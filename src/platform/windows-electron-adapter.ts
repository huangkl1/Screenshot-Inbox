import type { ElectronCapabilities } from "./electron-capabilities";
import type {
  CapturePlatformAdapter,
  CapturedDisplay,
  OverlayOpenInput,
  OverlayResult,
  OverlaySession,
  ShortcutRegistration
} from "./capture-platform-adapter";

interface DisplayLike {
  id: string | number;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

interface SourceLike {
  display_id?: string;
  thumbnail: { toDataURL(): string };
}

interface NativeWindowLike {
  loadURL(url: string): Promise<void>;
  on(event: string, callback: () => void): void;
  close(): void;
  isDestroyed?(): boolean;
  isMinimized?(): boolean;
  restore?(): void;
  show?(): void;
  focus?(): void;
  webContents?: {
    once(event: string, callback: (...args: unknown[]) => void): void;
    removeListener(event: string, callback: (...args: unknown[]) => void): void;
  };
}

interface BrowserWindowConstructor {
  new (options: Record<string, unknown>): NativeWindowLike;
  getFocusedWindow?(): NativeWindowLike | null;
  getAllWindows?(): NativeWindowLike[];
}

interface MainApis {
  globalShortcut: {
    register(accelerator: string, handler: () => void): boolean;
    isRegistered(accelerator: string): boolean;
    unregister(accelerator: string): void;
  };
  screen: { getPrimaryDisplay(): DisplayLike };
  BrowserWindow: BrowserWindowConstructor;
  ipcMain: {
    once(channel: string, listener: (event: unknown, payload: unknown) => void): void;
    removeListener(
      channel: string,
      listener: (event: unknown, payload: unknown) => void
    ): void;
  };
}

interface RendererApis {
  desktopCapturer: {
    getSources(options: {
      types: ["screen"];
      thumbnailSize: { width: number; height: number };
    }): Promise<SourceLike[]>;
  };
}

interface ActiveOverlay {
  close(): void;
}

const TOOLS = new Set(["pen", "rectangle", "arrow", "text"]);
const COLORS = new Set(["red", "yellow", "blue", "green", "black", "white"]);
const WIDTHS = new Set([2, 4, 8]);
const FONT_SIZES = new Set([10, 12, 16, 24, 32, 48, 62]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class WindowsElectronAdapter implements CapturePlatformAdapter {
  private readonly main: MainApis;
  private readonly renderer: RendererApis;
  private registeredAccelerator?: string;
  private activeOverlay?: ActiveOverlay;
  private previousWindow?: NativeWindowLike;
  private hostWindow?: NativeWindowLike;
  private disposed = false;

  constructor(
    capabilities: ElectronCapabilities,
    private readonly createDocument: (
      input: OverlayOpenInput,
      channel: string
    ) => string,
    private readonly overlayTimeoutMs = 10 * 60 * 1000
  ) {
    this.main = capabilities.main as unknown as MainApis;
    this.renderer = capabilities.renderer as unknown as RendererApis;
  }

  registerGlobalShortcut(
    accelerator: string,
    handler: () => void
  ): ShortcutRegistration {
    if (this.disposed) {
      return { ok: false, accelerator, message: "Screenshot Inbox is disposed" };
    }
    if (accelerator === this.registeredAccelerator) {
      return { ok: true, accelerator };
    }

    try {
      const registered = this.main.globalShortcut.register(accelerator, handler);
      const confirmed =
        registered && this.main.globalShortcut.isRegistered(accelerator);
      if (!confirmed) {
        if (this.main.globalShortcut.isRegistered(accelerator)) {
          this.main.globalShortcut.unregister(accelerator);
        }
        return {
          ok: false,
          accelerator,
          message: `Global shortcut is unavailable: ${accelerator}`
        };
      }

      const oldAccelerator = this.registeredAccelerator;
      this.registeredAccelerator = accelerator;
      if (oldAccelerator && oldAccelerator !== accelerator) {
        this.main.globalShortcut.unregister(oldAccelerator);
      }
      return { ok: true, accelerator };
    } catch (error) {
      return {
        ok: false,
        accelerator,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  unregisterGlobalShortcut(): void {
    if (!this.registeredAccelerator) return;
    const accelerator = this.registeredAccelerator;
    this.registeredAccelerator = undefined;
    try {
      this.main.globalShortcut.unregister(accelerator);
    } catch {
      // Native cleanup must remain best-effort during unload.
    }
  }

  async capturePrimaryDisplay(): Promise<CapturedDisplay> {
    this.requireActive();
    const display = this.main.screen.getPrimaryDisplay();
    const physicalSize = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    };
    const sources = await this.renderer.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: physicalSize
    });
    const expectedId = String(display.id);
    const source =
      sources.find(candidate => candidate.display_id === expectedId) ??
      (sources.length === 1 ? sources[0] : undefined);
    if (!source) throw new Error("Primary display capture failed");

    return {
      pngDataUrl: source.thumbnail.toDataURL(),
      physicalSize,
      logicalBounds: { ...display.bounds },
      scaleFactor: display.scaleFactor
    };
  }

  async openOverlay(input: OverlayOpenInput): Promise<OverlaySession> {
    this.requireActive();
    if (this.activeOverlay) throw new Error("A screenshot overlay is already active");

    this.previousWindow = this.main.BrowserWindow.getFocusedWindow?.() ?? undefined;
    this.hostWindow =
      this.previousWindow ??
      this.main.BrowserWindow.getAllWindows?.().find(candidate => !candidate.isDestroyed?.());
    const channel = `screenshot-inbox:${crypto.randomUUID()}`;
    const knownNotes = new Set(input.notes.map(note => note.path));
    const bounds = input.capture.logicalBounds;
    const window = new this.main.BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    });

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveResult!: (value: OverlayResult) => void;
    let rejectResult!: (reason: Error) => void;
    const result = new Promise<OverlayResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const cleanupListener = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      this.main.ipcMain.removeListener(channel, onResult);
      window.webContents?.removeListener("render-process-gone", onRendererFailure);
      window.webContents?.removeListener("unresponsive", onRendererFailure);
    };
    const settle = (value: OverlayResult | Error) => {
      if (settled) return;
      settled = true;
      cleanupListener();
      if (value instanceof Error) rejectResult(value);
      else resolveResult(value);
    };
    const onResult = (_event: unknown, payload: unknown) => {
      try {
        settle(this.validateResult(payload, channel, input, knownNotes));
      } catch {
        settle(new Error("Invalid overlay result"));
      }
    };
    const onRendererFailure = () => {
      settle(new Error("Screenshot overlay renderer failed"));
      if (!window.isDestroyed?.()) window.close();
    };

    this.main.ipcMain.once(channel, onResult);
    window.webContents?.once("render-process-gone", onRendererFailure);
    window.webContents?.once("unresponsive", onRendererFailure);
    window.on("closed", () => {
      if (!settled) settle({ status: "cancelled" });
      if (this.activeOverlay === session) this.activeOverlay = undefined;
    });
    timer = setTimeout(() => {
      settle(new Error("Screenshot overlay timed out"));
      if (!window.isDestroyed?.()) window.close();
    }, this.overlayTimeoutMs);

    const session: OverlaySession = {
      result,
      close: () => {
        if (!settled) settle({ status: "cancelled" });
        if (!window.isDestroyed?.()) window.close();
        if (this.activeOverlay === session) this.activeOverlay = undefined;
      }
    };
    this.activeOverlay = session;

    const html = this.createDocument(input, channel);
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    try {
      await window.loadURL(dataUrl);
    } catch (error) {
      session.close();
      throw error;
    }
    return session;
  }

  async restorePreviousFocus(): Promise<void> {
    const previous = this.previousWindow;
    this.previousWindow = undefined;
    if (!previous || previous.isDestroyed?.()) return;
    try {
      previous.show?.();
      previous.focus?.();
    } catch {
      // Focus restoration is deliberately best-effort.
    }
  }

  async activateHostWindow(): Promise<void> {
    const host = this.hostWindow ?? this.previousWindow;
    if (!host || host.isDestroyed?.()) return;
    try {
      if (host.isMinimized?.()) host.restore?.();
      host.show?.();
      host.focus?.();
    } catch {
      // Host activation is best-effort across Electron/Windows versions.
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterGlobalShortcut();
    this.activeOverlay?.close();
    this.activeOverlay = undefined;
    this.previousWindow = undefined;
    this.hostWindow = undefined;
  }

  private validateResult(
    payload: unknown,
    channel: string,
    input: OverlayOpenInput,
    knownNotes: ReadonlySet<string>
  ): OverlayResult {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Missing payload");
    }
    const envelope = payload as { channel?: unknown; result?: unknown };
    if (envelope.channel !== channel) throw new Error("Wrong channel");
    const result = envelope.result;
    if (typeof result !== "object" || result === null) {
      throw new Error("Missing result");
    }
    const candidate = result as Record<string, unknown>;
    if (candidate.status === "cancelled") return { status: "cancelled" };
    if (candidate.status !== "saved") throw new Error("Unknown status");

    const png = this.asBytes(candidate.png);
    const maximumBytes =
      input.capture.physicalSize.width * input.capture.physicalSize.height * 4;
    if (
      png.byteLength < PNG_SIGNATURE.length ||
      png.byteLength > maximumBytes ||
      !PNG_SIGNATURE.every((byte, index) => png[index] === byte)
    ) {
      throw new Error("Invalid PNG");
    }
    if (
      typeof candidate.targetNotePath !== "string" ||
      !knownNotes.has(candidate.targetNotePath)
    ) {
      throw new Error("Unknown target note");
    }
    if (
      typeof candidate.lastTool !== "string" ||
      !TOOLS.has(candidate.lastTool) ||
      typeof candidate.lastColor !== "string" ||
      !COLORS.has(candidate.lastColor) ||
      typeof candidate.lastStrokeWidth !== "number" ||
      !WIDTHS.has(candidate.lastStrokeWidth) ||
      typeof candidate.lastFontSize !== "number" ||
      !FONT_SIZES.has(candidate.lastFontSize)
    ) {
      throw new Error("Invalid annotation settings");
    }
    const description = typeof candidate.description === "string"
      ? candidate.description
      : "";
    const filename = typeof candidate.filename === "string"
      ? candidate.filename
      : "";

    return {
      status: "saved",
      png,
      targetNotePath: candidate.targetNotePath,
      filename,
      description,
      lastTool: candidate.lastTool as "pen" | "rectangle" | "arrow" | "text",
      lastColor: candidate.lastColor as
        | "red"
        | "yellow"
        | "blue"
        | "green"
        | "black"
        | "white",
      lastStrokeWidth: candidate.lastStrokeWidth as 2 | 4 | 8,
      lastFontSize: candidate.lastFontSize as 10 | 12 | 16 | 24 | 32 | 48 | 62
    };
  }

  private asBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value) && value.every(item => Number.isInteger(item))) {
      return new Uint8Array(value as number[]);
    }
    if (typeof value === "object" && value !== null && "data" in value) {
      const data = (value as { data?: unknown }).data;
      if (Array.isArray(data) && data.every(item => Number.isInteger(item))) {
        return new Uint8Array(data as number[]);
      }
    }
    throw new Error("Invalid bytes");
  }

  private requireActive(): void {
    if (this.disposed) throw new Error("Screenshot Inbox platform is disposed");
  }
}

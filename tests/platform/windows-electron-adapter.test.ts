import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsElectronAdapter } from "../../src/platform/windows-electron-adapter";
import type { OverlayOpenInput } from "../../src/platform/capture-platform-adapter";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

class MockWindow {
  static instances: MockWindow[] = [];
  static focused: MockWindow | null = null;
  options: Record<string, unknown>;
  loadedUrl = "";
  closed = false;
  focused = false;
  shown = false;
  minimized = false;
  restored = false;
  listeners = new Map<string, Array<() => void>>();
  webContents = {
    listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
    once: (event: string, callback: (...args: unknown[]) => void) => {
      const listeners = this.webContents.listeners.get(event) ?? [];
      listeners.push(callback);
      this.webContents.listeners.set(event, listeners);
    },
    removeListener: (event: string, callback: (...args: unknown[]) => void) => {
      const listeners = this.webContents.listeners.get(event) ?? [];
      this.webContents.listeners.set(event, listeners.filter(item => item !== callback));
    },
    emit: (event: string, ...args: unknown[]) => {
      const listeners = [...(this.webContents.listeners.get(event) ?? [])];
      this.webContents.listeners.delete(event);
      for (const callback of listeners) callback(...args);
    }
  };

  constructor(options: Record<string, unknown>) {
    this.options = options;
    MockWindow.instances.push(this);
  }

  static getFocusedWindow() {
    return MockWindow.focused;
  }

  static getAllWindows() {
    return MockWindow.instances;
  }

  async loadURL(url: string) {
    this.loadedUrl = url;
  }

  on(event: string, callback: () => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(callback);
    this.listeners.set(event, listeners);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const callback of this.listeners.get("closed") ?? []) callback();
  }

  isDestroyed() {
    return this.closed;
  }

  isMinimized() {
    return this.minimized;
  }

  restore() {
    this.minimized = false;
    this.restored = true;
  }

  show() {
    this.shown = true;
  }

  focus() {
    this.focused = true;
  }
}

describe("WindowsElectronAdapter", () => {
  let registered: Map<string, () => void>;
  let ipcListeners: Map<string, (event: unknown, payload: unknown) => void>;
  let sources: Array<{ display_id?: string; thumbnail: { toDataURL(): string } }>;
  let captureOptions: unknown[];
  let capabilities: ReturnType<typeof createCapabilities>;

  function createCapabilities() {
    return {
      main: {
        globalShortcut: {
          register: vi.fn((accelerator: string, handler: () => void) => {
            if (accelerator === "Occupied") return false;
            if (accelerator === "Throws") throw new Error("native failure");
            registered.set(accelerator, handler);
            return true;
          }),
          isRegistered: vi.fn((accelerator: string) => registered.has(accelerator)),
          unregister: vi.fn((accelerator: string) => registered.delete(accelerator))
        },
        screen: {
          getPrimaryDisplay: vi.fn(() => ({
            id: 7,
            bounds: { x: -100, y: 50, width: 1920, height: 1080 },
            size: { width: 1920, height: 1080 },
            scaleFactor: 1.25
          }))
        },
        BrowserWindow: MockWindow,
        ipcMain: {
          once: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
            ipcListeners.set(channel, listener);
          }),
          removeListener: vi.fn((channel: string) => ipcListeners.delete(channel))
        }
      },
      renderer: {
        desktopCapturer: {
          getSources: vi.fn(async (options: unknown) => {
            captureOptions.push(options);
            return sources;
          })
        }
      }
    };
  }

  function input(): OverlayOpenInput {
    return {
      capture: {
        pngDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        physicalSize: { width: 2400, height: 1350 },
        logicalBounds: { x: -100, y: 50, width: 1920, height: 1080 },
        scaleFactor: 1.25
      },
      notes: [{ path: "Inbox.md", label: "Inbox", isDefault: true }],
      settings: {
        lastTool: "pen",
        lastColor: "red",
        lastStrokeWidth: 4,
        lastFontSize: 24,
        showDescriptionInput: true
      }
    };
  }

  beforeEach(() => {
    registered = new Map();
    ipcListeners = new Map();
    sources = [
      { display_id: "other", thumbnail: { toDataURL: () => "wrong" } },
      {
        display_id: "7",
        thumbnail: { toDataURL: () => "data:image/png;base64,primary" }
      }
    ];
    captureOptions = [];
    MockWindow.instances = [];
    MockWindow.focused = null;
    capabilities = createCapabilities();
  });

  it("registers a shortcut only when Electron confirms it", () => {
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    const handler = vi.fn();

    expect(adapter.registerGlobalShortcut("Alt+Q", handler)).toEqual({
      ok: true,
      accelerator: "Alt+Q"
    });
    registered.get("Alt+Q")?.();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps the old shortcut active when replacement fails or throws", () => {
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    const oldHandler = vi.fn();
    adapter.registerGlobalShortcut("Alt+Q", oldHandler);

    expect(adapter.registerGlobalShortcut("Occupied", vi.fn())).toMatchObject({ ok: false });
    expect(adapter.registerGlobalShortcut("Throws", vi.fn())).toMatchObject({ ok: false });
    expect(registered.has("Alt+Q")).toBe(true);
    expect(capabilities.main.globalShortcut.unregister).not.toHaveBeenCalledWith("Alt+Q");
  });

  it("activates the new shortcut before unregistering the old one", () => {
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    adapter.registerGlobalShortcut("Alt+Q", vi.fn());

    expect(adapter.registerGlobalShortcut("Ctrl+Shift+S", vi.fn())).toEqual({
      ok: true,
      accelerator: "Ctrl+Shift+S"
    });
    expect(registered.has("Alt+Q")).toBe(false);
    expect(registered.has("Ctrl+Shift+S")).toBe(true);
  });

  it("captures the primary display at exact physical dimensions", async () => {
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");

    await expect(adapter.capturePrimaryDisplay()).resolves.toEqual({
      pngDataUrl: "data:image/png;base64,primary",
      physicalSize: { width: 2400, height: 1350 },
      logicalBounds: { x: -100, y: 50, width: 1920, height: 1080 },
      scaleFactor: 1.25
    });
    expect(captureOptions).toEqual([
      { types: ["screen"], thumbnailSize: { width: 2400, height: 1350 } }
    ]);
  });

  it("rejects a missing primary display source", async () => {
    sources = [];
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    await expect(adapter.capturePrimaryDisplay()).rejects.toThrow(
      "Primary display capture failed"
    );
  });

  it("opens a local overlay and validates the randomized IPC result", async () => {
    const adapter = new WindowsElectronAdapter(capabilities as never, (_input, channel) =>
      `<html data-channel="${channel}"></html>`
    );
    const session = await adapter.openOverlay(input());
    const overlay = MockWindow.instances[0];
    const channel = [...ipcListeners.keys()][0];

    expect(channel).toMatch(/^screenshot-inbox:[0-9a-f-]+$/);
    expect(overlay.loadedUrl).toMatch(/^data:text\/html/);
    expect(overlay.options).toMatchObject({
      x: -100,
      y: 50,
      width: 1920,
      height: 1080,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    });

    ipcListeners.get(channel)?.({}, {
      channel,
      result: {
        status: "saved",
        png: PNG,
        targetNotePath: "Inbox.md",
        filename: "接口设计草图.png",
        lastTool: "pen",
        lastColor: "red",
        lastStrokeWidth: 4,
        lastFontSize: 24
      }
    });

    await expect(session.result).resolves.toMatchObject({
      status: "saved",
      targetNotePath: "Inbox.md",
      filename: "接口设计草图.png"
    });
    expect(ipcListeners.has(channel)).toBe(false);
  });

  it("rejects invalid PNG or unknown note payloads", async () => {
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    const session = await adapter.openOverlay(input());
    const channel = [...ipcListeners.keys()][0];
    ipcListeners.get(channel)?.({}, {
      channel,
      result: {
        status: "saved",
        png: new Uint8Array([1, 2, 3]),
        targetNotePath: "Missing.md",
        lastTool: "pen",
        lastColor: "red",
        lastStrokeWidth: 4
      }
    });
    await expect(session.result).rejects.toThrow("Invalid overlay result");
  });

  it("immediately rejects and closes when the overlay renderer crashes", async () => {
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    const session = await adapter.openOverlay(input());
    const overlay = MockWindow.instances[0];

    overlay.webContents.emit("render-process-gone", {}, { reason: "crashed" });

    await expect(session.result).rejects.toThrow("Screenshot overlay renderer failed");
    expect(overlay.closed).toBe(true);
  });

  it("restores prior focus best-effort and disposes idempotently", async () => {
    const previous = new MockWindow({});
    MockWindow.focused = previous;
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    adapter.registerGlobalShortcut("Alt+Q", vi.fn());
    const session = await adapter.openOverlay(input());
    await adapter.restorePreviousFocus();
    await adapter.dispose();
    await adapter.dispose();

    expect(previous.shown).toBe(true);
    expect(previous.focused).toBe(true);
    expect(capabilities.main.globalShortcut.unregister).toHaveBeenCalledTimes(1);
    expect(MockWindow.instances.at(-1)?.closed).toBe(true);
    session.close();
  });

  it("activates and restores a minimized Obsidian host window", async () => {
    const host = new MockWindow({ host: true });
    host.minimized = true;
    MockWindow.focused = null;
    const adapter = new WindowsElectronAdapter(capabilities as never, () => "<html></html>");
    const session = await adapter.openOverlay(input());

    await adapter.activateHostWindow();

    expect(host.restored).toBe(true);
    expect(host.shown).toBe(true);
    expect(host.focused).toBe(true);
    session.close();
  });
});

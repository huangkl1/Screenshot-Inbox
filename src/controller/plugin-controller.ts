import type { TFile } from "obsidian";
import type { NoteTargetService } from "../notes/note-target-service";
import type {
  CapturePlatformAdapter,
  OverlayInput,
  OverlayResult,
  OverlaySession,
  ShortcutRegistration
} from "../platform/capture-platform-adapter";
import type { ScreenshotInboxSettings } from "../settings/settings";
import type {
  CaptureWriter,
  SaveCaptureResult
} from "../writer/capture-writer";

export type ControllerState = "idle" | "capturing" | "editing" | "saving";

export interface ControllerSettingsStore {
  get(): ScreenshotInboxSettings;
  update(patch: Partial<ScreenshotInboxSettings>): Promise<void>;
}

export interface ControllerNotices {
  captureError(error: unknown): void;
  nonFatalError(message: string, error: unknown): void;
  saved(targetNotePath: string, openNote: () => Promise<void>): void;
  pendingInsert(targetNotePath: string, retry: () => Promise<void>): void;
  shortcutError(message: string): void;
}

export interface PluginControllerOptions {
  platform: CapturePlatformAdapter;
  targets: NoteTargetService;
  writer: CaptureWriter;
  settings: ControllerSettingsStore;
  notices: ControllerNotices;
  openNote(path: string): Promise<void>;
  onStateChange?(state: ControllerState): void;
  now?(): Date;
}

function noteOption(file: TFile, defaultPath: string) {
  return {
    path: file.path,
    label: file.basename,
    isDefault: file.path === defaultPath
  };
}

export class PluginController {
  private state: ControllerState = "idle";
  private activeSession?: OverlaySession;
  private disposed = false;
  private registeredAccelerator?: string;
  private shortcutError?: string;
  private readonly shortcutHandler = () => {
    void this.startCapture();
  };

  constructor(private readonly options: PluginControllerOptions) {}

  get currentState(): ControllerState {
    return this.state;
  }

  get currentAccelerator(): string | undefined {
    return this.registeredAccelerator;
  }

  get lastShortcutError(): string | undefined {
    return this.shortcutError;
  }

  registerConfiguredShortcut(): ShortcutRegistration {
    const result = this.options.platform.registerGlobalShortcut(
      this.options.settings.get().accelerator,
      this.shortcutHandler
    );
    if (result.ok) {
      this.registeredAccelerator = result.accelerator;
      this.shortcutError = undefined;
    } else {
      this.shortcutError = result.message;
      this.options.notices.shortcutError(result.message);
    }
    return result;
  }

  async changeAccelerator(accelerator: string): Promise<ShortcutRegistration> {
    const previous = this.options.settings.get().accelerator;
    const result = this.options.platform.registerGlobalShortcut(
      accelerator,
      this.shortcutHandler
    );
    if (!result.ok) {
      this.shortcutError = result.message;
      this.options.notices.shortcutError(result.message);
      return result;
    }

    try {
      await this.options.settings.update({ accelerator: result.accelerator });
      this.registeredAccelerator = result.accelerator;
      this.shortcutError = undefined;
      return result;
    } catch (error) {
      const rollback = this.options.platform.registerGlobalShortcut(
        previous,
        this.shortcutHandler
      );
      const message = rollback.ok
        ? "快捷键设置保存失败，已恢复原快捷键"
        : "快捷键设置保存失败，且无法恢复原快捷键";
      this.options.notices.shortcutError(message);
      this.shortcutError = message;
      throw error;
    }
  }

  async startCapture(): Promise<void> {
    if (this.disposed || this.state !== "idle") return;
    this.setState("capturing");
    let session: OverlaySession | undefined;
    try {
      const capture = await this.options.platform.capturePrimaryDisplay();
      if (this.disposed) return;
      const input = await this.buildOverlayInput(capture);
      this.setState("editing");
      session = await this.options.platform.openOverlay(input);
      this.activeSession = session;
      const result = await session.result;
      session.close();
      this.activeSession = undefined;
      session = undefined;
      if (result.status === "cancelled" || result.png.byteLength === 0) return;
      this.setState("saving");
      const saved = await this.options.writer.save({
        png: result.png,
        targetNotePath: result.targetNotePath,
        filename: result.filename,
        description: result.description,
        capturedAt: this.options.now?.() ?? new Date()
      });
      await this.finishSave(saved, result);
    } catch (error) {
      if (!this.disposed) this.options.notices.captureError(error);
    } finally {
      session?.close();
      if (this.activeSession === session) this.activeSession = undefined;
      this.setState("idle");
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.activeSession?.close();
    this.activeSession = undefined;
    await this.options.platform.dispose();
    this.setState("idle");
  }

  async offerPendingInserts(): Promise<void> {
    if (this.disposed) return;
    const records = await this.options.writer.listPendingInserts();
    if (this.disposed) return;
    for (const record of records) {
      if (!record.completed) this.offerPendingInsert(record.id, record.targetNotePath);
    }
  }

  private async buildOverlayInput(
    capture: OverlayInput["capture"]
  ): Promise<OverlayInput> {
    const defaultNote = await this.options.targets.ensureDefaultNote();
    const recent = this.options.targets.getRecentNotes(5);
    const all = this.options.targets.getAllNotes();
    const files: TFile[] = [];
    const seen = new Set<string>();
    for (const file of [defaultNote, ...recent, ...all]) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }
    const settings = this.options.settings.get();
    return {
      capture,
      notes: files.map(file => noteOption(file, defaultNote.path)),
      settings: {
        lastTool: settings.lastTool,
        lastColor: settings.lastColor,
        lastStrokeWidth: settings.lastStrokeWidth,
        lastFontSize: settings.lastFontSize,
        showDescriptionInput: settings.showDescriptionInput
      }
    };
  }

  private async finishSave(
    saved: SaveCaptureResult,
    overlay: Extract<OverlayResult, { status: "saved" }>
  ): Promise<void> {
    try {
      await this.options.settings.update({
        lastTool: overlay.lastTool,
        lastColor: overlay.lastColor,
        lastStrokeWidth: overlay.lastStrokeWidth,
        lastFontSize: overlay.lastFontSize
      });
    } catch (error) {
      this.options.notices.nonFatalError("截图已保存，但标注偏好未能记住", error);
    }

    if (saved.status === "pending-insert") {
      this.offerPendingInsert(saved.pendingId, saved.targetNotePath);
      await this.restoreOrOpenSafely(saved.targetNotePath);
      return;
    }
    await this.afterCompleteSave(saved.targetNotePath);
  }

  private offerPendingInsert(pendingId: string, targetNotePath: string): void {
    this.options.notices.pendingInsert(targetNotePath, async () => {
      if (this.disposed) return;
      try {
        const retried = await this.options.writer.retryPendingInsert(pendingId);
        if (!this.disposed && retried.status === "saved") {
          await this.afterCompleteSave(retried.targetNotePath);
        }
      } catch (error) {
        this.options.notices.captureError(error);
      }
    });
  }

  private async afterCompleteSave(targetNotePath: string): Promise<void> {
    this.options.notices.saved(
      targetNotePath,
      async () => {
        try {
          await this.options.platform.activateHostWindow();
          await this.options.openNote(targetNotePath);
        } catch (error) {
          this.options.notices.nonFatalError("截图已保存，但目标笔记未能打开", error);
        }
      }
    );
    await this.restoreOrOpenSafely(targetNotePath);
  }

  private async restoreOrOpenSafely(targetNotePath: string): Promise<void> {
    try {
      await this.restoreOrOpen(targetNotePath);
    } catch (error) {
      this.options.notices.nonFatalError("截图已保存，但保存后窗口切换失败", error);
    }
  }

  private async restoreOrOpen(targetNotePath: string): Promise<void> {
    if (this.options.settings.get().afterSaveAction === "open-note") {
      await this.options.platform.activateHostWindow();
      await this.options.openNote(targetNotePath);
    } else {
      await this.options.platform.restorePreviousFocus();
    }
  }

  private setState(state: ControllerState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

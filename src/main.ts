import { Notice, Plugin, type TFile } from "obsidian";
import {
  PluginController,
  type ControllerNotices
} from "./controller/plugin-controller";
import {
  NoteTargetServiceImpl,
  type NoteTargetService
} from "./notes/note-target-service";
import { createOverlayDocument } from "./overlay/overlay-document";
import { loadElectronCapabilities } from "./platform/electron-capabilities";
import { WindowsElectronAdapter } from "./platform/windows-electron-adapter";
import { PluginDataStore } from "./settings/plugin-data-store";
import { ScreenshotInboxSettingTab } from "./settings/settings-tab";
import { CaptureWriterImpl } from "./writer/capture-writer";
import { PersistentPendingInsertStore } from "./writer/persistent-pending-store";

function nameFromPath(path: string): string {
  return (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");
}

function addNoticeAction(
  message: string,
  label: string,
  action: () => Promise<void>
): void {
  const notice = new Notice(message, 10_000);
  const button = notice.noticeEl.createEl("button", { text: label });
  button.addEventListener("click", () => void action());
}

class ObsidianControllerNotices implements ControllerNotices {
  captureError(error: unknown): void {
    const description = error instanceof Error ? error.message : "未知错误";
    new Notice(`Screenshot Inbox 操作失败：${description}`);
  }

  nonFatalError(message: string, error: unknown): void {
    const description = error instanceof Error ? error.message : "未知错误";
    new Notice(`${message}：${description}`);
  }

  saved(targetNotePath: string, openNote: () => Promise<void>): void {
    addNoticeAction(`截图已保存到 ${nameFromPath(targetNotePath)}`, "打开笔记", openNote);
  }

  pendingInsert(targetNotePath: string, retry: () => Promise<void>): void {
    addNoticeAction(
      `图片已保存，但尚未插入 ${nameFromPath(targetNotePath)}`,
      "重试插入",
      retry
    );
  }

  shortcutError(message: string): void {
    new Notice(`Screenshot Inbox 快捷键注册失败：${message}`);
  }
}

export interface PluginRuntime {
  controller: PluginController;
  targets: NoteTargetService;
  settingsTab: ScreenshotInboxSettingTab;
}

export default class ScreenshotInboxPlugin extends Plugin {
  private runtime?: PluginRuntime;
  private dataStore?: PluginDataStore;

  async onload(): Promise<void> {
    this.dataStore = await PluginDataStore.load(this);
    const runtime = await this.createRuntime(this.dataStore);
    this.runtime = runtime;

    this.addCommand({
      id: "start-capture",
      name: "开始截图",
      callback: () => void runtime.controller.startCapture()
    });
    this.addSettingTab(runtime.settingsTab);
    this.registerEvent(
      this.app.workspace.on("file-open", file => {
        if (file) void runtime.targets.recordOpenedNote(file);
      })
    );
    runtime.controller.registerConfiguredShortcut();
    await runtime.controller.offerPendingInserts();
  }

  async onunload(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = undefined;
    runtime?.targets.dispose();
    await runtime?.controller.dispose();
  }

  protected async createRuntime(store: PluginDataStore): Promise<PluginRuntime> {
    const rendererRequire = (globalThis as unknown as {
      require?: (specifier: string) => unknown;
    }).require;
    if (!rendererRequire) {
      throw new Error(
        "Screenshot Inbox requires the Windows desktop version of Obsidian with Electron modules"
      );
    }
    const capabilities = loadElectronCapabilities(rendererRequire);
    const platform = new WindowsElectronAdapter(capabilities, createOverlayDocument);
    const targets = new NoteTargetServiceImpl(
      this.app.vault,
      () => store.get(),
      paths => store.update({ recentNotePaths: paths })
    );
    const pending = new PersistentPendingInsertStore(
      () => store.getPendingInserts(),
      records => store.replacePendingInserts(records)
    );
    const writer = new CaptureWriterImpl(
      this.app.vault,
      this.app.fileManager,
      targets,
      pending
    );
    const openNote = async (path: string) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !("extension" in file) || (file as TFile).extension !== "md") {
        throw new Error(`目标笔记不存在：${path}`);
      }
      await this.app.workspace.getLeaf(false).openFile(file as TFile);
    };
    const controller = new PluginController({
      platform,
      targets,
      writer,
      settings: store,
      notices: new ObsidianControllerNotices(),
      openNote
    });
    return {
      controller,
      targets,
      settingsTab: new ScreenshotInboxSettingTab(this.app, this, controller, store)
    };
  }
}

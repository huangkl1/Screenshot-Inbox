import { describe, expect, it, vi } from "vitest";
import type {
  CapturedDisplay,
  OverlayResult,
  OverlaySession
} from "../../src/platform/capture-platform-adapter";
import { DEFAULT_SETTINGS, type ScreenshotInboxSettings } from "../../src/settings/settings";
import {
  PluginController,
  type ControllerNotices,
  type ControllerSettingsStore
} from "../../src/controller/plugin-controller";
import ScreenshotInboxPlugin, {
  type PluginRuntime
} from "../../src/main";
import type { PendingInsertRecord } from "../../src/writer/capture-writer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const capture: CapturedDisplay = {
  pngDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  physicalSize: { width: 100, height: 80 },
  logicalBounds: { x: 0, y: 0, width: 100, height: 80 },
  scaleFactor: 1
};

const savedOverlay: OverlayResult = {
  status: "saved",
  png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  targetNotePath: "Recent.md",
  filename: "接口设计草图.png",
  description: "截图说明",
  lastTool: "arrow",
  lastColor: "blue",
  lastStrokeWidth: 8,
  lastFontSize: 62
};

function testFile(path: string) {
  const name = path.split("/").at(-1) ?? path;
  return { path, basename: name.replace(/\.md$/i, ""), extension: "md" };
}

function setup() {
  const captureDeferred = deferred<CapturedDisplay>();
  const resultDeferred = deferred<OverlayResult>();
  const saveDeferred = deferred<any>();
  const close = vi.fn();
  const session: OverlaySession = { result: resultDeferred.promise, close };
  const settings: ScreenshotInboxSettings = {
    ...DEFAULT_SETTINGS,
    recentNotePaths: ["Recent.md"]
  };
  const settingsStore: ControllerSettingsStore = {
    get: vi.fn(() => ({ ...settings, recentNotePaths: [...settings.recentNotePaths] })),
    update: vi.fn(async patch => Object.assign(settings, patch))
  };
  const platform = {
    registerGlobalShortcut: vi.fn((accelerator: string) => ({ ok: true as const, accelerator })),
    unregisterGlobalShortcut: vi.fn(),
    capturePrimaryDisplay: vi.fn(() => captureDeferred.promise),
    openOverlay: vi.fn(async () => session),
    restorePreviousFocus: vi.fn(async () => undefined),
    activateHostWindow: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  };
  const targets = {
    ensureDefaultNote: vi.fn(async () => testFile("截图收集.md")),
    recordOpenedNote: vi.fn(async () => undefined),
    getRecentNotes: vi.fn(() => [testFile("Recent.md")]),
    getAllNotes: vi.fn(() => [testFile("截图收集.md"), testFile("Recent.md"), testFile("Other.md")]),
    searchNotes: vi.fn(() => []),
    resolveTarget: vi.fn(async (path?: string) => testFile(path ?? "截图收集.md"))
  };
  const writer = {
    save: vi.fn(() => saveDeferred.promise),
    listPendingInserts: vi.fn<() => Promise<PendingInsertRecord[]>>(async () => []),
    retryPendingInsert: vi.fn(async () => ({
      status: "saved" as const,
      attachmentPath: "attachments/a.png",
      targetNotePath: "Recent.md",
      embed: "![[a.png]]"
    }))
  };
  const notices: ControllerNotices = {
    captureError: vi.fn(),
    nonFatalError: vi.fn(),
    saved: vi.fn(),
    pendingInsert: vi.fn(),
    shortcutError: vi.fn()
  };
  const openNote = vi.fn(async () => undefined);
  const states: string[] = [];
  const controller = new PluginController({
    platform,
    targets: targets as never,
    writer,
    settings: settingsStore,
    notices,
    openNote,
    onStateChange: value => states.push(value)
  });
  return {
    controller, platform, targets, writer, settingsStore, notices, openNote,
    captureDeferred, resultDeferred, saveDeferred, close, states, settings
  };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("PluginController", () => {
  it("严格按 idle → capturing → editing → saving → idle 运行并忽略重入", async () => {
    const context = setup();
    const running = context.controller.startCapture();
    expect(context.controller.currentState).toBe("capturing");
    await context.controller.startCapture();
    expect(context.platform.capturePrimaryDisplay).toHaveBeenCalledTimes(1);

    context.captureDeferred.resolve(capture);
    await flush();
    expect(context.controller.currentState).toBe("editing");
    expect(context.platform.openOverlay).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ showDescriptionInput: true }),
      notes: [
        { path: "截图收集.md", label: "截图收集", isDefault: true },
        { path: "Recent.md", label: "Recent", isDefault: false },
        { path: "Other.md", label: "Other", isDefault: false }
      ]
    }));

    context.resultDeferred.resolve(savedOverlay);
    await flush();
    expect(context.controller.currentState).toBe("saving");
    expect(context.close).toHaveBeenCalledOnce();
    await context.controller.startCapture();
    expect(context.platform.capturePrimaryDisplay).toHaveBeenCalledTimes(1);

    context.saveDeferred.resolve({
      status: "saved",
      attachmentPath: "attachments/a.png",
      targetNotePath: "Recent.md",
      embed: "![[a.png]]"
    });
    await running;
    expect(context.states).toEqual(["capturing", "editing", "saving", "idle"]);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.settingsStore.update).toHaveBeenCalledWith({
      lastTool: "arrow",
      lastColor: "blue",
      lastStrokeWidth: 8,
      lastFontSize: 62
    });
    expect(context.writer.save).toHaveBeenCalledWith(expect.objectContaining({
      filename: "接口设计草图.png",
      description: "截图说明"
    }));
    expect(context.platform.restorePreviousFocus).toHaveBeenCalledOnce();
    expect(context.notices.saved).toHaveBeenCalledWith("Recent.md", expect.any(Function));
  });

  it("捕获失败、取消、空 PNG 和写入异常都回到 idle 且不产生额外写入", async () => {
    const failed = setup();
    const failedRun = failed.controller.startCapture();
    failed.captureDeferred.reject(new Error("capture failed"));
    await failedRun;
    expect(failed.controller.currentState).toBe("idle");
    expect(failed.writer.save).not.toHaveBeenCalled();
    expect(failed.notices.captureError).toHaveBeenCalledOnce();

    for (const result of [
      { status: "cancelled" } as const,
      { ...savedOverlay, png: new Uint8Array() }
    ]) {
      const context = setup();
      const running = context.controller.startCapture();
      context.captureDeferred.resolve(capture);
      await flush();
      context.resultDeferred.resolve(result);
      await running;
      expect(context.writer.save).not.toHaveBeenCalled();
      expect(context.close).toHaveBeenCalledOnce();
      expect(context.controller.currentState).toBe("idle");
    }

    const writerFailed = setup();
    const writerRun = writerFailed.controller.startCapture();
    writerFailed.captureDeferred.resolve(capture);
    await flush();
    writerFailed.resultDeferred.resolve(savedOverlay);
    await flush();
    writerFailed.saveDeferred.reject(new Error("disk full"));
    await writerRun;
    expect(writerFailed.notices.captureError).toHaveBeenCalledOnce();
    expect(writerFailed.close).toHaveBeenCalledOnce();
    expect(writerFailed.controller.currentState).toBe("idle");
  });

  it("待插入结果提供幂等重试动作，重试成功后才显示完成通知", async () => {
    const context = setup();
    const running = context.controller.startCapture();
    context.captureDeferred.resolve(capture);
    await flush();
    context.resultDeferred.resolve(savedOverlay);
    await flush();
    context.saveDeferred.resolve({
      status: "pending-insert",
      attachmentPath: "attachments/a.png",
      targetNotePath: "Recent.md",
      embed: "![[a.png]]",
      pendingId: "pending-1"
    });
    await running;

    expect(context.notices.pendingInsert).toHaveBeenCalledWith(
      "Recent.md",
      expect.any(Function)
    );
    expect(context.notices.saved).not.toHaveBeenCalled();
    const retry = vi.mocked(context.notices.pendingInsert).mock.calls[0][1];
    await retry();
    expect(context.writer.retryPendingInsert).toHaveBeenCalledWith("pending-1");
    expect(context.notices.saved).toHaveBeenCalledWith("Recent.md", expect.any(Function));
  });

  it("插件重启后重新提供所有未完成 pending 的重试入口", async () => {
    const context = setup();
    context.writer.listPendingInserts.mockResolvedValueOnce([
      {
        id: "pending-old",
        attachmentPath: "assets/old.png",
        targetNotePath: "Archive.md",
        embed: "![[old.png]]",
        completed: false
      },
      {
        id: "pending-done",
        attachmentPath: "assets/done.png",
        targetNotePath: "Done.md",
        embed: "![[done.png]]",
        completed: true
      }
    ]);

    await context.controller.offerPendingInserts();
    expect(context.notices.pendingInsert).toHaveBeenCalledTimes(1);
    expect(context.notices.pendingInsert).toHaveBeenCalledWith("Archive.md", expect.any(Function));
    const retry = vi.mocked(context.notices.pendingInsert).mock.calls[0][1];
    await retry();
    expect(context.writer.retryPendingInsert).toHaveBeenCalledWith("pending-old");
  });

  it("卸载后旧 pending 通知和未完成枚举都不能再触发写入", async () => {
    const first = setup();
    first.writer.listPendingInserts.mockResolvedValueOnce([{
      id: "pending-old",
      attachmentPath: "assets/old.png",
      targetNotePath: "Archive.md",
      embed: "![[old.png]]",
      completed: false
    }]);
    await first.controller.offerPendingInserts();
    const retry = vi.mocked(first.notices.pendingInsert).mock.calls[0][1];
    await first.controller.dispose();
    await retry();
    expect(first.writer.retryPendingInsert).not.toHaveBeenCalled();

    const second = setup();
    const pendingList = deferred<PendingInsertRecord[]>();
    second.writer.listPendingInserts.mockReturnValueOnce(pendingList.promise);
    const offering = second.controller.offerPendingInserts();
    await second.controller.dispose();
    pendingList.resolve([{
      id: "pending-late",
      attachmentPath: "assets/late.png",
      targetNotePath: "Late.md",
      embed: "![[late.png]]",
      completed: false
    }]);
    await offering;
    expect(second.notices.pendingInsert).not.toHaveBeenCalled();
  });

  it("open-note 模式打开实际目标，通知动作在两种模式都可打开笔记", async () => {
    const context = setup();
    context.settings.afterSaveAction = "open-note";
    const running = context.controller.startCapture();
    context.captureDeferred.resolve(capture);
    await flush();
    context.resultDeferred.resolve(savedOverlay);
    await flush();
    context.saveDeferred.resolve({
      status: "saved",
      attachmentPath: "a.png",
      targetNotePath: "Fallback.md",
      embed: "![[a.png]]"
    });
    await running;

    expect(context.openNote).toHaveBeenCalledWith("Fallback.md");
    expect(context.platform.activateHostWindow).toHaveBeenCalledOnce();
    expect(context.platform.restorePreviousFocus).not.toHaveBeenCalled();
    const openFromNotice = vi.mocked(context.notices.saved).mock.calls[0][1];
    await openFromNotice();
    expect(context.openNote).toHaveBeenLastCalledWith("Fallback.md");
  });

  it("设置记忆或保存后窗口切换失败不掩盖已经完成的截图保存", async () => {
    const context = setup();
    vi.mocked(context.settingsStore.update).mockRejectedValueOnce(new Error("data.json busy"));
    context.platform.restorePreviousFocus.mockRejectedValueOnce(new Error("focus denied"));
    const running = context.controller.startCapture();
    context.captureDeferred.resolve(capture);
    await flush();
    context.resultDeferred.resolve(savedOverlay);
    await flush();
    context.saveDeferred.resolve({
      status: "saved",
      attachmentPath: "a.png",
      targetNotePath: "Recent.md",
      embed: "![[a.png]]"
    });
    await running;

    expect(context.notices.saved).toHaveBeenCalledWith("Recent.md", expect.any(Function));
    expect(context.notices.nonFatalError).toHaveBeenCalledTimes(2);
    expect(context.notices.captureError).not.toHaveBeenCalled();
  });

  it("新快捷键先注册，只有成功才持久化，失败时保留旧快捷键", async () => {
    const context = setup();
    expect(context.controller.registerConfiguredShortcut()).toEqual({
      ok: true,
      accelerator: "Alt+Q"
    });

    context.platform.registerGlobalShortcut.mockReturnValueOnce({
      ok: false,
      accelerator: "Ctrl+Shift+Q",
      message: "conflict"
    } as never);
    await expect(context.controller.changeAccelerator("Ctrl+Shift+Q")).resolves.toMatchObject({
      ok: false
    });
    expect(context.settings.accelerator).toBe("Alt+Q");
    expect(context.notices.shortcutError).toHaveBeenCalledWith("conflict");

    await expect(context.controller.changeAccelerator("Ctrl+Alt+S")).resolves.toEqual({
      ok: true,
      accelerator: "Ctrl+Alt+S"
    });
    expect(context.settings.accelerator).toBe("Ctrl+Alt+S");
  });

  it("卸载拒绝新会话并释放平台和活动覆盖层", async () => {
    const context = setup();
    const running = context.controller.startCapture();
    context.captureDeferred.resolve(capture);
    await flush();
    await context.controller.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.platform.dispose).toHaveBeenCalledOnce();
    context.resultDeferred.resolve({ status: "cancelled" });
    await running;
    await context.controller.startCapture();
    expect(context.platform.capturePrimaryDisplay).toHaveBeenCalledTimes(1);
  });
});

describe("ScreenshotInboxPlugin lifecycle", () => {
  it("加载时注册命令、全局快捷键和文件打开事件，卸载时完整清理", async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const app = {
      workspace: {
        on: vi.fn((event: string, callback: (...args: any[]) => void) => {
          listeners.set(event, callback);
          return { unload: vi.fn() };
        })
      }
    };
    const controller = {
      startCapture: vi.fn(async () => undefined),
      registerConfiguredShortcut: vi.fn(() => ({ ok: true, accelerator: "Alt+Q" })),
      offerPendingInserts: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined)
    };
    const targets = {
      ensureDefaultNote: vi.fn(async () => testFile("截图收集.md")),
      recordOpenedNote: vi.fn(async () => undefined),
      dispose: vi.fn()
    };
    const runtime: PluginRuntime = {
      controller: controller as never,
      targets: targets as never,
      settingsTab: { display: vi.fn() } as never
    };
    class TestPlugin extends ScreenshotInboxPlugin {
      protected override async createRuntime(): Promise<PluginRuntime> {
        return runtime;
      }
    }
    const plugin = new TestPlugin(app as never, { id: "screenshot-inbox" } as never);

    await plugin.onload();
    expect((plugin as any).commands).toEqual([
      expect.objectContaining({ id: "start-capture", name: "开始截图" })
    ]);
    expect(controller.registerConfiguredShortcut).toHaveBeenCalledOnce();
    expect(targets.ensureDefaultNote).not.toHaveBeenCalled();
    expect(app.workspace.on).toHaveBeenCalledWith("file-open", expect.any(Function));
    listeners.get("file-open")?.(testFile("Opened.md"));
    await flush();
    expect(targets.recordOpenedNote).toHaveBeenCalledWith(expect.objectContaining({ path: "Opened.md" }));

    await plugin.onunload();
    expect(targets.dispose).toHaveBeenCalledOnce();
    expect(controller.dispose).toHaveBeenCalledOnce();
  });
});

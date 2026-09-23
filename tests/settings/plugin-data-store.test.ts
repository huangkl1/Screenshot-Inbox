import { describe, expect, it, vi } from "vitest";
import { PluginDataStore } from "../../src/settings/plugin-data-store";

describe("PluginDataStore", () => {
  it("迁移旧版顶层设置，并将设置与 pending 元数据一起保存", async () => {
    const plugin = {
      loadData: vi.fn(async () => ({ accelerator: "Ctrl+Alt+S" })),
      saveData: vi.fn(async () => undefined)
    };
    const store = await PluginDataStore.load(plugin as never);
    expect(store.get().accelerator).toBe("Ctrl+Alt+S");

    await store.replacePendingInserts([{
      id: "pending-1",
      attachmentPath: "assets/a.png",
      targetNotePath: "Inbox.md",
      embed: "![[a.png]]",
      completed: false
    }]);
    expect(plugin.saveData).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ accelerator: "Ctrl+Alt+S" }),
      pendingInserts: [expect.objectContaining({ id: "pending-1" })]
    }));
  });

  it("将开发机绝对路径迁移为当前仓库的默认笔记路径", async () => {
    const plugin = {
      loadData: vi.fn(async () => ({
        settings: {
          defaultNotePath: "D:\\笔记仓库\\Winnie\\截图收集\\截图收集.md",
          accelerator: "Ctrl+Alt+S"
        },
        pendingInserts: []
      })),
      saveData: vi.fn(async () => undefined)
    };

    const store = await PluginDataStore.load(plugin as never);

    expect(store.get().defaultNotePath).toBe("截图收集.md");
    expect(store.get().accelerator).toBe("Ctrl+Alt+S");
    expect(plugin.saveData).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        defaultNotePath: "截图收集.md",
        accelerator: "Ctrl+Alt+S"
      })
    }));
  });

  it("持久化失败时不让未保存设置污染内存状态", async () => {
    const plugin = {
      loadData: vi.fn(async () => ({ accelerator: "Alt+Q" })),
      saveData: vi.fn(async () => { throw new Error("write failed"); })
    };
    const store = await PluginDataStore.load(plugin as never);

    await expect(store.update({ accelerator: "Ctrl+Alt+S" })).rejects.toThrow("write failed");
    expect(store.get().accelerator).toBe("Alt+Q");
  });
});

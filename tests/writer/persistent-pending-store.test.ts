import { describe, expect, it, vi } from "vitest";
import { PersistentPendingInsertStore } from "../../src/writer/persistent-pending-store";
import type { PendingInsertRecord } from "../../src/writer/capture-writer";

describe("PersistentPendingInsertStore", () => {
  it("跨实例持久化待插入记录和完成状态", async () => {
    let records: PendingInsertRecord[] = [];
    const save = vi.fn(async (next: PendingInsertRecord[]) => {
      records = next.map(record => ({ ...record }));
    });
    const first = new PersistentPendingInsertStore(
      () => records,
      save,
      () => "fixed-id"
    );

    const id = await first.save({
      attachmentPath: "assets/a.png",
      targetNotePath: "Inbox.md",
      embed: "![[a.png]]"
    });
    expect(id).toBe("fixed-id");
    expect(save).toHaveBeenCalledOnce();

    const reloaded = new PersistentPendingInsertStore(() => records, save);
    expect(await reloaded.get(id)).toEqual({
      id,
      attachmentPath: "assets/a.png",
      targetNotePath: "Inbox.md",
      embed: "![[a.png]]",
      completed: false
    });
    await reloaded.markCompleted(id);
    expect((await reloaded.get(id))?.completed).toBe(true);
  });
});

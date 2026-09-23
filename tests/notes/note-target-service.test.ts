import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  normalizePath: (path: string) =>
    path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/")
}));

import { NoteTargetServiceImpl } from "../../src/notes/note-target-service";
import { migrateSettings } from "../../src/settings/settings";

interface TestFile {
  path: string;
  basename: string;
  extension: string;
}

function file(path: string): TestFile {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return {
    path,
    basename: dot < 0 ? name : name.slice(0, dot),
    extension: dot < 0 ? "" : name.slice(dot + 1)
  };
}

class TestVault {
  files: TestFile[];
  folders = new Set<string>();
  private listeners = new Map<string, Array<(...args: never[]) => void>>();
  offref = vi.fn((ref: { event: string; callback: (...args: never[]) => void }) => {
    const listeners = this.listeners.get(ref.event) ?? [];
    this.listeners.set(ref.event, listeners.filter(item => item !== ref.callback));
  });

  constructor(paths: string[] = []) {
    this.files = paths.map(file);
  }

  getMarkdownFiles(): TestFile[] {
    return this.files.filter(item => item.extension.toLowerCase() === "md");
  }

  getAbstractFileByPath(path: string): TestFile | null {
    return this.files.find(item => item.path === path) ??
      (this.folders.has(path) ? ({ path, children: [] } as never) : null);
  }

  async create(path: string): Promise<TestFile> {
    if (this.getAbstractFileByPath(path)) throw new Error("File already exists");
    const created = file(path);
    this.files.push(created);
    this.emit("create", created);
    return created;
  }

  on(event: string, callback: (...args: never[]) => void): {
    event: string;
    callback: (...args: never[]) => void;
  } {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(callback);
    this.listeners.set(event, listeners);
    return { event, callback };
  }

  rename(oldPath: string, newPath: string): void {
    const target = this.getAbstractFileByPath(oldPath);
    if (!target) throw new Error("Missing file");
    target.path = newPath;
    const replacement = file(newPath);
    target.basename = replacement.basename;
    target.extension = replacement.extension;
    this.emit("rename", target, oldPath);
  }

  delete(path: string): void {
    const target = this.getAbstractFileByPath(path);
    if (!target) return;
    this.files = this.files.filter(item => item !== target);
    this.emit("delete", target);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...(args as never[]));
    }
  }
}

describe("NoteTargetServiceImpl", () => {
  let persisted: string[][];

  beforeEach(() => {
    persisted = [];
  });

  function createService(
    vault: TestVault,
    recentNotePaths: string[] = [],
    defaultNotePath = "截图收集.md"
  ): NoteTargetServiceImpl {
    const settings = migrateSettings({ recentNotePaths, defaultNotePath });
    return new NoteTargetServiceImpl(
      vault as never,
      () => settings,
      async paths => {
        settings.recentNotePaths = [...paths];
        persisted.push([...paths]);
      }
    );
  }

  it("creates the configured default note only when absent", async () => {
    const vault = new TestVault();
    const service = createService(vault);

    const created = await service.ensureDefaultNote();
    const existing = await service.ensureDefaultNote();

    expect(created.path).toBe("截图收集.md");
    expect(existing).toBe(created);
    expect(vault.files).toHaveLength(1);
  });

  it("creates the safe default when persisted path belongs to another machine", async () => {
    const vault = new TestVault();
    const service = createService(
      vault,
      [],
      "D:\\笔记仓库\\Winnie\\截图收集\\截图收集.md"
    );

    const created = await service.ensureDefaultNote();

    expect(created.path).toBe("截图收集.md");
  });

  it("falls back to the vault root when the configured parent folder is missing", async () => {
    const vault = new TestVault();
    const service = createService(vault, [], "截图收集/截图收集.md");

    const created = await service.ensureDefaultNote();

    expect(created.path).toBe("截图收集.md");
    expect(vault.files.map(item => item.path)).toEqual(["截图收集.md"]);
  });

  it("keeps a configured relative path when all parent folders exist", async () => {
    const vault = new TestVault();
    vault.folders.add("截图收集");
    const service = createService(vault, [], "截图收集/截图收集.md");

    const created = await service.ensureDefaultNote();

    expect(created.path).toBe("截图收集/截图收集.md");
  });

  it("keeps recent Markdown notes newest-first, unique, and limited to five", async () => {
    const paths = ["A.md", "B.md", "C.md", "D.md", "E.md", "F.md", "image.png"];
    const vault = new TestVault(paths);
    const service = createService(vault);

    for (const path of paths) {
      await service.recordOpenedNote(vault.getAbstractFileByPath(path) as never);
    }
    await service.recordOpenedNote(vault.getAbstractFileByPath("C.md") as never);

    expect(service.getRecentNotes().map(item => item.path)).toEqual([
      "C.md",
      "F.md",
      "E.md",
      "D.md",
      "B.md"
    ]);
    expect(persisted.at(-1)).toEqual(["C.md", "F.md", "E.md", "D.md", "B.md"]);
  });

  it("updates persisted recent paths on rename and removes them on delete", async () => {
    const vault = new TestVault(["Folder/Old.md", "Keep.md"]);
    const service = createService(vault, ["Folder/Old.md", "Keep.md"]);

    vault.rename("Folder/Old.md", "Folder/New.md");
    expect(service.getRecentNotes().map(item => item.path)).toEqual([
      "Folder/New.md",
      "Keep.md"
    ]);

    vault.delete("Folder/New.md");
    expect(service.getRecentNotes().map(item => item.path)).toEqual(["Keep.md"]);
    expect(persisted).toEqual([
      ["Folder/New.md", "Keep.md"],
      ["Keep.md"]
    ]);
  });

  it("falls back to the default for missing or non-Markdown targets", async () => {
    const vault = new TestVault(["Inbox.md", "asset.png"]);
    const service = createService(vault, [], "Inbox.md");

    await expect(service.resolveTarget("Missing.md")).resolves.toMatchObject({
      path: "Inbox.md"
    });
    await expect(service.resolveTarget("asset.png")).resolves.toMatchObject({
      path: "Inbox.md"
    });
  });

  it("ranks title prefix, title contains, path contains, then recency", () => {
    const vault = new TestVault([
      "Project Alpha.md",
      "My Project Notes.md",
      "Archive/project/source.md",
      "project-old.md",
      "project-new.md",
      "ignore.png"
    ]);
    const service = createService(vault, ["project-new.md", "project-old.md"]);

    expect(service.searchNotes("project").map(item => item.path)).toEqual([
      "project-new.md",
      "project-old.md",
      "Project Alpha.md",
      "My Project Notes.md",
      "Archive/project/source.md"
    ]);
  });

  it("searches 10,000 Markdown notes under 200ms after warm-up", () => {
    const paths = Array.from(
      { length: 10_000 },
      (_, index) => `Knowledge/Project-${String(index).padStart(5, "0")}.md`
    );
    const service = createService(new TestVault(paths));
    service.searchNotes("project-099");

    const durations: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      service.searchNotes("project-099");
      durations.push(performance.now() - started);
    }

    expect(Math.max(...durations)).toBeLessThan(200);
  });

  it("dispose uses Vault.offref and stops all vault event processing", () => {
    const vault = new TestVault(["Old.md"]);
    const service = createService(vault, ["Old.md"]);

    service.dispose();
    vault.rename("Old.md", "New.md");

    expect(vault.offref).toHaveBeenCalledTimes(3);
    expect(persisted).toEqual([]);
    expect(service.searchNotes("new")).toEqual([]);
  });
});

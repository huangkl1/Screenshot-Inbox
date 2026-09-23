import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CaptureWriterImpl,
  InMemoryPendingInsertStore,
  formatCaptureFilename
} from "../../src/writer/capture-writer";

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

describe("CaptureWriterImpl", () => {
  const capturedAt = new Date(2026, 7, 23, 16, 9, 10, 123);
  let files: Map<string, TestFile>;
  let contents: Map<string, string>;
  let calls: string[];
  let processFailure: Error | undefined;
  let createFailure: Error | undefined;
  let attachmentFolder: string | undefined;

  beforeEach(() => {
    files = new Map([["Notes/Target.md", file("Notes/Target.md")]]);
    contents = new Map([["Notes/Target.md", "Existing text\n"]]);
    calls = [];
    processFailure = undefined;
    createFailure = undefined;
    attachmentFolder = undefined;
  });

  function createWriter(targetPath = "Notes/Target.md") {
    const vault = {
      async createBinary(path: string) {
        calls.push(`createBinary:${path}`);
        if (createFailure) throw createFailure;
        const created = file(path);
        files.set(path, created);
        return created;
      },
      async process(note: TestFile, transform: (current: string) => string) {
        calls.push(`process:${note.path}`);
        if (processFailure) throw processFailure;
        const current = contents.get(note.path) ?? "";
        contents.set(note.path, transform(current));
      },
      getAbstractFileByPath(path: string) {
        return files.get(path) ?? null;
      }
    };
    const fileManager = {
      async getAvailablePathForAttachment(name: string, sourcePath: string) {
        calls.push(`allocate:${name}:${sourcePath}`);
        const slash = sourcePath.lastIndexOf("/");
        const folder = attachmentFolder === undefined
          ? slash < 0 ? "" : sourcePath.slice(0, slash + 1)
          : attachmentFolder.length === 0 ? "" : `${attachmentFolder}/`;
        const extension = name.slice(name.lastIndexOf("."));
        const stem = name.slice(0, -extension.length);
        let candidate = `${folder}${name}`;
        let suffix = 1;
        while (files.has(candidate)) {
          candidate = `${folder}${stem}-${suffix}${extension}`;
          suffix += 1;
        }
        return candidate;
      },
      generateMarkdownLink(attachment: TestFile, notePath: string) {
        calls.push(`link:${attachment.path}:${notePath}`);
        return `[[${attachment.path}|Screenshot]]`;
      }
    };
    const targets = {
      async resolveTarget(path?: string) {
        return (files.get(path ?? "") ?? files.get(targetPath)) as TestFile;
      }
    };
    const pending = new InMemoryPendingInsertStore();
    return {
      writer: new CaptureWriterImpl(
        vault as never,
        fileManager as never,
        targets as never,
        pending
      ),
      pending,
      vault
    };
  }

  it("formats the required local timestamp filename", () => {
    expect(formatCaptureFilename(capturedAt)).toBe(
      "Screenshot-20260823-160910-123.png"
    );
  });

  it("uses a trimmed custom filename and appends the PNG extension", async () => {
    const { writer } = createWriter();

    const result = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      filename: "  接口设计草图.png  ",
      capturedAt
    });

    expect(result.attachmentPath).toBe("Notes/接口设计草图.png");
    expect(calls[0]).toBe("allocate:接口设计草图.png:Notes/Target.md");
  });

  it("falls back to the timestamp filename for a blank custom filename", async () => {
    const { writer } = createWriter();

    const result = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      filename: "   ",
      capturedAt
    });

    expect(result.attachmentPath).toBe("Notes/Screenshot-20260823-160910-123.png");
  });

  it("replaces path separators and invalid filename characters", async () => {
    const { writer } = createWriter();

    const result = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      filename: "设计/草图: v1?",
      capturedAt
    });

    expect(result.attachmentPath).toBe("Notes/设计-草图- v1-.png");
  });

  it("allocates, creates, links, and appends in order", async () => {
    const { writer } = createWriter();

    const result = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      description: "当前时间 xxx，我看到一个有意思的想法",
      capturedAt
    });

    expect(result).toEqual({
      status: "saved",
      attachmentPath: "Notes/Screenshot-20260823-160910-123.png",
      targetNotePath: "Notes/Target.md",
      embed: "![[Notes/Screenshot-20260823-160910-123.png|Screenshot]]"
    });
    expect(calls).toEqual([
      "allocate:Screenshot-20260823-160910-123.png:Notes/Target.md",
      "createBinary:Notes/Screenshot-20260823-160910-123.png",
      "link:Notes/Screenshot-20260823-160910-123.png:Notes/Target.md",
      "process:Notes/Target.md"
    ]);
    expect(contents.get("Notes/Target.md")).toBe(
      "Existing text\n\n当前时间 xxx，我看到一个有意思的想法\n\n![[Notes/Screenshot-20260823-160910-123.png|Screenshot]]\n"
    );
  });

  it("uses an incrementing suffix for a same-millisecond collision", async () => {
    files.set(
      "Notes/Screenshot-20260823-160910-123.png",
      file("Notes/Screenshot-20260823-160910-123.png")
    );
    const { writer } = createWriter();

    const result = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      capturedAt
    });

    expect(result.attachmentPath).toBe(
      "Notes/Screenshot-20260823-160910-123-1.png"
    );
  });

  it("falls back through the target service before allocating", async () => {
    files.set("Inbox.md", file("Inbox.md"));
    contents.set("Inbox.md", "");
    const { writer } = createWriter("Inbox.md");

    const result = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Deleted.md",
      capturedAt
    });

    expect(result.targetNotePath).toBe("Inbox.md");
    expect(calls[0]).toContain(":Inbox.md");
  });

  it.each(["", "附件/截图收集"])(
    "delegates Chinese root/custom attachment path mode: %s",
    async folder => {
      files.set("中文/目标笔记.md", file("中文/目标笔记.md"));
      contents.set("中文/目标笔记.md", "中文正文");
      attachmentFolder = folder;
      const { writer } = createWriter("中文/目标笔记.md");

      const result = await writer.save({
        png: new Uint8Array([137, 80, 78, 71]),
        targetNotePath: "中文/目标笔记.md",
        capturedAt
      });

      expect(result.attachmentPath.startsWith(folder)).toBe(true);
      expect(result.targetNotePath).toBe("中文/目标笔记.md");
      expect(contents.get("中文/目标笔记.md")).toContain("![[");
    }
  );

  it("does not modify a note or create pending state when binary creation fails", async () => {
    createFailure = new Error("disk full");
    const { writer, pending } = createWriter();

    await expect(
      writer.save({
        png: new Uint8Array([137, 80, 78, 71]),
        targetNotePath: "Notes/Target.md",
        capturedAt
      })
    ).rejects.toThrow("disk full");

    expect(calls.some(call => call.startsWith("process:"))).toBe(false);
    expect(await pending.count()).toBe(0);
  });

  it("retries a pending insert without recreating or duplicating the attachment", async () => {
    processFailure = new Error("note busy");
    const { writer } = createWriter();

    const first = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      capturedAt
    });
    expect(first.status).toBe("pending-insert");
    if (first.status !== "pending-insert") throw new Error("Expected pending insert");
    const createsAfterSave = calls.filter(call => call.startsWith("createBinary:")).length;

    processFailure = undefined;
    const retried = await writer.retryPendingInsert(first.pendingId);
    const repeated = await writer.retryPendingInsert(first.pendingId);

    expect(retried.status).toBe("saved");
    expect(repeated).toEqual(retried);
    expect(calls.filter(call => call.startsWith("createBinary:"))).toHaveLength(
      createsAfterSave
    );
    expect(calls.filter(call => call.startsWith("process:"))).toHaveLength(2);
  });

  it("persists the actual fallback target after a pending retry", async () => {
    files.set("Inbox.md", file("Inbox.md"));
    contents.set("Inbox.md", "");
    processFailure = new Error("note busy");
    const { writer } = createWriter("Inbox.md");
    const first = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      capturedAt
    });
    if (first.status !== "pending-insert") throw new Error("Expected pending insert");

    processFailure = undefined;
    files.delete("Notes/Target.md");
    contents.delete("Notes/Target.md");
    const retried = await writer.retryPendingInsert(first.pendingId);
    const repeated = await writer.retryPendingInsert(first.pendingId);

    expect(retried).toMatchObject({ status: "saved", targetNotePath: "Inbox.md" });
    expect(repeated).toEqual(retried);
    expect(contents.get("Inbox.md")).toContain("![[");
  });

  it("does not duplicate an embed when completion persistence fails after append", async () => {
    processFailure = new Error("note busy");
    const { writer, pending } = createWriter();
    const first = await writer.save({
      png: new Uint8Array([137, 80, 78, 71]),
      targetNotePath: "Notes/Target.md",
      capturedAt
    });
    if (first.status !== "pending-insert") throw new Error("Expected pending insert");
    processFailure = undefined;
    vi.spyOn(pending, "markCompleted").mockRejectedValueOnce(new Error("data.json busy"));

    await expect(writer.retryPendingInsert(first.pendingId)).rejects.toThrow("data.json busy");
    await expect(writer.retryPendingInsert(first.pendingId)).resolves.toMatchObject({ status: "saved" });

    expect((contents.get("Notes/Target.md")?.match(/!\[\[/g) ?? [])).toHaveLength(1);
  });

  it("serializes simultaneous appends to the same note", async () => {
    const { writer, vault } = createWriter();
    let active = 0;
    let maximumActive = 0;
    vault.process = async (note: TestFile, transform: (current: string) => string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      contents.set(note.path, transform(contents.get(note.path) ?? ""));
      active -= 1;
    };

    await Promise.all([
      writer.save({
        png: new Uint8Array([137, 80, 78, 71, 1]),
        targetNotePath: "Notes/Target.md",
        capturedAt
      }),
      writer.save({
        png: new Uint8Array([137, 80, 78, 71, 2]),
        targetNotePath: "Notes/Target.md",
        capturedAt
      })
    ]);

    expect(maximumActive).toBe(1);
    expect((contents.get("Notes/Target.md")?.match(/!\[\[/g) ?? [])).toHaveLength(2);
  });

  it("completes 100 queued saves without losing or duplicating an embed", async () => {
    const { writer } = createWriter();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) => writer.save({
        png: new Uint8Array([137, 80, 78, 71, index]),
        targetNotePath: "Notes/Target.md",
        capturedAt: new Date(capturedAt.getTime() + index)
      }))
    );

    expect(results.filter(result => result.status === "saved")).toHaveLength(100);
    expect(new Set(results.map(result => result.attachmentPath)).size).toBe(100);
    expect((contents.get("Notes/Target.md")?.match(/!\[\[/g) ?? [])).toHaveLength(100);
  });
});

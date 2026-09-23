import { normalizePath, type TAbstractFile, type TFile } from "obsidian";
import type { NoteTargetService } from "../notes/note-target-service";

export interface SaveCaptureRequest {
  png: Uint8Array;
  targetNotePath: string;
  filename?: string;
  description?: string;
  capturedAt: Date;
}

export type SaveCaptureResult =
  | {
      status: "saved";
      attachmentPath: string;
      targetNotePath: string;
      embed: string;
    }
  | {
      status: "pending-insert";
      attachmentPath: string;
      targetNotePath: string;
      embed: string;
      pendingId: string;
    };

export interface CaptureWriter {
  save(request: SaveCaptureRequest): Promise<SaveCaptureResult>;
  retryPendingInsert(pendingId: string): Promise<SaveCaptureResult>;
  listPendingInserts(): Promise<PendingInsertRecord[]>;
}

export interface PendingInsertRecord {
  id: string;
  attachmentPath: string;
  targetNotePath: string;
  embed: string;
  description?: string;
  completed: boolean;
}

export interface PendingInsertStore {
  save(record: Omit<PendingInsertRecord, "id" | "completed">): Promise<string>;
  get(id: string): Promise<PendingInsertRecord | undefined>;
  list(): Promise<PendingInsertRecord[]>;
  markCompleted(
    id: string,
    resolved?: Pick<PendingInsertRecord, "targetNotePath" | "embed">
  ): Promise<void>;
}

interface VaultLike {
  createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
  process(file: TFile, fn: (current: string) => string): Promise<string | void>;
  getAbstractFileByPath(path: string): TAbstractFile | null;
}

interface FileManagerLike {
  getAvailablePathForAttachment(filename: string, sourcePath: string): Promise<string>;
  generateMarkdownLink(
    file: TFile,
    sourcePath: string,
    subpath?: string,
    alias?: string
  ): string;
}

class PerKeyQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const normalized = normalizePath(key);
    const previous = this.tails.get(normalized) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(normalized, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(normalized) === tail) this.tails.delete(normalized);
    }
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatCaptureFilename(capturedAt: Date, customFilename?: string): string {
  const normalizedCustomFilename = normalizeCustomFilename(customFilename);
  if (normalizedCustomFilename) return `${normalizedCustomFilename}.png`;

  return [
    "Screenshot-",
    pad(capturedAt.getFullYear(), 4),
    pad(capturedAt.getMonth() + 1, 2),
    pad(capturedAt.getDate(), 2),
    "-",
    pad(capturedAt.getHours(), 2),
    pad(capturedAt.getMinutes(), 2),
    pad(capturedAt.getSeconds(), 2),
    "-",
    pad(capturedAt.getMilliseconds(), 3),
    ".png"
  ].join("");
}

function normalizeCustomFilename(value?: string): string {
  if (!value) return "";
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim();
  if (!sanitized || sanitized === "." || sanitized === "..") return "";
  return sanitized.toLocaleLowerCase().endsWith(".png")
    ? sanitized.slice(0, -4).trim()
    : sanitized;
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

export class CaptureWriterImpl implements CaptureWriter {
  private readonly noteQueue = new PerKeyQueue();

  constructor(
    private readonly vault: VaultLike,
    private readonly fileManager: FileManagerLike,
    private readonly targets: NoteTargetService,
    private readonly pending: PendingInsertStore
  ) {}

  async save(request: SaveCaptureRequest): Promise<SaveCaptureResult> {
    const note = await this.targets.resolveTarget(request.targetNotePath);
    return this.noteQueue.run(note.path, async () => {
      const filename = formatCaptureFilename(request.capturedAt, request.filename);
      const attachmentPath = normalizePath(
        await this.fileManager.getAvailablePathForAttachment(filename, note.path)
      );
      const attachment = await this.vault.createBinary(
        attachmentPath,
        toExactArrayBuffer(request.png)
      );
      const embed = this.asImageEmbed(
        this.fileManager.generateMarkdownLink(
          attachment,
          note.path,
          "",
          "Screenshot"
        )
      );
      const description = request.description?.trim() ?? "";
      try {
        await this.appendEmbed(note, embed, description);
        return {
          status: "saved",
          attachmentPath,
          targetNotePath: note.path,
          embed
        };
      } catch {
        const pendingId = await this.pending.save({
          attachmentPath,
          targetNotePath: note.path,
          embed,
          description
        });
        return {
          status: "pending-insert",
          attachmentPath,
          targetNotePath: note.path,
          embed,
          pendingId
        };
      }
    });
  }

  async retryPendingInsert(pendingId: string): Promise<SaveCaptureResult> {
    const record = await this.pending.get(pendingId);
    if (!record) throw new Error(`Unknown pending insert: ${pendingId}`);
    if (record.completed) return this.savedResult(record);

    const note = await this.targets.resolveTarget(record.targetNotePath);
    return this.noteQueue.run(note.path, async () => {
      const latest = await this.pending.get(pendingId);
      if (!latest) throw new Error(`Unknown pending insert: ${pendingId}`);
      if (latest.completed) return this.savedResult(latest);

      const attachment = this.vault.getAbstractFileByPath(latest.attachmentPath);
      if (!this.isFile(attachment)) {
        throw new Error(`Pending attachment is missing: ${latest.attachmentPath}`);
      }
      const embed =
        note.path === latest.targetNotePath
          ? latest.embed
          : this.asImageEmbed(
              this.fileManager.generateMarkdownLink(
                attachment,
                note.path,
                "",
                "Screenshot"
              )
            );
      await this.appendEmbed(note, embed, latest.description ?? "");
      await this.pending.markCompleted(pendingId, {
        targetNotePath: note.path,
        embed
      });
      return {
        status: "saved",
        attachmentPath: latest.attachmentPath,
        targetNotePath: note.path,
        embed
      };
    });
  }

  listPendingInserts(): Promise<PendingInsertRecord[]> {
    return this.pending.list();
  }

  private async appendEmbed(note: TFile, embed: string, description = ""): Promise<void> {
    const normalizedDescription = description.trim();
    const content = normalizedDescription.length > 0
      ? `${normalizedDescription}\n\n${embed}`
      : embed;
    await this.vault.process(
      note,
      current => current.includes(embed)
        ? current
        : current.replace(/\s*$/, "\n\n") + content + "\n"
    );
  }

  private asImageEmbed(markdownLink: string): string {
    return markdownLink.startsWith("!") ? markdownLink : `!${markdownLink}`;
  }

  private savedResult(record: PendingInsertRecord): SaveCaptureResult {
    return {
      status: "saved",
      attachmentPath: record.attachmentPath,
      targetNotePath: record.targetNotePath,
      embed: record.embed
    };
  }

  private isFile(value: unknown): value is TFile {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as Partial<TFile>).path === "string" &&
      typeof (value as Partial<TFile>).extension === "string"
    );
  }
}

export class InMemoryPendingInsertStore implements PendingInsertStore {
  private readonly records = new Map<string, PendingInsertRecord>();
  private nextId = 1;

  async save(
    record: Omit<PendingInsertRecord, "id" | "completed">
  ): Promise<string> {
    const id = `pending-${this.nextId}`;
    this.nextId += 1;
    this.records.set(id, { ...record, id, completed: false });
    return id;
  }

  async get(id: string): Promise<PendingInsertRecord | undefined> {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  async list(): Promise<PendingInsertRecord[]> {
    return Array.from(this.records.values(), record => ({ ...record }));
  }

  async markCompleted(
    id: string,
    resolved?: Pick<PendingInsertRecord, "targetNotePath" | "embed">
  ): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown pending insert: ${id}`);
    this.records.set(id, { ...record, ...resolved, completed: true });
  }

  async count(): Promise<number> {
    return this.records.size;
  }
}

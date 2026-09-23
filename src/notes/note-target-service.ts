import {
  normalizePath,
  type TAbstractFile,
  type TFile
} from "obsidian";
import type { ScreenshotInboxSettings } from "../settings/settings";

export interface NoteTargetService {
  ensureDefaultNote(): Promise<TFile>;
  recordOpenedNote(file: TFile): Promise<void>;
  getRecentNotes(limit?: number): TFile[];
  getAllNotes(limit?: number): TFile[];
  searchNotes(query: string, limit?: number): TFile[];
  resolveTarget(path?: string): Promise<TFile>;
  dispose(): void;
}

interface EventRefLike {}

interface VaultLike {
  getMarkdownFiles(): TFile[];
  getAbstractFileByPath(path: string): TAbstractFile | null;
  create(path: string, data: string): Promise<TFile>;
  on(event: "create", callback: (file: TAbstractFile) => unknown): EventRefLike;
  on(
    event: "rename",
    callback: (file: TAbstractFile, oldPath: string) => unknown
  ): EventRefLike;
  on(event: "delete", callback: (file: TAbstractFile) => unknown): EventRefLike;
  offref(ref: EventRefLike): void;
}

interface IndexedNote {
  file: TFile;
  basename: string;
  path: string;
}

function isMarkdownFile(value: unknown): value is TFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TFile>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.basename === "string" &&
    typeof candidate.extension === "string" &&
    candidate.extension.toLowerCase() === "md"
  );
}

function isFolder(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { children?: unknown }).children)
  );
}

function hasExistingParentFolders(vault: VaultLike, path: string): boolean {
  const parts = path.split("/");
  let parent = "";
  for (const part of parts.slice(0, -1)) {
    parent = parent.length > 0 ? `${parent}/${part}` : part;
    if (!isFolder(vault.getAbstractFileByPath(parent))) return false;
  }
  return true;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export class NoteTargetServiceImpl implements NoteTargetService {
  private recentPaths: string[];
  private index: IndexedNote[] = [];
  private readonly eventRefs: EventRefLike[] = [];

  constructor(
    private readonly vault: VaultLike,
    private readonly getSettings: () => ScreenshotInboxSettings,
    private readonly persistRecentPaths: (paths: string[]) => Promise<void>
  ) {
    this.recentPaths = this.sanitizeRecent(this.getSettings().recentNotePaths);
    this.refreshIndex();
    this.eventRefs.push(
      this.vault.on("create", (created: TAbstractFile) => {
        if (isMarkdownFile(created)) this.refreshIndex();
      }),
      this.vault.on("rename", (renamed: TAbstractFile, oldPath: string) => {
        this.handleRename(renamed, oldPath);
      }),
      this.vault.on("delete", (deleted: TAbstractFile) => {
        this.handleDelete(deleted);
      })
    );
  }

  async ensureDefaultNote(): Promise<TFile> {
    const configuredPath = normalizePath(this.getSettings().defaultNotePath);
    if (!configuredPath.toLowerCase().endsWith(".md")) {
      throw new Error("Screenshot Inbox default note must be a Markdown path");
    }
    const path = hasExistingParentFolders(this.vault, configuredPath)
      ? configuredPath
      : basename(configuredPath);
    const existing = this.vault.getAbstractFileByPath(path);
    if (isMarkdownFile(existing)) return existing;
    if (existing) {
      throw new Error(`Default note path is not a Markdown file: ${path}`);
    }
    return this.vault.create(path, "");
  }

  async recordOpenedNote(file: TFile): Promise<void> {
    if (!isMarkdownFile(file)) return;
    const path = normalizePath(file.path);
    this.recentPaths = [
      path,
      ...this.recentPaths.filter(existing => existing !== path)
    ].slice(0, 5);
    await this.persistRecentPaths([...this.recentPaths]);
  }

  getRecentNotes(limit = 5): TFile[] {
    const seen = new Set<string>();
    const result: TFile[] = [];
    for (const path of this.recentPaths) {
      const normalized = normalizePath(path);
      if (seen.has(normalized)) continue;
      const value = this.vault.getAbstractFileByPath(normalized);
      if (isMarkdownFile(value)) {
        seen.add(normalized);
        result.push(value);
      }
      if (result.length >= Math.max(0, limit)) break;
    }
    return result;
  }

  getAllNotes(limit = Number.MAX_SAFE_INTEGER): TFile[] {
    return this.index.slice(0, Math.max(0, limit)).map(note => note.file);
  }

  searchNotes(query: string, limit = 20): TFile[] {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0 || limit <= 0) return [];
    const recency = new Map(
      this.recentPaths.map((path, index) => [normalizePath(path), index])
    );

    return this.index
      .map(note => {
        const titleIndex = note.basename.indexOf(needle);
        const pathIndex = note.path.indexOf(needle);
        const rank = titleIndex === 0 ? 0 : titleIndex > 0 ? 1 : pathIndex >= 0 ? 2 : 3;
        return { note, rank, recent: recency.get(note.file.path) ?? Number.MAX_SAFE_INTEGER };
      })
      .filter(item => item.rank < 3)
      .sort((left, right) =>
        left.rank - right.rank ||
        left.recent - right.recent ||
        left.note.basename.localeCompare(right.note.basename) ||
        left.note.path.localeCompare(right.note.path)
      )
      .slice(0, limit)
      .map(item => item.note.file);
  }

  async resolveTarget(path?: string): Promise<TFile> {
    if (path) {
      const selected = this.vault.getAbstractFileByPath(normalizePath(path));
      if (isMarkdownFile(selected)) return selected;
    }
    return this.ensureDefaultNote();
  }

  dispose(): void {
    for (const ref of this.eventRefs) this.vault.offref(ref);
    this.eventRefs.length = 0;
  }

  private refreshIndex(): void {
    this.index = this.vault.getMarkdownFiles().map(file => ({
      file,
      basename: file.basename.toLocaleLowerCase(),
      path: normalizePath(file.path).toLocaleLowerCase()
    }));
  }

  private handleRename(renamed: TAbstractFile, oldPath: string): void {
    const oldNormalized = normalizePath(oldPath);
    if (isMarkdownFile(renamed)) {
      const next = normalizePath(renamed.path);
      const replaced = this.recentPaths.map(path =>
        path === oldNormalized ? next : path
      );
      const sanitized = this.sanitizeRecent(replaced);
      if (sanitized.join("\u0000") !== this.recentPaths.join("\u0000")) {
        this.recentPaths = sanitized;
        void this.persistRecentPaths([...this.recentPaths]).catch(() => undefined);
      }
    }
    this.refreshIndex();
  }

  private handleDelete(deleted: TAbstractFile): void {
    const deletedPath = normalizePath(deleted.path);
    const next = this.recentPaths.filter(path => path !== deletedPath);
    if (next.length !== this.recentPaths.length) {
      this.recentPaths = next;
      void this.persistRecentPaths([...this.recentPaths]).catch(() => undefined);
    }
    this.refreshIndex();
  }

  private sanitizeRecent(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const path of paths) {
      const normalized = normalizePath(path);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
      if (result.length === 5) break;
    }
    return result;
  }
}

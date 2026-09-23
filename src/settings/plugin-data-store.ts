import type { Plugin } from "obsidian";
import type { ControllerSettingsStore } from "../controller/plugin-controller";
import type { PendingInsertRecord } from "../writer/capture-writer";
import {
  migrateSettings,
  type ScreenshotInboxSettings
} from "./settings";

interface PluginData {
  settings: ScreenshotInboxSettings;
  pendingInserts: PendingInsertRecord[];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function parsePending(value: unknown): PendingInsertRecord[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const records: PendingInsertRecord[] = [];
  for (const candidate of value) {
    const record = objectValue(candidate);
    if (
      !record ||
      typeof record.id !== "string" ||
      ids.has(record.id) ||
      typeof record.attachmentPath !== "string" ||
      typeof record.targetNotePath !== "string" ||
      typeof record.embed !== "string" ||
      typeof record.completed !== "boolean"
    ) continue;
    ids.add(record.id);
    records.push({
      id: record.id,
      attachmentPath: record.attachmentPath,
      targetNotePath: record.targetNotePath,
      embed: record.embed,
      description: typeof record.description === "string" ? record.description : "",
      completed: record.completed
    });
  }
  return records;
}

function clonePending(records: readonly PendingInsertRecord[]): PendingInsertRecord[] {
  return records.map(record => ({ ...record }));
}

export class PluginDataStore implements ControllerSettingsStore {
  private mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly plugin: Pick<Plugin, "saveData">,
    private data: PluginData
  ) {}

  static async load(
    plugin: Pick<Plugin, "loadData" | "saveData">
  ): Promise<PluginDataStore> {
    const raw = await plugin.loadData();
    const record = objectValue(raw);
    const settingsSource = record && "settings" in record ? record.settings : raw;
    const data: PluginData = {
      settings: migrateSettings(settingsSource),
      pendingInserts: parsePending(record?.pendingInserts)
    };
    if (!isCanonicalData(raw, data)) {
      try {
        await plugin.saveData(data);
      } catch {
        // A failed migration write must not prevent the plugin from loading.
      }
    }
    return new PluginDataStore(plugin, data);
  }

  get(): ScreenshotInboxSettings {
    return {
      ...this.data.settings,
      recentNotePaths: [...this.data.settings.recentNotePaths]
    };
  }

  async update(patch: Partial<ScreenshotInboxSettings>): Promise<void> {
    await this.mutate(current => ({
      settings: migrateSettings({ ...current.settings, ...patch }),
      pendingInserts: clonePending(current.pendingInserts)
    }));
  }

  getPendingInserts(): PendingInsertRecord[] {
    return clonePending(this.data.pendingInserts);
  }

  async replacePendingInserts(records: PendingInsertRecord[]): Promise<void> {
    await this.mutate(current => ({
      settings: {
        ...current.settings,
        recentNotePaths: [...current.settings.recentNotePaths]
      },
      pendingInserts: parsePending(records)
    }));
  }

  private mutate(change: (current: PluginData) => PluginData): Promise<void> {
    const operation = this.mutationTail
      .catch(() => undefined)
      .then(async () => {
        const next = change(this.data);
        const snapshot: PluginData = {
          settings: {
            ...next.settings,
            recentNotePaths: [...next.settings.recentNotePaths]
          },
          pendingInserts: clonePending(next.pendingInserts)
        };
        await this.plugin.saveData(snapshot);
        this.data = snapshot;
      });
    this.mutationTail = operation;
    return operation;
  }
}

function isCanonicalData(raw: unknown, data: PluginData): boolean {
  const record = objectValue(raw);
  return Boolean(
    record &&
    "settings" in record &&
    "pendingInserts" in record &&
    JSON.stringify(record.settings) === JSON.stringify(data.settings) &&
    JSON.stringify(parsePending(record.pendingInserts)) ===
      JSON.stringify(data.pendingInserts)
  );
}

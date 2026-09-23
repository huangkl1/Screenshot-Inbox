export type AnnotationTool = "pen" | "rectangle" | "arrow" | "text";
export type AnnotationColor =
  | "red"
  | "yellow"
  | "blue"
  | "green"
  | "black"
  | "white";
export type StrokeWidth = 2 | 4 | 8;
export type TextFontSize = 10 | 12 | 16 | 24 | 32 | 48 | 62;
export type AfterSaveAction = "return" | "open-note";

export interface ScreenshotInboxSettings {
  settingsVersion: 1;
  accelerator: string;
  defaultNotePath: string;
  recentNotePaths: string[];
  lastTool: AnnotationTool;
  lastColor: AnnotationColor;
  lastStrokeWidth: StrokeWidth;
  lastFontSize: TextFontSize;
  showDescriptionInput: boolean;
  afterSaveAction: AfterSaveAction;
}

export const DEFAULT_SETTINGS: ScreenshotInboxSettings = Object.freeze({
  settingsVersion: 1,
  accelerator: "Alt+Q",
  defaultNotePath: "截图收集.md",
  recentNotePaths: [],
  lastTool: "pen",
  lastColor: "red",
  lastStrokeWidth: 4,
  lastFontSize: 24,
  showDescriptionInput: true,
  afterSaveAction: "return"
});

const TOOLS = new Set<AnnotationTool>(["pen", "rectangle", "arrow", "text"]);
const COLORS = new Set<AnnotationColor>([
  "red",
  "yellow",
  "blue",
  "green",
  "black",
  "white"
]);
const WIDTHS = new Set<StrokeWidth>([2, 4, 8]);
const FONT_SIZES = new Set<TextFontSize>([10, 12, 16, 24, 32, 48, 62]);
const AFTER_SAVE_ACTIONS = new Set<AfterSaveAction>(["return", "open-note"]);

function recordValue(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function normalizeVaultPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function isAbsoluteVaultPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\//.test(value);
}

function stringOrDefault(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
}

function vaultPathOrDefault(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const value = raw.trim();
  if (isAbsoluteVaultPath(value)) return fallback;
  const normalized = normalizeVaultPath(value);
  return normalized.length > 0 ? normalized : fallback;
}

function recentVaultPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || isAbsoluteVaultPath(trimmed)) return undefined;
  const normalized = normalizeVaultPath(trimmed);
  return normalized.length > 0 ? normalized : undefined;
}

export function migrateSettings(raw: unknown): ScreenshotInboxSettings {
  const accelerator = stringOrDefault(
    recordValue(raw, "accelerator"),
    DEFAULT_SETTINGS.accelerator
  );
  const defaultNotePath = vaultPathOrDefault(
    recordValue(raw, "defaultNotePath"),
    DEFAULT_SETTINGS.defaultNotePath
  );
  const recentValue = recordValue(raw, "recentNotePaths");
  const recentNotePaths: string[] = [];
  if (Array.isArray(recentValue)) {
    const seen = new Set<string>();
    for (const value of recentValue) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const normalized = recentVaultPath(value);
      if (!normalized) continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        recentNotePaths.push(normalized);
      }
      if (recentNotePaths.length === 5) break;
    }
  }

  const lastTool = recordValue(raw, "lastTool");
  const lastColor = recordValue(raw, "lastColor");
  const lastStrokeWidth = recordValue(raw, "lastStrokeWidth");
  const lastFontSize = recordValue(raw, "lastFontSize");
  const showDescriptionInput = recordValue(raw, "showDescriptionInput");
  const afterSaveAction = recordValue(raw, "afterSaveAction");

  return {
    settingsVersion: 1,
    accelerator,
    defaultNotePath,
    recentNotePaths,
    lastTool:
      typeof lastTool === "string" && TOOLS.has(lastTool as AnnotationTool)
        ? (lastTool as AnnotationTool)
        : DEFAULT_SETTINGS.lastTool,
    lastColor:
      typeof lastColor === "string" && COLORS.has(lastColor as AnnotationColor)
        ? (lastColor as AnnotationColor)
        : DEFAULT_SETTINGS.lastColor,
    lastStrokeWidth:
      typeof lastStrokeWidth === "number" && WIDTHS.has(lastStrokeWidth as StrokeWidth)
        ? (lastStrokeWidth as StrokeWidth)
        : DEFAULT_SETTINGS.lastStrokeWidth,
    lastFontSize:
      typeof lastFontSize === "number" && FONT_SIZES.has(lastFontSize as TextFontSize)
        ? (lastFontSize as TextFontSize)
        : DEFAULT_SETTINGS.lastFontSize,
    showDescriptionInput:
      typeof showDescriptionInput === "boolean"
        ? showDescriptionInput
        : DEFAULT_SETTINGS.showDescriptionInput,
    afterSaveAction:
      typeof afterSaveAction === "string" &&
      AFTER_SAVE_ACTIONS.has(afterSaveAction as AfterSaveAction)
        ? (afterSaveAction as AfterSaveAction)
        : DEFAULT_SETTINGS.afterSaveAction
  };
}

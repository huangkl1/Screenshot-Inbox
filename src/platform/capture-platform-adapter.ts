import type {
  AnnotationColor,
  AnnotationTool,
  ScreenshotInboxSettings,
  StrokeWidth,
  TextFontSize
} from "../settings/settings";

export interface CapturedDisplay {
  pngDataUrl: string;
  physicalSize: { width: number; height: number };
  logicalBounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export type OverlayResult =
  | { status: "cancelled" }
  | {
      status: "saved";
      png: Uint8Array;
      targetNotePath: string;
      filename: string;
      description: string;
      lastTool: AnnotationTool;
      lastColor: AnnotationColor;
      lastStrokeWidth: StrokeWidth;
      lastFontSize: TextFontSize;
    };

export interface OverlayInput {
  capture: CapturedDisplay;
  notes: Array<{ path: string; label: string; isDefault: boolean }>;
  settings: Pick<
    ScreenshotInboxSettings,
    "lastTool" | "lastColor" | "lastStrokeWidth"
    | "lastFontSize" | "showDescriptionInput"
  >;
}

export type OverlayOpenInput = OverlayInput;

export interface OverlaySession {
  result: Promise<OverlayResult>;
  close(): void;
}

export type ShortcutRegistration =
  | { ok: true; accelerator: string }
  | { ok: false; accelerator: string; message: string };

export interface CapturePlatformAdapter {
  registerGlobalShortcut(
    accelerator: string,
    handler: () => void
  ): ShortcutRegistration;
  unregisterGlobalShortcut(): void;
  capturePrimaryDisplay(): Promise<CapturedDisplay>;
  openOverlay(input: OverlayOpenInput): Promise<OverlaySession>;
  restorePreviousFocus(): Promise<void>;
  activateHostWindow(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CaptureOverlay {
  run(input: OverlayInput): Promise<OverlayResult>;
  dispose(): void;
}

import type {
  CaptureOverlay as CaptureOverlayContract,
  OverlayInput,
  OverlayResult
} from "../platform/capture-platform-adapter";
import { createOverlayDocument } from "./overlay-document";

interface ResultEventDetail {
  channel: string;
  result: OverlayResult;
}

export class CaptureOverlay implements CaptureOverlayContract {
  private active = false;
  private disposed = false;
  private rejectActive?: (reason: Error) => void;
  private cleanupActive?: () => void;

  constructor(private readonly targetDocument: Document = document) {}

  run(input: OverlayInput): Promise<OverlayResult> {
    if (this.disposed) return Promise.reject(new Error("Capture overlay is disposed"));
    if (this.active) return Promise.reject(new Error("Capture overlay is already active"));
    this.active = true;
    const channel = `screenshot-inbox:${crypto.randomUUID()}`;
    const targetWindow = this.targetDocument.defaultView ?? window;

    return new Promise<OverlayResult>((resolve, reject) => {
      this.rejectActive = reject;
      const onResult = (event: Event) => {
        const detail = (event as CustomEvent<ResultEventDetail>).detail;
        if (detail?.channel !== channel) return;
        cleanup();
        resolve(detail.result);
      };
      const cleanup = () => {
        targetWindow.removeEventListener("screenshot-inbox-result", onResult);
        this.rejectActive = undefined;
        this.cleanupActive = undefined;
        this.active = false;
      };
      this.cleanupActive = cleanup;
      targetWindow.addEventListener("screenshot-inbox-result", onResult);
      try {
        this.targetDocument.open();
        this.targetDocument.write(createOverlayDocument(input, channel));
        this.targetDocument.close();
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const reject = this.rejectActive;
    this.cleanupActive?.();
    reject?.(new Error("Capture overlay was disposed"));
  }
}

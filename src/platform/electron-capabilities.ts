export interface ElectronCapabilities {
  main: {
    globalShortcut?: {
      register: (...args: unknown[]) => boolean;
      unregister: (...args: unknown[]) => void;
    };
    screen?: { getPrimaryDisplay: (...args: unknown[]) => unknown };
    BrowserWindow?: new (...args: unknown[]) => unknown;
    ipcMain?: {
      once: (...args: unknown[]) => unknown;
      removeListener: (...args: unknown[]) => unknown;
    };
    desktopCapturer?: { getSources: (...args: unknown[]) => Promise<unknown[]> };
  };
  renderer: {
    desktopCapturer?: { getSources: (...args: unknown[]) => Promise<unknown[]> };
    remote?: { require: (specifier: string) => unknown };
  };
}

type RequireFunction = (specifier: string) => unknown;

function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "MODULE_NOT_FOUND"
  );
}

function safeRequire(requireFn: RequireFunction, specifier: string): unknown {
  try {
    return requireFn(specifier);
  } catch (error) {
    if (isModuleNotFound(error)) return undefined;
    throw error;
  }
}

export function loadElectronCapabilities(
  requireFn: RequireFunction
): ElectronCapabilities {
  const rendererModule = requireFn("electron") as ElectronCapabilities["renderer"];
  const remote =
    rendererModule.remote ??
    (safeRequire(requireFn, "@electron/remote") as
      | { require?: (specifier: string) => unknown }
      | undefined);
  const main = (remote?.require?.("electron") ?? rendererModule) as ElectronCapabilities["main"];
  const renderer: ElectronCapabilities["renderer"] = {
    ...rendererModule,
    desktopCapturer:
      rendererModule.desktopCapturer ?? main.desktopCapturer
  };
  const capabilities = { main, renderer };
  assertCaptureCapabilities(capabilities);
  return capabilities;
}

export function assertCaptureCapabilities(
  value: ElectronCapabilities
): asserts value is ElectronCapabilities {
  const valid =
    typeof value.main?.globalShortcut?.register === "function" &&
    typeof value.main?.globalShortcut?.unregister === "function" &&
    typeof value.main?.screen?.getPrimaryDisplay === "function" &&
    typeof value.main?.BrowserWindow === "function" &&
    typeof value.main?.ipcMain?.once === "function" &&
    typeof value.main?.ipcMain?.removeListener === "function" &&
    typeof value.renderer?.desktopCapturer?.getSources === "function";

  if (!valid) {
    throw new Error(
      "Screenshot Inbox requires Electron capture capabilities on the Windows desktop version of Obsidian"
    );
  }
}

import { describe, expect, it, vi } from "vitest";
import {
  assertCaptureCapabilities,
  loadElectronCapabilities
} from "../../src/platform/electron-capabilities";

describe("Electron capability gate", () => {
  it("loads main-process APIs through an exposed remote bridge", () => {
    const mainElectron = {
      globalShortcut: { register: vi.fn(), unregister: vi.fn() },
      screen: { getPrimaryDisplay: vi.fn() },
      BrowserWindow: vi.fn(),
      ipcMain: { once: vi.fn(), removeListener: vi.fn() }
    };
    const rendererElectron = {
      desktopCapturer: { getSources: vi.fn() },
      remote: { require: vi.fn(() => mainElectron) }
    };

    const capabilities = loadElectronCapabilities(() => rendererElectron);

    expect(capabilities.main.globalShortcut).toBe(mainElectron.globalShortcut);
    expect(capabilities.renderer.desktopCapturer).toBe(rendererElectron.desktopCapturer);
  });

  it("normalizes desktopCapturer when Electron exposes it only in the main process", () => {
    const desktopCapturer = { getSources: vi.fn() };
    const mainElectron = {
      globalShortcut: { register: vi.fn(), unregister: vi.fn() },
      screen: { getPrimaryDisplay: vi.fn() },
      BrowserWindow: vi.fn(),
      ipcMain: { once: vi.fn(), removeListener: vi.fn() },
      desktopCapturer
    };
    const rendererElectron = {
      remote: { require: vi.fn(() => mainElectron) }
    };

    const capabilities = loadElectronCapabilities(() => rendererElectron);

    expect(capabilities.renderer.desktopCapturer).toBe(desktopCapturer);
  });

  it("rejects hosts without every required API", () => {
    expect(() =>
      assertCaptureCapabilities({ main: {}, renderer: {} } as never)
    ).toThrow("Screenshot Inbox requires Electron capture capabilities");
  });

  it("propagates non-module resolution failures from the remote bridge", () => {
    const failure = Object.assign(new Error("bridge initialization failed"), {
      code: "EACCES"
    });

    expect(() =>
      loadElectronCapabilities((specifier: string) => {
        if (specifier === "electron") return {};
        throw failure;
      })
    ).toThrow(failure);
  });
});

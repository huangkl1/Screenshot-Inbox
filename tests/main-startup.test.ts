import { describe, expect, it, vi } from "vitest";
import ScreenshotInboxPlugin, {
  type PluginRuntime
} from "../src/main";
import { PluginDataStore } from "../src/settings/plugin-data-store";

describe("ScreenshotInboxPlugin startup", () => {
  it("does not create the default note during plugin startup", async () => {
    const controller = {
      registerConfiguredShortcut: vi.fn(),
      offerPendingInserts: vi.fn(async () => undefined)
    };
    const targets = {
      ensureDefaultNote: vi.fn(async () => {
        throw new Error("should not be called during startup");
      }),
      recordOpenedNote: vi.fn(),
      dispose: vi.fn()
    };
    const runtime = {
      controller,
      targets,
      settingsTab: {}
    } as unknown as PluginRuntime;

    class TestPlugin extends ScreenshotInboxPlugin {
      protected override async createRuntime(
        _store: PluginDataStore
      ): Promise<PluginRuntime> {
        return runtime;
      }
    }

    const plugin = new TestPlugin({
      workspace: {
        on: vi.fn(() => ({}))
      }
    } as never, {} as never);

    await expect(plugin.onload()).resolves.toBeUndefined();
    expect(targets.ensureDefaultNote).not.toHaveBeenCalled();
    expect(controller.registerConfiguredShortcut).toHaveBeenCalledOnce();
    expect(controller.offerPendingInserts).toHaveBeenCalledOnce();
  });
});

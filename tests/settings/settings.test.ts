import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateSettings } from "../../src/settings/settings";

describe("Screenshot Inbox settings", () => {
  it("uses the locked MVP defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
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
  });

  it("sanitizes persisted recent notes and enum values", () => {
    const settings = migrateSettings({
      recentNotePaths: [
        "A.md",
        "A.md",
        "B.md",
        "C.md",
        "D.md",
        "E.md",
        "F.md"
      ],
      lastTool: "ellipse"
    });

    expect(settings.recentNotePaths).toEqual([
      "A.md",
      "B.md",
      "C.md",
      "D.md",
      "E.md"
    ]);
    expect(settings.lastTool).toBe("pen");
    expect(migrateSettings({ lastTool: "text" }).lastTool).toBe("text");
  });

  it("normalizes vault paths and rejects malformed persisted values", () => {
    const settings = migrateSettings({
      accelerator: "",
      defaultNotePath: "Folder\\Inbox.md",
      recentNotePaths: ["Folder\\One.md", "", 42, "Folder/One.md"],
      lastColor: "purple",
      lastStrokeWidth: 16,
      lastFontSize: 99,
      afterSaveAction: "clipboard"
    });

    expect(settings.accelerator).toBe("Alt+Q");
    expect(settings.defaultNotePath).toBe("Folder/Inbox.md");
    expect(settings.recentNotePaths).toEqual(["Folder/One.md"]);
    expect(settings.lastColor).toBe("red");
    expect(settings.lastStrokeWidth).toBe(4);
    expect(settings.lastFontSize).toBe(24);
    expect(settings.afterSaveAction).toBe("return");
  });

  it("falls back from machine-specific absolute paths to the vault default", () => {
    const settings = migrateSettings({
      defaultNotePath: "D:\\笔记仓库\\Winnie\\截图收集\\截图收集.md",
      recentNotePaths: [
        "D:\\笔记仓库\\Winnie\\截图收集\\截图收集.md",
        "\\\\server\\share\\Inbox.md",
        "Folder\\Inbox.md"
      ]
    });

    expect(settings.defaultNotePath).toBe("截图收集.md");
    expect(settings.recentNotePaths).toEqual(["Folder/Inbox.md"]);
  });

  it("defaults the description input to visible and preserves an explicit false value", () => {
    expect(migrateSettings({}).showDescriptionInput).toBe(true);
    expect(migrateSettings({ showDescriptionInput: false }).showDescriptionInput).toBe(false);
    expect(migrateSettings({ showDescriptionInput: "false" }).showDescriptionInput).toBe(true);
  });
});

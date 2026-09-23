import {
  AbstractInputSuggest,
  Notice,
  PluginSettingTab,
  Setting,
  type App,
  type TFile,
  type TextComponent
} from "obsidian";
import type { PluginController } from "../controller/plugin-controller";
import type { ControllerSettingsStore } from "../controller/plugin-controller";
import type ScreenshotInboxPlugin from "../main";

function acceleratorFromEvent(event: KeyboardEvent): string | undefined {
  const ignored = new Set(["Control", "Alt", "Shift", "Meta"]);
  if (ignored.has(event.key)) return undefined;
  const key = event.key === " " ? "Space" : event.key.length === 1
    ? event.key.toUpperCase()
    : event.key;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(key);
  return parts.join("+");
}

class MarkdownFileSuggest extends AbstractInputSuggest<TFile> {
  constructor(
    app: App,
    private readonly sourceInput: HTMLInputElement,
    private readonly selected: (file: TFile) => void
  ) {
    super(app, sourceInput);
  }

  getSuggestions(query: string): TFile[] {
    const needle = query.trim().toLocaleLowerCase();
    return this.app.vault.getMarkdownFiles()
      .filter(file => needle.length === 0 || file.path.toLocaleLowerCase().includes(needle))
      .slice(0, 20);
  }

  renderSuggestion(file: TFile, element: HTMLElement): void {
    element.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.sourceInput.value = file.path;
    this.selected(file);
    this.close();
  }
}

export class ScreenshotInboxSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: ScreenshotInboxPlugin,
    private readonly controller: PluginController,
    private readonly settings: ControllerSettingsStore
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.settings.get();

    const shortcut = new Setting(containerEl)
      .setName("全局截图快捷键")
      .setDesc(
        this.controller.lastShortcutError
          ? `当前生效：${this.controller.currentAccelerator ?? "无"}；失败原因：${this.controller.lastShortcutError}`
          : `当前生效：${this.controller.currentAccelerator ?? "尚未注册"}`
      );
    shortcut.settingEl.addClass(
      this.controller.lastShortcutError
        ? "screenshot-inbox-shortcut-error"
        : "screenshot-inbox-shortcut-status"
    );
    shortcut.addText(text => {
      text.setValue(settings.accelerator).setPlaceholder("按下组合键");
      text.inputEl.readOnly = true;
      text.inputEl.addEventListener("keydown", event => {
        const accelerator = acceleratorFromEvent(event);
        if (!accelerator) return;
        event.preventDefault();
        event.stopPropagation();
        text.setValue(accelerator);
        void this.controller.changeAccelerator(accelerator)
          .then(() => this.display())
          .catch(() => this.display());
      });
    });

    new Setting(containerEl)
      .setName("默认目标笔记")
      .setDesc("只能选择或填写仓库内的 Markdown 文件路径")
      .addText(text => this.configureDefaultPath(text, settings.defaultNotePath));

    new Setting(containerEl)
      .setName("是否显示说明输入框（勾选后可在截图工具栏中输入图片说明）")
      .addToggle(toggle => {
        toggle
          .setValue(settings.showDescriptionInput)
          .onChange(value => {
            void this.settings.update({ showDescriptionInput: value }).catch(() => {
              new Notice("Screenshot Inbox 设置保存失败");
            });
          });
      });

    new Setting(containerEl)
      .setName("保存后行为")
      .setDesc("返回截图前的软件，或在 Obsidian 中打开目标笔记")
      .addDropdown(dropdown => {
        dropdown
          .addOption("return", "返回原软件")
          .addOption("open-note", "打开目标笔记")
          .setValue(settings.afterSaveAction)
          .onChange(value => {
            if (value !== "return" && value !== "open-note") return;
            void this.settings.update({ afterSaveAction: value }).catch(() => {
              new Notice("Screenshot Inbox 设置保存失败");
            });
          });
      });
  }

  private configureDefaultPath(text: TextComponent, current: string): void {
    text.setValue(current).setPlaceholder("截图收集.md");
    const persist = (path: string) => {
      const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
      if (!normalized.toLocaleLowerCase().endsWith(".md")) {
        new Notice("默认目标必须是 Markdown 文件路径");
        return;
      }
      text.setValue(normalized);
      void this.settings.update({ defaultNotePath: normalized }).catch(() => {
        new Notice("Screenshot Inbox 设置保存失败");
      });
    };
    text.onChange(value => {
      if (value.trim().toLocaleLowerCase().endsWith(".md")) persist(value);
    });
    new MarkdownFileSuggest(this.app, text.inputEl, file => persist(file.path));
  }
}

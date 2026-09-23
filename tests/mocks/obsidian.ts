export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

export class Plugin {
  app: any;
  manifest: any;
  commands: any[] = [];
  settingTabs: any[] = [];
  events: any[] = [];
  data: unknown = {};

  constructor(app: any = {}, manifest: any = {}) {
    this.app = app;
    this.manifest = manifest;
  }

  addCommand(command: any): any {
    this.commands.push(command);
    return command;
  }

  addSettingTab(tab: any): void {
    this.settingTabs.push(tab);
  }

  registerEvent(event: any): void {
    this.events.push(event);
  }

  async loadData(): Promise<unknown> {
    return this.data;
  }

  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }
}

export class PluginSettingTab {
  containerEl: any = { empty() {} };
  constructor(public app: any, public plugin: any) {}
  display(): void {}
}

export class AbstractInputSuggest<T> {
  constructor(public app: any, public inputEl: HTMLInputElement) {}
  close(): void {}
  getSuggestions(_query: string): T[] { return []; }
  renderSuggestion(_value: T, _el: HTMLElement): void {}
  selectSuggestion(_value: T): void {}
}

class Component {
  inputEl = document.createElement("input");
  selectEl = document.createElement("select");
  setValue(_value: string): this { return this; }
  setPlaceholder(_value: string): this { return this; }
  onChange(_callback: (value: string) => void): this { return this; }
}

export class Setting {
  settingEl = document.createElement("div");
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string): this { return this; }
  setDesc(_description: string | DocumentFragment): this { return this; }
  addText(callback: (component: Component) => void): this { callback(new Component()); return this; }
  addDropdown(callback: (component: Component & { addOption(value: string, label: string): any }) => void): this {
    const component = Object.assign(new Component(), { addOption() { return component; } });
    callback(component);
    return this;
  }
}

export class Notice {
  noticeEl = document.createElement("div");
  constructor(public message: string, public timeout?: number) {}
}

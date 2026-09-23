import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { OverlayInput } from "../../src/platform/capture-platform-adapter";
import { createOverlayDocument } from "../../src/overlay/overlay-document";
import { CaptureOverlay } from "../../src/overlay/capture-overlay";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function input(overrides: Partial<OverlayInput> = {}): OverlayInput {
  return {
    capture: {
      pngDataUrl: PNG_DATA_URL,
      physicalSize: { width: 1000, height: 750 },
      logicalBounds: { x: 100, y: 50, width: 800, height: 600 },
      scaleFactor: 1.25
    },
    notes: [
      { path: "Inbox/默认 & <收集>.md", label: "默认 <收集>", isDefault: true },
      { path: "项目/一.md", label: "项目一", isDefault: false },
      { path: "项目/二.md", label: "项目二", isDefault: false },
      { path: "项目/一.md", label: "重复项", isDefault: false },
      { path: "Archive/three.md", label: "Three", isDefault: false },
      { path: "Archive/four.md", label: "Four", isDefault: false },
      { path: "Archive/five.md", label: "Five", isDefault: false },
      { path: "Archive/six.md", label: "Six", isDefault: false },
      { path: "Private/needle.md", label: "Needle Note", isDefault: false }
    ],
    settings: {
      lastTool: "pen",
      lastColor: "red",
      lastStrokeWidth: 4,
      lastFontSize: 24,
      showDescriptionInput: true
    },
    ...overrides
  };
}

type SentPayload = { channel: string; payload: Record<string, unknown> };

async function loadOverlay(
  overlayInput = input(),
  options: { autoLoadImage?: boolean } = {}
) {
  const sent: SentPayload[] = [];
  const drawCalls: unknown[][] = [];
  const textCalls: unknown[][] = [];
  let triggerImageLoad: () => void = () => undefined;
  const html = createOverlayDocument(overlayInput, "screenshot-inbox:test");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
      Object.defineProperty(window, "require", {
        value: () => ({
          ipcRenderer: {
            send: (channel: string, payload: Record<string, unknown>) => {
              sent.push({ channel, payload });
            }
          }
        })
      });

      class LoadedImage {
        width = 1000;
        height = 750;
        naturalWidth = 1000;
        naturalHeight = 750;
        onload: (() => void) | null = null;
        set src(_value: string) {
          triggerImageLoad = () => this.onload?.();
          if (options.autoLoadImage !== false) window.queueMicrotask(triggerImageLoad);
        }
      }
      Object.defineProperty(window, "Image", { value: LoadedImage });

      const context = {
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {},
        strokeRect() {}, clearRect() {}, fillRect() {}, save() {}, restore() {},
        arc() {}, fill() {}, setTransform() {},
        drawImage(...args: unknown[]) { drawCalls.push(args); },
        fillText(...args: unknown[]) { textCalls.push(args); },
        globalCompositeOperation: "source-over",
        strokeStyle: "", fillStyle: "", lineWidth: 1,
        lineCap: "round", lineJoin: "round", font: "", textBaseline: "top",
        setLineDash() {}, measureText: (value: string) => ({ width: value.length * 10 })
      };
      Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
        value: () => context
      });
      Object.defineProperty(window.HTMLCanvasElement.prototype, "toDataURL", {
        value: () => PNG_DATA_URL
      });
      Object.defineProperty(window.HTMLCanvasElement.prototype, "getBoundingClientRect", {
        value() {
          return {
            x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600,
            width: 800, height: 600, toJSON() { return {}; }
          };
        }
      });
    }
  });
  await new Promise<void>((resolve) => dom.window.queueMicrotask(resolve));
  return { dom, window: dom.window, sent, drawCalls, textCalls, html, triggerImageLoad };
}

function pointer(window: DOMWindow, type: string, x: number, y: number): MouseEvent {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    buttons: 1
  });
  window.document.getElementById("interaction")!.dispatchEvent(event);
  return event;
}

function key(window: DOMWindow, value: string, options: KeyboardEventInit = {}): void {
  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: value, bubbles: true, ...options })
  );
}

function state(window: DOMWindow): Record<string, any> {
  return (window as unknown as { __screenshotInboxState: Record<string, any> })
    .__screenshotInboxState;
}

describe("createOverlayDocument", () => {
  it("生成完全本地、自包含且安全序列化的三层 Canvas 文档", () => {
    const html = createOverlayDocument(input(), "screenshot-inbox:test");

    expect(html).not.toMatch(/(?:src|href)=["']https?:/i);
    expect(html).not.toContain("<收集></option>");
    expect(html).not.toContain("</script><script>");
    const dom = new JSDOM(html);
    expect(dom.window.document.querySelectorAll("canvas")).toHaveLength(3);
    expect(dom.window.document.querySelector("#screen-layer")).not.toBeNull();
    expect(dom.window.document.querySelector("#annotation-layer")).not.toBeNull();
    expect(dom.window.document.querySelector("#interaction")).not.toBeNull();
  });

  it("按设置显示或隐藏说明输入框", () => {
    const visible = new JSDOM(createOverlayDocument(input(), "screenshot-inbox:test"));
    expect(visible.window.document.querySelector("#filename-input")).not.toBeNull();
    expect(visible.window.document.querySelector("#description-input")).not.toBeNull();
    expect(visible.window.document.querySelector(".toolbar-description")).not.toBeNull();
    const visibleToolbar = visible.window.document.querySelector("#toolbar");
    const visibleDescription = visibleToolbar?.querySelector(".toolbar-description");
    const visibleActions = visibleToolbar?.querySelector(".toolbar-actions");
    const visibleSave = visibleToolbar?.querySelector("#save");
    expect(visibleDescription).toBeTruthy();
    expect(visibleActions).toBeTruthy();
    expect(visibleActions?.previousElementSibling?.className).toBe("toolbar-description");
    expect(visibleActions?.querySelector("#save")?.id).toBe(visibleSave?.id);
    expect(visibleSave?.textContent).toBe("保存截图");
    expect(visibleSave?.getAttribute("aria-label")).toBe("保存截图到目标笔记");
    visible.window.close();

    const hidden = new JSDOM(createOverlayDocument(input({
      settings: { ...input().settings, showDescriptionInput: false }
    }), "screenshot-inbox:test"));
    expect(hidden.window.document.querySelector("#filename-input")).not.toBeNull();
    expect(hidden.window.document.querySelector("#description-input")).toBeNull();
    expect(hidden.window.document.querySelector(".toolbar-description")).toBeNull();
    const hiddenToolbar = hidden.window.document.querySelector("#toolbar");
    const hiddenActions = hiddenToolbar?.querySelector(".toolbar-actions");
    expect(hiddenActions).toBeTruthy();
    expect(hiddenActions?.previousElementSibling?.className).toBe("toolbar-field");
    expect(hiddenActions?.querySelector("#save")?.id).toBe("save");
    hidden.window.close();
  });

  it("为工具栏按钮和控件提供明确的悬停说明", () => {
    const { window } = new JSDOM(createOverlayDocument(input(), "screenshot-inbox:test"));

    const titles = new Map([
      ['[data-tool="pen"]', "画笔：自由绘制"],
      ['[data-tool="rectangle"]', "矩形：绘制矩形框"],
      ['[data-tool="arrow"]', "箭头：绘制箭头"],
      ['[data-tool="text"]', "文字：添加和编辑文字"],
      ['[data-color="red"]', "红色：设置标注和文字颜色"],
      ['[data-color="yellow"]', "黄色：设置标注和文字颜色"],
      ['[data-color="blue"]', "蓝色：设置标注和文字颜色"],
      ['[data-color="green"]', "绿色：设置标注和文字颜色"],
      ['[data-color="black"]', "黑色：设置标注和文字颜色"],
      ['[data-color="white"]', "白色：设置标注和文字颜色"],
      ['[data-width="2"]', "线条粗细 2px"],
      ['[data-width="4"]', "线条粗细 4px"],
      ['[data-width="8"]', "线条粗细 8px"],
      ['[data-font-size="10"]', "文字字号 10px"],
      ['[data-font-size="12"]', "文字字号 12px"],
      ['[data-font-size="16"]', "文字字号 16px"],
      ['[data-font-size="24"]', "文字字号 24px"],
      ['[data-font-size="32"]', "文字字号 32px"],
      ['[data-font-size="48"]', "文字字号 48px"],
      ['[data-font-size="62"]', "文字字号 62px"],
      ["#undo", "撤销上一步标注或文字操作"],
      ["#redo", "重做上一步撤销的操作"],
      ["#filename-input", "填写截图文件名"],
      ["#save", "保存截图到目标笔记"]
    ]);

    for (const [selector, title] of titles) {
      expect(window.document.querySelector(selector)?.getAttribute("title")).toBe(title);
    }
    expect(window.document.getElementById("note-search")?.getAttribute("title")).toBe("搜索目标笔记");
    expect(window.document.getElementById("target-note")?.getAttribute("title")).toBe(
      "选择截图保存到的目标笔记"
    );

    for (const selector of [
      '[data-color="red"]',
      '[data-color="yellow"]',
      '[data-color="blue"]',
      '[data-color="green"]',
      '[data-color="black"]',
      '[data-color="white"]',
      '[data-width="2"]',
      '[data-width="4"]',
      '[data-width="8"]',
      '[data-font-size="10"]',
      '[data-font-size="12"]',
      '[data-font-size="16"]',
      '[data-font-size="24"]',
      '[data-font-size="32"]',
      '[data-font-size="48"]',
      '[data-font-size="62"]'
    ]) {
      expect(window.document.querySelector(selector)?.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("将线条粗细与文字字号按钮放入独立的工具栏分组", () => {
    const { window } = new JSDOM(createOverlayDocument(input(), "screenshot-inbox:test"));

    const strokeGroup = window.document.querySelector('[data-toolbar-group="stroke-width"]');
    const fontSizeGroup = window.document.querySelector('[data-toolbar-group="font-size"]');

    expect(strokeGroup?.getAttribute("role")).toBe("group");
    expect(strokeGroup?.getAttribute("aria-label")).toBe("线条粗细");
    expect(strokeGroup?.querySelector(".toolbar-group-label")?.textContent).toBe("线条粗细");
    expect(strokeGroup?.querySelectorAll("[data-width]")).toHaveLength(3);
    expect(strokeGroup?.querySelector("[data-font-size]")).toBeNull();

    expect(fontSizeGroup?.getAttribute("role")).toBe("group");
    expect(fontSizeGroup?.getAttribute("aria-label")).toBe("文字字号");
    expect(fontSizeGroup?.querySelector(".toolbar-group-label")?.textContent).toBe("文字字号");
    expect(fontSizeGroup?.querySelectorAll("[data-font-size]")).toHaveLength(7);
    expect(fontSizeGroup?.querySelector("[data-width]")).toBeNull();
  });

  it("支持框选、移动和东南角缩放，并将工具栏限制在视口内", async () => {
    const { dom, window } = await loadOverlay();
    pointer(window, "pointerdown", 100, 100);
    pointer(window, "pointermove", 300, 250);
    pointer(window, "pointerup", 300, 250);
    expect(state(window).selection).toEqual({ x: 100, y: 100, width: 200, height: 150 });

    pointer(window, "pointerdown", 180, 160);
    pointer(window, "pointermove", 230, 200);
    pointer(window, "pointerup", 230, 200);
    expect(state(window).selection).toEqual({ x: 150, y: 140, width: 200, height: 150 });

    pointer(window, "pointerdown", 350, 290);
    pointer(window, "pointermove", 790, 590);
    pointer(window, "pointerup", 790, 590);
    expect(state(window).selection).toEqual({ x: 150, y: 140, width: 640, height: 450 });

    pointer(window, "pointerdown", 150, 140);
    pointer(window, "pointermove", 100, 100);
    pointer(window, "pointerup", 100, 100);
    expect(state(window).selection).toEqual({ x: 100, y: 100, width: 690, height: 490 });
    const toolbar = state(window).toolbarPosition;
    expect(toolbar.x).toBeGreaterThanOrEqual(8);
    expect(toolbar.y).toBeGreaterThanOrEqual(8);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(792);
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(592);
    dom.window.close();
  });

  it("提供精确的标注选项并支持撤销、重做和快捷键", async () => {
    const { dom, window } = await loadOverlay();
    expect(window.document.querySelectorAll('[data-tool]')).toHaveLength(4);
    expect(window.document.querySelectorAll('[data-color]')).toHaveLength(6);
    expect(window.document.querySelectorAll('[data-width]')).toHaveLength(3);
    expect(window.document.querySelectorAll('[data-font-size]')).toHaveLength(7);

    pointer(window, "pointerdown", 20, 20);
    pointer(window, "pointermove", 300, 260);
    pointer(window, "pointerup", 300, 260);
    (window.document.querySelector('[data-tool="arrow"]') as HTMLElement).click();
    (window.document.querySelector('[data-color="blue"]') as HTMLElement).click();
    (window.document.querySelector('[data-width="8"]') as HTMLElement).click();
    pointer(window, "pointerdown", 40, 50);
    pointer(window, "pointermove", 140, 150);
    pointer(window, "pointerup", 140, 150);
    expect(state(window).tool).toBe("arrow");
    expect(state(window).color).toBe("blue");
    expect(state(window).strokeWidth).toBe(8);
    expect(state(window).annotations).toHaveLength(1);

    key(window, "z", { ctrlKey: true });
    expect(state(window).annotations).toHaveLength(0);
    key(window, "y", { ctrlKey: true });
    expect(state(window).annotations).toHaveLength(1);

    (window.document.querySelector('[data-tool="arrow"]') as HTMLElement).click();
    const beforeMove = { ...state(window).selection };
    pointer(window, "pointerdown", 200, 180);
    pointer(window, "pointermove", 220, 200);
    pointer(window, "pointerup", 220, 200);
    expect(state(window).selection).toEqual({
      ...beforeMove,
      x: beforeMove.x + 20,
      y: beforeMove.y + 20
    });
    expect(state(window).annotations).toHaveLength(1);
    dom.window.close();
  });

  it("输入文字后支持多个文字对象、移动和四角缩放", async () => {
    const { dom, window } = await loadOverlay();
    pointer(window, "pointerdown", 100, 100);
    pointer(window, "pointermove", 500, 400);
    pointer(window, "pointerup", 500, 400);

    (window.document.querySelector('[data-tool="text"]') as HTMLElement).click();
    (window.document.querySelector('[data-font-size="62"]') as HTMLElement).click();
    (window.document.querySelector('[data-color="green"]') as HTMLElement).click();
    pointer(window, "pointerdown", 180, 160);
    pointer(window, "pointerup", 180, 160);

    const editor = window.document.getElementById("text-editor") as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    editor.value = "第一行\n第二行";
    editor.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
    key(window, "Enter");

    expect(state(window).annotations).toEqual([
      expect.objectContaining({
        type: "text",
        text: "第一行\n第二行",
        color: "green",
        fontSize: 62,
        position: { x: 180, y: 160 }
      })
    ]);

    pointer(window, "pointerdown", 200, 180);
    pointer(window, "pointermove", 240, 210);
    pointer(window, "pointerup", 240, 210);
    expect(state(window).annotations[0].position).toEqual({ x: 220, y: 190 });

    const textBounds = state(window).selectedTextBounds;
    pointer(window, "pointerdown", textBounds.x + textBounds.width, textBounds.y + textBounds.height);
    pointer(window, "pointermove", textBounds.x + textBounds.width + 30, textBounds.y + textBounds.height + 30);
    pointer(window, "pointerup", textBounds.x + textBounds.width + 30, textBounds.y + textBounds.height + 30);
    expect(state(window).annotations[0].fontSize).toBeGreaterThan(62);

    pointer(window, "pointerdown", 450, 340);
    pointer(window, "pointerup", 450, 340);
    const secondEditor = window.document.getElementById("text-editor") as HTMLTextAreaElement;
    secondEditor.value = "第二段";
    secondEditor.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
    key(window, "Enter");
    expect(state(window).annotations).toHaveLength(2);

    key(window, "z", { ctrlKey: true });
    expect(state(window).annotations).toHaveLength(1);
    key(window, "y", { ctrlKey: true });
    expect(state(window).annotations).toHaveLength(2);
    dom.window.close();
  });

  it("打开文字输入框时阻止画布默认焦点切换", async () => {
    const { dom, window } = await loadOverlay();
    pointer(window, "pointerdown", 100, 100);
    pointer(window, "pointermove", 500, 400);
    pointer(window, "pointerup", 500, 400);
    (window.document.querySelector('[data-tool="text"]') as HTMLElement).click();

    const pointerDown = pointer(window, "pointerdown", 180, 160);
    pointer(window, "pointerup", 180, 160);
    const editor = window.document.getElementById("text-editor") as HTMLTextAreaElement;

    expect(pointerDown.defaultPrevented).toBe(true);
    expect(editor).not.toBeNull();
    expect(window.document.activeElement).toBe(editor);
    dom.window.close();
  });

  it("按物理 DPI 导出文字并返回最后字号", async () => {
    const context = await loadOverlay(input({
      capture: {
        pngDataUrl: PNG_DATA_URL,
        physicalSize: { width: 1600, height: 1200 },
        logicalBounds: { x: 0, y: 0, width: 800, height: 600 },
        scaleFactor: 2
      }
    }));
    pointer(context.window, "pointerdown", 10, 10);
    pointer(context.window, "pointermove", 400, 300);
    pointer(context.window, "pointerup", 400, 300);
    (context.window.document.querySelector('[data-tool="text"]') as HTMLElement).click();
    (context.window.document.querySelector('[data-font-size="12"]') as HTMLElement).click();
    pointer(context.window, "pointerdown", 20, 30);
    pointer(context.window, "pointerup", 20, 30);
    const editor = context.window.document.getElementById("text-editor") as HTMLTextAreaElement;
    editor.value = "DPI文字";
    key(context.window, "Enter");
    key(context.window, "Enter");

    expect(context.sent[0].payload.result).toMatchObject({
      status: "saved",
      lastFontSize: 12
    });
    expect(context.textCalls).toEqual(expect.arrayContaining([
      expect.arrayContaining(["DPI文字", 20, 40])
    ]));
    context.dom.window.close();
  });

  it("真实输入框按 Enter 只提交文字，不会提前保存截图", async () => {
    const context = await loadOverlay();
    pointer(context.window, "pointerdown", 10, 10);
    pointer(context.window, "pointermove", 400, 300);
    pointer(context.window, "pointerup", 400, 300);
    (context.window.document.querySelector('[data-tool="text"]') as HTMLElement).click();
    pointer(context.window, "pointerdown", 40, 50);
    pointer(context.window, "pointerup", 40, 50);
    const editor = context.window.document.getElementById("text-editor") as HTMLTextAreaElement;
    editor.value = "继续编辑";
    editor.dispatchEvent(new context.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true
    }));

    expect(context.sent).toHaveLength(0);
    expect(state(context.window).annotations).toHaveLength(1);
    expect(context.window.document.getElementById("text-editor")).toBeNull();
    context.dom.window.close();
  });

  it("零面积 Enter 不发送，Escape 取消，有效 Enter 导出物理像素 PNG", async () => {
    const first = await loadOverlay();
    key(first.window, "Enter");
    expect(first.sent).toHaveLength(0);
    key(first.window, "Escape");
    expect(first.sent).toEqual([
      {
        channel: "screenshot-inbox:test",
        payload: {
          channel: "screenshot-inbox:test",
          result: { status: "cancelled" }
        }
      }
    ]);
    first.dom.window.close();

    const second = await loadOverlay();
    pointer(second.window, "pointerdown", 40, 60);
    pointer(second.window, "pointermove", 240, 180);
    pointer(second.window, "pointerup", 240, 180);
    key(second.window, "Enter");
    expect(second.sent).toHaveLength(1);
    const result = second.sent[0].payload.result as Record<string, any>;
    expect(result.status).toBe("saved");
    expect(result.filename).toBe("");
    expect(result.description).toBe("");
    expect(result.targetNotePath).toBe("Inbox/默认 & <收集>.md");
    expect(Array.from(result.png as Uint8Array).slice(0, 8)).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10
    ]);
    const exportState = state(second.window).lastExport;
    expect(exportState).toEqual({ x: 50, y: 75, width: 250, height: 150 });
    expect(second.drawCalls.some((call) =>
      call.length === 9 && call.slice(1, 5).join(",") === "50,75,250,150"
    )).toBe(true);
    second.dom.window.close();
  });

  it("保存时返回去除首尾空白的说明", async () => {
    const context = await loadOverlay();
    pointer(context.window, "pointerdown", 40, 60);
    pointer(context.window, "pointermove", 240, 180);
    pointer(context.window, "pointerup", 240, 180);

    const description = context.window.document.getElementById("description-input") as HTMLInputElement;
    const filename = context.window.document.getElementById("filename-input") as HTMLInputElement;
    description.value = "  当前时间 xxx，我看到一个有意思的想法  ";
    filename.value = "  接口设计草图.png  ";
    key(context.window, "Enter");

    expect(context.sent[0].payload.result).toMatchObject({
      status: "saved",
      filename: "接口设计草图.png",
      description: "当前时间 xxx，我看到一个有意思的想法"
    });
    context.dom.window.close();
  });

  it("隐藏说明输入框时保存结果返回空说明", async () => {
    const context = await loadOverlay(input({
      settings: { ...input().settings, showDescriptionInput: false }
    }));
    pointer(context.window, "pointerdown", 40, 60);
    pointer(context.window, "pointermove", 240, 180);
    pointer(context.window, "pointerup", 240, 180);
    key(context.window, "Enter");

    expect(context.sent[0].payload.result).toMatchObject({
      status: "saved",
      filename: "",
      description: ""
    });
    context.dom.window.close();
  });

  it("底图解码完成前暂缓保存，解码后自动完成排队的导出", async () => {
    const context = await loadOverlay(input(), { autoLoadImage: false });
    pointer(context.window, "pointerdown", 10, 10);
    pointer(context.window, "pointermove", 110, 90);
    pointer(context.window, "pointerup", 110, 90);
    key(context.window, "Enter");
    expect(context.sent).toHaveLength(0);

    context.triggerImageLoad();
    await new Promise<void>(resolve => context.window.queueMicrotask(resolve));
    expect(context.sent).toHaveLength(1);
    expect(context.sent[0].payload.result).toMatchObject({ status: "saved" });
    context.dom.window.close();
  });

  it.each([1, 1.25, 1.5, 2])(
    "在 %s 倍 DPI 下按物理像素边界导出",
    async scaleFactor => {
      const context = await loadOverlay(input({
        capture: {
          pngDataUrl: PNG_DATA_URL,
          physicalSize: {
            width: Math.round(800 * scaleFactor),
            height: Math.round(600 * scaleFactor)
          },
          logicalBounds: { x: 0, y: 0, width: 800, height: 600 },
          scaleFactor
        }
      }));
      pointer(context.window, "pointerdown", 11, 13);
      pointer(context.window, "pointermove", 112, 87);
      pointer(context.window, "pointerup", 112, 87);
      key(context.window, "Enter");

      expect(state(context.window).lastExport).toEqual({
        x: Math.round(11 * scaleFactor),
        y: Math.round(13 * scaleFactor),
        width: Math.round(112 * scaleFactor) - Math.round(11 * scaleFactor),
        height: Math.round(87 * scaleFactor) - Math.round(13 * scaleFactor)
      });
      context.dom.window.close();
    }
  );

  it("默认笔记优先、最近路径去重限五，并可按标题或路径搜索", async () => {
    const { dom, window } = await loadOverlay();
    const select = window.document.getElementById("target-note") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "Inbox/默认 & <收集>.md",
      "项目/一.md",
      "项目/二.md",
      "Archive/three.md",
      "Archive/four.md",
      "Archive/five.md"
    ]);

    const search = window.document.getElementById("note-search") as HTMLInputElement;
    search.value = "needle";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "Private/needle.md"
    ]);
    select.value = "Private/needle.md";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(state(window).targetNotePath).toBe("Private/needle.md");

    search.value = "项目/二";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["项目/二.md"]);
    expect(state(window).targetNotePath).toBe("Private/needle.md");

    search.value = "不存在";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    key(window, "ArrowDown");
    expect(state(window).targetNotePath).toBe("Private/needle.md");
    dom.window.close();
  });

  it("10,000 条笔记的常见词搜索限制 DOM 结果并在 200ms 内响应", async () => {
    const notes = [
      { path: "截图收集.md", label: "截图收集", isDefault: true },
      ...Array.from({ length: 10_000 }, (_, index) => ({
        path: `Knowledge/Project-${String(index).padStart(5, "0")}.md`,
        label: `Project ${index}`,
        isDefault: false
      }))
    ];
    const context = await loadOverlay(input({ notes }));
    const search = context.window.document.getElementById("note-search") as HTMLInputElement;
    const select = context.window.document.getElementById("target-note") as HTMLSelectElement;
    const started = performance.now();
    search.value = "project";
    search.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    const duration = performance.now() - started;

    expect(select.options.length).toBeLessThanOrEqual(50);
    expect(duration).toBeLessThan(200);
    context.dom.window.close();
  });
});

describe("CaptureOverlay", () => {
  it("dispose rejects the active run and removes its global result listener", async () => {
    const targetWindow = window;
    const remove = vi.spyOn(targetWindow, "removeEventListener");
    const fakeDocument = {
      defaultView: targetWindow,
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn()
    } as unknown as Document;
    const overlay = new CaptureOverlay(fakeDocument);
    const running = overlay.run(input());

    overlay.dispose();

    await expect(running).rejects.toThrow("Capture overlay was disposed");
    expect(remove).toHaveBeenCalledWith("screenshot-inbox-result", expect.any(Function));
  });
});

import type { OverlayInput } from "../platform/capture-platform-adapter";

interface OverlayConfig extends OverlayInput {
  channel: string;
}

type RuntimeRect = { x: number; y: number; width: number; height: number };
type RuntimePoint = { x: number; y: number };
type RuntimeAnnotation =
  | { type: "pen"; color: string; strokeWidth: number; points: RuntimePoint[] }
  | {
      type: "rectangle" | "arrow";
      color: string;
      strokeWidth: number;
      start: RuntimePoint;
      end: RuntimePoint;
    }
  | {
      type: "text";
      id: string;
      text: string;
      color: string;
      fontSize: number;
      position: RuntimePoint;
    };
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

function serializeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function overlayRuntime(config: OverlayConfig): void {
  const doc = document;
  const screenCanvas = doc.getElementById("screen-layer") as HTMLCanvasElement;
  const annotationCanvas = doc.getElementById("annotation-layer") as HTMLCanvasElement;
  const interactionCanvas = doc.getElementById("interaction") as HTMLCanvasElement;
  const toolbar = doc.getElementById("toolbar") as HTMLDivElement;
  const saveButton = doc.getElementById("save") as HTMLButtonElement;
  const targetSelect = doc.getElementById("target-note") as HTMLSelectElement;
  const noteSearch = doc.getElementById("note-search") as HTMLInputElement;
  const filenameInput = doc.getElementById("filename-input") as HTMLInputElement;
  const descriptionInput = doc.getElementById("description-input") as HTMLInputElement | null;
  const screenContext = screenCanvas.getContext("2d");
  const annotationContext = annotationCanvas.getContext("2d");
  const interactionContext = interactionCanvas.getContext("2d");
  const scale = config.capture.scaleFactor;
  const viewport = {
    width: config.capture.logicalBounds.width,
    height: config.capture.logicalBounds.height
  };
  const toolbarHeight = config.settings.showDescriptionInput ? 192 : 152;
  const toolbarSize = {
    width: Math.max(0, Math.min(720, viewport.width - 16)),
    height: Math.max(0, Math.min(toolbarHeight, viewport.height - 16))
  };
  const notes = config.notes.filter(
    (note, index, all) => all.findIndex(candidate => candidate.path === note.path) === index
  );
  const defaultNote = notes.find(note => note.isDefault) ?? notes[0];
  const initialNotes = [
    ...(defaultNote ? [defaultNote] : []),
    ...notes.filter(note => note.path !== defaultNote?.path).slice(0, 5)
  ];
  const recentRank = new Map(initialNotes.map((note, index) => [note.path, index]));
  const searchableNotes = notes.map(note => ({
    note,
    label: note.label.toLocaleLowerCase(),
    path: note.path.toLocaleLowerCase()
  }));

  const state: {
    selection: RuntimeRect;
    toolbarPosition: { x: number; y: number; width: number; height: number };
    tool: "pen" | "rectangle" | "arrow" | "text";
    color: string;
    strokeWidth: 2 | 4 | 8;
    fontSize: number;
    annotations: RuntimeAnnotation[];
    targetNotePath: string;
    lastExport?: RuntimeRect;
    selectedTextId?: string;
    selectedTextBounds?: RuntimeRect;
  } = {
    selection: { x: 0, y: 0, width: 0, height: 0 },
    toolbarPosition: { x: 8, y: 8, ...toolbarSize },
    tool: config.settings.lastTool,
    color: config.settings.lastColor,
    strokeWidth: config.settings.lastStrokeWidth,
    fontSize: config.settings.lastFontSize,
    annotations: [],
    targetNotePath: defaultNote?.path ?? ""
  };
  Object.defineProperty(window, "__screenshotInboxState", { value: state });

  let history: RuntimeAnnotation[][] = [];
  let historyCursor = 0;
  let elements: RuntimeAnnotation[] = [];
  let gesture:
    | { kind: "select"; start: RuntimePoint }
    | { kind: "move"; start: RuntimePoint; original: RuntimeRect }
    | { kind: "resize"; handle: ResizeHandle; original: RuntimeRect }
    | { kind: "annotate"; annotation: RuntimeAnnotation }
    | {
        kind: "text-move" | "text-resize";
        index: number;
        original: Extract<RuntimeAnnotation, { type: "text" }>;
        handle?: ResizeHandle;
        start: RuntimePoint;
      }
    | undefined;
  let annotationMode = false;
  let sent = false;
  let imageReady = false;
  let saveRequested = false;
  let textEditor: HTMLTextAreaElement | undefined;
  let textEditorIndex: number | undefined;
  let nextTextId = 1;
  const image = new Image();

  function setupCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = config.capture.physicalSize.width;
    canvas.height = config.capture.physicalSize.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  }
  setupCanvas(screenCanvas);
  setupCanvas(annotationCanvas);
  setupCanvas(interactionCanvas);
  annotationContext?.setTransform(scale, 0, 0, scale, 0, 0);
  interactionContext?.setTransform(scale, 0, 0, scale, 0, 0);

  image.onload = () => {
    imageReady = true;
    saveButton.disabled = false;
    screenContext?.drawImage(
      image,
      0,
      0,
      config.capture.physicalSize.width,
      config.capture.physicalSize.height
    );
    if (saveRequested) save();
  };
  image.onerror = () => emit({ status: "cancelled" });
  saveButton.disabled = true;
  image.src = config.capture.pngDataUrl;

  function point(event: MouseEvent): RuntimePoint {
    const bounds = interactionCanvas.getBoundingClientRect();
    return {
      x: Math.min(viewport.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(viewport.height, Math.max(0, event.clientY - bounds.top))
    };
  }

  function normalized(start: RuntimePoint, end: RuntimePoint): RuntimeRect {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    return { x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }

  function contains(rect: RuntimeRect, value: RuntimePoint): boolean {
    return value.x >= rect.x && value.x <= rect.x + rect.width &&
      value.y >= rect.y && value.y <= rect.y + rect.height;
  }

  function resizeHandleAt(rect: RuntimeRect, value: RuntimePoint): ResizeHandle | undefined {
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    const tolerance = 10;
    const left = rect.x;
    const centerX = rect.x + rect.width / 2;
    const right = rect.x + rect.width;
    const top = rect.y;
    const centerY = rect.y + rect.height / 2;
    const bottom = rect.y + rect.height;
    const handles: Array<[ResizeHandle, number, number]> = [
      ["nw", left, top], ["ne", right, top], ["se", right, bottom], ["sw", left, bottom],
      ["n", centerX, top], ["e", right, centerY], ["s", centerX, bottom], ["w", left, centerY]
    ];
    return handles.find(([, x, y]) =>
      Math.abs(value.x - x) <= tolerance && Math.abs(value.y - y) <= tolerance
    )?.[0];
  }

  function clampRect(rect: RuntimeRect): RuntimeRect {
    const width = Math.min(rect.width, viewport.width);
    const height = Math.min(rect.height, viewport.height);
    return {
      x: Math.min(Math.max(0, rect.x), viewport.width - width),
      y: Math.min(Math.max(0, rect.y), viewport.height - height),
      width,
      height
    };
  }

  function placeToolbar(): void {
    if (state.selection.width === 0 || state.selection.height === 0) {
      toolbar.hidden = true;
      return;
    }
    const gap = 8;
    const below = state.selection.y + state.selection.height + gap;
    const x = Math.min(
      Math.max(gap, state.selection.x + state.selection.width - toolbarSize.width),
      Math.max(gap, viewport.width - toolbarSize.width - gap)
    );
    const preferredY = below + toolbarSize.height <= viewport.height
      ? below
      : state.selection.y - toolbarSize.height - gap;
    const y = Math.min(
      Math.max(gap, preferredY),
      Math.max(gap, viewport.height - toolbarSize.height - gap)
    );
    state.toolbarPosition = { x, y, ...toolbarSize };
    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${y}px`;
    toolbar.style.width = `${toolbarSize.width}px`;
    toolbar.hidden = false;
  }

  function drawArrow(
    context: CanvasRenderingContext2D,
    start: RuntimePoint,
    end: RuntimePoint
  ): void {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(10, context.lineWidth * 4);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }

  function drawAnnotation(
    context: CanvasRenderingContext2D,
    annotation: RuntimeAnnotation,
    offset: RuntimePoint = { x: 0, y: 0 },
    coordinateScale = 1
  ): void {
    context.save();
    const convert = (value: RuntimePoint): RuntimePoint => ({
      x: (value.x - offset.x) * coordinateScale,
      y: (value.y - offset.y) * coordinateScale
    });
    if (annotation.type === "text") {
      context.fillStyle = annotation.color;
      context.font = `${annotation.fontSize * coordinateScale}px system-ui, sans-serif`;
      context.textBaseline = "top";
      const lineHeight = annotation.fontSize * 1.2 * coordinateScale;
      const position = convert(annotation.position);
      annotation.text.split("\n").forEach((line, index) => {
        context.fillText(line, position.x, position.y + index * lineHeight);
      });
    } else {
      context.strokeStyle = annotation.color;
      context.lineWidth = annotation.strokeWidth * coordinateScale;
      context.lineCap = "round";
      context.lineJoin = "round";
      if (annotation.type === "pen") {
      const points = annotation.points.map(convert);
      if (points.length > 0) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (const value of points.slice(1)) context.lineTo(value.x, value.y);
        context.stroke();
      }
      } else if (annotation.type === "rectangle") {
        const start = convert(annotation.start);
        const end = convert(annotation.end);
        const rect = normalized(start, end);
        context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      } else {
        drawArrow(context, convert(annotation.start), convert(annotation.end));
      }
    }
    context.restore();
  }

  function textBounds(
    annotation: Extract<RuntimeAnnotation, { type: "text" }>,
    context: CanvasRenderingContext2D | null = annotationContext
  ): RuntimeRect {
    context?.save();
    if (context) {
      context.font = `${annotation.fontSize}px system-ui, sans-serif`;
      context.textBaseline = "top";
    }
    const lines = annotation.text.split("\n");
    const width = Math.max(
      annotation.fontSize,
      ...lines.map(line => context?.measureText?.(line)?.width ?? line.length * annotation.fontSize * 0.6)
    );
    context?.restore();
    return {
      x: annotation.position.x,
      y: annotation.position.y,
      width,
      height: Math.max(annotation.fontSize, lines.length * annotation.fontSize * 1.2)
    };
  }

  function textAt(value: RuntimePoint): number | undefined {
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const annotation = elements[index];
      if (annotation.type === "text" && contains(textBounds(annotation), value)) return index;
    }
    return undefined;
  }

  function textResizeHandleAt(
    rect: RuntimeRect,
    value: RuntimePoint
  ): ResizeHandle | undefined {
    const tolerance = 10;
    const handles: Array<[ResizeHandle, number, number]> = [
      ["nw", rect.x, rect.y],
      ["ne", rect.x + rect.width, rect.y],
      ["se", rect.x + rect.width, rect.y + rect.height],
      ["sw", rect.x, rect.y + rect.height]
    ];
    return handles.find(([, x, y]) =>
      Math.abs(value.x - x) <= tolerance && Math.abs(value.y - y) <= tolerance
    )?.[0];
  }

  function cloneAnnotations(values: RuntimeAnnotation[]): RuntimeAnnotation[] {
    return values.map(annotation =>
      annotation.type === "pen"
        ? { ...annotation, points: annotation.points.map(pointValue => ({ ...pointValue })) }
        : annotation.type === "text"
          ? { ...annotation, position: { ...annotation.position } }
          : { ...annotation, start: { ...annotation.start }, end: { ...annotation.end } }
    );
  }

  function setSelectedText(annotation: Extract<RuntimeAnnotation, { type: "text" }> | undefined): void {
    state.selectedTextBounds = annotation ? textBounds(annotation) : undefined;
  }

  function redrawAnnotations(preview?: RuntimeAnnotation): void {
    annotationContext?.clearRect(0, 0, viewport.width, viewport.height);
    if (!annotationContext) return;
    for (const annotation of elements) {
      drawAnnotation(annotationContext, annotation);
    }
    if (preview) drawAnnotation(annotationContext, preview);
    state.annotations = elements;
    const selected = elements.find(
      annotation => annotation.type === "text" && annotation.id === state.selectedTextId
    );
    setSelectedText(selected?.type === "text" ? selected : undefined);
  }

  function redrawInteraction(): void {
    interactionContext?.clearRect(0, 0, viewport.width, viewport.height);
    if (!interactionContext) return;
    interactionContext.save();
    interactionContext.fillStyle = "rgba(0,0,0,0.48)";
    interactionContext.fillRect(0, 0, viewport.width, viewport.height);
    if (state.selection.width > 0 && state.selection.height > 0) {
      interactionContext.globalCompositeOperation = "destination-out";
      interactionContext.fillRect(
        state.selection.x,
        state.selection.y,
        state.selection.width,
        state.selection.height
      );
      interactionContext.globalCompositeOperation = "source-over";
      interactionContext.strokeStyle = "#4da3ff";
      interactionContext.lineWidth = 1;
      interactionContext.strokeRect(
        state.selection.x + 0.5,
        state.selection.y + 0.5,
        Math.max(0, state.selection.width - 1),
        Math.max(0, state.selection.height - 1)
      );
      interactionContext.fillStyle = "#ffffff";
      const left = state.selection.x;
      const centerX = left + state.selection.width / 2;
      const right = left + state.selection.width;
      const top = state.selection.y;
      const centerY = top + state.selection.height / 2;
      const bottom = top + state.selection.height;
      for (const [x, y] of [
        [left, top], [centerX, top], [right, top], [right, centerY],
        [right, bottom], [centerX, bottom], [left, bottom], [left, centerY]
      ]) interactionContext.fillRect(x - 5, y - 5, 10, 10);
    }
    if (state.selectedTextBounds) {
      const bounds = state.selectedTextBounds;
      interactionContext.strokeStyle = "#f7c948";
      interactionContext.setLineDash?.([4, 3]);
      interactionContext.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      interactionContext.setLineDash?.([]);
      interactionContext.fillStyle = "#f7c948";
      for (const [x, y] of [
        [bounds.x, bounds.y],
        [bounds.x + bounds.width, bounds.y],
        [bounds.x + bounds.width, bounds.y + bounds.height],
        [bounds.x, bounds.y + bounds.height]
      ]) interactionContext.fillRect(x - 5, y - 5, 10, 10);
    }
    interactionContext.restore();
    placeToolbar();
  }

  function push(annotation: RuntimeAnnotation): void {
    commit([...elements, annotation]);
  }

  function commit(next: RuntimeAnnotation[]): void {
    elements = cloneAnnotations(next);
    history = [...history.slice(0, historyCursor), cloneAnnotations(elements)];
    historyCursor = history.length;
    redrawAnnotations();
  }

  function undo(): void {
    if (historyCursor > 0) historyCursor -= 1;
    elements = cloneAnnotations(history[historyCursor - 1] ?? []);
    redrawAnnotations();
  }

  function redo(): void {
    if (historyCursor < history.length) historyCursor += 1;
    elements = cloneAnnotations(history[historyCursor - 1] ?? []);
    redrawAnnotations();
  }

  function clampTextPosition(
    annotation: Extract<RuntimeAnnotation, { type: "text" }>
  ): Extract<RuntimeAnnotation, { type: "text" }> {
    const bounds = textBounds(annotation);
    const selection = state.selection;
    const minX = selection.width > 0 ? selection.x : 0;
    const minY = selection.height > 0 ? selection.y : 0;
    const maxX = selection.width > 0
      ? Math.max(minX, selection.x + selection.width - bounds.width)
      : Math.max(0, viewport.width - bounds.width);
    const maxY = selection.height > 0
      ? Math.max(minY, selection.y + selection.height - bounds.height)
      : Math.max(0, viewport.height - bounds.height);
    return {
      ...annotation,
      position: {
        x: Math.min(maxX, Math.max(minX, annotation.position.x)),
        y: Math.min(maxY, Math.max(minY, annotation.position.y))
      }
    };
  }

  function resizeText(
    original: Extract<RuntimeAnnotation, { type: "text" }>,
    handle: ResizeHandle,
    current: RuntimePoint
  ): Extract<RuntimeAnnotation, { type: "text" }> {
    const bounds = textBounds(original);
    const oppositeX = handle.includes("w") ? bounds.x + bounds.width : bounds.x;
    const oppositeY = handle.includes("n") ? bounds.y + bounds.height : bounds.y;
    const desiredWidth = Math.max(8, Math.abs(current.x - oppositeX));
    const desiredHeight = Math.max(8, Math.abs(current.y - oppositeY));
    const factor = Math.min(
      4,
      Math.max(0.2, desiredWidth / Math.max(1, bounds.width), desiredHeight / Math.max(1, bounds.height))
    );
    const fontSize = Math.min(200, Math.max(4, original.fontSize * factor));
    const nextBounds = {
      width: bounds.width * factor,
      height: bounds.height * factor
    };
    const next = {
      ...original,
      fontSize,
      position: {
        x: handle.includes("w") ? oppositeX - nextBounds.width : oppositeX,
        y: handle.includes("n") ? oppositeY - nextBounds.height : oppositeY
      }
    };
    return clampTextPosition(next);
  }

  function finishTextEditor(saveValue: boolean): void {
    const editor = textEditor;
    if (!editor) return;
    const index = textEditorIndex;
    textEditor = undefined;
    textEditorIndex = undefined;
    editor.remove();
    const text = editor.value;
    if (!saveValue || text.trim().length === 0) {
      redrawInteraction();
      return;
    }
    const existing = index === undefined ? undefined : elements[index];
    const annotation: Extract<RuntimeAnnotation, { type: "text" }> = {
      type: "text",
      id: existing?.type === "text" ? existing.id : `text-${nextTextId++}`,
      text,
      color: existing?.type === "text" ? existing.color : state.color,
      fontSize: existing?.type === "text" ? existing.fontSize : state.fontSize,
      position: existing?.type === "text" ? existing.position : { ...editorPosition }
    };
    const clamped = clampTextPosition(annotation);
    if (index === undefined) {
      state.selectedTextId = clamped.id;
      commit([...elements, clamped]);
    } else {
      const next = [...elements];
      next[index] = clamped;
      state.selectedTextId = clamped.id;
      commit(next);
    }
  }

  let editorPosition: RuntimePoint = { x: 0, y: 0 };

  function openTextEditor(
    position: RuntimePoint,
    index?: number
  ): void {
    if (textEditor) finishTextEditor(true);
    const existing = index === undefined ? undefined : elements[index];
    const editor = doc.createElement("textarea");
    editor.id = "text-editor";
    editor.value = existing?.type === "text" ? existing.text : "";
    editor.rows = 1;
    editor.placeholder = "输入文字";
    editor.style.position = "fixed";
    editor.style.left = `${position.x}px`;
    editor.style.top = `${position.y}px`;
    editor.style.zIndex = "5";
    editor.style.minWidth = "80px";
    editor.style.minHeight = `${(existing?.type === "text" ? existing.fontSize : state.fontSize) * 1.4}px`;
    editor.style.font = `${existing?.type === "text" ? existing.fontSize : state.fontSize}px system-ui, sans-serif`;
    editor.style.color = existing?.type === "text" ? existing.color : state.color;
    editor.style.background = "rgba(0,0,0,.35)";
    editor.style.border = "1px solid #f7c948";
    editor.style.padding = "2px 4px";
    editor.style.resize = "both";
    editor.style.userSelect = "text";
    doc.body.append(editor);
    textEditor = editor;
    textEditorIndex = index;
    editorPosition = existing?.type === "text" ? { ...existing.position } : { ...position };
    editor.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        finishTextEditor(false);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finishTextEditor(true);
      }
    });
    editor.addEventListener("blur", () => finishTextEditor(true));
    editor.focus();
  }

  function updatePressed(): void {
    doc.querySelectorAll<HTMLElement>("[data-tool]").forEach(element => {
      element.dataset.active = String(
        annotationMode && element.dataset.tool === state.tool
      );
    });
    doc.querySelectorAll<HTMLElement>("[data-color]").forEach(element => {
      element.dataset.active = String(element.dataset.color === state.color);
    });
    doc.querySelectorAll<HTMLElement>("[data-width]").forEach(element => {
      element.dataset.active = String(Number(element.dataset.width) === state.strokeWidth);
    });
    doc.querySelectorAll<HTMLElement>("[data-font-size]").forEach(element => {
      element.dataset.active = String(Number(element.dataset.fontSize) === state.fontSize);
    });
  }

  function populateNotes(query: string): void {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const options = normalizedQuery.length === 0
      ? initialNotes
      : searchableNotes
          .map(item => {
            const labelIndex = item.label.indexOf(normalizedQuery);
            const pathIndex = item.path.indexOf(normalizedQuery);
            const rank = labelIndex === 0 ? 0 : labelIndex > 0 ? 1 : pathIndex >= 0 ? 2 : 3;
            return { ...item, rank, recent: recentRank.get(item.note.path) ?? Number.MAX_SAFE_INTEGER };
          })
          .filter(item => item.rank < 3)
          .sort((left, right) =>
            left.rank - right.rank ||
            left.recent - right.recent ||
            left.label.localeCompare(right.label) ||
            left.path.localeCompare(right.path)
          )
          .slice(0, 50)
          .map(item => item.note);
    targetSelect.replaceChildren();
    for (const note of options) {
      const option = doc.createElement("option");
      option.value = note.path;
      option.textContent = `${note.label} — ${note.path}`;
      option.selected = note.path === state.targetNotePath;
      targetSelect.append(option);
    }
  }

  function emit(result: Record<string, unknown>): void {
    if (sent) return;
    sent = true;
    const envelope = { channel: config.channel, result };
    window.dispatchEvent(new CustomEvent("screenshot-inbox-result", { detail: envelope }));
    const electronRequire = (window as unknown as { require?: (name: string) => unknown }).require;
    const electron = electronRequire?.("electron") as
      | { ipcRenderer?: { send(channel: string, payload: unknown): void } }
      | undefined;
    electron?.ipcRenderer?.send(config.channel, envelope);
  }

  function dataUrlBytes(dataUrl: string): Uint8Array {
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function save(): void {
    const selection = state.selection;
    if (
      sent || selection.width <= 0 || selection.height <= 0 ||
      state.targetNotePath.length === 0
    ) return;
    if (!imageReady) {
      saveRequested = true;
      return;
    }
    saveRequested = false;
    const left = Math.max(0, Math.round(selection.x * scale));
    const top = Math.max(0, Math.round(selection.y * scale));
    const right = Math.min(
      config.capture.physicalSize.width,
      Math.round((selection.x + selection.width) * scale)
    );
    const bottom = Math.min(
      config.capture.physicalSize.height,
      Math.round((selection.y + selection.height) * scale)
    );
    const physical = {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
    if (physical.width === 0 || physical.height === 0) return;
    state.lastExport = physical;
    const output = doc.createElement("canvas");
    output.width = physical.width;
    output.height = physical.height;
    const context = output.getContext("2d");
    if (!context) return;
    context.drawImage(
      image,
      physical.x,
      physical.y,
      physical.width,
      physical.height,
      0,
      0,
      physical.width,
      physical.height
    );
    for (const annotation of elements) {
      drawAnnotation(context, annotation, { x: selection.x, y: selection.y }, scale);
    }
    const png = dataUrlBytes(output.toDataURL("image/png"));
    emit({
      status: "saved",
      png,
      targetNotePath: state.targetNotePath,
      filename: filenameInput.value.trim(),
      description: descriptionInput?.value.trim() ?? "",
      lastTool: state.tool,
      lastColor: state.color,
      lastStrokeWidth: state.strokeWidth,
      lastFontSize: state.fontSize
    });
  }

  interactionCanvas.addEventListener("pointerdown", event => {
    if (sent) return;
    const current = point(event);
    const selection = state.selection;
    const resizeHandle = resizeHandleAt(selection, current);
    if (resizeHandle) {
      gesture = { kind: "resize", handle: resizeHandle, original: { ...selection } };
    } else if (annotationMode && state.tool === "text" && contains(selection, current)) {
      const textIndex = textAt(current);
      if (textIndex !== undefined) {
        const selected = elements[textIndex];
        if (selected.type !== "text") return;
        state.selectedTextId = selected.id;
        const bounds = textBounds(selected);
        const textHandle = textResizeHandleAt(bounds, current);
        if (event.detail >= 2) {
          event.preventDefault();
          openTextEditor(selected.position, textIndex);
          return;
        }
        gesture = textHandle
          ? {
              kind: "text-resize",
              index: textIndex,
              original: { ...selected, position: { ...selected.position } },
              handle: textHandle,
              start: current
            }
          : {
              kind: "text-move",
              index: textIndex,
              original: { ...selected, position: { ...selected.position } },
              start: current
            };
        redrawInteraction();
      } else {
        state.selectedTextId = undefined;
        event.preventDefault();
        openTextEditor(current);
      }
    } else if (annotationMode && contains(selection, current)) {
      const tool = state.tool === "pen" || state.tool === "rectangle" || state.tool === "arrow"
        ? state.tool
        : "arrow";
      gesture = tool === "pen"
        ? {
            kind: "annotate",
            annotation: {
              type: "pen",
              color: state.color,
              strokeWidth: state.strokeWidth,
              points: [current]
            }
          }
        : {
            kind: "annotate",
            annotation: {
              type: tool,
              color: state.color,
              strokeWidth: state.strokeWidth,
              start: current,
              end: current
            }
          };
    } else if (selection.width > 0 && selection.height > 0 && contains(selection, current)) {
      gesture = { kind: "move", start: current, original: { ...selection } };
    } else {
      annotationMode = false;
      gesture = { kind: "select", start: current };
      state.selection = { x: current.x, y: current.y, width: 0, height: 0 };
      redrawInteraction();
    }
  });

  interactionCanvas.addEventListener("pointermove", event => {
    if (!gesture) return;
    const current = point(event);
    if (gesture.kind === "select") {
      state.selection = normalized(gesture.start, current);
      redrawInteraction();
    } else if (gesture.kind === "move") {
      state.selection = clampRect({
        ...gesture.original,
        x: gesture.original.x + current.x - gesture.start.x,
        y: gesture.original.y + current.y - gesture.start.y
      });
      redrawInteraction();
    } else if (gesture.kind === "resize") {
      let left = gesture.original.x;
      let top = gesture.original.y;
      let right = gesture.original.x + gesture.original.width;
      let bottom = gesture.original.y + gesture.original.height;
      if (gesture.handle.includes("w")) left = current.x;
      if (gesture.handle.includes("e")) right = current.x;
      if (gesture.handle.includes("n")) top = current.y;
      if (gesture.handle.includes("s")) bottom = current.y;
      state.selection = clampRect(normalized({ x: left, y: top }, { x: right, y: bottom }));
      redrawInteraction();
    } else if (gesture.kind === "text-move") {
      const next = {
        ...gesture.original,
        position: {
          x: gesture.original.position.x + current.x - gesture.start.x,
          y: gesture.original.position.y + current.y - gesture.start.y
        }
      };
      elements[gesture.index] = clampTextPosition(next);
      redrawAnnotations();
      redrawInteraction();
    } else if (gesture.kind === "text-resize") {
      const next = resizeText(gesture.original, gesture.handle!, current);
      elements[gesture.index] = next;
      redrawAnnotations();
      redrawInteraction();
    } else if (gesture.kind === "annotate" && gesture.annotation.type === "pen") {
      gesture.annotation.points.push(current);
      redrawAnnotations(gesture.annotation);
    } else if (
      gesture.kind === "annotate" &&
      gesture.annotation.type !== "pen" &&
      gesture.annotation.type !== "text"
    ) {
      gesture.annotation.end = current;
      redrawAnnotations(gesture.annotation);
    }
  });

  interactionCanvas.addEventListener("pointerup", () => {
    if (gesture?.kind === "annotate") push(gesture.annotation);
    if (gesture?.kind === "text-move" || gesture?.kind === "text-resize") commit(elements);
    gesture = undefined;
    redrawInteraction();
  });

  doc.querySelectorAll<HTMLElement>("[data-tool]").forEach(element => {
    element.addEventListener("click", () => {
      const value = element.dataset.tool;
      if (value === "pen" || value === "rectangle" || value === "arrow" || value === "text") {
        const wasActive = annotationMode && state.tool === value;
        state.tool = value;
        annotationMode = !wasActive;
        updatePressed();
      }
    });
  });
  doc.querySelectorAll<HTMLElement>("[data-color]").forEach(element => {
    element.addEventListener("click", () => {
      if (element.dataset.color) state.color = element.dataset.color;
      annotationMode = true;
      updatePressed();
    });
  });
  doc.querySelectorAll<HTMLElement>("[data-width]").forEach(element => {
    element.addEventListener("click", () => {
      const value = Number(element.dataset.width);
      if (value === 2 || value === 4 || value === 8) state.strokeWidth = value;
      annotationMode = true;
      updatePressed();
    });
  });
  doc.querySelectorAll<HTMLElement>("[data-font-size]").forEach(element => {
    element.addEventListener("click", () => {
      const value = Number(element.dataset.fontSize);
      if ([10, 12, 16, 24, 32, 48, 62].includes(value)) state.fontSize = value;
      annotationMode = true;
      updatePressed();
    });
  });
  doc.getElementById("undo")?.addEventListener("click", undo);
  doc.getElementById("redo")?.addEventListener("click", redo);
  doc.getElementById("save")?.addEventListener("click", save);
  noteSearch.addEventListener("input", () => populateNotes(noteSearch.value));
  targetSelect.addEventListener("change", () => {
    if (notes.some(note => note.path === targetSelect.value)) {
      state.targetNotePath = targetSelect.value;
    }
  });
  toolbar.addEventListener("pointerdown", event => event.stopPropagation());

  doc.addEventListener("keydown", event => {
    if (textEditor) {
      if (event.key === "Escape") {
        event.preventDefault();
        finishTextEditor(false);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finishTextEditor(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      emit({ status: "cancelled" });
    } else if (event.key === "Enter" && event.target !== noteSearch) {
      event.preventDefault();
      save();
    } else if (event.ctrlKey && event.key.toLocaleLowerCase() === "z") {
      event.preventDefault();
      undo();
    } else if (event.ctrlKey && event.key.toLocaleLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (targetSelect.options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(
        targetSelect.options.length - 1,
        Math.max(0, targetSelect.selectedIndex + delta)
      );
      targetSelect.selectedIndex = next;
      const selected = targetSelect.options.item(next);
      if (selected && notes.some(note => note.path === selected.value)) {
        state.targetNotePath = selected.value;
      }
    }
  });

  populateNotes("");
  updatePressed();
  redrawAnnotations();
  redrawInteraction();
}

const OVERLAY_CSS = `
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; user-select: none; }
  body { background: transparent; }
  canvas { position: fixed; inset: 0; display: block; }
  #screen-layer { z-index: 1; }
  #annotation-layer { z-index: 2; pointer-events: none; }
  #interaction { z-index: 3; cursor: crosshair; }
  #text-editor { z-index: 5; font-family: system-ui, sans-serif; line-height: 1.2; }
  #toolbar { position: fixed; z-index: 4; min-height: 96px; padding: 8px; border: 1px solid #5f6368;
    border-radius: 10px; background: rgba(28, 30, 34, .96); color: #fff; box-shadow: 0 8px 24px #0008;
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  #toolbar[hidden] { display: none; }
  #toolbar .toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
    min-height: 32px; margin-left: 2px; padding-left: 8px; border-left: 1px solid #5f6368; }
  #toolbar .toolbar-group-label { color: #c7ccd3; font-size: 11px; font-weight: 650; white-space: nowrap; }
  button, input, select { height: 32px; border: 1px solid #70757a; border-radius: 6px;
    background: #30343a; color: #fff; }
  button { min-width: 32px; padding: 0 9px; cursor: pointer; }
  button[data-active="true"] { outline: 2px solid #4da3ff; background: #174b78; }
  button[data-color] { width: 26px; min-width: 26px; color: transparent; background: var(--swatch); }
  #note-search { width: 128px; padding: 0 8px; }
  #target-note { min-width: 210px; max-width: 330px; padding: 0 6px; }
  #toolbar .toolbar-actions { flex-basis: 100%; display: flex; align-items: center; justify-content: flex-start;
    min-width: 0; margin-top: 2px; padding-top: 8px; border-top: 1px solid #5f6368; }
  #save { min-width: 136px; height: 38px; padding: 0 16px; background: #2d9c68; border-color: #56d993;
    font-size: 14px; font-weight: 700; box-shadow: 0 2px 8px #0006;
    transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
  #save:hover { background: #38b878; border-color: #78e6a9; box-shadow: 0 4px 12px #0008; }
  #save:active { transform: translateY(1px); box-shadow: 0 1px 4px #0006; }
  #save:focus-visible { outline: 2px solid #a7f3c5; outline-offset: 2px; }
  #toolbar .toolbar-field, #toolbar .toolbar-description { flex-basis: 100%; display: flex; align-items: center; gap: 8px;
    min-width: 0; margin-top: 2px; padding-top: 6px; border-top: 1px solid #5f6368; }
  #toolbar .toolbar-field label, #toolbar .toolbar-description label { color: #c7ccd3; font-size: 12px; white-space: nowrap; }
  #filename-input, #description-input { flex: 1 1 auto; min-width: 0; padding: 0 8px; }
`;

export function createOverlayDocument(input: OverlayInput, channel: string): string {
  const config = serializeJson({ ...input, channel });
  const runtime = `(${overlayRuntime.toString()})(JSON.parse(document.getElementById("overlay-config").textContent));`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Screenshot Inbox</title>
  <style>${OVERLAY_CSS}</style>
</head>
<body>
  <canvas id="screen-layer" aria-hidden="true"></canvas>
  <canvas id="annotation-layer" aria-hidden="true"></canvas>
  <canvas id="interaction" aria-label="截图选择区域"></canvas>
  <div id="toolbar" hidden role="toolbar" aria-label="截图工具栏">
    <button type="button" data-tool="pen" title="画笔：自由绘制" aria-label="画笔：自由绘制">笔</button>
    <button type="button" data-tool="rectangle" title="矩形：绘制矩形框" aria-label="矩形：绘制矩形框">框</button>
    <button type="button" data-tool="arrow" title="箭头：绘制箭头" aria-label="箭头：绘制箭头">箭</button>
    <button type="button" data-tool="text" title="文字：添加和编辑文字" aria-label="文字：添加和编辑文字">字</button>
    <button type="button" data-color="red" title="红色：设置标注和文字颜色" style="--swatch:#ef4444" aria-label="红色：设置标注和文字颜色">红</button>
    <button type="button" data-color="yellow" title="黄色：设置标注和文字颜色" style="--swatch:#facc15" aria-label="黄色：设置标注和文字颜色">黄</button>
    <button type="button" data-color="blue" title="蓝色：设置标注和文字颜色" style="--swatch:#3b82f6" aria-label="蓝色：设置标注和文字颜色">蓝</button>
    <button type="button" data-color="green" title="绿色：设置标注和文字颜色" style="--swatch:#22c55e" aria-label="绿色：设置标注和文字颜色">绿</button>
    <button type="button" data-color="black" title="黑色：设置标注和文字颜色" style="--swatch:#111827" aria-label="黑色：设置标注和文字颜色">黑</button>
    <button type="button" data-color="white" title="白色：设置标注和文字颜色" style="--swatch:#f8fafc" aria-label="白色：设置标注和文字颜色">白</button>
    <div class="toolbar-group" data-toolbar-group="stroke-width" role="group" aria-label="线条粗细">
      <span class="toolbar-group-label">线条粗细</span>
      <button type="button" data-width="2" title="线条粗细 2px" aria-label="线条粗细 2px">2</button>
      <button type="button" data-width="4" title="线条粗细 4px" aria-label="线条粗细 4px">4</button>
      <button type="button" data-width="8" title="线条粗细 8px" aria-label="线条粗细 8px">8</button>
    </div>
    <div class="toolbar-group" data-toolbar-group="font-size" role="group" aria-label="文字字号">
      <span class="toolbar-group-label">文字字号</span>
      <button type="button" data-font-size="10" title="文字字号 10px" aria-label="文字字号 10px">10</button>
      <button type="button" data-font-size="12" title="文字字号 12px" aria-label="文字字号 12px">12</button>
      <button type="button" data-font-size="16" title="文字字号 16px" aria-label="文字字号 16px">16</button>
      <button type="button" data-font-size="24" title="文字字号 24px" aria-label="文字字号 24px">24</button>
      <button type="button" data-font-size="32" title="文字字号 32px" aria-label="文字字号 32px">32</button>
      <button type="button" data-font-size="48" title="文字字号 48px" aria-label="文字字号 48px">48</button>
      <button type="button" data-font-size="62" title="文字字号 62px" aria-label="文字字号 62px">62</button>
    </div>
    <button type="button" id="undo" title="撤销上一步标注或文字操作" aria-label="撤销上一步标注或文字操作">↶</button>
    <button type="button" id="redo" title="重做上一步撤销的操作" aria-label="重做上一步撤销的操作">↷</button>
    <input id="note-search" type="search" title="搜索目标笔记" placeholder="搜索笔记" autocomplete="off">
    <select id="target-note" title="选择截图保存到的目标笔记" aria-label="目标笔记"></select>
    <div class="toolbar-field">
      <label for="filename-input">文件名（可选）</label>
      <input id="filename-input" type="text" title="填写截图文件名" aria-label="截图文件名" placeholder="例如：接口设计草图" autocomplete="off">
    </div>
    ${input.settings.showDescriptionInput ? `
    <div class="toolbar-description">
      <label for="description-input">说明（可选）</label>
      <input id="description-input" type="text" title="填写图片说明" aria-label="图片说明" placeholder="填写截图说明" autocomplete="off">
    </div>` : ""}
    <div class="toolbar-actions">
      <button type="button" id="save" title="保存截图到目标笔记" aria-label="保存截图到目标笔记">保存截图</button>
    </div>
  </div>
  <script type="application/json" id="overlay-config">${config}</script>
  <script>${runtime}</script>
</body>
</html>`;
}

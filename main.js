var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ScreenshotInboxPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/controller/plugin-controller.ts
function noteOption(file, defaultPath) {
  return {
    path: file.path,
    label: file.basename,
    isDefault: file.path === defaultPath
  };
}
var PluginController = class {
  constructor(options) {
    this.options = options;
    this.state = "idle";
    this.disposed = false;
    this.shortcutHandler = () => {
      void this.startCapture();
    };
  }
  get currentState() {
    return this.state;
  }
  get currentAccelerator() {
    return this.registeredAccelerator;
  }
  get lastShortcutError() {
    return this.shortcutError;
  }
  registerConfiguredShortcut() {
    const result = this.options.platform.registerGlobalShortcut(
      this.options.settings.get().accelerator,
      this.shortcutHandler
    );
    if (result.ok) {
      this.registeredAccelerator = result.accelerator;
      this.shortcutError = void 0;
    } else {
      this.shortcutError = result.message;
      this.options.notices.shortcutError(result.message);
    }
    return result;
  }
  async changeAccelerator(accelerator) {
    const previous = this.options.settings.get().accelerator;
    const result = this.options.platform.registerGlobalShortcut(
      accelerator,
      this.shortcutHandler
    );
    if (!result.ok) {
      this.shortcutError = result.message;
      this.options.notices.shortcutError(result.message);
      return result;
    }
    try {
      await this.options.settings.update({ accelerator: result.accelerator });
      this.registeredAccelerator = result.accelerator;
      this.shortcutError = void 0;
      return result;
    } catch (error) {
      const rollback = this.options.platform.registerGlobalShortcut(
        previous,
        this.shortcutHandler
      );
      const message = rollback.ok ? "\u5FEB\u6377\u952E\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF0C\u5DF2\u6062\u590D\u539F\u5FEB\u6377\u952E" : "\u5FEB\u6377\u952E\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF0C\u4E14\u65E0\u6CD5\u6062\u590D\u539F\u5FEB\u6377\u952E";
      this.options.notices.shortcutError(message);
      this.shortcutError = message;
      throw error;
    }
  }
  async startCapture() {
    if (this.disposed || this.state !== "idle") return;
    this.setState("capturing");
    let session;
    try {
      const capture = await this.options.platform.capturePrimaryDisplay();
      if (this.disposed) return;
      const input = await this.buildOverlayInput(capture);
      this.setState("editing");
      session = await this.options.platform.openOverlay(input);
      this.activeSession = session;
      const result = await session.result;
      session.close();
      this.activeSession = void 0;
      session = void 0;
      if (result.status === "cancelled" || result.png.byteLength === 0) return;
      this.setState("saving");
      const saved = await this.options.writer.save({
        png: result.png,
        targetNotePath: result.targetNotePath,
        filename: result.filename,
        description: result.description,
        capturedAt: this.options.now?.() ?? /* @__PURE__ */ new Date()
      });
      await this.finishSave(saved, result);
    } catch (error) {
      if (!this.disposed) this.options.notices.captureError(error);
    } finally {
      session?.close();
      if (this.activeSession === session) this.activeSession = void 0;
      this.setState("idle");
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.activeSession?.close();
    this.activeSession = void 0;
    await this.options.platform.dispose();
    this.setState("idle");
  }
  async offerPendingInserts() {
    if (this.disposed) return;
    const records = await this.options.writer.listPendingInserts();
    if (this.disposed) return;
    for (const record of records) {
      if (!record.completed) this.offerPendingInsert(record.id, record.targetNotePath);
    }
  }
  async buildOverlayInput(capture) {
    const defaultNote = await this.options.targets.ensureDefaultNote();
    const recent = this.options.targets.getRecentNotes(5);
    const all = this.options.targets.getAllNotes();
    const files = [];
    const seen = /* @__PURE__ */ new Set();
    for (const file of [defaultNote, ...recent, ...all]) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }
    const settings = this.options.settings.get();
    return {
      capture,
      notes: files.map((file) => noteOption(file, defaultNote.path)),
      settings: {
        lastTool: settings.lastTool,
        lastColor: settings.lastColor,
        lastStrokeWidth: settings.lastStrokeWidth,
        lastFontSize: settings.lastFontSize,
        showDescriptionInput: settings.showDescriptionInput
      }
    };
  }
  async finishSave(saved, overlay) {
    try {
      await this.options.settings.update({
        lastTool: overlay.lastTool,
        lastColor: overlay.lastColor,
        lastStrokeWidth: overlay.lastStrokeWidth,
        lastFontSize: overlay.lastFontSize
      });
    } catch (error) {
      this.options.notices.nonFatalError("\u622A\u56FE\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u6807\u6CE8\u504F\u597D\u672A\u80FD\u8BB0\u4F4F", error);
    }
    if (saved.status === "pending-insert") {
      this.offerPendingInsert(saved.pendingId, saved.targetNotePath);
      await this.restoreOrOpenSafely(saved.targetNotePath);
      return;
    }
    await this.afterCompleteSave(saved.targetNotePath);
  }
  offerPendingInsert(pendingId, targetNotePath) {
    this.options.notices.pendingInsert(targetNotePath, async () => {
      if (this.disposed) return;
      try {
        const retried = await this.options.writer.retryPendingInsert(pendingId);
        if (!this.disposed && retried.status === "saved") {
          await this.afterCompleteSave(retried.targetNotePath);
        }
      } catch (error) {
        this.options.notices.captureError(error);
      }
    });
  }
  async afterCompleteSave(targetNotePath) {
    this.options.notices.saved(
      targetNotePath,
      async () => {
        try {
          await this.options.platform.activateHostWindow();
          await this.options.openNote(targetNotePath);
        } catch (error) {
          this.options.notices.nonFatalError("\u622A\u56FE\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u76EE\u6807\u7B14\u8BB0\u672A\u80FD\u6253\u5F00", error);
        }
      }
    );
    await this.restoreOrOpenSafely(targetNotePath);
  }
  async restoreOrOpenSafely(targetNotePath) {
    try {
      await this.restoreOrOpen(targetNotePath);
    } catch (error) {
      this.options.notices.nonFatalError("\u622A\u56FE\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u4FDD\u5B58\u540E\u7A97\u53E3\u5207\u6362\u5931\u8D25", error);
    }
  }
  async restoreOrOpen(targetNotePath) {
    if (this.options.settings.get().afterSaveAction === "open-note") {
      await this.options.platform.activateHostWindow();
      await this.options.openNote(targetNotePath);
    } else {
      await this.options.platform.restorePreviousFocus();
    }
  }
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
};

// src/notes/note-target-service.ts
var import_obsidian = require("obsidian");
function isMarkdownFile(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return typeof candidate.path === "string" && typeof candidate.basename === "string" && typeof candidate.extension === "string" && candidate.extension.toLowerCase() === "md";
}
function isFolder(value) {
  return typeof value === "object" && value !== null && Array.isArray(value.children);
}
function hasExistingParentFolders(vault, path) {
  const parts = path.split("/");
  let parent = "";
  for (const part of parts.slice(0, -1)) {
    parent = parent.length > 0 ? `${parent}/${part}` : part;
    if (!isFolder(vault.getAbstractFileByPath(parent))) return false;
  }
  return true;
}
function basename(path) {
  return path.split("/").at(-1) ?? path;
}
var NoteTargetServiceImpl = class {
  constructor(vault, getSettings, persistRecentPaths) {
    this.vault = vault;
    this.getSettings = getSettings;
    this.persistRecentPaths = persistRecentPaths;
    this.index = [];
    this.eventRefs = [];
    this.recentPaths = this.sanitizeRecent(this.getSettings().recentNotePaths);
    this.refreshIndex();
    this.eventRefs.push(
      this.vault.on("create", (created) => {
        if (isMarkdownFile(created)) this.refreshIndex();
      }),
      this.vault.on("rename", (renamed, oldPath) => {
        this.handleRename(renamed, oldPath);
      }),
      this.vault.on("delete", (deleted) => {
        this.handleDelete(deleted);
      })
    );
  }
  async ensureDefaultNote() {
    const configuredPath = (0, import_obsidian.normalizePath)(this.getSettings().defaultNotePath);
    if (!configuredPath.toLowerCase().endsWith(".md")) {
      throw new Error("Screenshot Inbox default note must be a Markdown path");
    }
    const path = hasExistingParentFolders(this.vault, configuredPath) ? configuredPath : basename(configuredPath);
    const existing = this.vault.getAbstractFileByPath(path);
    if (isMarkdownFile(existing)) return existing;
    if (existing) {
      throw new Error(`Default note path is not a Markdown file: ${path}`);
    }
    return this.vault.create(path, "");
  }
  async recordOpenedNote(file) {
    if (!isMarkdownFile(file)) return;
    const path = (0, import_obsidian.normalizePath)(file.path);
    this.recentPaths = [
      path,
      ...this.recentPaths.filter((existing) => existing !== path)
    ].slice(0, 5);
    await this.persistRecentPaths([...this.recentPaths]);
  }
  getRecentNotes(limit = 5) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const path of this.recentPaths) {
      const normalized = (0, import_obsidian.normalizePath)(path);
      if (seen.has(normalized)) continue;
      const value = this.vault.getAbstractFileByPath(normalized);
      if (isMarkdownFile(value)) {
        seen.add(normalized);
        result.push(value);
      }
      if (result.length >= Math.max(0, limit)) break;
    }
    return result;
  }
  getAllNotes(limit = Number.MAX_SAFE_INTEGER) {
    return this.index.slice(0, Math.max(0, limit)).map((note) => note.file);
  }
  searchNotes(query, limit = 20) {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0 || limit <= 0) return [];
    const recency = new Map(
      this.recentPaths.map((path, index) => [(0, import_obsidian.normalizePath)(path), index])
    );
    return this.index.map((note) => {
      const titleIndex = note.basename.indexOf(needle);
      const pathIndex = note.path.indexOf(needle);
      const rank = titleIndex === 0 ? 0 : titleIndex > 0 ? 1 : pathIndex >= 0 ? 2 : 3;
      return { note, rank, recent: recency.get(note.file.path) ?? Number.MAX_SAFE_INTEGER };
    }).filter((item) => item.rank < 3).sort(
      (left, right) => left.rank - right.rank || left.recent - right.recent || left.note.basename.localeCompare(right.note.basename) || left.note.path.localeCompare(right.note.path)
    ).slice(0, limit).map((item) => item.note.file);
  }
  async resolveTarget(path) {
    if (path) {
      const selected = this.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(path));
      if (isMarkdownFile(selected)) return selected;
    }
    return this.ensureDefaultNote();
  }
  dispose() {
    for (const ref of this.eventRefs) this.vault.offref(ref);
    this.eventRefs.length = 0;
  }
  refreshIndex() {
    this.index = this.vault.getMarkdownFiles().map((file) => ({
      file,
      basename: file.basename.toLocaleLowerCase(),
      path: (0, import_obsidian.normalizePath)(file.path).toLocaleLowerCase()
    }));
  }
  handleRename(renamed, oldPath) {
    const oldNormalized = (0, import_obsidian.normalizePath)(oldPath);
    if (isMarkdownFile(renamed)) {
      const next = (0, import_obsidian.normalizePath)(renamed.path);
      const replaced = this.recentPaths.map(
        (path) => path === oldNormalized ? next : path
      );
      const sanitized = this.sanitizeRecent(replaced);
      if (sanitized.join("\0") !== this.recentPaths.join("\0")) {
        this.recentPaths = sanitized;
        void this.persistRecentPaths([...this.recentPaths]).catch(() => void 0);
      }
    }
    this.refreshIndex();
  }
  handleDelete(deleted) {
    const deletedPath = (0, import_obsidian.normalizePath)(deleted.path);
    const next = this.recentPaths.filter((path) => path !== deletedPath);
    if (next.length !== this.recentPaths.length) {
      this.recentPaths = next;
      void this.persistRecentPaths([...this.recentPaths]).catch(() => void 0);
    }
    this.refreshIndex();
  }
  sanitizeRecent(paths) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const path of paths) {
      const normalized = (0, import_obsidian.normalizePath)(path);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
      if (result.length === 5) break;
    }
    return result;
  }
};

// src/overlay/overlay-document.ts
function serializeJson(value) {
  return JSON.stringify(value).replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function overlayRuntime(config) {
  const doc = document;
  const screenCanvas = doc.getElementById("screen-layer");
  const annotationCanvas = doc.getElementById("annotation-layer");
  const interactionCanvas = doc.getElementById("interaction");
  const toolbar = doc.getElementById("toolbar");
  const saveButton = doc.getElementById("save");
  const targetSelect = doc.getElementById("target-note");
  const noteSearch = doc.getElementById("note-search");
  const filenameInput = doc.getElementById("filename-input");
  const descriptionInput = doc.getElementById("description-input");
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
    (note, index, all) => all.findIndex((candidate) => candidate.path === note.path) === index
  );
  const defaultNote = notes.find((note) => note.isDefault) ?? notes[0];
  const initialNotes = [
    ...defaultNote ? [defaultNote] : [],
    ...notes.filter((note) => note.path !== defaultNote?.path).slice(0, 5)
  ];
  const recentRank = new Map(initialNotes.map((note, index) => [note.path, index]));
  const searchableNotes = notes.map((note) => ({
    note,
    label: note.label.toLocaleLowerCase(),
    path: note.path.toLocaleLowerCase()
  }));
  const state = {
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
  let history = [];
  let historyCursor = 0;
  let elements = [];
  let gesture;
  let annotationMode = false;
  let sent = false;
  let imageReady = false;
  let saveRequested = false;
  let textEditor;
  let textEditorIndex;
  let nextTextId = 1;
  const image = new Image();
  function setupCanvas(canvas) {
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
  function point(event) {
    const bounds = interactionCanvas.getBoundingClientRect();
    return {
      x: Math.min(viewport.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(viewport.height, Math.max(0, event.clientY - bounds.top))
    };
  }
  function normalized(start, end) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    return { x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }
  function contains(rect, value) {
    return value.x >= rect.x && value.x <= rect.x + rect.width && value.y >= rect.y && value.y <= rect.y + rect.height;
  }
  function resizeHandleAt(rect, value) {
    if (rect.width <= 0 || rect.height <= 0) return void 0;
    const tolerance = 10;
    const left = rect.x;
    const centerX = rect.x + rect.width / 2;
    const right = rect.x + rect.width;
    const top = rect.y;
    const centerY = rect.y + rect.height / 2;
    const bottom = rect.y + rect.height;
    const handles = [
      ["nw", left, top],
      ["ne", right, top],
      ["se", right, bottom],
      ["sw", left, bottom],
      ["n", centerX, top],
      ["e", right, centerY],
      ["s", centerX, bottom],
      ["w", left, centerY]
    ];
    return handles.find(
      ([, x, y]) => Math.abs(value.x - x) <= tolerance && Math.abs(value.y - y) <= tolerance
    )?.[0];
  }
  function clampRect(rect) {
    const width = Math.min(rect.width, viewport.width);
    const height = Math.min(rect.height, viewport.height);
    return {
      x: Math.min(Math.max(0, rect.x), viewport.width - width),
      y: Math.min(Math.max(0, rect.y), viewport.height - height),
      width,
      height
    };
  }
  function placeToolbar() {
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
    const preferredY = below + toolbarSize.height <= viewport.height ? below : state.selection.y - toolbarSize.height - gap;
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
  function drawArrow(context, start, end) {
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
  function drawAnnotation(context, annotation, offset = { x: 0, y: 0 }, coordinateScale = 1) {
    context.save();
    const convert = (value) => ({
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
  function textBounds(annotation, context = annotationContext) {
    context?.save();
    if (context) {
      context.font = `${annotation.fontSize}px system-ui, sans-serif`;
      context.textBaseline = "top";
    }
    const lines = annotation.text.split("\n");
    const width = Math.max(
      annotation.fontSize,
      ...lines.map((line) => context?.measureText?.(line)?.width ?? line.length * annotation.fontSize * 0.6)
    );
    context?.restore();
    return {
      x: annotation.position.x,
      y: annotation.position.y,
      width,
      height: Math.max(annotation.fontSize, lines.length * annotation.fontSize * 1.2)
    };
  }
  function textAt(value) {
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const annotation = elements[index];
      if (annotation.type === "text" && contains(textBounds(annotation), value)) return index;
    }
    return void 0;
  }
  function textResizeHandleAt(rect, value) {
    const tolerance = 10;
    const handles = [
      ["nw", rect.x, rect.y],
      ["ne", rect.x + rect.width, rect.y],
      ["se", rect.x + rect.width, rect.y + rect.height],
      ["sw", rect.x, rect.y + rect.height]
    ];
    return handles.find(
      ([, x, y]) => Math.abs(value.x - x) <= tolerance && Math.abs(value.y - y) <= tolerance
    )?.[0];
  }
  function cloneAnnotations(values) {
    return values.map(
      (annotation) => annotation.type === "pen" ? { ...annotation, points: annotation.points.map((pointValue) => ({ ...pointValue })) } : annotation.type === "text" ? { ...annotation, position: { ...annotation.position } } : { ...annotation, start: { ...annotation.start }, end: { ...annotation.end } }
    );
  }
  function setSelectedText(annotation) {
    state.selectedTextBounds = annotation ? textBounds(annotation) : void 0;
  }
  function redrawAnnotations(preview) {
    annotationContext?.clearRect(0, 0, viewport.width, viewport.height);
    if (!annotationContext) return;
    for (const annotation of elements) {
      drawAnnotation(annotationContext, annotation);
    }
    if (preview) drawAnnotation(annotationContext, preview);
    state.annotations = elements;
    const selected = elements.find(
      (annotation) => annotation.type === "text" && annotation.id === state.selectedTextId
    );
    setSelectedText(selected?.type === "text" ? selected : void 0);
  }
  function redrawInteraction() {
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
        [left, top],
        [centerX, top],
        [right, top],
        [right, centerY],
        [right, bottom],
        [centerX, bottom],
        [left, bottom],
        [left, centerY]
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
  function push(annotation) {
    commit([...elements, annotation]);
  }
  function commit(next) {
    elements = cloneAnnotations(next);
    history = [...history.slice(0, historyCursor), cloneAnnotations(elements)];
    historyCursor = history.length;
    redrawAnnotations();
  }
  function undo() {
    if (historyCursor > 0) historyCursor -= 1;
    elements = cloneAnnotations(history[historyCursor - 1] ?? []);
    redrawAnnotations();
  }
  function redo() {
    if (historyCursor < history.length) historyCursor += 1;
    elements = cloneAnnotations(history[historyCursor - 1] ?? []);
    redrawAnnotations();
  }
  function clampTextPosition(annotation) {
    const bounds = textBounds(annotation);
    const selection = state.selection;
    const minX = selection.width > 0 ? selection.x : 0;
    const minY = selection.height > 0 ? selection.y : 0;
    const maxX = selection.width > 0 ? Math.max(minX, selection.x + selection.width - bounds.width) : Math.max(0, viewport.width - bounds.width);
    const maxY = selection.height > 0 ? Math.max(minY, selection.y + selection.height - bounds.height) : Math.max(0, viewport.height - bounds.height);
    return {
      ...annotation,
      position: {
        x: Math.min(maxX, Math.max(minX, annotation.position.x)),
        y: Math.min(maxY, Math.max(minY, annotation.position.y))
      }
    };
  }
  function resizeText(original, handle, current) {
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
  function finishTextEditor(saveValue) {
    const editor = textEditor;
    if (!editor) return;
    const index = textEditorIndex;
    textEditor = void 0;
    textEditorIndex = void 0;
    editor.remove();
    const text = editor.value;
    if (!saveValue || text.trim().length === 0) {
      redrawInteraction();
      return;
    }
    const existing = index === void 0 ? void 0 : elements[index];
    const annotation = {
      type: "text",
      id: existing?.type === "text" ? existing.id : `text-${nextTextId++}`,
      text,
      color: existing?.type === "text" ? existing.color : state.color,
      fontSize: existing?.type === "text" ? existing.fontSize : state.fontSize,
      position: existing?.type === "text" ? existing.position : { ...editorPosition }
    };
    const clamped = clampTextPosition(annotation);
    if (index === void 0) {
      state.selectedTextId = clamped.id;
      commit([...elements, clamped]);
    } else {
      const next = [...elements];
      next[index] = clamped;
      state.selectedTextId = clamped.id;
      commit(next);
    }
  }
  let editorPosition = { x: 0, y: 0 };
  function openTextEditor(position, index) {
    if (textEditor) finishTextEditor(true);
    const existing = index === void 0 ? void 0 : elements[index];
    const editor = doc.createElement("textarea");
    editor.id = "text-editor";
    editor.value = existing?.type === "text" ? existing.text : "";
    editor.rows = 1;
    editor.placeholder = "\u8F93\u5165\u6587\u5B57";
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
    editor.addEventListener("keydown", (event) => {
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
  function updatePressed() {
    doc.querySelectorAll("[data-tool]").forEach((element) => {
      element.dataset.active = String(
        annotationMode && element.dataset.tool === state.tool
      );
    });
    doc.querySelectorAll("[data-color]").forEach((element) => {
      element.dataset.active = String(element.dataset.color === state.color);
    });
    doc.querySelectorAll("[data-width]").forEach((element) => {
      element.dataset.active = String(Number(element.dataset.width) === state.strokeWidth);
    });
    doc.querySelectorAll("[data-font-size]").forEach((element) => {
      element.dataset.active = String(Number(element.dataset.fontSize) === state.fontSize);
    });
  }
  function populateNotes(query) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const options = normalizedQuery.length === 0 ? initialNotes : searchableNotes.map((item) => {
      const labelIndex = item.label.indexOf(normalizedQuery);
      const pathIndex = item.path.indexOf(normalizedQuery);
      const rank = labelIndex === 0 ? 0 : labelIndex > 0 ? 1 : pathIndex >= 0 ? 2 : 3;
      return { ...item, rank, recent: recentRank.get(item.note.path) ?? Number.MAX_SAFE_INTEGER };
    }).filter((item) => item.rank < 3).sort(
      (left, right) => left.rank - right.rank || left.recent - right.recent || left.label.localeCompare(right.label) || left.path.localeCompare(right.path)
    ).slice(0, 50).map((item) => item.note);
    targetSelect.replaceChildren();
    for (const note of options) {
      const option = doc.createElement("option");
      option.value = note.path;
      option.textContent = `${note.label} \u2014 ${note.path}`;
      option.selected = note.path === state.targetNotePath;
      targetSelect.append(option);
    }
  }
  function emit(result) {
    if (sent) return;
    sent = true;
    const envelope = { channel: config.channel, result };
    window.dispatchEvent(new CustomEvent("screenshot-inbox-result", { detail: envelope }));
    const electronRequire = window.require;
    const electron = electronRequire?.("electron");
    electron?.ipcRenderer?.send(config.channel, envelope);
  }
  function dataUrlBytes(dataUrl) {
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  function save() {
    const selection = state.selection;
    if (sent || selection.width <= 0 || selection.height <= 0 || state.targetNotePath.length === 0) return;
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
  interactionCanvas.addEventListener("pointerdown", (event) => {
    if (sent) return;
    const current = point(event);
    const selection = state.selection;
    const resizeHandle = resizeHandleAt(selection, current);
    if (resizeHandle) {
      gesture = { kind: "resize", handle: resizeHandle, original: { ...selection } };
    } else if (annotationMode && state.tool === "text" && contains(selection, current)) {
      const textIndex = textAt(current);
      if (textIndex !== void 0) {
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
        gesture = textHandle ? {
          kind: "text-resize",
          index: textIndex,
          original: { ...selected, position: { ...selected.position } },
          handle: textHandle,
          start: current
        } : {
          kind: "text-move",
          index: textIndex,
          original: { ...selected, position: { ...selected.position } },
          start: current
        };
        redrawInteraction();
      } else {
        state.selectedTextId = void 0;
        event.preventDefault();
        openTextEditor(current);
      }
    } else if (annotationMode && contains(selection, current)) {
      const tool = state.tool === "pen" || state.tool === "rectangle" || state.tool === "arrow" ? state.tool : "arrow";
      gesture = tool === "pen" ? {
        kind: "annotate",
        annotation: {
          type: "pen",
          color: state.color,
          strokeWidth: state.strokeWidth,
          points: [current]
        }
      } : {
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
  interactionCanvas.addEventListener("pointermove", (event) => {
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
      const next = resizeText(gesture.original, gesture.handle, current);
      elements[gesture.index] = next;
      redrawAnnotations();
      redrawInteraction();
    } else if (gesture.kind === "annotate" && gesture.annotation.type === "pen") {
      gesture.annotation.points.push(current);
      redrawAnnotations(gesture.annotation);
    } else if (gesture.kind === "annotate" && gesture.annotation.type !== "pen" && gesture.annotation.type !== "text") {
      gesture.annotation.end = current;
      redrawAnnotations(gesture.annotation);
    }
  });
  interactionCanvas.addEventListener("pointerup", () => {
    if (gesture?.kind === "annotate") push(gesture.annotation);
    if (gesture?.kind === "text-move" || gesture?.kind === "text-resize") commit(elements);
    gesture = void 0;
    redrawInteraction();
  });
  doc.querySelectorAll("[data-tool]").forEach((element) => {
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
  doc.querySelectorAll("[data-color]").forEach((element) => {
    element.addEventListener("click", () => {
      if (element.dataset.color) state.color = element.dataset.color;
      annotationMode = true;
      updatePressed();
    });
  });
  doc.querySelectorAll("[data-width]").forEach((element) => {
    element.addEventListener("click", () => {
      const value = Number(element.dataset.width);
      if (value === 2 || value === 4 || value === 8) state.strokeWidth = value;
      annotationMode = true;
      updatePressed();
    });
  });
  doc.querySelectorAll("[data-font-size]").forEach((element) => {
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
    if (notes.some((note) => note.path === targetSelect.value)) {
      state.targetNotePath = targetSelect.value;
    }
  });
  toolbar.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
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
      if (selected && notes.some((note) => note.path === selected.value)) {
        state.targetNotePath = selected.value;
      }
    }
  });
  populateNotes("");
  updatePressed();
  redrawAnnotations();
  redrawInteraction();
}
var OVERLAY_CSS = `
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
function createOverlayDocument(input, channel) {
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
  <canvas id="interaction" aria-label="\u622A\u56FE\u9009\u62E9\u533A\u57DF"></canvas>
  <div id="toolbar" hidden role="toolbar" aria-label="\u622A\u56FE\u5DE5\u5177\u680F">
    <button type="button" data-tool="pen" title="\u753B\u7B14\uFF1A\u81EA\u7531\u7ED8\u5236" aria-label="\u753B\u7B14\uFF1A\u81EA\u7531\u7ED8\u5236">\u7B14</button>
    <button type="button" data-tool="rectangle" title="\u77E9\u5F62\uFF1A\u7ED8\u5236\u77E9\u5F62\u6846" aria-label="\u77E9\u5F62\uFF1A\u7ED8\u5236\u77E9\u5F62\u6846">\u6846</button>
    <button type="button" data-tool="arrow" title="\u7BAD\u5934\uFF1A\u7ED8\u5236\u7BAD\u5934" aria-label="\u7BAD\u5934\uFF1A\u7ED8\u5236\u7BAD\u5934">\u7BAD</button>
    <button type="button" data-tool="text" title="\u6587\u5B57\uFF1A\u6DFB\u52A0\u548C\u7F16\u8F91\u6587\u5B57" aria-label="\u6587\u5B57\uFF1A\u6DFB\u52A0\u548C\u7F16\u8F91\u6587\u5B57">\u5B57</button>
    <button type="button" data-color="red" title="\u7EA2\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272" style="--swatch:#ef4444" aria-label="\u7EA2\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272">\u7EA2</button>
    <button type="button" data-color="yellow" title="\u9EC4\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272" style="--swatch:#facc15" aria-label="\u9EC4\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272">\u9EC4</button>
    <button type="button" data-color="blue" title="\u84DD\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272" style="--swatch:#3b82f6" aria-label="\u84DD\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272">\u84DD</button>
    <button type="button" data-color="green" title="\u7EFF\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272" style="--swatch:#22c55e" aria-label="\u7EFF\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272">\u7EFF</button>
    <button type="button" data-color="black" title="\u9ED1\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272" style="--swatch:#111827" aria-label="\u9ED1\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272">\u9ED1</button>
    <button type="button" data-color="white" title="\u767D\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272" style="--swatch:#f8fafc" aria-label="\u767D\u8272\uFF1A\u8BBE\u7F6E\u6807\u6CE8\u548C\u6587\u5B57\u989C\u8272">\u767D</button>
    <div class="toolbar-group" data-toolbar-group="stroke-width" role="group" aria-label="\u7EBF\u6761\u7C97\u7EC6">
      <span class="toolbar-group-label">\u7EBF\u6761\u7C97\u7EC6</span>
      <button type="button" data-width="2" title="\u7EBF\u6761\u7C97\u7EC6 2px" aria-label="\u7EBF\u6761\u7C97\u7EC6 2px">2</button>
      <button type="button" data-width="4" title="\u7EBF\u6761\u7C97\u7EC6 4px" aria-label="\u7EBF\u6761\u7C97\u7EC6 4px">4</button>
      <button type="button" data-width="8" title="\u7EBF\u6761\u7C97\u7EC6 8px" aria-label="\u7EBF\u6761\u7C97\u7EC6 8px">8</button>
    </div>
    <div class="toolbar-group" data-toolbar-group="font-size" role="group" aria-label="\u6587\u5B57\u5B57\u53F7">
      <span class="toolbar-group-label">\u6587\u5B57\u5B57\u53F7</span>
      <button type="button" data-font-size="10" title="\u6587\u5B57\u5B57\u53F7 10px" aria-label="\u6587\u5B57\u5B57\u53F7 10px">10</button>
      <button type="button" data-font-size="12" title="\u6587\u5B57\u5B57\u53F7 12px" aria-label="\u6587\u5B57\u5B57\u53F7 12px">12</button>
      <button type="button" data-font-size="16" title="\u6587\u5B57\u5B57\u53F7 16px" aria-label="\u6587\u5B57\u5B57\u53F7 16px">16</button>
      <button type="button" data-font-size="24" title="\u6587\u5B57\u5B57\u53F7 24px" aria-label="\u6587\u5B57\u5B57\u53F7 24px">24</button>
      <button type="button" data-font-size="32" title="\u6587\u5B57\u5B57\u53F7 32px" aria-label="\u6587\u5B57\u5B57\u53F7 32px">32</button>
      <button type="button" data-font-size="48" title="\u6587\u5B57\u5B57\u53F7 48px" aria-label="\u6587\u5B57\u5B57\u53F7 48px">48</button>
      <button type="button" data-font-size="62" title="\u6587\u5B57\u5B57\u53F7 62px" aria-label="\u6587\u5B57\u5B57\u53F7 62px">62</button>
    </div>
    <button type="button" id="undo" title="\u64A4\u9500\u4E0A\u4E00\u6B65\u6807\u6CE8\u6216\u6587\u5B57\u64CD\u4F5C" aria-label="\u64A4\u9500\u4E0A\u4E00\u6B65\u6807\u6CE8\u6216\u6587\u5B57\u64CD\u4F5C">\u21B6</button>
    <button type="button" id="redo" title="\u91CD\u505A\u4E0A\u4E00\u6B65\u64A4\u9500\u7684\u64CD\u4F5C" aria-label="\u91CD\u505A\u4E0A\u4E00\u6B65\u64A4\u9500\u7684\u64CD\u4F5C">\u21B7</button>
    <input id="note-search" type="search" title="\u641C\u7D22\u76EE\u6807\u7B14\u8BB0" placeholder="\u641C\u7D22\u7B14\u8BB0" autocomplete="off">
    <select id="target-note" title="\u9009\u62E9\u622A\u56FE\u4FDD\u5B58\u5230\u7684\u76EE\u6807\u7B14\u8BB0" aria-label="\u76EE\u6807\u7B14\u8BB0"></select>
    <div class="toolbar-field">
      <label for="filename-input">\u6587\u4EF6\u540D\uFF08\u53EF\u9009\uFF09</label>
      <input id="filename-input" type="text" title="\u586B\u5199\u622A\u56FE\u6587\u4EF6\u540D" aria-label="\u622A\u56FE\u6587\u4EF6\u540D" placeholder="\u4F8B\u5982\uFF1A\u63A5\u53E3\u8BBE\u8BA1\u8349\u56FE" autocomplete="off">
    </div>
    ${input.settings.showDescriptionInput ? `
    <div class="toolbar-description">
      <label for="description-input">\u8BF4\u660E\uFF08\u53EF\u9009\uFF09</label>
      <input id="description-input" type="text" title="\u586B\u5199\u56FE\u7247\u8BF4\u660E" aria-label="\u56FE\u7247\u8BF4\u660E" placeholder="\u586B\u5199\u622A\u56FE\u8BF4\u660E" autocomplete="off">
    </div>` : ""}
    <div class="toolbar-actions">
      <button type="button" id="save" title="\u4FDD\u5B58\u622A\u56FE\u5230\u76EE\u6807\u7B14\u8BB0" aria-label="\u4FDD\u5B58\u622A\u56FE\u5230\u76EE\u6807\u7B14\u8BB0">\u4FDD\u5B58\u622A\u56FE</button>
    </div>
  </div>
  <script type="application/json" id="overlay-config">${config}<\/script>
  <script>${runtime}<\/script>
</body>
</html>`;
}

// src/platform/electron-capabilities.ts
function isModuleNotFound(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "MODULE_NOT_FOUND";
}
function safeRequire(requireFn, specifier) {
  try {
    return requireFn(specifier);
  } catch (error) {
    if (isModuleNotFound(error)) return void 0;
    throw error;
  }
}
function loadElectronCapabilities(requireFn) {
  const rendererModule = requireFn("electron");
  const remote = rendererModule.remote ?? safeRequire(requireFn, "@electron/remote");
  const main = remote?.require?.("electron") ?? rendererModule;
  const renderer = {
    ...rendererModule,
    desktopCapturer: rendererModule.desktopCapturer ?? main.desktopCapturer
  };
  const capabilities = { main, renderer };
  assertCaptureCapabilities(capabilities);
  return capabilities;
}
function assertCaptureCapabilities(value) {
  const valid = typeof value.main?.globalShortcut?.register === "function" && typeof value.main?.globalShortcut?.unregister === "function" && typeof value.main?.screen?.getPrimaryDisplay === "function" && typeof value.main?.BrowserWindow === "function" && typeof value.main?.ipcMain?.once === "function" && typeof value.main?.ipcMain?.removeListener === "function" && typeof value.renderer?.desktopCapturer?.getSources === "function";
  if (!valid) {
    throw new Error(
      "Screenshot Inbox requires Electron capture capabilities on the Windows desktop version of Obsidian"
    );
  }
}

// src/platform/windows-electron-adapter.ts
var TOOLS = /* @__PURE__ */ new Set(["pen", "rectangle", "arrow", "text"]);
var COLORS = /* @__PURE__ */ new Set(["red", "yellow", "blue", "green", "black", "white"]);
var WIDTHS = /* @__PURE__ */ new Set([2, 4, 8]);
var FONT_SIZES = /* @__PURE__ */ new Set([10, 12, 16, 24, 32, 48, 62]);
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
var WindowsElectronAdapter = class {
  constructor(capabilities, createDocument, overlayTimeoutMs = 10 * 60 * 1e3) {
    this.createDocument = createDocument;
    this.overlayTimeoutMs = overlayTimeoutMs;
    this.disposed = false;
    this.main = capabilities.main;
    this.renderer = capabilities.renderer;
  }
  registerGlobalShortcut(accelerator, handler) {
    if (this.disposed) {
      return { ok: false, accelerator, message: "Screenshot Inbox is disposed" };
    }
    if (accelerator === this.registeredAccelerator) {
      return { ok: true, accelerator };
    }
    try {
      const registered = this.main.globalShortcut.register(accelerator, handler);
      const confirmed = registered && this.main.globalShortcut.isRegistered(accelerator);
      if (!confirmed) {
        if (this.main.globalShortcut.isRegistered(accelerator)) {
          this.main.globalShortcut.unregister(accelerator);
        }
        return {
          ok: false,
          accelerator,
          message: `Global shortcut is unavailable: ${accelerator}`
        };
      }
      const oldAccelerator = this.registeredAccelerator;
      this.registeredAccelerator = accelerator;
      if (oldAccelerator && oldAccelerator !== accelerator) {
        this.main.globalShortcut.unregister(oldAccelerator);
      }
      return { ok: true, accelerator };
    } catch (error) {
      return {
        ok: false,
        accelerator,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
  unregisterGlobalShortcut() {
    if (!this.registeredAccelerator) return;
    const accelerator = this.registeredAccelerator;
    this.registeredAccelerator = void 0;
    try {
      this.main.globalShortcut.unregister(accelerator);
    } catch {
    }
  }
  async capturePrimaryDisplay() {
    this.requireActive();
    const display = this.main.screen.getPrimaryDisplay();
    const physicalSize = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    };
    const sources = await this.renderer.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: physicalSize
    });
    const expectedId = String(display.id);
    const source = sources.find((candidate) => candidate.display_id === expectedId) ?? (sources.length === 1 ? sources[0] : void 0);
    if (!source) throw new Error("Primary display capture failed");
    return {
      pngDataUrl: source.thumbnail.toDataURL(),
      physicalSize,
      logicalBounds: { ...display.bounds },
      scaleFactor: display.scaleFactor
    };
  }
  async openOverlay(input) {
    this.requireActive();
    if (this.activeOverlay) throw new Error("A screenshot overlay is already active");
    this.previousWindow = this.main.BrowserWindow.getFocusedWindow?.() ?? void 0;
    this.hostWindow = this.previousWindow ?? this.main.BrowserWindow.getAllWindows?.().find((candidate) => !candidate.isDestroyed?.());
    const channel = `screenshot-inbox:${crypto.randomUUID()}`;
    const knownNotes = new Set(input.notes.map((note) => note.path));
    const bounds = input.capture.logicalBounds;
    const window2 = new this.main.BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    });
    let settled = false;
    let timer;
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const cleanupListener = () => {
      if (timer !== void 0) clearTimeout(timer);
      timer = void 0;
      this.main.ipcMain.removeListener(channel, onResult);
      window2.webContents?.removeListener("render-process-gone", onRendererFailure);
      window2.webContents?.removeListener("unresponsive", onRendererFailure);
    };
    const settle = (value) => {
      if (settled) return;
      settled = true;
      cleanupListener();
      if (value instanceof Error) rejectResult(value);
      else resolveResult(value);
    };
    const onResult = (_event, payload) => {
      try {
        settle(this.validateResult(payload, channel, input, knownNotes));
      } catch {
        settle(new Error("Invalid overlay result"));
      }
    };
    const onRendererFailure = () => {
      settle(new Error("Screenshot overlay renderer failed"));
      if (!window2.isDestroyed?.()) window2.close();
    };
    this.main.ipcMain.once(channel, onResult);
    window2.webContents?.once("render-process-gone", onRendererFailure);
    window2.webContents?.once("unresponsive", onRendererFailure);
    window2.on("closed", () => {
      if (!settled) settle({ status: "cancelled" });
      if (this.activeOverlay === session) this.activeOverlay = void 0;
    });
    timer = setTimeout(() => {
      settle(new Error("Screenshot overlay timed out"));
      if (!window2.isDestroyed?.()) window2.close();
    }, this.overlayTimeoutMs);
    const session = {
      result,
      close: () => {
        if (!settled) settle({ status: "cancelled" });
        if (!window2.isDestroyed?.()) window2.close();
        if (this.activeOverlay === session) this.activeOverlay = void 0;
      }
    };
    this.activeOverlay = session;
    const html = this.createDocument(input, channel);
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    try {
      await window2.loadURL(dataUrl);
    } catch (error) {
      session.close();
      throw error;
    }
    return session;
  }
  async restorePreviousFocus() {
    const previous = this.previousWindow;
    this.previousWindow = void 0;
    if (!previous || previous.isDestroyed?.()) return;
    try {
      previous.show?.();
      previous.focus?.();
    } catch {
    }
  }
  async activateHostWindow() {
    const host = this.hostWindow ?? this.previousWindow;
    if (!host || host.isDestroyed?.()) return;
    try {
      if (host.isMinimized?.()) host.restore?.();
      host.show?.();
      host.focus?.();
    } catch {
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterGlobalShortcut();
    this.activeOverlay?.close();
    this.activeOverlay = void 0;
    this.previousWindow = void 0;
    this.hostWindow = void 0;
  }
  validateResult(payload, channel, input, knownNotes) {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Missing payload");
    }
    const envelope = payload;
    if (envelope.channel !== channel) throw new Error("Wrong channel");
    const result = envelope.result;
    if (typeof result !== "object" || result === null) {
      throw new Error("Missing result");
    }
    const candidate = result;
    if (candidate.status === "cancelled") return { status: "cancelled" };
    if (candidate.status !== "saved") throw new Error("Unknown status");
    const png = this.asBytes(candidate.png);
    const maximumBytes = input.capture.physicalSize.width * input.capture.physicalSize.height * 4;
    if (png.byteLength < PNG_SIGNATURE.length || png.byteLength > maximumBytes || !PNG_SIGNATURE.every((byte, index) => png[index] === byte)) {
      throw new Error("Invalid PNG");
    }
    if (typeof candidate.targetNotePath !== "string" || !knownNotes.has(candidate.targetNotePath)) {
      throw new Error("Unknown target note");
    }
    if (typeof candidate.lastTool !== "string" || !TOOLS.has(candidate.lastTool) || typeof candidate.lastColor !== "string" || !COLORS.has(candidate.lastColor) || typeof candidate.lastStrokeWidth !== "number" || !WIDTHS.has(candidate.lastStrokeWidth) || typeof candidate.lastFontSize !== "number" || !FONT_SIZES.has(candidate.lastFontSize)) {
      throw new Error("Invalid annotation settings");
    }
    const description = typeof candidate.description === "string" ? candidate.description : "";
    const filename = typeof candidate.filename === "string" ? candidate.filename : "";
    return {
      status: "saved",
      png,
      targetNotePath: candidate.targetNotePath,
      filename,
      description,
      lastTool: candidate.lastTool,
      lastColor: candidate.lastColor,
      lastStrokeWidth: candidate.lastStrokeWidth,
      lastFontSize: candidate.lastFontSize
    };
  }
  asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
      return new Uint8Array(value);
    }
    if (typeof value === "object" && value !== null && "data" in value) {
      const data = value.data;
      if (Array.isArray(data) && data.every((item) => Number.isInteger(item))) {
        return new Uint8Array(data);
      }
    }
    throw new Error("Invalid bytes");
  }
  requireActive() {
    if (this.disposed) throw new Error("Screenshot Inbox platform is disposed");
  }
};

// src/settings/settings.ts
var DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: 1,
  accelerator: "Alt+Q",
  defaultNotePath: "\u622A\u56FE\u6536\u96C6.md",
  recentNotePaths: [],
  lastTool: "pen",
  lastColor: "red",
  lastStrokeWidth: 4,
  lastFontSize: 24,
  showDescriptionInput: true,
  afterSaveAction: "return"
});
var TOOLS2 = /* @__PURE__ */ new Set(["pen", "rectangle", "arrow", "text"]);
var COLORS2 = /* @__PURE__ */ new Set([
  "red",
  "yellow",
  "blue",
  "green",
  "black",
  "white"
]);
var WIDTHS2 = /* @__PURE__ */ new Set([2, 4, 8]);
var FONT_SIZES2 = /* @__PURE__ */ new Set([10, 12, 16, 24, 32, 48, 62]);
var AFTER_SAVE_ACTIONS = /* @__PURE__ */ new Set(["return", "open-note"]);
function recordValue(raw, key) {
  return typeof raw === "object" && raw !== null ? raw[key] : void 0;
}
function normalizeVaultPath(value) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}
function isAbsoluteVaultPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\//.test(value);
}
function stringOrDefault(raw, fallback) {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
}
function vaultPathOrDefault(raw, fallback) {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const value = raw.trim();
  if (isAbsoluteVaultPath(value)) return fallback;
  const normalized = normalizeVaultPath(value);
  return normalized.length > 0 ? normalized : fallback;
}
function recentVaultPath(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0 || isAbsoluteVaultPath(trimmed)) return void 0;
  const normalized = normalizeVaultPath(trimmed);
  return normalized.length > 0 ? normalized : void 0;
}
function migrateSettings(raw) {
  const accelerator = stringOrDefault(
    recordValue(raw, "accelerator"),
    DEFAULT_SETTINGS.accelerator
  );
  const defaultNotePath = vaultPathOrDefault(
    recordValue(raw, "defaultNotePath"),
    DEFAULT_SETTINGS.defaultNotePath
  );
  const recentValue = recordValue(raw, "recentNotePaths");
  const recentNotePaths = [];
  if (Array.isArray(recentValue)) {
    const seen = /* @__PURE__ */ new Set();
    for (const value of recentValue) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const normalized = recentVaultPath(value);
      if (!normalized) continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        recentNotePaths.push(normalized);
      }
      if (recentNotePaths.length === 5) break;
    }
  }
  const lastTool = recordValue(raw, "lastTool");
  const lastColor = recordValue(raw, "lastColor");
  const lastStrokeWidth = recordValue(raw, "lastStrokeWidth");
  const lastFontSize = recordValue(raw, "lastFontSize");
  const showDescriptionInput = recordValue(raw, "showDescriptionInput");
  const afterSaveAction = recordValue(raw, "afterSaveAction");
  return {
    settingsVersion: 1,
    accelerator,
    defaultNotePath,
    recentNotePaths,
    lastTool: typeof lastTool === "string" && TOOLS2.has(lastTool) ? lastTool : DEFAULT_SETTINGS.lastTool,
    lastColor: typeof lastColor === "string" && COLORS2.has(lastColor) ? lastColor : DEFAULT_SETTINGS.lastColor,
    lastStrokeWidth: typeof lastStrokeWidth === "number" && WIDTHS2.has(lastStrokeWidth) ? lastStrokeWidth : DEFAULT_SETTINGS.lastStrokeWidth,
    lastFontSize: typeof lastFontSize === "number" && FONT_SIZES2.has(lastFontSize) ? lastFontSize : DEFAULT_SETTINGS.lastFontSize,
    showDescriptionInput: typeof showDescriptionInput === "boolean" ? showDescriptionInput : DEFAULT_SETTINGS.showDescriptionInput,
    afterSaveAction: typeof afterSaveAction === "string" && AFTER_SAVE_ACTIONS.has(afterSaveAction) ? afterSaveAction : DEFAULT_SETTINGS.afterSaveAction
  };
}

// src/settings/plugin-data-store.ts
function objectValue(value) {
  return typeof value === "object" && value !== null ? value : void 0;
}
function parsePending(value) {
  if (!Array.isArray(value)) return [];
  const ids = /* @__PURE__ */ new Set();
  const records = [];
  for (const candidate of value) {
    const record = objectValue(candidate);
    if (!record || typeof record.id !== "string" || ids.has(record.id) || typeof record.attachmentPath !== "string" || typeof record.targetNotePath !== "string" || typeof record.embed !== "string" || typeof record.completed !== "boolean") continue;
    ids.add(record.id);
    records.push({
      id: record.id,
      attachmentPath: record.attachmentPath,
      targetNotePath: record.targetNotePath,
      embed: record.embed,
      description: typeof record.description === "string" ? record.description : "",
      completed: record.completed
    });
  }
  return records;
}
function clonePending(records) {
  return records.map((record) => ({ ...record }));
}
var PluginDataStore = class _PluginDataStore {
  constructor(plugin, data) {
    this.plugin = plugin;
    this.data = data;
    this.mutationTail = Promise.resolve();
  }
  static async load(plugin) {
    const raw = await plugin.loadData();
    const record = objectValue(raw);
    const settingsSource = record && "settings" in record ? record.settings : raw;
    const data = {
      settings: migrateSettings(settingsSource),
      pendingInserts: parsePending(record?.pendingInserts)
    };
    if (!isCanonicalData(raw, data)) {
      try {
        await plugin.saveData(data);
      } catch {
      }
    }
    return new _PluginDataStore(plugin, data);
  }
  get() {
    return {
      ...this.data.settings,
      recentNotePaths: [...this.data.settings.recentNotePaths]
    };
  }
  async update(patch) {
    await this.mutate((current) => ({
      settings: migrateSettings({ ...current.settings, ...patch }),
      pendingInserts: clonePending(current.pendingInserts)
    }));
  }
  getPendingInserts() {
    return clonePending(this.data.pendingInserts);
  }
  async replacePendingInserts(records) {
    await this.mutate((current) => ({
      settings: {
        ...current.settings,
        recentNotePaths: [...current.settings.recentNotePaths]
      },
      pendingInserts: parsePending(records)
    }));
  }
  mutate(change) {
    const operation = this.mutationTail.catch(() => void 0).then(async () => {
      const next = change(this.data);
      const snapshot = {
        settings: {
          ...next.settings,
          recentNotePaths: [...next.settings.recentNotePaths]
        },
        pendingInserts: clonePending(next.pendingInserts)
      };
      await this.plugin.saveData(snapshot);
      this.data = snapshot;
    });
    this.mutationTail = operation;
    return operation;
  }
};
function isCanonicalData(raw, data) {
  const record = objectValue(raw);
  return Boolean(
    record && "settings" in record && "pendingInserts" in record && JSON.stringify(record.settings) === JSON.stringify(data.settings) && JSON.stringify(parsePending(record.pendingInserts)) === JSON.stringify(data.pendingInserts)
  );
}

// src/settings/settings-tab.ts
var import_obsidian2 = require("obsidian");
function acceleratorFromEvent(event) {
  const ignored = /* @__PURE__ */ new Set(["Control", "Alt", "Shift", "Meta"]);
  if (ignored.has(event.key)) return void 0;
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(key);
  return parts.join("+");
}
var MarkdownFileSuggest = class extends import_obsidian2.AbstractInputSuggest {
  constructor(app, sourceInput, selected) {
    super(app, sourceInput);
    this.sourceInput = sourceInput;
    this.selected = selected;
  }
  getSuggestions(query) {
    const needle = query.trim().toLocaleLowerCase();
    return this.app.vault.getMarkdownFiles().filter((file) => needle.length === 0 || file.path.toLocaleLowerCase().includes(needle)).slice(0, 20);
  }
  renderSuggestion(file, element) {
    element.setText(file.path);
  }
  selectSuggestion(file) {
    this.sourceInput.value = file.path;
    this.selected(file);
    this.close();
  }
};
var ScreenshotInboxSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin, controller, settings) {
    super(app, plugin);
    this.controller = controller;
    this.settings = settings;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.settings.get();
    const shortcut = new import_obsidian2.Setting(containerEl).setName("\u5168\u5C40\u622A\u56FE\u5FEB\u6377\u952E").setDesc(
      this.controller.lastShortcutError ? `\u5F53\u524D\u751F\u6548\uFF1A${this.controller.currentAccelerator ?? "\u65E0"}\uFF1B\u5931\u8D25\u539F\u56E0\uFF1A${this.controller.lastShortcutError}` : `\u5F53\u524D\u751F\u6548\uFF1A${this.controller.currentAccelerator ?? "\u5C1A\u672A\u6CE8\u518C"}`
    );
    shortcut.settingEl.addClass(
      this.controller.lastShortcutError ? "screenshot-inbox-shortcut-error" : "screenshot-inbox-shortcut-status"
    );
    shortcut.addText((text) => {
      text.setValue(settings.accelerator).setPlaceholder("\u6309\u4E0B\u7EC4\u5408\u952E");
      text.inputEl.readOnly = true;
      text.inputEl.addEventListener("keydown", (event) => {
        const accelerator = acceleratorFromEvent(event);
        if (!accelerator) return;
        event.preventDefault();
        event.stopPropagation();
        text.setValue(accelerator);
        void this.controller.changeAccelerator(accelerator).then(() => this.display()).catch(() => this.display());
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u9ED8\u8BA4\u76EE\u6807\u7B14\u8BB0").setDesc("\u53EA\u80FD\u9009\u62E9\u6216\u586B\u5199\u4ED3\u5E93\u5185\u7684 Markdown \u6587\u4EF6\u8DEF\u5F84").addText((text) => this.configureDefaultPath(text, settings.defaultNotePath));
    new import_obsidian2.Setting(containerEl).setName("\u662F\u5426\u663E\u793A\u8BF4\u660E\u8F93\u5165\u6846\uFF08\u52FE\u9009\u540E\u53EF\u5728\u622A\u56FE\u5DE5\u5177\u680F\u4E2D\u8F93\u5165\u56FE\u7247\u8BF4\u660E\uFF09").addToggle((toggle) => {
      toggle.setValue(settings.showDescriptionInput).onChange((value) => {
        void this.settings.update({ showDescriptionInput: value }).catch(() => {
          new import_obsidian2.Notice("Screenshot Inbox \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25");
        });
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u4FDD\u5B58\u540E\u884C\u4E3A").setDesc("\u8FD4\u56DE\u622A\u56FE\u524D\u7684\u8F6F\u4EF6\uFF0C\u6216\u5728 Obsidian \u4E2D\u6253\u5F00\u76EE\u6807\u7B14\u8BB0").addDropdown((dropdown) => {
      dropdown.addOption("return", "\u8FD4\u56DE\u539F\u8F6F\u4EF6").addOption("open-note", "\u6253\u5F00\u76EE\u6807\u7B14\u8BB0").setValue(settings.afterSaveAction).onChange((value) => {
        if (value !== "return" && value !== "open-note") return;
        void this.settings.update({ afterSaveAction: value }).catch(() => {
          new import_obsidian2.Notice("Screenshot Inbox \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25");
        });
      });
    });
  }
  configureDefaultPath(text, current) {
    text.setValue(current).setPlaceholder("\u622A\u56FE\u6536\u96C6.md");
    const persist = (path) => {
      const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
      if (!normalized.toLocaleLowerCase().endsWith(".md")) {
        new import_obsidian2.Notice("\u9ED8\u8BA4\u76EE\u6807\u5FC5\u987B\u662F Markdown \u6587\u4EF6\u8DEF\u5F84");
        return;
      }
      text.setValue(normalized);
      void this.settings.update({ defaultNotePath: normalized }).catch(() => {
        new import_obsidian2.Notice("Screenshot Inbox \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25");
      });
    };
    text.onChange((value) => {
      if (value.trim().toLocaleLowerCase().endsWith(".md")) persist(value);
    });
    new MarkdownFileSuggest(this.app, text.inputEl, (file) => persist(file.path));
  }
};

// src/writer/capture-writer.ts
var import_obsidian3 = require("obsidian");
var PerKeyQueue = class {
  constructor() {
    this.tails = /* @__PURE__ */ new Map();
  }
  async run(key, task) {
    const normalized = (0, import_obsidian3.normalizePath)(key);
    const previous = this.tails.get(normalized) ?? Promise.resolve();
    const result = previous.catch(() => void 0).then(task);
    const tail = result.then(
      () => void 0,
      () => void 0
    );
    this.tails.set(normalized, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(normalized) === tail) this.tails.delete(normalized);
    }
  }
};
function pad(value, width) {
  return String(value).padStart(width, "0");
}
function formatCaptureFilename(capturedAt, customFilename) {
  const normalizedCustomFilename = normalizeCustomFilename(customFilename);
  if (normalizedCustomFilename) return `${normalizedCustomFilename}.png`;
  return [
    "Screenshot-",
    pad(capturedAt.getFullYear(), 4),
    pad(capturedAt.getMonth() + 1, 2),
    pad(capturedAt.getDate(), 2),
    "-",
    pad(capturedAt.getHours(), 2),
    pad(capturedAt.getMinutes(), 2),
    pad(capturedAt.getSeconds(), 2),
    "-",
    pad(capturedAt.getMilliseconds(), 3),
    ".png"
  ].join("");
}
function normalizeCustomFilename(value) {
  if (!value) return "";
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[.\s]+$/g, "").trim();
  if (!sanitized || sanitized === "." || sanitized === "..") return "";
  return sanitized.toLocaleLowerCase().endsWith(".png") ? sanitized.slice(0, -4).trim() : sanitized;
}
function toExactArrayBuffer(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}
var CaptureWriterImpl = class {
  constructor(vault, fileManager, targets, pending) {
    this.vault = vault;
    this.fileManager = fileManager;
    this.targets = targets;
    this.pending = pending;
    this.noteQueue = new PerKeyQueue();
  }
  async save(request) {
    const note = await this.targets.resolveTarget(request.targetNotePath);
    return this.noteQueue.run(note.path, async () => {
      const filename = formatCaptureFilename(request.capturedAt, request.filename);
      const attachmentPath = (0, import_obsidian3.normalizePath)(
        await this.fileManager.getAvailablePathForAttachment(filename, note.path)
      );
      const attachment = await this.vault.createBinary(
        attachmentPath,
        toExactArrayBuffer(request.png)
      );
      const embed = this.asImageEmbed(
        this.fileManager.generateMarkdownLink(
          attachment,
          note.path,
          "",
          "Screenshot"
        )
      );
      const description = request.description?.trim() ?? "";
      try {
        await this.appendEmbed(note, embed, description);
        return {
          status: "saved",
          attachmentPath,
          targetNotePath: note.path,
          embed
        };
      } catch {
        const pendingId = await this.pending.save({
          attachmentPath,
          targetNotePath: note.path,
          embed,
          description
        });
        return {
          status: "pending-insert",
          attachmentPath,
          targetNotePath: note.path,
          embed,
          pendingId
        };
      }
    });
  }
  async retryPendingInsert(pendingId) {
    const record = await this.pending.get(pendingId);
    if (!record) throw new Error(`Unknown pending insert: ${pendingId}`);
    if (record.completed) return this.savedResult(record);
    const note = await this.targets.resolveTarget(record.targetNotePath);
    return this.noteQueue.run(note.path, async () => {
      const latest = await this.pending.get(pendingId);
      if (!latest) throw new Error(`Unknown pending insert: ${pendingId}`);
      if (latest.completed) return this.savedResult(latest);
      const attachment = this.vault.getAbstractFileByPath(latest.attachmentPath);
      if (!this.isFile(attachment)) {
        throw new Error(`Pending attachment is missing: ${latest.attachmentPath}`);
      }
      const embed = note.path === latest.targetNotePath ? latest.embed : this.asImageEmbed(
        this.fileManager.generateMarkdownLink(
          attachment,
          note.path,
          "",
          "Screenshot"
        )
      );
      await this.appendEmbed(note, embed, latest.description ?? "");
      await this.pending.markCompleted(pendingId, {
        targetNotePath: note.path,
        embed
      });
      return {
        status: "saved",
        attachmentPath: latest.attachmentPath,
        targetNotePath: note.path,
        embed
      };
    });
  }
  listPendingInserts() {
    return this.pending.list();
  }
  async appendEmbed(note, embed, description = "") {
    const normalizedDescription = description.trim();
    const content = normalizedDescription.length > 0 ? `${normalizedDescription}

${embed}` : embed;
    await this.vault.process(
      note,
      (current) => current.includes(embed) ? current : current.replace(/\s*$/, "\n\n") + content + "\n"
    );
  }
  asImageEmbed(markdownLink) {
    return markdownLink.startsWith("!") ? markdownLink : `!${markdownLink}`;
  }
  savedResult(record) {
    return {
      status: "saved",
      attachmentPath: record.attachmentPath,
      targetNotePath: record.targetNotePath,
      embed: record.embed
    };
  }
  isFile(value) {
    return typeof value === "object" && value !== null && typeof value.path === "string" && typeof value.extension === "string";
  }
};

// src/writer/persistent-pending-store.ts
var PersistentPendingInsertStore = class {
  constructor(load, persist, createId = () => `pending-${crypto.randomUUID()}`) {
    this.load = load;
    this.persist = persist;
    this.createId = createId;
    this.mutationTail = Promise.resolve();
  }
  async save(record) {
    let id = "";
    await this.mutate((records) => {
      do
        id = this.createId();
      while (records.some((candidate) => candidate.id === id));
      records.push({ ...record, id, completed: false });
    });
    return id;
  }
  async get(id) {
    await this.mutationTail.catch(() => void 0);
    const record = this.load().find((candidate) => candidate.id === id);
    return record ? { ...record } : void 0;
  }
  async list() {
    await this.mutationTail.catch(() => void 0);
    return this.load().map((record) => ({ ...record }));
  }
  async markCompleted(id, resolved) {
    await this.mutate((records) => {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error(`Unknown pending insert: ${id}`);
      records[index] = { ...records[index], ...resolved, completed: true };
    });
  }
  mutate(change) {
    const operation = this.mutationTail.catch(() => void 0).then(async () => {
      const records = this.load().map((record) => ({ ...record }));
      change(records);
      await this.persist(records);
    });
    this.mutationTail = operation;
    return operation;
  }
};

// src/main.ts
function nameFromPath(path) {
  return (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");
}
function addNoticeAction(message, label, action) {
  const notice = new import_obsidian4.Notice(message, 1e4);
  const button = notice.noticeEl.createEl("button", { text: label });
  button.addEventListener("click", () => void action());
}
var ObsidianControllerNotices = class {
  captureError(error) {
    const description = error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF";
    new import_obsidian4.Notice(`Screenshot Inbox \u64CD\u4F5C\u5931\u8D25\uFF1A${description}`);
  }
  nonFatalError(message, error) {
    const description = error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF";
    new import_obsidian4.Notice(`${message}\uFF1A${description}`);
  }
  saved(targetNotePath, openNote) {
    addNoticeAction(`\u622A\u56FE\u5DF2\u4FDD\u5B58\u5230 ${nameFromPath(targetNotePath)}`, "\u6253\u5F00\u7B14\u8BB0", openNote);
  }
  pendingInsert(targetNotePath, retry) {
    addNoticeAction(
      `\u56FE\u7247\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u5C1A\u672A\u63D2\u5165 ${nameFromPath(targetNotePath)}`,
      "\u91CD\u8BD5\u63D2\u5165",
      retry
    );
  }
  shortcutError(message) {
    new import_obsidian4.Notice(`Screenshot Inbox \u5FEB\u6377\u952E\u6CE8\u518C\u5931\u8D25\uFF1A${message}`);
  }
};
var ScreenshotInboxPlugin = class extends import_obsidian4.Plugin {
  async onload() {
    this.dataStore = await PluginDataStore.load(this);
    const runtime = await this.createRuntime(this.dataStore);
    this.runtime = runtime;
    this.addCommand({
      id: "start-capture",
      name: "\u5F00\u59CB\u622A\u56FE",
      callback: () => void runtime.controller.startCapture()
    });
    this.addSettingTab(runtime.settingsTab);
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) void runtime.targets.recordOpenedNote(file);
      })
    );
    runtime.controller.registerConfiguredShortcut();
    await runtime.controller.offerPendingInserts();
  }
  async onunload() {
    const runtime = this.runtime;
    this.runtime = void 0;
    runtime?.targets.dispose();
    await runtime?.controller.dispose();
  }
  async createRuntime(store) {
    const rendererRequire = globalThis.require;
    if (!rendererRequire) {
      throw new Error(
        "Screenshot Inbox requires the Windows desktop version of Obsidian with Electron modules"
      );
    }
    const capabilities = loadElectronCapabilities(rendererRequire);
    const platform = new WindowsElectronAdapter(capabilities, createOverlayDocument);
    const targets = new NoteTargetServiceImpl(
      this.app.vault,
      () => store.get(),
      (paths) => store.update({ recentNotePaths: paths })
    );
    const pending = new PersistentPendingInsertStore(
      () => store.getPendingInserts(),
      (records) => store.replacePendingInserts(records)
    );
    const writer = new CaptureWriterImpl(
      this.app.vault,
      this.app.fileManager,
      targets,
      pending
    );
    const openNote = async (path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !("extension" in file) || file.extension !== "md") {
        throw new Error(`\u76EE\u6807\u7B14\u8BB0\u4E0D\u5B58\u5728\uFF1A${path}`);
      }
      await this.app.workspace.getLeaf(false).openFile(file);
    };
    const controller = new PluginController({
      platform,
      targets,
      writer,
      settings: store,
      notices: new ObsidianControllerNotices(),
      openNote
    });
    return {
      controller,
      targets,
      settingsTab: new ScreenshotInboxSettingTab(this.app, this, controller, store)
    };
  }
};

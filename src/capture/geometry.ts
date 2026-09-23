export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface PixelRect extends Rect {}

export interface DisplayGeometry {
  logicalBounds: Rect;
  physicalSize?: Size;
  scaleFactor: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeRect(rect: Rect): Rect {
  const left = Math.min(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const right = Math.max(rect.x, rect.x + rect.width);
  const bottom = Math.max(rect.y, rect.y + rect.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function logicalRectToPhysical(
  rect: Rect,
  display: DisplayGeometry
): PixelRect {
  const normalized = normalizeRect(rect);
  const physicalWidth =
    display.physicalSize?.width ??
    Math.round(display.logicalBounds.width * display.scaleFactor);
  const physicalHeight =
    display.physicalSize?.height ??
    Math.round(display.logicalBounds.height * display.scaleFactor);

  const left = clamp(
    Math.round((normalized.x - display.logicalBounds.x) * display.scaleFactor),
    0,
    physicalWidth
  );
  const top = clamp(
    Math.round((normalized.y - display.logicalBounds.y) * display.scaleFactor),
    0,
    physicalHeight
  );
  const right = clamp(
    Math.round(
      (normalized.x + normalized.width - display.logicalBounds.x) *
        display.scaleFactor
    ),
    0,
    physicalWidth
  );
  const bottom = clamp(
    Math.round(
      (normalized.y + normalized.height - display.logicalBounds.y) *
        display.scaleFactor
    ),
    0,
    physicalHeight
  );

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

export function placeToolbar(
  selection: Rect,
  toolbar: Size,
  viewport: Size
): Point {
  const normalized = normalizeRect(selection);
  const gap = 8;
  const preferredX = normalized.x + normalized.width - toolbar.width;
  const below = normalized.y + normalized.height + gap;
  const preferredY =
    below + toolbar.height <= viewport.height
      ? below
      : normalized.y - toolbar.height - gap;

  return {
    x: clamp(preferredX, gap, Math.max(gap, viewport.width - toolbar.width - gap)),
    y: clamp(preferredY, gap, Math.max(gap, viewport.height - toolbar.height - gap))
  };
}

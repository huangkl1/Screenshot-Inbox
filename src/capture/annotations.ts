import type {
  AnnotationColor,
  StrokeWidth
} from "../settings/settings";
import type { Point } from "./geometry";

interface AnnotationBase {
  color: AnnotationColor;
}

interface StrokeAnnotationBase extends AnnotationBase {
  strokeWidth: StrokeWidth;
}

export interface PenAnnotation extends StrokeAnnotationBase {
  type: "pen";
  points: readonly Point[];
}

export interface RectangleAnnotation extends StrokeAnnotationBase {
  type: "rectangle";
  start: Point;
  end: Point;
}

export interface ArrowAnnotation extends StrokeAnnotationBase {
  type: "arrow";
  start: Point;
  end: Point;
}

export interface TextAnnotation extends AnnotationBase {
  type: "text";
  id: string;
  text: string;
  position: Point;
  fontSize: number;
}

export type Annotation =
  | PenAnnotation
  | RectangleAnnotation
  | ArrowAnnotation
  | TextAnnotation;

function freezePoint(point: Point): Readonly<Point> {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeAnnotation(annotation: Annotation): Annotation {
  if (annotation.type === "pen") {
    return Object.freeze({
      ...annotation,
      points: Object.freeze(annotation.points.map(freezePoint))
    });
  }
  if (annotation.type === "text") {
    return Object.freeze({
      ...annotation,
      position: freezePoint(annotation.position)
    });
  }
  return Object.freeze({
    ...annotation,
    start: freezePoint(annotation.start),
    end: freezePoint(annotation.end)
  });
}

export class AnnotationHistory {
  private commands: readonly Annotation[] = Object.freeze([]);
  private cursor = 0;

  get active(): readonly Annotation[] {
    return Object.freeze(this.commands.slice(0, this.cursor));
  }

  push(annotation: Annotation): void {
    this.commands = Object.freeze([
      ...this.commands.slice(0, this.cursor),
      freezeAnnotation(annotation)
    ]);
    this.cursor = this.commands.length;
  }

  undo(): boolean {
    if (this.cursor === 0) return false;
    this.cursor -= 1;
    return true;
  }

  redo(): boolean {
    if (this.cursor === this.commands.length) return false;
    this.cursor += 1;
    return true;
  }
}

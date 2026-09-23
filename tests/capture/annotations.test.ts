import { describe, expect, it } from "vitest";
import {
  AnnotationHistory,
  type Annotation
} from "../../src/capture/annotations";

const rectangle: Annotation = {
  type: "rectangle",
  color: "red",
  strokeWidth: 4,
  start: { x: 10, y: 20 },
  end: { x: 50, y: 80 }
};

const arrow: Annotation = {
  type: "arrow",
  color: "blue",
  strokeWidth: 2,
  start: { x: 5, y: 5 },
  end: { x: 30, y: 40 }
};

describe("AnnotationHistory", () => {
  it("starts empty and returns immutable snapshots", () => {
    const history = new AnnotationHistory();
    expect(history.active).toEqual([]);
    expect(Object.isFrozen(history.active)).toBe(true);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it("supports push, undo, and redo", () => {
    const history = new AnnotationHistory();
    history.push(rectangle);
    history.push(arrow);

    expect(history.active).toEqual([rectangle, arrow]);
    expect(history.undo()).toBe(true);
    expect(history.active).toEqual([rectangle]);
    expect(history.redo()).toBe(true);
    expect(history.active).toEqual([rectangle, arrow]);
  });

  it("clears the redo branch after pushing a new annotation", () => {
    const history = new AnnotationHistory();
    history.push(rectangle);
    history.push(arrow);
    history.undo();

    const pen: Annotation = {
      type: "pen",
      color: "green",
      strokeWidth: 8,
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 }
      ]
    };
    history.push(pen);

    expect(history.active).toEqual([rectangle, pen]);
    expect(history.redo()).toBe(false);
  });

  it("freezes text content and position in history snapshots", () => {
    const history = new AnnotationHistory();
    history.push({
      type: "text",
      id: "text-1",
      text: "说明",
      color: "blue",
      fontSize: 24,
      position: { x: 10, y: 20 }
    });

    const active = history.active[0];
    expect(active).toMatchObject({ type: "text", text: "说明", fontSize: 24 });
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen((active as Extract<Annotation, { type: "text" }>).position)).toBe(true);
  });
});

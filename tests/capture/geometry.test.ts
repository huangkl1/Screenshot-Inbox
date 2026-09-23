import { describe, expect, it } from "vitest";
import {
  logicalRectToPhysical,
  normalizeRect,
  placeToolbar
} from "../../src/capture/geometry";

describe("logicalRectToPhysical", () => {
  it.each([1, 1.25, 1.5, 2])(
    "maps logical selection at scale %s",
    scaleFactor => {
      const actual = logicalRectToPhysical(
        { x: 10, y: 20, width: 100, height: 80 },
        {
          logicalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          physicalSize: {
            width: Math.round(1920 * scaleFactor),
            height: Math.round(1080 * scaleFactor)
          },
          scaleFactor
        }
      );

      expect(actual).toEqual({
        x: Math.round(10 * scaleFactor),
        y: Math.round(20 * scaleFactor),
        width: Math.round(110 * scaleFactor) - Math.round(10 * scaleFactor),
        height: Math.round(100 * scaleFactor) - Math.round(20 * scaleFactor)
      });
    }
  );

  it("normalizes negative drag direction before conversion", () => {
    expect(normalizeRect({ x: 110, y: 100, width: -100, height: -80 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 80
    });
  });

  it("subtracts the display origin and clamps to physical bounds", () => {
    expect(
      logicalRectToPhysical(
        { x: -110, y: 40, width: 250, height: 200 },
        {
          logicalBounds: { x: -100, y: 50, width: 200, height: 100 },
          physicalSize: { width: 300, height: 150 },
          scaleFactor: 1.5
        }
      )
    ).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });

  it("keeps zero-area selections empty", () => {
    expect(
      logicalRectToPhysical(
        { x: 5, y: 5, width: 0, height: 10 },
        {
          logicalBounds: { x: 0, y: 0, width: 100, height: 100 },
          physicalSize: { width: 125, height: 125 },
          scaleFactor: 1.25
        }
      )
    ).toEqual({ x: 6, y: 6, width: 0, height: 13 });
  });
});

describe("placeToolbar", () => {
  it("flips above the selection and stays inside the viewport", () => {
    expect(
      placeToolbar(
        { x: 900, y: 700, width: 100, height: 100 },
        { width: 240, height: 48 },
        { width: 1024, height: 768 }
      )
    ).toEqual({ x: 760, y: 644 });
  });

  it("clamps a toolbar near the top-left edge", () => {
    expect(
      placeToolbar(
        { x: -20, y: -10, width: 30, height: 20 },
        { width: 240, height: 48 },
        { width: 320, height: 200 }
      )
    ).toEqual({ x: 8, y: 18 });
  });
});

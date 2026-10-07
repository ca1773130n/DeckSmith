/**
 * The v2 player's pure parts: preferences, stage geometry, the keymap and the
 * page marker. The browser half — that these are actually wired, and that the
 * controls never cover a caption — is test/deck-page.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  CAPTION_MIN_PX,
  cleanPrefs,
  DEFAULT_PREFS,
  keyAction,
  markV2,
  PLAYER_MARKER,
  prefsFromQuery,
  prefsFromStored,
  RATES,
  resolvePrefs,
  snapRate,
  stageGeometry,
  stepRate,
  stepSize,
} from "../src/deck/playback.js";

/** Slide area with captions on, over the area it would have with them off. */
function share(vw: number, vh: number, size: "s" | "m" | "l" | "xl" = "m"): number {
  const on = stageGeometry(vw, vh, 16 / 9, { on: true, size });
  const off = stageGeometry(vw, vh, 16 / 9, { on: false, size });
  return (on.slideW * on.slideH) / (off.slideW * off.slideH);
}

const VIEWPORTS: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [960, 540],
  [800, 450],
  [390, 844],
  [358, 201],
];

describe("stage geometry", () => {
  it("gives the slide at least 83% of its captionless area at 1080p and in the 800x450 embed", () => {
    // v0.8.0 measured 76.9% and 68.7% here (plan §1).
    expect(share(1920, 1080)).toBeGreaterThanOrEqual(0.83);
    expect(share(800, 450)).toBeGreaterThanOrEqual(0.83);
    expect(share(1280, 720)).toBeGreaterThanOrEqual(0.83);
    expect(share(960, 540)).toBeGreaterThanOrEqual(0.83);
  });

  it("gives the slide everything with captions off", () => {
    for (const [w, h] of VIEWPORTS) {
      const g = stageGeometry(w, h, 16 / 9, { on: false, size: "m" });
      // Fills one dimension: the whole width or the whole height.
      expect(Math.max(g.slideW / w, g.slideH / h)).toBeCloseTo(1, 6);
      expect(g.capH).toBe(0);
    }
  });

  it("puts the strip in a portrait phone's letterbox, costing the slide nothing", () => {
    expect(share(390, 844)).toBeCloseTo(1, 6);
  });

  it("never lets slide and strip together exceed the viewport, at any size", () => {
    for (const [w, h] of VIEWPORTS) {
      for (const size of ["s", "m", "l", "xl"] as const) {
        const g = stageGeometry(w, h, 16 / 9, { on: true, size });
        expect(g.slideY + g.slideH + g.capH).toBeLessThanOrEqual(h + 1e-9);
        expect(g.slideW).toBeLessThanOrEqual(w + 1e-9);
        expect(g.capFont).toBeGreaterThanOrEqual(CAPTION_MIN_PX);
      }
    }
  });

  it("sizes the caption from the slide, not the window width, and smaller than v0.8.0", () => {
    // v0.8.0: clamp(22px, 2.2vw, 38px) — 38px at 1080p, 22px in the embed.
    const big = stageGeometry(1920, 1080, 16 / 9, { on: true, size: "m" });
    const embed = stageGeometry(800, 450, 16 / 9, { on: true, size: "m" });
    expect(big.capFont).toBeLessThan(38);
    expect(embed.capFont).toBeLessThan(22);
    // Same slide height, same caption — however wide the window around it.
    const wide = stageGeometry(3000, 1080, 16 / 9, { on: true, size: "m" });
    expect(wide.capFont).toBeCloseTo(big.capFont, 6);
  });

  it("is not circular: the font follows from the viewport alone, and the strip fits under the slide", () => {
    const g = stageGeometry(1920, 1080, 16 / 9, { on: true, size: "m" });
    expect(g.slideH + g.capH).toBeCloseTo(1080, 6);
    expect(g.capH).toBeCloseTo(3 * g.capFont, 6);
  });

  it("grows the caption with each size step", () => {
    const font = (size: "s" | "m" | "l" | "xl") =>
      stageGeometry(1920, 1080, 16 / 9, { on: true, size }).capFont;
    expect(font("s")).toBeLessThan(font("m"));
    expect(font("m")).toBeLessThan(font("l"));
    expect(font("l")).toBeLessThan(font("xl"));
  });

  it("centres slide and strip as one block", () => {
    const g = stageGeometry(390, 844, 16 / 9, { on: true, size: "m" });
    expect(g.slideY).toBeCloseTo((844 - g.slideH - g.capH) / 2, 6);
    expect(g.slideX).toBeCloseTo(0, 6);
  });
});

describe("preferences", () => {
  it("snaps a speed to the nearest offered rate, and refuses what is not one", () => {
    expect(snapRate(1.3)).toBe(1.25);
    expect(snapRate("2")).toBe(2);
    expect(snapRate(9)).toBe(2);
    expect(snapRate(0.1)).toBe(0.75);
    expect(snapRate(0)).toBeUndefined();
    expect(snapRate("fast")).toBeUndefined();
    expect(snapRate("")).toBeUndefined();
  });

  it("reads the URL's three params and ignores anything else", () => {
    expect(prefsFromQuery("?speed=1.5&cc=0&ccsize=XL&x=1")).toEqual({
      speed: 1.5,
      cc: false,
      ccsize: "xl",
    });
    expect(prefsFromQuery("?cc=on")).toEqual({ cc: true });
    expect(prefsFromQuery("?ccsize=huge&speed=nope")).toEqual({});
    expect(prefsFromQuery("")).toEqual({});
  });

  it("reads a stored blob defensively", () => {
    expect(prefsFromStored('{"speed":1.25,"cc":false,"ccsize":"s"}')).toEqual({
      speed: 1.25,
      cc: false,
      ccsize: "s",
    });
    expect(prefsFromStored("{not json")).toEqual({});
    expect(prefsFromStored(null)).toEqual({});
    expect(cleanPrefs({ speed: -1, cc: "maybe", ccsize: 3 })).toEqual({});
  });

  it("lets the URL win over storage, and storage over the default", () => {
    expect(resolvePrefs({}, {})).toEqual(DEFAULT_PREFS);
    expect(resolvePrefs({ speed: 1.5, cc: false }, { speed: 2 })).toEqual({
      speed: 2,
      cc: false,
      ccsize: "m",
    });
  });

  it("steps speed and size within their lists", () => {
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(2, 1)).toBe(2);
    expect(stepRate(0.75, -1)).toBe(0.75);
    expect(RATES).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(stepSize("m", 1)).toBe("l");
    expect(stepSize("xl", 1)).toBe("xl");
    expect(stepSize("s", -1)).toBe("s");
  });
});

describe("the v2 keymap", () => {
  it("steps on Space and plays on Enter (founder's decision, 2026-10-07)", () => {
    expect(keyAction({ key: " " })).toBe("next");
    expect(keyAction({ key: "Enter" })).toBe("play");
    expect(keyAction({ key: "ArrowRight" })).toBe("next");
    expect(keyAction({ key: "ArrowLeft" })).toBe("prev");
  });

  it("toggles captions on c, keeping s", () => {
    expect(keyAction({ key: "c" })).toBe("captions");
    expect(keyAction({ key: "s" })).toBe("captions");
  });

  it("leaves every key held with Cmd, Ctrl or Alt to the browser", () => {
    expect(keyAction({ key: "f", metaKey: true })).toBeNull();
    expect(keyAction({ key: "f", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(keyAction({ key: " ", altKey: true })).toBeNull();
  });

  it("repeats steps but not toggles", () => {
    expect(keyAction({ key: "ArrowRight", repeat: true })).toBe("next");
    expect(keyAction({ key: "c", repeat: true })).toBeNull();
    expect(keyAction({ key: "Enter", repeat: true })).toBeNull();
  });

  it("maps speed and size", () => {
    expect(keyAction({ key: ">" })).toBe("faster");
    expect(keyAction({ key: "<" })).toBe("slower");
    expect(keyAction({ key: "+" })).toBe("bigger");
    expect(keyAction({ key: "-" })).toBe("smaller");
    expect(keyAction({ key: "q" })).toBeNull();
  });
});

describe("the v2 page marker", () => {
  const page =
    '<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n  </head>\n</html>';

  it("goes first in the head", () => {
    expect(markV2(page)).toContain(`<head>\n    ${PLAYER_MARKER}\n    <meta charset`);
  });

  it("is idempotent", () => {
    expect(markV2(markV2(page))).toBe(markV2(page));
  });

  it("refuses a page with no head", () => {
    expect(() => markV2("<p>hi</p>")).toThrow(/no <head>/);
  });
});

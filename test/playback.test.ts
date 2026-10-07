/**
 * The v2 player's pure parts: preferences, stage geometry, the keymap and the
 * page marker. The browser half — that these are actually wired, and that the
 * controls never cover a caption — is test/deck-page.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  type Box,
  BTN_MIN,
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
  safeBottomFor,
  snapRate,
  stageGeometry,
  stepRate,
  stepSize,
} from "../src/deck/playback.js";

const SAFE = safeBottomFor(1920, 1080);
const geo = (vw: number, vh: number, on: boolean, size: "s" | "m" | "l" | "xl" = "m") =>
  stageGeometry(vw, vh, 16 / 9, { on, size }, { safeBottom: SAFE });

/** Slide area over the largest 16:9 box the viewport holds. */
function share(vw: number, vh: number, size: "s" | "m" | "l" | "xl" = "m", on = true): number {
  const g = geo(vw, vh, on, size);
  const full = Math.min(vw, (vh * 16) / 9) * Math.min(vh, (vw * 9) / 16);
  return (g.slideW * g.slideH) / full;
}

const VIEWPORTS: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [960, 540],
  [800, 450],
  [390, 844],
  [358, 201],
];

const meets = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("stage geometry", () => {
  it("gives the slide at least 83% of the screen at 1080p and in the 800x450 embed", () => {
    // v0.8.0 measured 76.9% and 68.7% here (plan §1).
    expect(share(1920, 1080)).toBeGreaterThanOrEqual(0.83);
    expect(share(800, 450)).toBeGreaterThanOrEqual(0.83);
    expect(share(1280, 720)).toBeGreaterThanOrEqual(0.83);
    expect(share(960, 540)).toBeGreaterThanOrEqual(0.83);
    expect(share(358, 201)).toBeGreaterThanOrEqual(0.64);
  });

  it("gives the slide everything with captions off wherever the bar costs nothing, and never less than with them on", () => {
    for (const [w, h] of VIEWPORTS) {
      const off = geo(w, h, false);
      expect(off.capH).toBe(0);
      expect(share(w, h, "m", false)).toBeGreaterThanOrEqual(share(w, h, "m", true) - 1e-9);
      if (off.dock !== "band") expect(Math.max(off.slideW / w, off.slideH / h)).toBeCloseTo(1, 6);
    }
  });

  it("puts the bar where it covers nothing: over the text-free foot, in spare letterbox, or in a band", () => {
    // The review's blocker: the bar was inside the slide's box on every screen,
    // and on a small slide a 48px bar is a fifth of the height.
    expect(geo(1920, 1080, true).dock).toBe("pad");
    expect(geo(1920, 1080, false).dock).toBe("pad");
    expect(geo(390, 844, true).dock).toBe("letterbox");
    expect(geo(800, 450, true).dock).toBe("band");
    expect(geo(358, 201, true).dock).toBe("band");
    for (const [w, h] of VIEWPORTS) {
      for (const on of [true, false]) {
        const g = geo(w, h, on);
        const slide = { x: g.slideX, y: g.slideY, w: g.slideW, h: g.slideH };
        if (g.dock === "pad") {
          // Inside the slide, and only within its text-free foot.
          expect(g.bar.y).toBeGreaterThanOrEqual(g.slideY + g.slideH * (1 - SAFE) - 1e-6);
        } else {
          expect(meets(g.bar, slide), `${w}x${h} ${g.dock}`).toBe(false);
        }
        expect(g.btn).toBeGreaterThanOrEqual(BTN_MIN);
        expect(g.bar.y + g.bar.h).toBeLessThanOrEqual(h + 1e-6);
      }
    }
  });

  it("keeps a caption's text clear of the buttons beside it in a shared band", () => {
    for (const [w, h] of VIEWPORTS) {
      const g = geo(w, h, true);
      if (g.dock !== "band") continue;
      // The strip pads its text in past the clusters on both sides.
      const sideBtns = g.compact ? 1.2 : 4.6;
      expect(g.stripPad).toBeGreaterThanOrEqual(g.barInset + sideBtns * g.btn);
      // And the budget is what is left: two lines of it, never more than 44em.
      const measure = g.strip.w - 2 * g.stripPad;
      expect(g.cueEm).toBeLessThanOrEqual((2 * measure) / g.capFont + 1e-6);
      expect(g.cueEm).toBeLessThanOrEqual(44);
    }
  });

  it("swaps four settings buttons for one menu only when the window is too narrow for both", () => {
    expect(geo(358, 201, true).compact).toBe(true);
    expect(geo(800, 450, true).compact).toBe(false);
    expect(geo(1280, 720, true).compact).toBe(false);
  });

  it("never lets slide, strip and bar together exceed the viewport, at any size", () => {
    for (const [w, h] of VIEWPORTS) {
      for (const size of ["s", "m", "l", "xl"] as const) {
        const g = geo(w, h, true, size);
        expect(g.slideY + g.slideH + g.capH).toBeLessThanOrEqual(h + 1e-9);
        expect(g.slideW).toBeLessThanOrEqual(w + 1e-9);
        expect(g.capFont).toBeGreaterThanOrEqual(CAPTION_MIN_PX);
      }
    }
  });

  it("sizes the caption from the slide, not the window width, and smaller than v0.8.0", () => {
    // v0.8.0: clamp(22px, 2.2vw, 38px) — 38px at 1080p, 22px in the embed.
    const big = geo(1920, 1080, true);
    const embed = geo(800, 450, true);
    expect(big.capFont).toBeLessThan(38);
    expect(embed.capFont).toBeLessThan(22);
    // Same slide height, same caption — however wide the window around it.
    const wide = geo(3000, 1080, true);
    expect(wide.capFont).toBeCloseTo(big.capFont, 6);
  });

  it("is not circular: the font follows from the viewport alone, and the strip fits under the slide", () => {
    const g = geo(1920, 1080, true);
    expect(g.slideH + g.capH).toBeCloseTo(1080, 6);
    expect(g.capH).toBeCloseTo(3 * g.capFont, 6);
  });

  it("grows the caption with each size step, on a big screen and on the phone embed", () => {
    for (const [w, h] of [
      [1920, 1080],
      [358, 201],
    ] as const) {
      const font = (size: "s" | "m" | "l" | "xl") => geo(w, h, true, size).capFont;
      if (w > 1000) expect(font("s")).toBeLessThan(font("m"));
      expect(font("m")).toBeLessThan(font("l"));
      expect(font("l")).toBeLessThan(font("xl"));
    }
  });

  it("centres slide, strip and a letterbox bar as one block", () => {
    const g = geo(390, 844, true);
    expect(g.slideY).toBeCloseTo((844 - g.slideH - g.capH - g.bar.h) / 2, 6);
    expect(g.bar.y).toBeCloseTo(g.slideY + g.slideH + g.capH, 6);
    expect(g.slideX).toBeCloseTo(0, 6);
  });

  it("knows the composition's text-free foot from its size", () => {
    // (84 - 16) / 1080: `.scene`'s bottom padding less a margin.
    expect(safeBottomFor(1920, 1080)).toBeCloseTo(68 / 1080, 9);
    expect(safeBottomFor(0, 0)).toBe(0);
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

  it("reads a letter key by its physical key when an IME turns it into Hangul or kana", () => {
    // Korean 2-set: c → ㅊ, m → ㅡ, f → ㄹ. Before, every toggle did nothing.
    expect(keyAction({ key: "ㅊ", code: "KeyC" })).toBe("captions");
    expect(keyAction({ key: "ㅡ", code: "KeyM" })).toBe("mute");
    expect(keyAction({ key: "ㄹ", code: "KeyF" })).toBe("fullscreen");
    expect(keyAction({ key: "Process", code: "KeyK" })).toBe("play");
    // ASCII is taken as typed: a layout's own letter wins over the key's position.
    expect(keyAction({ key: "a", code: "KeyQ" })).toBeNull();
    expect(keyAction({ key: "Enter", code: "Enter" })).toBe("play");
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

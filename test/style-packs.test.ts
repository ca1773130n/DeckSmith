/**
 * v2 style packs: the measured faces, the type specs, and the chrome they drive.
 *
 * A pack changes what draws the text, so it changes what fits. Everything here
 * guards one of two promises: a CLASSIC theme measures and emits exactly what it
 * did before packs existed, and a PACK is measured in the face it is drawn in.
 */
import { describe, expect, it } from "vitest";
import {
  chromeCss,
  chromeHeight,
  EYEBROW_GAP,
  EYEBROW_LINE,
  EYEBROW_SIZE,
  EYEBROW_TRACKING,
  HEADLINE_H,
  HEADLINE_SIZE,
  HEADLINE_TRACKING,
} from "../src/emit/archetypes/title.js";
import { FACE_METRICS, type MeasuredFace } from "../src/emit/faces.js";
import {
  displayFace,
  type Face,
  faceOf,
  type PackFace,
  textWidth,
  typeOf,
  wrap,
} from "../src/emit/svg.js";
import { ink } from "../src/emit/theme.js";
import { CLASSIC_TYPE, em, lineBox, stackFor, TYPES, typeForStack } from "../src/emit/type.js";

/** A pack face whose Latin glyphs are `glyphs`, whatever spec carries it. */
function measuredIn(glyphs: MeasuredFace): PackFace {
  const base = faceOf(TYPES.plex?.stack ?? "") as PackFace;
  return { ...base, glyphs };
}

/* ---------------------------------------------------------------- the faces */

describe("measured Latin faces", () => {
  // Drawn by `node scripts/measure-faces.mjs` in Chrome, from the vendored
  // @fontsource-variable files, with Inter as the fallback — the same pair a
  // pack's stack declares. Re-run the script before touching a number here.
  //   [text, size, weight, drawn px per face]
  const CASES: readonly [string, number, number, Record<MeasuredFace, number>][] = [
    [
      "Reconstruction",
      64,
      700,
      { "source-serif-4": 487.14, "space-grotesk": 481.61, "ibm-plex-sans": 455.56 },
    ],
    [
      "MEASURED AGAINST THE BROWSER",
      42,
      500,
      { "source-serif-4": 742.36, "space-grotesk": 686.81, "ibm-plex-sans": 711.59 },
    ],
    [
      "Latency drops 38% at 2× throughput",
      40,
      400,
      { "source-serif-4": 682.73, "space-grotesk": 715.27, "ibm-plex-sans": 658.61 },
    ],
    [
      "Wolf Tavern — 29.88",
      40,
      600,
      { "source-serif-4": 383.94, "space-grotesk": 385.52, "ibm-plex-sans": 377.42 },
    ],
  ];

  it.each(Object.keys(FACE_METRICS) as MeasuredFace[])(
    "%s is never under what Chrome draws, and not far over",
    (glyphs) => {
      for (const [text, size, weight, drawn] of CASES) {
        const w = textWidth(text, size, weight, 0, false, measuredIn(glyphs));
        expect(w, `${glyphs} "${text}" under-predicts`).toBeGreaterThanOrEqual(drawn[glyphs]);
        expect(w / drawn[glyphs], `${glyphs} "${text}" over-predicts`).toBeLessThanOrEqual(1.08);
      }
    },
  );

  // The table, not Inter's, is what a pack face is charged. Exact, so a pack
  // that silently fell back to Inter's numbers fails here even where Inter
  // happens to be wide enough to pass the drawn-width bound above.
  it.each(Object.keys(FACE_METRICS) as MeasuredFace[])("%s charges its own table", (glyphs) => {
    const m = FACE_METRICS[glyphs];
    const text = "Wolf";
    const units = [...text].reduce((n, c) => n + (m.advance[c] ?? 0), 0);
    expect(textWidth(text, 100, 400, 0, false, measuredIn(glyphs))).toBeCloseTo(
      units * m.kernSlack * 100,
      9,
    );
    expect(textWidth(text, 100, 400, 0, false, measuredIn(glyphs))).not.toBeCloseTo(
      textWidth(text, 100, 400),
      3,
    );
  });

  it("uses a face's own weight factor", () => {
    const m = FACE_METRICS["space-grotesk"];
    const at = (w: number) =>
      textWidth("Reconstruction", 100, w, 0, false, measuredIn("space-grotesk"));
    expect(at(700) / at(400)).toBeCloseTo(m.weight[700], 9);
  });

  it("takes tabular figures from the face", () => {
    const m = FACE_METRICS["ibm-plex-sans"];
    expect(textWidth("0", 100, 400, 0, true, measuredIn("ibm-plex-sans"))).toBeCloseTo(
      m.tabularFigure * m.kernSlack * 100,
      9,
    );
  });

  it("leaves a CJK deck measured as it always was, whatever the pack", () => {
    // Noto draws every glyph of a CJK deck, Latin included, so a pack's Latin
    // face must not leak into its measurement.
    const pack = faceOf(`"Noto Sans KR", ${TYPES.serif?.stack}`);
    expect(typeof pack).toBe("object");
    for (const run of ["영상 복원 결과", "PSNR 32.1 dB", "Wolf · Tavern"]) {
      expect(textWidth(run, 40, 700, 0, false, pack)).toBe(
        textWidth(run, 40, 700, 0, false, "hangul"),
      );
    }
  });
});

/* ------------------------------------------------------------ type specs */

describe("type specs", () => {
  it("keeps classic exactly the constants title.ts has always exported", () => {
    expect(CLASSIC_TYPE.eyebrow.size).toBe(EYEBROW_SIZE);
    expect(lineBox(CLASSIC_TYPE.eyebrow.size, CLASSIC_TYPE.eyebrow.lh)).toBe(EYEBROW_LINE);
    expect(CLASSIC_TYPE.eyebrow.gap).toBe(EYEBROW_GAP);
    expect(CLASSIC_TYPE.eyebrow.tracking).toBe(EYEBROW_TRACKING);
    expect(CLASSIC_TYPE.headline.size).toBe(HEADLINE_SIZE);
    expect(CLASSIC_TYPE.headline.tracking).toBe(HEADLINE_TRACKING);
    expect(lineBox(CLASSIC_TYPE.headline.size, CLASSIC_TYPE.headline.lh)).toBe(HEADLINE_H);
  });

  it("gives every spec a stack of its own, so the stack can name the spec", () => {
    const stacks = Object.values(TYPES).map((t) => t.stack);
    expect(new Set(stacks).size).toBe(stacks.length);
    expect(stacks).not.toContain(CLASSIC_TYPE.stack);
  });

  it.each(Object.keys(TYPES))(
    "%s is found again from its own stack, plain or behind Noto",
    (key) => {
      const t = TYPES[key];
      if (!t) throw new Error(key);
      expect(typeForStack(t.stack)).toBe(t);
      expect(typeForStack(`"Noto Sans JP", ${t.stack}`)).toBe(t);
      expect(typeOf(faceOf(t.stack))).toBe(t);
      // Inter second: what measure-faces.mjs measured each face's missing glyphs in.
      expect(t.stack.split(", ").slice(0, 2)).toContain('"Inter"');
    },
  );

  it("does not mistake a stack that merely contains a spec's families for it", () => {
    expect(typeForStack(`"Comic Neue", ${TYPES.serif?.stack}`)).toBeUndefined();
    expect(faceOf('"Inter", system-ui, sans-serif')).toBe("latin");
    expect(faceOf('"Noto Sans KR", "Inter", system-ui, sans-serif')).toBe("hangul");
  });

  it.each(Object.keys(TYPES))("%s keeps audience text on the 40px floor", (key) => {
    const t = TYPES[key];
    if (!t) throw new Error(key);
    expect(t.eyebrow.size).toBeGreaterThanOrEqual(40);
    expect(t.headline.size).toBeGreaterThanOrEqual(40);
    expect(t.title.lo).toBeGreaterThanOrEqual(t.headline.size);
  });

  // `fitText` sizes the title untracked, so only a tightening is free.
  it.each(Object.keys(TYPES))("%s never tracks the title open", (key) => {
    expect(TYPES[key]?.title.tracking).toBeLessThanOrEqual(0);
  });

  it("formats tracking the way the classic stylesheet always has", () => {
    expect(em(0.14)).toBe(".14em");
    expect(em(-0.015)).toBe("-.015em");
    expect(em(0)).toBe("0");
  });

  it("orders a stack body first, Inter next, then the display face", () => {
    expect(stackFor("ibm-plex-sans", "space-grotesk")).toBe(
      '"IBM Plex Sans", "Inter", "Space Grotesk", system-ui, sans-serif',
    );
    expect(stackFor("inter", "source-serif-4")).toBe(
      '"Inter", "Source Serif 4", system-ui, sans-serif',
    );
  });
});

/* ------------------------------------------------------------------ chrome */

describe("the chrome a pack draws, and what it is charged", () => {
  const W = 1700;

  it("writes the classic chrome byte for byte", () => {
    expect(chromeCss(ink)).toBe(
      [
        ".eyebrow{font-size:42px;line-height:1.2;letter-spacing:.14em;text-transform:uppercase;color:#9aa7b5;font-weight:500;margin-bottom:22px}",
        ".headline{font-size:64px;line-height:1.15;font-weight:700;letter-spacing:-.015em;color:#e8eaed}",
      ].join("\n"),
    );
  });

  it("charges a pack's chrome at the pack's scale", () => {
    const t = TYPES["grotesk-inter"];
    if (!t) throw new Error("spec");
    const face: Face = faceOf(t.stack);
    // One line each, so the sum is exactly the pack's two line boxes and gap.
    expect(chromeHeight("Method", "Short", W, face)).toBe(
      lineBox(t.eyebrow.size, t.eyebrow.lh) +
        t.eyebrow.gap +
        lineBox(t.headline.size, t.headline.lh),
    );
    expect(chromeHeight("Method", "Short", W, face)).not.toBe(chromeHeight("Method", "Short", W));
  });

  it("measures the headline in the display face, not the body's", () => {
    const t = TYPES["grotesk-plex"];
    if (!t) throw new Error("spec");
    const face = faceOf(t.stack) as PackFace;
    expect(face.glyphs).toBe("ibm-plex-sans");
    expect((displayFace(face) as PackFace).glyphs).toBe("space-grotesk");
    // Find a measure where the two faces wrap the same headline to different
    // line counts, then hold chromeHeight to the DISPLAY face's count there.
    const head = "Reconstruction quality improves when every pass sees the whole sequence";
    const lines = (f: Face, w: number) =>
      wrap(head, t.headline.size, w, t.headline.weight, t.headline.tracking, f).length;
    const w = [...Array(600).keys()]
      .map((i) => 700 + i)
      .find((x) => lines(face, x) !== lines(displayFace(face), x));
    if (w === undefined) throw new Error("the two faces never disagree — pick another headline");
    expect(chromeHeight(undefined, head, w, face)).toBe(
      lines(displayFace(face), w) * lineBox(t.headline.size, t.headline.lh),
    );
  });

  it("keeps an eyebrow in sentence case when the spec says so, and measures it that way", () => {
    const t = TYPES.serif;
    if (!t) throw new Error("spec");
    const css = chromeCss({ ...ink, fontStack: t.stack, displayStack: t.displayStack });
    expect(css).toContain("text-transform:none");
    expect(css).toContain(`font-family:${t.displayStack};`);
    expect(css).toContain(`font-size:${t.headline.size}px`);
    // Accent, not muted: the eyebrow is this spec's colour accent.
    expect(css).toContain(`color:${ink.accent}`);
  });
});

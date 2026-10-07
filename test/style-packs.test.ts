/**
 * v2 style packs: the measured faces, the type specs, and the chrome they drive.
 *
 * A pack changes what draws the text, so it changes what fits. Everything here
 * guards one of two promises: a CLASSIC theme measures and emits exactly what it
 * did before packs existed, and a PACK is measured in the face it is drawn in.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refreshFont, vendorFace } from "../src/build/files.js";
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
import { emitComposition } from "../src/emit/composition.js";
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
import { baseCss, type DeckTheme, deckLook, ink, PACKS } from "../src/emit/theme.js";
import {
  chooseLook,
  costsNothing,
  fnv1a,
  packWeights,
  rankPacks,
} from "../src/emit/themes/pick.js";
import {
  CLASSIC_TYPE,
  em,
  familyOf,
  lineBox,
  stackFor,
  TYPES,
  typeForStack,
} from "../src/emit/type.js";
import { loadPrefs, prefsFromFlags } from "../src/prefs.js";
import { FORMATS, type Format, storyboardSchema } from "../src/types.js";
import narratedStoryboard from "./fixtures/narrated-storyboard.json" with { type: "json" };

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

  it.each(Object.keys(TYPES))("%s's one-line chrome costs no more than classic's", (key) => {
    const h = (t: typeof CLASSIC_TYPE) =>
      lineBox(t.eyebrow.size, t.eyebrow.lh) +
      t.eyebrow.gap +
      lineBox(t.headline.size, t.headline.lh);
    expect(h(TYPES[key] as typeof CLASSIC_TYPE)).toBeLessThanOrEqual(h(CLASSIC_TYPE));
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
    const t = TYPES.plex;
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

/* ------------------------------------------------------------------- packs */

describe("the v2 packs", () => {
  const names = Object.keys(PACKS);

  it("is at least five packs, both grounds twice over, each its own pairing", () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
    const grounds = names.map((n) => PACKS[n]?.ground);
    expect(grounds.filter((g) => g === "dark").length).toBeGreaterThanOrEqual(2);
    expect(grounds.filter((g) => g === "light").length).toBeGreaterThanOrEqual(2);
    const pairs = names.map((n) => typeOf(faceOf(PACKS[n]?.fontStack ?? "")).key);
    expect(new Set(pairs).size).toBe(names.length);
    expect(pairs).not.toContain("classic");
  });

  it.each(names)("%s declares its display stack as its type spec does", (name) => {
    const p = PACKS[name] as DeckTheme;
    expect(p.displayStack).toBe(typeOf(faceOf(p.fontStack)).displayStack);
  });

  /**
   * The skin rule, enforced: a property a measurement reads may not appear. An
   * absolutely positioned pseudo-element is outside the flow; `position:
   * relative` with no offset moves nothing.
   */
  const PAINT = new Set([
    "color",
    "background",
    "background-image",
    "background-size",
    "border-color",
    "border-top-color",
    "border-top-style",
    "border-radius",
    "box-shadow",
    "text-decoration",
    "text-decoration-color",
    "text-decoration-thickness",
    "text-underline-offset",
    "text-shadow",
    // Moves glyphs inside their line boxes, never a box: line counts are the same.
    "text-align",
    // Outlines are painted outside the box and take no space.
    "outline",
    "outline-offset",
    // SVG paint and corner radii: the rect's geometry is its attributes.
    "rx",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
  ]);
  const PSEUDO = new Set([
    ...PAINT,
    "content",
    "position",
    "left",
    "right",
    "top",
    "bottom",
    "width",
    "height",
    "border-top",
    "border-left",
    "border-right",
    "border-bottom",
  ]);

  it.each(names)("%s's skin paints and never moves a box", (name) => {
    const skin = (PACKS[name] as DeckTheme).skin ?? "";
    expect(skin.length).toBeGreaterThan(0);
    const rules = [...skin.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    expect(rules.length).toBe(skin.split("}").length - 1);
    for (const [, selector = "", body = ""] of rules) {
      const pseudo = /::(before|after)/.test(selector);
      const decls = body
        .split(";")
        .filter(Boolean)
        .map((d) => d.split(":")[0]?.trim() ?? "");
      for (const prop of decls) {
        const allowed = pseudo ? PSEUDO : new Set([...PAINT, "position"]);
        expect(allowed.has(prop), `${name}: ${selector.trim()} sets ${prop}`).toBe(true);
      }
      if (pseudo) expect(body, `${name}: ${selector.trim()}`).toContain("position:absolute");
      else if (decls.includes("position")) expect(body).toContain("position:relative");
    }
  });

  it("appends a pack's skin to the base stylesheet, and nothing for a classic theme", () => {
    const fmt = { id: "deck-16x9", width: 1920, height: 1080, minWeight: 0, navigable: true };
    expect(baseCss(ink, fmt)).not.toContain(".scene .eyebrow");
    const signal = PACKS.signal as DeckTheme;
    expect(baseCss(signal, fmt).endsWith(signal.skin ?? "-")).toBe(true);
  });

  it("puts a CJK deck's bundled family in front of the chrome stack too", () => {
    const { theme } = deckLook({ theme: "signal", lang: "ko" });
    expect(theme.fontStack.startsWith('"Noto Sans KR", ')).toBe(true);
    expect(theme.displayStack?.startsWith('"Noto Sans KR", ')).toBe(true);
    // And the chrome is still measured at the pack's scale, in Hangul.
    const face = faceOf(theme.fontStack) as PackFace;
    expect(face.script).toBe("hangul");
    expect(face.type).toBe(TYPES["grotesk-inter"]);
    expect(face.cjkSerif).toBeUndefined();
  });

  it("sets a serif pack's serif roles in the bundle's Noto Serif, in every CJK language", () => {
    // Review 2026-10-08: every CJK glyph fell back to Noto Sans whatever the
    // pack, so a serif pack's one change of face vanished in ko, ja and zh.
    const folio = deckLook({ theme: "folio", lang: "ko" }).theme; // serif body and display
    expect(folio.fontStack.startsWith('"Noto Serif KR", ')).toBe(true);
    expect(folio.displayStack?.startsWith('"Noto Serif KR", ')).toBe(true);
    const atlas = deckLook({ theme: "atlas", lang: "zh-Hans" }).theme; // serif display only
    expect(atlas.fontStack.startsWith('"Noto Sans SC", ')).toBe(true);
    expect(atlas.displayStack?.startsWith('"Noto Serif SC", ')).toBe(true);
    const journal = deckLook({ theme: "journal", lang: "ja" }).theme; // serif body only
    expect(journal.fontStack.startsWith('"Noto Serif JP", ')).toBe(true);
    expect(journal.displayStack?.startsWith('"Noto Sans JP", ')).toBe(true);
    // Still the pack's spec, still the script — and measured as the serif.
    const face = faceOf(folio.fontStack) as PackFace;
    expect(face.type).toBe(TYPES.serif);
    expect(face.script).toBe("hangul");
    expect(face.cjkSerif).toBe(true);
    expect((displayFace(faceOf(atlas.fontStack)) as PackFace).cjkSerif).toBe(true);
    expect((faceOf(atlas.fontStack) as PackFace).cjkSerif).toBeUndefined();
    // Hangul at Noto Serif KR's 0.966em, Han unchanged, Latin wider.
    const sans = faceOf(deckLook({ theme: "signal", lang: "ko" }).theme.fontStack);
    expect(textWidth("가나다", 100, 400, 0, false, face)).toBeGreaterThan(
      textWidth("가나다", 100, 400, 0, false, sans),
    );
    expect(textWidth("漢字", 100, 400, 0, false, faceOf(journal.fontStack))).toBeCloseTo(
      textWidth(
        "漢字",
        100,
        400,
        0,
        false,
        faceOf(deckLook({ theme: "signal", lang: "ja" }).theme.fontStack),
      ),
      6,
    );
    // Classic themes never get a serif.
    expect(
      deckLook({ theme: "paper", lang: "ko" }).theme.fontStack.startsWith('"Noto Sans KR"'),
    ).toBe(true);
  });

  it("leaves a classic theme's chrome stack absent", () => {
    expect(deckLook({ theme: "ink", lang: "ko" }).theme.displayStack).toBeUndefined();
  });
});

/* ------------------------------------------------------------------- fonts */

describe("vendored pack faces", () => {
  it.each(Object.keys(FACE_METRICS) as MeasuredFace[])(
    "%s ships beside the deck under the family its stack names",
    async (face) => {
      const dir = await mkdtemp(join(tmpdir(), "ds-face-"));
      const css = await vendorFace(face, dir);
      expect(css).toContain(`font-family: '${familyOf(face)}';`);
      expect(css).not.toContain("Variable");
      expect(css).toContain("font-display: block");
      const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] ?? "");
      expect(urls.length).toBeGreaterThan(0);
      const files = await readdir(dir);
      for (const u of urls) expect(files).toContain(u);
    },
  );

  it("declares a pack face with Inter's vertical metrics, and leaves Inter's own alone", async () => {
    const css = await vendorFace("source-serif-4", await mkdtemp(join(tmpdir(), "ds-face-")));
    const faces = css.split("@font-face").slice(1);
    expect(faces.length).toBeGreaterThan(0);
    for (const f of faces) {
      expect(f).toContain("ascent-override: 96.875%");
      expect(f).toContain("descent-override: 24.1211%");
      expect(f).toContain("line-gap-override: 0%");
    }
  });

  it("ships a pack's faces with a CJK deck too, behind its Noto bundle", async () => {
    // A cached bundle, stamped the way `bundleFont` stamps one, so this needs no
    // network: the stamp is the hash of the family and the deck's glyphs.
    const storyboard = storyboardSchema.parse({
      sourceId: "x",
      title: "t",
      lang: "ko",
      beats: [
        { id: "b1", intent: "i", archetype: "title", seconds: 4, params: { headline: "안녕" } },
      ],
    });
    const source = {
      id: "x",
      title: "t",
      lang: "ko",
      sections: [],
      figures: [],
      equations: [],
      tables: [],
    };
    const out = await mkdtemp(join(tmpdir(), "ds-f-"));
    const text = [...new Set(JSON.stringify(source) + JSON.stringify(storyboard))]
      .filter((c) => c > " ")
      .sort()
      .join("");
    const stamp = `/* decksmith ${createHash("sha256").update(`Noto Sans KR\n${text}`).digest("hex").slice(0, 16)} */`;
    await mkdir(join(out, "assets", "fonts"), { recursive: true });
    await writeFile(
      join(out, "assets", "fonts", "fonts.css"),
      `${stamp}\n@font-face { font-family: 'Noto Sans KR'; src: url(notosanskr-0.woff2); }`,
    );
    const css = await refreshFont(storyboard, source, out, () => {}, "blueprint");
    expect(css).toContain("font-family: 'Noto Sans KR'");
    expect(css).toContain("font-family: 'IBM Plex Sans';");
    const classic = await refreshFont(storyboard, source, out, () => {});
    expect(classic).not.toContain("IBM Plex Sans");
  });

  it("vendors a Latin pack's faces with Inter, and only Inter for a classic theme", async () => {
    const storyboard = storyboardSchema.parse({
      sourceId: "x",
      title: "t",
      beats: [
        { id: "b1", intent: "i", archetype: "title", seconds: 4, params: { headline: "Hi" } },
      ],
    });
    const source = {
      id: "x",
      title: "t",
      lang: "en",
      sections: [],
      figures: [],
      equations: [],
      tables: [],
    };
    const classic = await refreshFont(
      storyboard,
      source,
      await mkdtemp(join(tmpdir(), "ds-f-")),
      () => {},
    );
    expect(classic).toContain("font-family: 'Inter';");
    expect(classic).not.toContain("Space Grotesk");
    const pack = await refreshFont(
      storyboard,
      source,
      await mkdtemp(join(tmpdir(), "ds-f-")),
      () => {},
      "chalk",
    );
    expect(pack).toContain("font-family: 'Inter';");
    expect(pack).toContain("font-family: 'Space Grotesk';");
    expect(pack).toContain("font-family: 'IBM Plex Sans';");
  });
});

/* -------------------------------------------------------------------- pick */

describe("picking a pack per deck", () => {
  const board = storyboardSchema.parse(narratedStoryboard);
  const beats = board.beats;
  /** Twenty paper-like ids, fixed, so the spread below is a fact about the hash. */
  const SEEDS = Array.from({ length: 20 }, (_, i) =>
    `${(0x9e3779b1 * (i + 1)).toString(16).padStart(8, "0")}-paper-${i}`.slice(0, 24),
  );

  it("spreads twenty decks over at least three packs, none on more than 40%", () => {
    const counts: Record<string, number> = {};
    for (const s of SEEDS) {
      const p = rankPacks(beats, s)[0] ?? "";
      counts[p] = (counts[p] ?? 0) + 1;
    }
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...Object.values(counts)) / SEEDS.length).toBeLessThanOrEqual(0.4);
  });

  it("is a pure function of the beats and the seed", () => {
    expect(rankPacks(beats, "abc")).toEqual(rankPacks(beats, "abc"));
    expect(new Set(rankPacks(beats, "abc"))).toEqual(new Set(Object.keys(PACKS)));
    expect(fnv1a("hypepaper")).toBe(fnv1a("hypepaper"));
  });

  it("leans with the content: an equation deck finds the serif packs more often", () => {
    const only = (archetype: string) =>
      beats
        .filter((b) => b.archetype === archetype)
        .slice(0, 1)
        .flatMap((b) => Array(10).fill(b));
    const formal = only("equation-walk");
    const quantity = only("bar-compare");
    const share = (bs: typeof beats, pack: string) =>
      Array.from({ length: 400 }, (_, i) => rankPacks(bs, `s${i}`)[0]).filter((p) => p === pack)
        .length / 400;
    expect(share(formal, "folio")).toBeGreaterThan(share(quantity, "folio"));
    expect(share(quantity, "signal")).toBeGreaterThan(share(formal, "signal"));
    // Mild: no family hands any pack the majority.
    expect(share(formal, "folio")).toBeLessThan(0.4);
  });

  it("weighs every pack at least 1, so none is ever unreachable", () => {
    for (const w of Object.values(packWeights(beats))) expect(w).toBeGreaterThanOrEqual(1);
  });

  it("changes nothing for classic", () => {
    expect(chooseLook({ storyboard: board, design: "classic" })).toBe("ink");
    expect(chooseLook({ storyboard: { ...board, theme: "paper" }, design: "classic" })).toBe(
      "paper",
    );
  });

  it("lets a named theme or a storyboard's own theme force the look under v2", () => {
    expect(chooseLook({ stated: "mono", storyboard: board, design: "v2" })).toBe("mono");
    expect(chooseLook({ storyboard: { ...board, theme: "folio" }, design: "v2" })).toBe("folio");
  });

  it("picks the top-ranked pack under v2, by the seed when one is given", () => {
    expect(chooseLook({ storyboard: board, design: "v2" })).toBe(
      rankPacks(beats, board.sourceId)[0],
    );
    expect(chooseLook({ storyboard: board, design: "v2", seed: "p1" })).toBe(
      rankPacks(beats, "p1")[0],
    );
  });

  it("walks down the ranking past a pack the build refuses, and lands on the storyboard's own when all are", () => {
    const ranked = rankPacks(beats, board.sourceId);
    const refuse = new Set(ranked.slice(0, 2));
    expect(chooseLook({ storyboard: board, design: "v2", accepts: (n) => !refuse.has(n) })).toBe(
      ranked[2],
    );
    expect(chooseLook({ storyboard: board, design: "v2", accepts: () => false })).toBe("ink");
  });
});

describe("the design preference", () => {
  it("is unset — classic — unless asked, so an npm user's decks do not move", async () => {
    const prefs = await loadPrefs({}, await mkdtemp(join(tmpdir(), "ds-p-")));
    expect(prefs.design).toBeUndefined();
    expect(prefs.packSeed).toBeUndefined();
  });

  it("reads --design and --pack-seed, and refuses a design that does not exist", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ds-p-"));
    const prefs = await loadPrefs(prefsFromFlags({ design: "v2", packSeed: "paper-1" }), cwd);
    expect(prefs.design).toBe("v2");
    expect(prefs.packSeed).toBe("paper-1");
    await expect(loadPrefs(prefsFromFlags({ design: "v3" }), cwd)).rejects.toThrow(/design/);
  });
});

describe("a pack may cost a deck nothing", () => {
  // From a real HypePaper deck (Gen-Searcher, en, 2026-10-06), plus one bar.
  // The six-bar original is what `folio` first dropped ("need 660px of the
  // 653px"); folio's chrome has since been capped at classic's height, and at
  // seven bars the serif-bodied packs still refuse it where ink draws it.
  const tight = {
    id: "b10",
    intent: "Gen-Searcher improves overall KnowGen K-Score for three downstream image generators.",
    seconds: 15,
    archetype: "bar-compare",
    params: {
      eyebrow: "KnowGen",
      headline: "Gen-Searcher improves all three paired generators on KnowGen",
      unit: "Overall K-Score",
      bars: [
        { label: "Qwen-Image", value: 14.98, tone: "a" },
        { label: "Qwen-Image + Gen-Searcher", value: 31.52, tone: "b" },
        { label: "Seedream 4.5", value: 31.01, tone: "a" },
        { label: "Seedream 4.5 + Gen-Searcher", value: 47.29, tone: "b" },
        { label: "Nano Banana Pro", value: 50.38, tone: "a" },
        { label: "Nano Banana Pro + Gen-Searcher", value: 53.3, tone: "b" },
        { label: "FLUX.1 dev", value: 40.2, tone: "a" },
      ],
    },
  };
  const board = storyboardSchema.parse({
    sourceId: "gen-searcher",
    title: "t",
    beats: [
      { id: "b1", intent: "i", archetype: "title", seconds: 4, params: { headline: "Hi" } },
      tight,
    ],
  });
  const source = {
    id: "x",
    title: "t",
    lang: "en",
    sections: [],
    figures: [],
    equations: [],
    tables: [],
  };
  const format = FORMATS["deck-16x9"] as Format;

  it("refuses a pack that would leave out a beat the storyboard's own theme draws", () => {
    const accepts = costsNothing(board, source, format, { speed: 1 });
    expect(accepts("folio")).toBe(false);
    expect(accepts("journal")).toBe(false);
    expect(accepts("signal")).toBe(true);
  });

  it("so --design v2 never picks one, whatever the hash says", () => {
    const accepts = costsNothing(board, source, format, { speed: 1 });
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(["folio", "journal"]).not.toContain(
        chooseLook({ storyboard: board, design: "v2", seed, accepts }),
      );
    }
  });
});

/* ----------------------------------------------------------------- goldens */

/**
 * v2's own goldens: the composition each pack emits for one small deck, pinned
 * to its bytes. A change that moves one is a change to what a pack draws or how
 * it measures — re-take the digest on purpose and say so in the commit. The
 * classic golden lives in test/wiring.test.ts and is untouched by packs.
 */
describe("v2 pack goldens", () => {
  const source = {
    id: "src-g",
    title: "A source",
    lang: "en",
    sections: [{ id: "sec-1", depth: 1, heading: "One", text: "..." }],
    figures: [],
    equations: [],
    tables: [],
  };
  const deck = storyboardSchema.parse({
    sourceId: "src-g",
    title: "A deck",
    beats: [
      {
        id: "b1",
        intent: "Open.",
        archetype: "title",
        seconds: 6,
        params: {
          eyebrow: "Image generation",
          headline: "Search before you draw",
          sub: "Evidence first.",
        },
      },
      {
        id: "b2",
        intent: "Method.",
        archetype: "pipeline",
        seconds: 10,
        params: {
          eyebrow: "Method",
          headline: "Accumulated evidence decides the next search",
          stages: [{ label: "choose an action" }, { label: "use a tool" }, { label: "interpret" }],
        },
      },
      {
        id: "b3",
        intent: "Result.",
        archetype: "bar-compare",
        seconds: 10,
        params: {
          eyebrow: "KnowGen",
          headline: "Search lifts every generator",
          unit: "K-Score",
          bars: [
            { label: "Qwen-Image", value: 14.98, tone: "a" },
            { label: "Qwen-Image + Gen-Searcher", value: 31.52, tone: "b" },
          ],
        },
      },
    ],
  });
  // Re-pinned 2026-10-08 (review fix round): each pack now draws its own bar
  // corners and tracks and its own title composition, in the skin.
  const GOLDEN: Record<string, string> = {
    atlas: "a26d28ef7432e965a75e8c50e4aa3241afde8328ff237de21049a3d50a683883",
    blueprint: "b27c387005b3e644f6689307f8c358b81944327605c3439bec5c78b8150e993a",
    chalk: "b8eca602cbc18709cc2aa7f49d06debe28ec857a5164e499477810f8fcde695d",
    folio: "16abedfe97c79b103947ec741de6349e3852e8d9f5e74d51b56e1695117ff4b8",
    journal: "95d87eec6733a5bf129925f2184eeca2bdecd3033b72dcda71d8416b2e0f87c9",
    signal: "3c3bff1ff0d8583588460c02cc557cf61895737862f119979f1adcb7cc4c91d1",
  };

  it.each(Object.keys(PACKS))("%s emits the composition it emitted when pinned", (name) => {
    const html = emitComposition(deck, source, FORMATS["deck-16x9"] as Format, { theme: name });
    const digest = createHash("sha256").update(html).digest("hex");
    expect(digest).toBe(GOLDEN[name]);
  });
});

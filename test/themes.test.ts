import { describe, expect, it } from "vitest";
import { isPortrait, title } from "../src/emit/archetypes/title.js";
import type { EmitContext, Scene, Tween } from "../src/emit/kit.js";
import {
  contentH,
  contentW,
  fromTo,
  raw,
  refHeight,
  refWidth,
  tweenText,
  zoomOf,
} from "../src/emit/kit.js";
import {
  baseCss,
  type DeckTheme,
  ink,
  pace,
  resolveTheme,
  THEME_NAMES,
  THEMES,
} from "../src/emit/theme.js";
import { type Beat, beatSchema, FORMATS, type Format, type Source } from "../src/types.js";

const format: Format = {
  id: "deck-16x9",
  width: 1920,
  height: 1080,
  minWeight: 0,
  navigable: true,
};

const source: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [],
  equations: [],
  tables: [],
};

const beat = beatSchema.parse({
  id: "b1",
  archetype: "title",
  intent: "open",
  params: { eyebrow: "Section 1", headline: "A headline", sub: "And a subtitle" },
  seconds: 8,
}) as Beat & { archetype: "title" };

function scene(theme: DeckTheme, sid = "s1"): Scene {
  const ctx: EmitContext = { source, format, theme, sid };
  return title(beat, ctx);
}

/* ------------------------------------------------------------- WCAG helpers */

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ------------------------------------------------------------------ Registry */

describe("theme registry", () => {
  it("holds the three themes, sorted", () => {
    expect(THEME_NAMES).toEqual(["ink", "mono", "paper"]);
  });

  it("resolves by name and names the alternatives when it cannot", () => {
    expect(resolveTheme("paper")).toBe(THEMES.paper);
    expect(() => resolveTheme("Ink")).toThrow(/unknown theme "Ink" — known: ink, mono, paper/);
  });

  // An unset field reads as `undefined` in a template literal and paints the
  // word "undefined" into the stylesheet, which lints and renders clean.
  it.each(THEME_NAMES)("%s defines every field", (name) => {
    const t = THEMES[name] as DeckTheme;
    for (const key of ["bg", "fg", "muted", "dim", "rule", "panel", "accent"] as const) {
      expect(t[key], `${name}.${key}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const key of ["a", "b", "c", "d"] as const) {
      expect(t.tones[key], `${name}.tones.${key}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(t.fontStack).toContain("Inter");
  });

  it.each(THEME_NAMES)("%s keeps its four tones pairwise distinct", (name) => {
    const tones = Object.values((THEMES[name] as DeckTheme).tones);
    expect(new Set(tones).size).toBe(4);
  });

  // The contrast gate is the one that fails a light theme, and it fails it at
  // `check` time on a built deck — far too late. 4.5:1 on the ground is AA for
  // body text; the panel is held to AA-large, because invariant 4 puts a floor
  // of 40px under every run of audience text and 40px is large text twice over.
  // `ink` sits at 4.38 for `dim` on `panel` and has always shipped that way.
  it.each(THEME_NAMES)("%s clears WCAG AA on its own ground", (name) => {
    const t = THEMES[name] as DeckTheme;
    const inks = [t.fg, t.muted, t.dim, t.accent, ...Object.values(t.tones)];
    for (const c of inks) {
      expect(contrast(c, t.bg), `${name}: ${c} on bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, t.panel), `${name}: ${c} on panel`).toBeGreaterThanOrEqual(3);
    }
  });

  // Encoded by hue in ink and paper, by value in mono — either way four
  // highlights an audience can tell apart. Three ways to be different is not
  // three chances to pass: a pair alike in all three is genuinely one colour.
  it.each(THEME_NAMES)("%s keeps its tones tellable apart", (name) => {
    const tones = Object.values((THEMES[name] as DeckTheme).tones);
    for (const [i, x] of tones.entries()) {
      for (const y of tones.slice(i + 1)) {
        const separated =
          contrast(x, y) >= 1.7 || hueGap(x, y) >= 25 || Math.abs(chroma(x) - chroma(y)) >= 0.25;
        expect(separated, `${name}: ${x} vs ${y}`).toBe(true);
      }
    }
  });
});

/** Degrees between two hex colours on the hue wheel. Meaningless for a grey. */
function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

/** 0 for any grey, 1 for a pure hue — how `mono`'s one red parts from its ladder. */
function chroma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(...v) - Math.min(...v)) / 255;
}

function hue(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

/* ---------------------------------------------------------- ink, unchanged */

describe("ink", () => {
  // Frozen. Every render this project has compared against came out of these
  // numbers, so a nicer blue is a broken regression test, not a refactor.
  it("is exactly the palette it has always been", () => {
    expect(ink).toEqual({
      bg: "#0b0d10",
      fg: "#e8eaed",
      muted: "#9aa7b5",
      dim: "#74808e",
      rule: "#2b333d",
      panel: "#16191e",
      accent: "#3d8bfd",
      tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
      fontStack: '"Inter", system-ui, sans-serif',
    });
  });

  it("emits the same base stylesheet as before the registry", () => {
    const css = baseCss(ink, format);
    expect(css).toContain("background: #0b0d10;");
    expect(css).toContain(
      'body { font-family: "Inter", system-ui, sans-serif; color: #e8eaed; font-weight: 400; }',
    );
  });

  it("emits the same scene as before for a known beat", () => {
    const s = scene(ink);
    // Deliberately the SERIALISED text, not the objects: this is the byte-level
    // pin that the vocabulary refactor moved nothing, and it is the assertion
    // the whole seam is checked against.
    expect(s.tl.map(tweenText)).toEqual([
      'tl.fromTo("#s1-e", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6 }, 0.2);',
      'tl.fromTo("#s1-t", { opacity: 0, y: 38 }, { opacity: 1, y: 0, duration: 0.9 }, 0.4);',
      'tl.fromTo("#s1-s", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7 }, 1);',
    ]);
    expect(s.holds).toEqual([1.9]);
    expect(s.css).toContain("color:#e8eaed");
    expect(s.css).toContain("color:#9aa7b5");
  });
});

/* --------------------------------------------------------- Reference space */

describe("reference space", () => {
  const short = FORMATS["short-9x16"] as Format;
  const square = FORMATS["post-1x1"] as Format;

  it("is exactly identity on the reference canvas, so 16:9 emits no scaling rule", () => {
    // The load-bearing property of this whole design. `deck-16x9` and
    // `video-16x9` are what ships, and they have to be byte-identical to every
    // deck built before reference space existed — which they are only if the
    // stylesheet gains nothing at all. An `if` in `baseCss`, not arithmetic that
    // happens to round back to 1.
    expect(zoomOf(format)).toBe(1);
    expect(refWidth(format)).toBe(1920);
    expect(refHeight(format)).toBe(1080);
    expect(baseCss(ink, format)).not.toContain("zoom");
    expect(contentW(format)).toBe(1700);
    expect(contentH(format)).toBe(912);
  });

  it("keeps the TARGET's aspect ratio, so isPortrait still answers", () => {
    // Reference space is a change of unit, never a change of shape. If the
    // reference canvas were 16:9 whatever the target, every `isPortrait` branch
    // in the vocabulary would take the landscape arrangement and then be
    // squeezed into a phone.
    expect(refWidth(short) / refHeight(short)).toBeCloseTo(1080 / 1920, 6);
    expect(refWidth(square) / refHeight(square)).toBeCloseTo(1, 6);
    expect(isPortrait(short)).toBe(true);
    expect(isPortrait(square)).toBe(false);
  });

  it("scales the scene onto the canvas exactly, leaving no strip of background", () => {
    // `width x zoom` has to land ON the canvas edge. A reference width that
    // rounded the wrong way would leave a sliver of `theme.bg` down one side —
    // the same colour as the deck, so nothing would ever report it.
    for (const f of [short, square]) {
      expect(refWidth(f) * zoomOf(f)).toBe(f.width);
      expect(Math.abs(refHeight(f) * zoomOf(f) - f.height)).toBeLessThan(1);
    }
  });

  it("gives a narrow canvas a bigger box in reference px than it has in canvas px", () => {
    // The point of the exercise. 1220 reference px against a 1080px canvas is
    // where the extra table rows and pipeline stages come from: the type scale
    // is unchanged in reference px and therefore smaller on screen.
    expect(contentW(short)).toBeGreaterThan(short.width);
    expect(contentH(short)).toBeGreaterThan(short.height);
  });

  it("makes a scene that contains a scene a pass-through, for the camera's sake", () => {
    // `rigHtml` nests a second `.scene` and the camera pans the rig between them
    // by a CANVAS-px distance it measured with getBoundingClientRect. Inside the
    // scaled subtree that pan lands short by the scale factor. The rule names no
    // camera class, so a camera-free deck still carries no camera CSS.
    const css = baseCss(ink, short);
    expect(css).toContain(`.scene { width: ${refWidth(short)}px`);
    expect(css).toContain(`zoom: ${zoomOf(short)};`);
    expect(css).toContain(".scene:has(.scene) { width: 100%; height: 100%; padding: 0; zoom: 1; }");
    expect(css).not.toContain("ds-zoom");
    expect(css).not.toContain("ds-pan");
    expect(css).not.toContain("ds-plate");
  });
});

/* ------------------------------------------------------------------ Pacing */

describe("pace", () => {
  it("is identity at 1, by construction", () => {
    const s = scene(ink);
    expect(pace(s, 1)).toBe(s);
  });

  it("halves a tween duration, its position, and the hold that follows it", () => {
    const s = scene(ink);
    const half = pace(s, 0.5);

    // The subtitle enters at 1.0 for 0.7s, ending at 1.7; the hold is at 1.9.
    expect(half.tl[2]).toEqual({
      target: "#s1-s",
      from: { opacity: 0, y: 22 },
      to: { opacity: 1, y: 0, duration: 0.35 },
      at: 0.5,
    });
    expect(half.holds).toEqual([0.95]);
  });

  it("doubles them the same way", () => {
    const doubled = pace(scene(ink), 2);
    expect(doubled.tl[1]).toEqual({
      target: "#s1-t",
      from: { opacity: 0, y: 38 },
      to: { opacity: 1, y: 0, duration: 1.8 },
      at: 0.8,
    });
    expect(doubled.holds).toEqual([3.8]);
  });

  it("keeps the hold on the tween it belongs to", () => {
    for (const speed of [0.25, 0.5, 0.8, 1.5, 3]) {
      const paced = pace(scene(ink), speed);
      const last = paced.tl[2] as Tween;
      // Authored as "0.2s after the last entrance settles"; that gap scales too.
      expect((paced.holds[0] ?? 0) - (last.at + (last.to.duration as number))).toBeCloseTo(
        0.2 * speed,
        6,
      );
    }
  });

  it("scales times and leaves geometry alone", () => {
    const s: Scene = {
      html: "",
      holds: [1],
      tl: [
        fromTo(
          "#s1 .row",
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.45, stagger: 0.16, ease: "power2.out" },
          1.2,
        ),
        fromTo(
          "#s1 .cell",
          { opacity: 0, scale: 0.9 },
          { opacity: 1, scale: 1, duration: 0.35, stagger: { amount: 0.55, grid: [3, 4] } },
          0.8,
        ),
      ],
    };
    const half = pace(s, 0.5);
    // y, scale and the grid dimensions are geometry — untouched. `ease` is a
    // string and `grid` an array, so this also pins that the recursion stops
    // where it should.
    expect(half.tl[0]).toEqual({
      target: "#s1 .row",
      from: { opacity: 0, y: 24 },
      to: { opacity: 1, y: 0, duration: 0.225, stagger: 0.08, ease: "power2.out" },
      at: 0.6,
    });
    expect(half.tl[1]).toEqual({
      target: "#s1 .cell",
      from: { opacity: 0, scale: 0.9 },
      to: { opacity: 1, scale: 1, duration: 0.175, stagger: { amount: 0.275, grid: [3, 4] } },
      at: 0.4,
    });
  });

  it("leaves the input scene untouched", () => {
    // It used to rewrite strings, which are immutable and so could not be got
    // wrong. Vars are objects, and a pace that mutated them would corrupt the
    // measuring pass's scenes — `planCut` paces every beat before the real
    // layout paces it again.
    const s = scene(ink);
    const before = JSON.stringify(s);
    pace(s, 0.5);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("prints no float dust", () => {
    for (const speed of [0.25, 0.3, 0.7, 1.1, 2.5]) {
      for (const t of pace(scene(ink), speed).tl) {
        const line = tweenText(t);
        expect(line, line).not.toMatch(/\d\.\d{5,}/);
      }
    }
  });
});

/* ------------------------------------------------------- the serialiser */

describe("the tween type", () => {
  it("makes invariant 2 a type error rather than a review question", () => {
    // Checked by `tsc`, not by vitest: an unused `@ts-expect-error` is itself
    // an error, so this line fails the type floor the day `Scene.tl` goes back
    // to accepting hand-written GSAP. `from()` had no shape to be written in
    // once `Tween` required `from`; a raw string was the way round it.
    const s: Scene = {
      html: "",
      holds: [],
      // @ts-expect-error a timeline entry is a Tween, never GSAP source text
      tl: ['tl.from("#s1 .x", { opacity: 0, duration: 0.4 });'],
    };
    expect(s.tl).toHaveLength(1);
  });
});

describe("tweenText", () => {
  it("is the only place a tween becomes GSAP text, and writes fromTo", () => {
    expect(tweenText(fromTo("#s1 .x", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 1.2))).toBe(
      'tl.fromTo("#s1 .x", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 1.2);',
    );
  });

  it("always writes a position argument", () => {
    // This replaces "does not invent a position argument where there was none",
    // which existed because `pace` recovered the position with a regex and a
    // statement might not have carried one. `at` is a required field now, so
    // the case it guarded against cannot be written down.
    for (const at of [0, 0.5, 12.75]) {
      expect(tweenText(fromTo("#s1 .x", {}, { opacity: 1 }, at))).toContain(`, ${at});`);
    }
  });

  it("quotes strings, prints raw() as code, and nests", () => {
    // `ease: "dsZoomLazy"` is a GSAP ease NAME that does not exist; GSAP would
    // fall back to its default curve with every gate green. So the difference
    // between data and code is spelled at the call site.
    expect(
      tweenText(
        fromTo(
          "#s1 .z",
          { scale: 1 },
          {
            scale: raw("function () { return dsFrame().k; }"),
            ease: raw("dsZoomLazy"),
            snap: { textContent: 0.01 },
            stagger: { amount: 0.55, grid: [3, 4], from: "start" },
            immediateRender: false,
          },
          9,
        ),
      ),
    ).toBe(
      'tl.fromTo("#s1 .z", { scale: 1 }, { scale: function () { return dsFrame().k; }, ' +
        "ease: dsZoomLazy, snap: { textContent: 0.01 }, " +
        'stagger: { amount: 0.55, grid: [3, 4], from: "start" }, immediateRender: false }, 9);',
    );
  });
});

/**
 * A figure that owns the frame.
 *
 * What a stage beat promises, asserted on what it emits: the media fills the
 * scene edge to edge (cover-fit, no plate, no border, no column), a piece's
 * canvas is the frame rather than the figure's box, the words sit over a scrim
 * sized from their own measured height, nothing is set below the 40px floor
 * (too much text is refused, never shrunk), and the one stop lands after the
 * words and any piece have finished. Whether the scrim actually clears contrast
 * on a real picture is the browser's business — `hyperframes check` on a built
 * deck — and is not claimed here.
 */
import { describe, expect, it } from "vitest";
import { stage } from "../src/emit/archetypes/stage.js";
import { emitComposition } from "../src/emit/composition.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { PAD_X, PAD_Y, refHeight, refWidth, reserveRef, tweenText } from "../src/emit/kit.js";
import { ENTRANCES, restyleEntrance } from "../src/emit/motion.js";
import { MIN_FONT } from "../src/emit/svg.js";
import {
  type BeatOf,
  FORMATS,
  type Format,
  type Source,
  STAGE_PLACEMENTS,
  sourceSchema,
  stageParamsSchema,
  storyboardSchema,
} from "../src/types.js";

const theme: Theme = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#b8c4d2",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif',
};

const source: Source = sourceSchema.parse({
  id: "src",
  title: "A product",
  lang: "en",
  sections: [],
  figures: [
    { id: "f-ui", src: "ui.png", caption: "The editor, open", width: 2400, height: 1350 },
    { id: "f-small", src: "small.jpg", caption: "A thumbnail", width: 640, height: 360 },
    {
      id: "f-piece",
      kind: "piece",
      src: "pieces/garden.js",
      caption: "The moon becomes the sun",
      width: 1600,
      height: 900,
      seconds: 6,
    },
    {
      id: "f-clip",
      kind: "clip",
      src: "clip.mp4",
      poster: "clip.jpg",
      caption: "A walkthrough",
      width: 1920,
      height: 1080,
      seconds: 8,
    },
  ],
  equations: [],
  tables: [],
});

const deck16 = FORMATS["deck-16x9"] as Format;
const ctx = (format: Format = deck16): EmitContext => ({
  source,
  format,
  theme,
  sid: "s4",
  start: 12,
});
type Stage = BeatOf<"stage">;
const beat = (params: Partial<Stage["params"]> = {}, seconds = 8): Stage => ({
  id: "b4",
  intent: "Show it.",
  weight: 0.8,
  seconds,
  evidence: [],
  archetype: "stage",
  params: {
    headline: "The editor is the product",
    figureId: "f-ui",
    placement: "bottom-left",
    ...params,
  },
});

/** Every `font-size:Npx` the scene's stylesheet sets. */
const fontSizes = (css: string) => [...css.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));

describe("stage", () => {
  it("covers the frame with the figure: no plate, no border, no column", () => {
    const scene = stage(beat(), ctx());
    expect(scene.html).toContain(
      '<div class="stg-m" id="s4-m" data-layout-allow-overflow><div class="stg-mi" id="s4-mi"><img src="assets/ui.png" alt="The editor, open" /></div></div>',
    );
    const css = scene.css ?? "";
    // Absolute against `.scene`, so its padding never reaches the picture, and
    // cover-fit, so the frame is filled at the figure's own aspect.
    expect(css).toContain(".stg-m,.stg-scrim{position:absolute;left:0;top:0;right:0;bottom:0px}");
    expect(css).toContain(
      ".stg-mi>img,.stg-mi>video,.stg-mi>canvas{display:block;width:100%;height:100%;object-fit:cover}",
    );
    // None of claim-figure's furniture.
    expect(scene.html).not.toMatch(/figwrap|caption|claim|headline/);
    expect(css).not.toMatch(/border|border-radius/);
  });

  it("draws a piece on a canvas the size of the frame, played by the dsAnimate tween", () => {
    const scene = stage(beat({ figureId: "f-piece", placement: "top-left" }), ctx());
    // The FRAME's pixels, not the figure's 1600x900: the kit lays out by LX/LY.
    expect(scene.html).toContain(
      '<canvas id="s4-pc" data-ds-piece width="1920" height="1080" role="img" aria-label="The moon becomes the sun"></canvas><script src="assets/pieces/garden.js"></script>',
    );
    expect(scene.plugins).toEqual(["dsAnimate"]);
    expect(scene.measure).toEqual([
      'DSAnimate.mount(document.getElementById("s4-pc"), "f-piece", { seconds: 6, fps: 30, hand: "\\"Inter\\", system-ui, sans-serif" })',
    ]);
    const code = scene.tl.map(tweenText).join("\n");
    expect(code).toContain(
      'tl.fromTo("#s4-pc", { dsAnimate: 0 }, { dsAnimate: 6, duration: 6, ease: "none" }, 1);',
    );
    // No drift on a canvas: a scaled canvas is a blurred one.
    expect(code).not.toContain("#s4-m canvas");
  });

  it("sizes a piece's canvas to a portrait frame too, and leaves a caption reserve clear", () => {
    const short = { ...(FORMATS["short-9x16"] as Format), captionReserve: 300 };
    const scene = stage(beat({ figureId: "f-piece" }), ctx(short));
    expect(scene.html).toContain(`width="${short.width}" height="${short.height - 300}"`);
    // The box stops above the reserve, in the scene's reference px.
    expect(scene.css).toMatch(/\.stg-m,\.stg-scrim\{[^}]*bottom:[1-9]\d*px\}/);
  });

  it("plays a clip it holds on the deck's clock, and fills the frame with it", () => {
    const scene = stage(beat({ figureId: "f-clip" }), ctx());
    expect(scene.html).toContain(
      '<video id="s4-v" src="assets/clip.mp4" poster="assets/clip.jpg" data-start="12" preload="auto" playsinline muted></video>',
    );
  });

  it.each(STAGE_PLACEMENTS.filter((p) => p !== "none"))(
    "sets the words %s over a scrim, white, never under 40px",
    (placement) => {
      const scene = stage(beat({ placement, line: "Everything else is a panel" }), ctx());
      expect(scene.html).toContain(`<div class="stg-t stg-${placement}" id="s4-t">`);
      expect(scene.html).toContain('<h2 class="stg-h" id="s4-h">The editor is the product</h2>');
      expect(scene.html).toContain('<p class="stg-l" id="s4-l">Everything else is a panel</p>');
      const css = scene.css ?? "";
      // The scrim reaches a solid black at the alpha the contrast argument rests on.
      expect(css).toMatch(/#s4 \.stg-scrim\{background:linear-gradient\([^}]*rgba\(0,0,0,0\.66\)/);
      expect(css).toContain("color:#fff");
      const sizes = fontSizes(css);
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(MIN_FONT);
    },
  );

  it("grows the scrim with the text it sits under", () => {
    const solid = (css: string) =>
      Number(/rgba\(0,0,0,0\.66\) (\d+)px,rgba\(0,0,0,0\)/.exec(css)?.[1]);
    const one = stage(beat({ headline: "Short" }), ctx()).css ?? "";
    const three =
      stage(
        beat({ headline: "A much longer headline that has to wrap over more than one line here" }),
        ctx(),
      ).css ?? "";
    expect(solid(three)).toBeGreaterThan(solid(one));
  });

  it("draws the picture alone under placement none", () => {
    const scene = stage(beat({ placement: "none", line: "never drawn" }), ctx());
    expect(scene.html).not.toContain("stg-t");
    expect(scene.html).not.toContain("stg-scrim");
    expect(scene.html).not.toContain("never drawn");
    expect(scene.css).not.toMatch(/font-size/);
    // The stop waits only for the picture to land.
    expect(scene.holds).toEqual([1.1]);
  });

  it("refuses text the overlay cannot hold even across the full width, rather than shrinking it", () => {
    const long = "word ".repeat(40).trim();
    expect(() => stage(beat({ placement: "right", headline: long }), ctx())).toThrow(
      /stage b4: the headline sets on \d+ lines in the right column at 72px, and the overlay holds 3 even across the full width/,
    );
    expect(() => stage(beat({ line: long }), ctx())).toThrow(
      /stage b4: the line sets on \d+ lines in the bottom-left column at 44px, and the overlay holds 2 even across the full width/,
    );
    // Under none nothing is set, so nothing is refused.
    expect(() => stage(beat({ placement: "none", headline: long }), ctx())).not.toThrow();
  });

  /**
   * THE PLANNER IS TOLD A HEADLINE MAY RUN TO 80 CHARACTERS (RULE 5), and a
   * refused stage is a slide `build` leaves out of the deck. `right`'s 0.42
   * column set a 61-character headline on four lines at 16:9, and at 1:1 refused
   * 36 characters. Words too long for their column take a wider one instead —
   * said, as a warning — so no headline inside the planner's budget loses the slide.
   */
  it("widens the column for words its placement cannot hold, in every format, and says so", () => {
    const headline = "The editor keeps every change you make in one shared timeline, live"; // 68
    const line = "Every change is kept, in order, for everyone";
    for (const id of Object.keys(FORMATS)) {
      const format = FORMATS[id] as Format;
      for (const placement of STAGE_PLACEMENTS.filter((p) => p !== "none")) {
        const at = `${id} ${placement}`;
        const scene = stage(beat({ placement, headline, line }), ctx(format));
        const col = Number(/#s4 \.stg-t\{max-width:(\d+)px/.exec(scene.css ?? "")?.[1]);
        expect(col, at).toBeLessThanOrEqual(refWidth(format) - 2 * PAD_X);
      }
    }
    // The case that used to be refused: wider than right's own 714px, and warned.
    const scene = stage(beat({ placement: "right", headline }), ctx());
    expect(Number(/#s4 \.stg-t\{max-width:(\d+)px/.exec(scene.css ?? "")?.[1])).toBe(1054);
    expect(scene.warnings).toEqual([
      "the words do not fit the right column in 3 headline and 2 line lines, so they take a 62% column and cover more of the picture — shorten them to keep it",
    ]);
    // Words that fit keep their placement's own column, unwarned.
    const fits = stage(beat({ placement: "right", headline: "The editor is it" }), ctx());
    expect(fits.css).toContain("#s4 .stg-t{max-width:714px;align-self:flex-end}");
    expect(fits.warnings).toBeUndefined();
  });

  /**
   * WHERE THE SCRIM IS, held against where the words are — evaluated, not
   * string-matched, so a gradient pointed the wrong way, a band centred on the
   * wrong row or a block moved to the other end fails here instead of shipping
   * white text over an unscrimmed picture with every other case green.
   *
   * Three claims, at every placement and format: every corner of the words'
   * column is under the full 0.66; the picture is CLEAR away from the words on
   * any axis the frame has room on (a full-width band dimmed the sun the 16:9
   * headline named, and at 9:16 `right` put 96% of the frame under 0.66); and
   * the block's own CSS puts it at the corner the scrim assumes.
   */
  describe("puts the scrim where the words are, and nowhere else", () => {
    /** Alpha of a `linear-gradient(to <side>, color Npx, ...)` at `pos` px along it. */
    const along = (gradient: string, pos: number): number => {
      const stops = [...gradient.matchAll(/(rgba\(0,0,0,([\d.]+)\)|#000) (-?\d+)px/g)].map((m) => ({
        a: m[2] === undefined ? 1 : Number(m[2]),
        at: Number(m[3]),
      }));
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) throw new Error(`no stops in ${gradient}`);
      if (pos <= first.at) return first.a;
      if (pos >= last.at) return last.a;
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (a && b && pos <= b.at) return a.a + ((b.a - a.a) * (pos - a.at)) / (b.at - a.at || 1);
      }
      return last.a;
    };
    /** Position of (x, y) along a gradient's direction, in a w x h box. */
    const offset = (g: string, x: number, y: number, w: number, h: number): number => {
      const dir = /linear-gradient\(to (top|bottom|left|right),/.exec(g)?.[1];
      if (dir === "top") return h - y;
      if (dir === "bottom") return y;
      if (dir === "left") return w - x;
      if (dir === "right") return x;
      throw new Error(`no direction in ${g}`);
    };
    const scrimOf = (css: string) => {
      const bg = /#s4 \.stg-scrim\{background:(linear-gradient\([^)]*(?:\)[^)]*)*?\));/.exec(
        css,
      )?.[1];
      const mask = /;mask-image:(linear-gradient\(.*?\))\}/.exec(css)?.[1];
      if (!bg || !mask) throw new Error(`no scrim in ${css}`);
      return { bg, mask };
    };

    const BLOCKS = {
      "bottom-left": "margin-top:auto;align-self:flex-start",
      "top-left": "margin-bottom:auto;align-self:flex-start",
      center: "align-self:center;text-align:center",
      right: "align-self:flex-end",
    } as const;
    const cases = Object.keys(FORMATS).flatMap((id) =>
      (Object.keys(BLOCKS) as (keyof typeof BLOCKS)[]).map((p) => [id, p] as const),
    );

    it.each(cases)("%s, %s", (id, placement) => {
      const format = { ...(FORMATS[id] as Format), captionReserve: 120 };
      const css = stage(beat({ placement, headline: "Short" }), ctx(format)).css ?? "";
      const { bg, mask } = scrimOf(css);
      const w = refWidth(format);
      const h = refHeight(format) - reserveRef(format);
      const alpha = (x: number, y: number) =>
        along(bg, offset(bg, x, y, w, h)) * along(mask, offset(mask, x, y, w, h));

      // The block the scrim must be under: one 72px line, its column's extent.
      const col = Number(/#s4 \.stg-t\{max-width:(\d+)px/.exec(css)?.[1]);
      const textH = Math.round(72 * 1.12);
      const portrait = format.height > format.width;
      const [x0, x1] =
        placement === "right"
          ? [w - PAD_X - col, w - PAD_X]
          : placement === "center"
            ? [w / 2 - col / 2, w / 2 + col / 2]
            : [PAD_X, PAD_X + col];
      const [y0, y1] =
        placement === "bottom-left"
          ? [h - PAD_Y - textH, h - PAD_Y]
          : placement === "top-left"
            ? [PAD_Y, PAD_Y + textH]
            : [h / 2 - textH / 2, h / 2 + textH / 2];
      for (const [x, y] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ] as const) {
        expect(alpha(x, y), `corner (${x}, ${y})`).toBeCloseTo(0.66, 6);
      }

      // Clear away from the words, wherever the frame has the room.
      const mid = (y0 + y1) / 2;
      const clear: [number, number][] = [];
      if (placement === "bottom-left") clear.push([x0, 0]);
      if (placement === "top-left") clear.push([x0, h - 1]);
      if (placement === "right" || placement === "center") clear.push([x1, 0], [x1, h - 1]);
      if (!portrait && (placement === "bottom-left" || placement === "top-left")) {
        clear.push([w - 1, mid]);
      }
      if (!portrait && placement === "right") clear.push([0, mid]);
      for (const [x, y] of clear) expect(alpha(x, y), `clear at (${x}, ${y})`).toBe(0);

      // And the block sits where all of the above assumed it does.
      const block = /#s4 \.stg-t\{max-width:\d+px;([^}]*)\}/.exec(css)?.[1];
      expect(block).toBe(
        placement === "right" && portrait ? `${BLOCKS.right};text-align:right` : BLOCKS[placement],
      );
      if (portrait) expect(col).toBe(w - 2 * PAD_X);
    });
  });

  it("enters the media first, then the words, every tween a fromTo scoped to the scene", () => {
    const scene = stage(beat({ line: "l" }), ctx());
    const code = scene.tl.map(tweenText);
    expect(code[0]).toBe(
      'tl.fromTo("#s4-mi", { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 1.1, ease: "power2.out" }, 0);',
    );
    const at = (sel: string) => scene.tl.find((t) => t.target === sel)?.at ?? Number.NaN;
    expect(at("#s4-h")).toBeGreaterThan(at("#s4-mi"));
    expect(at("#s4-l")).toBeGreaterThan(at("#s4-h"));
    for (const t of scene.tl) expect(t.target.startsWith("#s4")).toBe(true);
    expect(code.join("\n")).not.toMatch(/\bon(Update|Start|Complete)\b/);
  });

  /**
   * THE CLIPPING BOX NEVER MOVES. It is anchored `reserveRef` above the bottom
   * edge, and `overflow:hidden` clips its children, not its own transform: a
   * 1.06 entrance on the box itself put 49 canvas px of picture into a 9:16
   * caption reserve for the first second of every stage, where the stop-time
   * `ink_in_caption_reserve` gate never looks. Under v2 the entrance is
   * revoiced (`rise` drops 22px), so the claim is checked for every verb.
   */
  it("moves only what the box clips, under every entrance verb", () => {
    const short = { ...(FORMATS["short-9x16"] as Format), captionReserve: 300 };
    const scene = stage(beat({ line: "l" }), ctx(short));
    expect(scene.html).toMatch(/<div class="stg-m" id="s4-m"[^>]*><div class="stg-mi" id="s4-mi">/);
    for (const s of [scene, ...ENTRANCES.map((v) => restyleEntrance(scene, "s4", v))]) {
      expect(s.tl.filter((t) => t.target === "#s4-m")).toEqual([]);
    }
  });

  it("holds after the words have entered, and after a piece's last frame", () => {
    // 0.9 + 0.7 for the headline, 1.3 + 0.6 for the line: in by 1.9, held at 2.1.
    expect(stage(beat({ line: "l" }), ctx()).holds).toEqual([2.1]);
    // 1s in + 6s of piece + 0.3s of its last frame.
    expect(stage(beat({ figureId: "f-piece" }), ctx()).holds).toEqual([7.3]);
    // Inside the slide window, always.
    expect(() => stage(beat({ figureId: "f-piece" }, 7), ctx())).toThrow(
      /stage b4: piece "f-piece" plays 6s from 1s and holds 0.3s, which needs 7.3s, and the beat is 7s/,
    );
  });

  it("says when a raster figure is drawn soft or cropped hard", () => {
    expect(stage(beat(), ctx()).warnings).toBeUndefined();
    expect(stage(beat({ figureId: "f-small" }), ctx()).warnings).toEqual([
      'figure "f-small" (640x360) fills the frame at 3.00x with 0% cropped — a stage wants a picture near the frame\'s shape and size',
    ]);
  });

  it("refuses a figure the source does not have", () => {
    expect(() => stage(beat({ figureId: "nope" }), ctx())).toThrow(
      /stage b4: no figure "nope" in source src/,
    );
  });

  it("takes only the placements it has a scrim for", () => {
    expect(() =>
      stageParamsSchema.parse({ headline: "H", figureId: "f", placement: "bottom-right" }),
    ).toThrow();
    expect(() => stageParamsSchema.parse({ headline: "H", figureId: "f" })).toThrow();
  });

  it("takes a brief in place of a figure, and refuses to draw one not yet generated", () => {
    const illustration = { prompt: "a wide valley at dawn", caption: "A valley" };
    expect(() =>
      stageParamsSchema.parse({ headline: "H", illustration, placement: "center" }),
    ).not.toThrow();
    // Neither a figure nor a brief is nothing to draw.
    expect(() => stageParamsSchema.parse({ headline: "H", placement: "center" })).toThrow(
      /stage needs a figureId or an illustration/,
    );
    const { figureId: _none, ...rest } = beat().params;
    expect(() => stage({ ...beat(), params: { ...rest, illustration } }, ctx())).toThrow(
      "stage b4: illustration not generated — run `decksmith illustrate`",
    );
  });

  it("shares the deck's one piece with claim-figure, naming both", () => {
    const board = storyboardSchema.parse({
      sourceId: "src",
      title: "Two pieces",
      beats: [
        {
          id: "b1",
          intent: "i",
          archetype: "stage",
          seconds: 8,
          params: { headline: "H", figureId: "f-piece", placement: "none" },
        },
        {
          id: "b2",
          intent: "i",
          archetype: "stage",
          seconds: 8,
          params: { headline: "H", figureId: "f-piece", placement: "center" },
        },
      ],
    });
    expect(() => emitComposition(board, source, deck16)).toThrow(
      /stage b2: figure "f-piece" is a second animate piece in this deck — b1 already draws "f-piece"/,
    );
  });
});

/**
 * A diagram over a full-bleed picture (src/emit/backdrop.ts): the archetype
 * keeps its geometry and its time, gains the picture under it, and paints in
 * glass colours scoped to its own scene.
 */
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { fieldColour, glass, onWorstGround, overField, scopeCss } from "../src/emit/backdrop.js";
import { type EmitContext, reserveRef, type Theme } from "../src/emit/kit.js";
import { THEMES } from "../src/emit/theme.js";
import { PACKS } from "../src/emit/themes/packs.js";
import { type Beat, FORMATS, type Format, type Source } from "../src/types.js";

/** WCAG relative luminance of `#rrggbb`. */
function lum(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (s: number) => {
    const x = ((n >> s) & 255) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(16) + 0.7152 * lin(8) + 0.0722 * lin(0);
}

const source: Source = {
  id: "paper",
  title: "A paper",
  lang: "en",
  sections: [{ id: "sec-1", depth: 1, heading: "Intro", text: "Words." }],
  figures: [
    {
      id: "gen-b1-bd",
      kind: "image",
      src: "valley.png",
      caption: "A valley",
      width: 1536,
      height: 1024,
    },
    { id: "clip", kind: "clip", src: "c.mp4", caption: "A clip", width: 1920, height: 1080 },
  ],
  equations: [],
  tables: [],
};

const ctx = (theme: Theme = PACKS.chalk as Theme): EmitContext => ({
  source,
  format: FORMATS["deck-16x9"] as Format,
  theme,
  sid: "s1",
  start: 0,
  design: "v2",
});

const callout = (backdrop?: {
  figureId?: string;
  illustration?: { prompt: string; caption: string };
}): Beat =>
  ({
    id: "b1",
    archetype: "callout",
    intent: "i",
    evidence: [],
    weight: 0.5,
    seconds: 8,
    params: {
      headline: "What was not tested",
      panels: [
        { label: "Tested", lines: ["Indoor scenes"] },
        { label: "Not tested", lines: ["Outdoor scenes"] },
      ],
      ...(backdrop ? { backdrop } : {}),
    },
  }) as Beat;

describe("backdrop", () => {
  it("emits the archetype's own scene when there is no backdrop, or only a pending brief", () => {
    const plain = emitScene(callout(), ctx());
    expect(emitScene(callout({ illustration: { prompt: "p", caption: "c" } }), ctx())).toEqual(
      plain,
    );
    expect(plain.html).not.toContain("bd-m");
  });

  it("sets the scene over the picture and a scrim, keeping its holds and its geometry", () => {
    const plain = emitScene(callout(), ctx());
    const over = emitScene(callout({ figureId: "gen-b1-bd" }), ctx());
    expect(over.holds).toEqual(plain.holds);
    expect(over.fill).toEqual(plain.fill);
    // Picture first, then the scrim, then the archetype's own html unchanged in shape.
    expect(over.html.indexOf('<img id="s1-bdi" src="assets/valley.png"')).toBeGreaterThan(-1);
    expect(over.html.indexOf("s1-bdsc")).toBeLessThan(over.html.indexOf('id="s1-p0"'));
    expect(over.css).toContain("#s1 .bd-sc{background:rgba(0,0,0,0.62)}");
    // A slow drift on the picture, tweened, never a callback.
    const drift = over.tl.find((t) => t.target === "#s1-bdi");
    expect(drift?.to).toMatchObject({ scale: 1.06, ease: "none" });
    expect(over.tl.some((t) => "onUpdate" in t.to)).toBe(false);
    // No fill prediction: a full-bleed picture has no modal ground to measure against.
    expect(over.fit).toBeUndefined();
  });

  it("stops the picture and the field above a caption reserve, as a stage does", () => {
    // A deck with burned captions keeps its strip clear: neither layer runs under it.
    const format = { ...(FORMATS["deck-16x9"] as Format), captionReserve: 120 };
    const c = { ...ctx(), format };
    const bottom = reserveRef(format);
    expect(bottom).toBeGreaterThan(0);
    const over = emitScene(callout({ figureId: "gen-b1-bd" }), c);
    expect(over.css).toContain(
      `#s1 .bd-m,#s1 .bd-sc{position:absolute;left:0;top:0;right:0;bottom:${bottom}px;z-index:-1}`,
    );
    const field = overField(emitScene(callout(), c), c, 8);
    expect(field.css).toMatch(new RegExp(`#s1 \\.fd\\{[^}]*bottom:${bottom}px;`));
  });

  it("paints glass panels in rules scoped to its scene, so no other callout is repainted", () => {
    const over = emitScene(callout({ figureId: "gen-b1-bd" }), ctx());
    expect(over.css).toContain("#s1 .panel{background:rgba(8,12,20,0.66)");
    // Every non-@ rule is under the scene.
    for (const line of (over.css ?? "").split("\n")) {
      const sel = line.slice(0, line.indexOf("{"));
      if (line.startsWith("@") || !sel) continue;
      for (const s of sel.split(",")) expect(s.trim(), line).toMatch(/^#s1(?![\w])/);
    }
  });

  it("scopes a stylesheet by one id, keeping the order among its own rules", () => {
    const css = [
      ".panel{a:1}",
      "#s1 .panel{a:2}",
      "#s1-p0,.x .y{a:3}",
      "#s10 .z{a:4}",
      "@media (prefers-reduced-motion: no-preference){.ds-live #s1-p1 .plabel{animation:b}}",
      ".a:is(.b,.c){a:5}",
    ].join("\n");
    expect(scopeCss(css, "s1")).toBe(
      [
        "#s1 .panel{a:1}",
        "#s1#s1 .panel{a:2}",
        "#s1 #s1-p0,#s1 .x .y{a:3}",
        "#s1 #s10 .z{a:4}",
        "@media (prefers-reduced-motion: no-preference){.ds-live #s1-p1 .plabel{animation:b}}",
        "#s1 .a:is(.b,.c){a:5}",
      ].join("\n"),
    );
  });

  it("gives every pack and theme inks that clear 4.5:1 on the scrim over pure white", () => {
    for (const [name, theme] of Object.entries({ ...THEMES, ...PACKS })) {
      const g = glass(theme as Theme);
      for (const ink of [g.fg, g.muted, g.accent, ...Object.values(g.tones)]) {
        expect(onWorstGround(ink), `${name} ${ink}`).toBeGreaterThanOrEqual(4.5);
      }
      // Dim is the step-back ink: large text's 3:1, which all audience text is.
      expect(onWorstGround(g.dim), `${name} dim`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps glass emphasis the right way round: dim is darker than every tone", () => {
    // bar-compare paints every bar it is not pointing at in dim. Brighter than
    // the tones, the background bars were the loudest marks on the slide.
    for (const [name, theme] of Object.entries({ ...THEMES, ...PACKS })) {
      const g = glass(theme as Theme);
      for (const ink of [g.accent, ...Object.values(g.tones)]) {
        expect(lum(g.dim), `${name} dim vs ${ink}`).toBeLessThan(lum(ink) - 0.1);
      }
    }
  });

  it("keeps a light pack's four tones apart once they are lifted onto glass", () => {
    // Mixed toward white from the start, chalk's closest two tones were 22
    // apart in RGB and folio's 13: four pastels a viewer cannot tell apart.
    const rgb = (h: string) => [16, 8, 0].map((s) => (Number.parseInt(h.slice(1), 16) >> s) & 255);
    for (const [name, theme] of Object.entries({ ...THEMES, ...PACKS })) {
      const src = Object.values((theme as Theme).tones);
      // A theme whose tones are greys (mono) has no hue to keep.
      if (src.some((h) => Math.max(...rgb(h)) - Math.min(...rgb(h)) < 40)) continue;
      const lifted = Object.values(glass(theme as Theme).tones);
      for (let i = 0; i < lifted.length; i++) {
        for (let j = i + 1; j < lifted.length; j++) {
          const [a, b] = [rgb(lifted[i] as string), rgb(lifted[j] as string)];
          const d = Math.hypot(...a.map((v, k) => v - (b[k] as number)));
          expect(d, `${name} ${lifted[i]} ${lifted[j]}`).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  it("gives every pack and theme a field its glass inks clear 4.5:1 on, keeping the accent's hue", () => {
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const [name, theme] of Object.entries({ ...THEMES, ...PACKS })) {
      const t = theme as Theme;
      const field = fieldColour(t.accent);
      const g = glass(t);
      for (const ink of [g.fg, g.muted, g.dim, g.accent, ...Object.values(g.tones)]) {
        expect(contrast(ink, field), `${name} ${ink} on ${field}`).toBeGreaterThanOrEqual(4.5);
      }
      // A key struck on the accent chip, in the glass ground's ink.
      expect(contrast(g.bg, g.accent), `${name} chip`).toBeGreaterThanOrEqual(4.5);
      // The hue survives: the dominant channel of the accent is the field's too.
      const ch = (hex: string) =>
        [16, 8, 0].map((s) => (Number.parseInt(hex.slice(1), 16) >> s) & 255);
      const a = ch(t.accent);
      const f = ch(field);
      if (Math.max(...a) - Math.min(...a) > 40)
        expect(f.indexOf(Math.max(...f))).toBe(a.indexOf(Math.max(...a)));
    }
  });

  it("refuses a backdrop that is not a still, and one the source does not have", () => {
    expect(() => emitScene(callout({ figureId: "clip" }), ctx())).toThrow(/still picture/);
    expect(() => emitScene(callout({ figureId: "nope" }), ctx())).toThrow(/no backdrop figure/);
  });
});

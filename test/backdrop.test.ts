/**
 * A diagram over a full-bleed picture (src/emit/backdrop.ts): the archetype
 * keeps its geometry and its time, gains the picture under it, and paints in
 * glass colours scoped to its own scene.
 */
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { glass, onWorstGround, scopeCss } from "../src/emit/backdrop.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { THEMES } from "../src/emit/theme.js";
import { PACKS } from "../src/emit/themes/packs.js";
import { type Beat, FORMATS, type Format, type Source } from "../src/types.js";

const source: Source = {
  id: "paper",
  title: "A paper",
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
      for (const ink of [g.fg, g.muted, g.dim, g.accent, ...Object.values(g.tones)]) {
        expect(onWorstGround(ink), `${name} ${ink}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("refuses a backdrop that is not a still, and one the source does not have", () => {
    expect(() => emitScene(callout({ figureId: "clip" }), ctx())).toThrow(/still picture/);
    expect(() => emitScene(callout({ figureId: "nope" }), ctx())).toThrow(/no backdrop figure/);
  });
});

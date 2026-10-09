/**
 * A claim set as moving type (src/emit/archetypes/kinetic.ts).
 *
 * Asserted on what it emits: one stop per phrase, each phrase arriving with a
 * move of its own that the v2 motion grammar does not re-voice, the key word
 * struck by a chip and its ink turned with property tweens (no callback), type
 * that steps down rather than wrapping past two lines and is refused below its
 * smallest size, and a schema that refuses a key its phrase does not contain.
 */
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { kinetic } from "../src/emit/archetypes/kinetic.js";
import { glass } from "../src/emit/backdrop.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { tweenText } from "../src/emit/kit.js";
import { ENTRANCES, restyleEntrance } from "../src/emit/motion.js";
import { MIN_FONT } from "../src/emit/svg.js";
import { PACKS } from "../src/emit/themes/packs.js";
import {
  type BeatOf,
  FORMATS,
  type Format,
  kineticParamsSchema,
  type Source,
} from "../src/types.js";

const source: Source = {
  id: "paper",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [],
  equations: [],
  tables: [],
};

const ctx = (format: Format = FORMATS["deck-16x9"] as Format): EmitContext => ({
  source,
  format,
  theme: glass(PACKS.chalk as Theme),
  sid: "s2",
  start: 0,
  design: "v2",
});
/** Classic keeps the moves, the chip and the 64-120px sizes. */
const classic = (format?: Format): EmitContext => {
  const { design: _v2, ...rest } = ctx(format);
  return rest;
};

type Params = BeatOf<"kinetic">["params"];
const beat = (phrases: Params["phrases"], seconds = 10): BeatOf<"kinetic"> => ({
  id: "b4",
  archetype: "kinetic",
  intent: "i",
  evidence: [],
  weight: 0.8,
  seconds,
  params: { headline: "Spikes stay sparse", phrases },
});

const three = [
  { text: "Haze lowers contrast", key: "contrast" },
  { text: "weak edges fade", key: "edges" },
  { text: "before they ever spike" },
];

describe("kinetic", () => {
  it("stops once per phrase, each after its own words (and strike) have landed", () => {
    const scene = kinetic(beat(three), ctx());
    expect(scene.holds).toHaveLength(3);
    three.forEach((_, i) => {
      const words = scene.tl.find((t) => t.target === `#s2-p${i} .kn-w`);
      expect(words, `phrase ${i}`).toBeDefined();
      expect(words?.at).toBeGreaterThan(i === 0 ? 0 : (scene.holds[i - 1] as number));
      for (const t of scene.tl.filter(
        (x) => x.target.includes(`-k${i}`) || x.target.includes(`-hl${i}`),
      )) {
        expect(t.at + Number(t.to.duration)).toBeLessThanOrEqual((scene.holds[i] as number) + 1e-9);
      }
    });
  });

  it("classic: brings each phrase in with a different move, and the motion grammar leaves them alone", () => {
    const scene = kinetic(beat(three), classic());
    const moves = three.map((_, i) => {
      const t = scene.tl.find((x) => x.target === `#s2-p${i} .kn-w`);
      return JSON.stringify(t?.from);
    });
    expect(new Set(moves).size).toBe(3);
    expect(scene.ownEntrances).toBe(true);
    for (const verb of ENTRANCES) expect(restyleEntrance(scene, "s2", verb)).toBe(scene);
    // Over the field too: the wrapper keeps the flag.
    expect(emitScene(beat(three), { ...classic(), theme: PACKS.chalk as Theme }).ownEntrances).toBe(
      true,
    );
  });

  it("classic: strikes the key with a chip swept in and its ink turned, all fromTo, no callback", () => {
    const scene = kinetic(beat(three), classic());
    expect(scene.html).toContain('<span class="kn-kt" id="s2-kt0">contrast</span>');
    const chip = scene.tl.find((t) => t.target === "#s2-hl0");
    expect(chip?.from).toEqual({ scaleX: 0 });
    expect(chip?.to.scaleX).toBe(1);
    // Rendered shut from the start: a chip left at its CSS width until the
    // strike showed a full highlight fading in with the words (ko e2e).
    expect(chip?.to.immediateRender).toBeUndefined();
    const ink = scene.tl.find((t) => t.target === "#s2-kt0");
    expect(ink?.to.color).toBe(classic().theme.bg);
    // The unstruck phrase has no chip.
    expect(scene.html).not.toContain('id="s2-hl2"');
    const code = scene.tl.map(tweenText).join("\n");
    expect(code).not.toMatch(/on(Update|Start|Complete|Repeat)/);
  });

  it("classic: sets short phrases larger than long ones, and never below its smallest size", () => {
    const size = (p: Params["phrases"]) =>
      Number(/\.kn-p\{font-size:(\d+)px/.exec(kinetic(beat(p), classic()).css ?? "")?.[1]);
    const short = size([{ text: "Sparse" }, { text: "and fast" }]);
    const long = size([
      { text: "Spiking networks stay sparse at inference time" },
      { text: "even when the haze thickens over the whole scene" },
      { text: "and the weak edges are the first thing to go" },
    ]);
    expect(short).toBeGreaterThan(long);
    expect(long).toBeGreaterThanOrEqual(64);
    expect(long).toBeGreaterThan(MIN_FONT);
  });

  it("classic: scopes its size to its own scene, and makes every word a box a transform moves", () => {
    // An unscoped `.kn-p{font-size}` from one beat sets every kinetic beat in
    // the deck at the last size emitted; an inline `.kn-w` takes no transform,
    // so every per-word move would be a fade in place.
    const a = kinetic(beat([{ text: "Sparse" }, { text: "and fast" }]), classic());
    const b = kinetic(
      beat([
        { text: "Spiking networks stay sparse at inference time" },
        { text: "even when the haze thickens over the whole scene" },
      ]),
      classic(),
    );
    const lines = (s: { css?: string }) => new Set((s.css ?? "").split("\n"));
    const [la, lb] = [lines(a), lines(b)];
    const moved = [...la].filter((l) => !lb.has(l)).concat([...lb].filter((l) => !la.has(l)));
    expect(moved.some((l) => /\.kn-p\{font-size/.test(l))).toBe(true);
    for (const l of moved) expect(l).toMatch(/^#s2[ .{,:-]|^@/);
    for (const s of [a, b]) expect(s.css).toMatch(/(^|\n)\.kn-w\{display:inline-block\}/);
  });

  it("classic: sets the same phrases in a portrait frame, flush left, above the floor", () => {
    const scene = kinetic(beat(three), classic(FORMATS["short-9x16"] as Format));
    expect(scene.html).not.toContain("margin-left");
    const size = Number(/\.kn-p\{font-size:(\d+)px/.exec(scene.css ?? "")?.[1]);
    expect(size).toBeGreaterThanOrEqual(64);
  });

  it("v2: fades every word in where it stands, and marks the key by colour, not a chip", () => {
    // Founder, 2026-10-10: "graphic animation by animated UI elements is old-fashioned".
    const scene = kinetic(beat(three), ctx());
    for (const t of scene.tl) {
      expect(Object.keys(t.to).filter((k) => /^(x|y|scale|scaleX|scaleY)$/.test(k))).toEqual([]);
    }
    three.forEach((_, i) => {
      expect(scene.tl.find((x) => x.target === `#s2-p${i} .kn-w`)?.from).toEqual({ opacity: 0 });
    });
    expect(scene.html).not.toContain("kn-hl");
    expect(scene.tl.some((t) => /-hl\d|-k\d$/.test(t.target))).toBe(false);
    const ink = scene.tl.find((t) => t.target === "#s2-kt0");
    expect(ink?.to.color).toBe(ctx().theme.accent);
    expect(ink?.to.immediateRender).toBe(false);
    expect(scene.tl.map(tweenText).join("\n")).not.toMatch(/on(Update|Start|Complete|Repeat)/);
  });

  it("v2: sets every phrase on the confirmed scale, 56px at most and never under 40", () => {
    const size = (p: Params["phrases"], f?: Format) =>
      Number(/\.kn-p\{font-size:(\d+)px/.exec(kinetic(beat(p), ctx(f)).css ?? "")?.[1]);
    const long = [
      { text: "Spiking networks stay sparse at inference time" },
      { text: "even when the haze thickens over the whole scene" },
      { text: "and the weak edges are the first thing to go" },
    ];
    for (const f of [undefined, FORMATS["short-9x16"] as Format]) {
      for (const p of [[{ text: "Sparse" }, { text: "and fast" }], three, long]) {
        expect(size(p, f)).toBeLessThanOrEqual(56);
        expect(size(p, f)).toBeGreaterThanOrEqual(MIN_FONT);
      }
    }
    expect(size([{ text: "Sparse" }, { text: "and fast" }])).toBe(56);
  });

  it("refuses phrases it cannot set in two lines inside the frame, rather than shrinking them", () => {
    const essay = "a phrase that runs on and on well past anything a speaker says in one breath ";
    expect(() => kinetic(beat([{ text: essay.repeat(2) }, { text: "and" }]), ctx())).toThrow(
      /do not set in 2 lines/,
    );
  });

  it("says so when the beat is too short for every phrase to stop", () => {
    const scene = kinetic(beat(three, 3), ctx());
    expect(scene.holds.length).toBeLessThan(3);
    expect(scene.warnings?.[0]).toMatch(/stops merge/);
  });

  it("refuses a key its phrase does not contain", () => {
    const parsed = kineticParamsSchema.safeParse({
      headline: "h",
      phrases: [{ text: "Haze lowers contrast", key: "edges" }, { text: "b" }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message)).toEqual([
      'key "edges" is not in phrase "Haze lowers contrast"',
    ]);
  });

  it("stands on the accent field, in glass inks, when it has no backdrop", () => {
    const scene = emitScene(beat(three), { ...ctx(), theme: PACKS.chalk as Theme });
    expect(scene.html).toMatch(/^<div class="fd"/);
    expect(scene.css).toContain("color:#f4f6fa");
  });
});

/**
 * The two frame grids, and the assertion nobody had.
 *
 * DeckSmith rounds every authored time to three decimals (invariant 10) and the
 * renderer seeks frame `k` to exactly `k / fps`. Whether an element is ON at
 * frame `k` is decided by the hyperframes runtime, which quantises the element's
 * activation window before comparing — but only under `hyperframes render`,
 * because the predicate is gated on `window.__HF_EXPORT_RENDER_SEEK_CONFIG`.
 *
 * THAT GATE IS WHY THIS NEEDS ITS OWN TEST. `lint`, `check`, `verify`, the deck
 * player and `decksmith frames` all either do not render or never set that
 * global, so nothing in the stack can see the quantiser change. It only shows up
 * in the mp4.
 *
 * IT HAS ALREADY CHANGED TWICE. 0.8.30 made the quantiser an unconditional
 * `Math.floor`, which moved every off-grid boundary one frame earlier: on the
 * narrated demo deck all fourteen scene ends were torn down a frame early and
 * the LAST FRAME of the video rendered blank, because `root:end` and `s15:end`
 * both floored onto the frame the renderer seeks to. 0.8.32 reversed it, and
 * 0.8.33 is byte-identical to 0.8.27 on a fixture built to see the difference.
 * Added and removed inside three patch releases, entirely invisible to this
 * repository, discovered by rendering a deck twice and looking at the frames.
 *
 * So the property asserted here is the one DeckSmith actually depends on: A TIME
 * DECKSMITH CAN AUTHOR SURVIVES THE ACTIVATION QUANTISER UNCHANGED. It costs
 * milliseconds and no browser, and it would have gone red on 0.8.30 before a
 * single frame was captured.
 *
 * It reads the INSTALLED runtime rather than restating upstream's arithmetic. A
 * hand-written copy of `Bo` would assert that this file agrees with itself.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const RUNTIME = createRequire(import.meta.url).resolve(
  "hyperframes/dist/hyperframe.runtime.iife.js",
);

/** The three decimals every emitter here rounds to. */
const authored = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * The quantiser the runtime applies to an element's activation window, pulled
 * out of the installed bundle.
 *
 * Found structurally, not by name: minified identifiers change every build, but
 * the predicate reads `__HF_EXPORT_RENDER_SEEK_CONFIG?<name>(` and that shape is
 * the thing worth binding to. EVERY failure here throws rather than skipping —
 * an extraction that quietly gave up would turn this file into one of the
 * can't-fail gates this project keeps finding.
 */
function activationQuantiser(): (t: number, fps: number) => number {
  const src = readFileSync(RUNTIME, "utf8");

  const gate = /__HF_EXPORT_RENDER_SEEK_CONFIG\?([A-Za-z_$][\w$]*)\(/.exec(src);
  if (!gate) {
    throw new Error(
      "no `__HF_EXPORT_RENDER_SEEK_CONFIG?<fn>(` in the installed runtime. Upstream " +
        "restructured the activation predicate, so re-read it and re-measure before " +
        "trusting a render — this assertion no longer knows what it is guarding.",
    );
  }
  const name = gate[1] as string;

  const fn = new RegExp(
    `function ${name.replace(/\$/g, "\\$")}\\(([\\w$]+),([\\w$]+)\\)\\{[^}]*\\}`,
  ).exec(src);
  if (!fn) {
    throw new Error(
      `found the activation gate calling \`${name}\`, but no \`function ${name}(a,b){...}\` ` +
        "to go with it. It is probably an arrow or a method now; re-read the runtime.",
    );
  }

  return new Function(`${fn[0]}; return ${name};`)() as (t: number, fps: number) => number;
}

/** What 0.8.30 shipped, kept here so the assertion below can be shown to fail. */
const floorGrid = (t: number, fps: number): number => Math.floor(t * fps + 1e-9) / fps;

/** Times DeckSmith can actually author: three decimals, across the plausible range. */
const AUTHORED: number[] = [];
for (let ms = 0; ms <= 300_000; ms += 137) AUTHORED.push(authored(ms / 1000));

const RATES = [24, 25, 30, 50, 60];

describe("the activation grid, which only `hyperframes render` applies", () => {
  it("leaves every time DeckSmith can author exactly where it was", () => {
    const q = activationQuantiser();
    const moved: Array<{ t: number; fps: number; to: number }> = [];
    for (const fps of RATES) {
      for (const t of AUTHORED) {
        const got = q(t, fps);
        if (got !== t) moved.push({ t, fps, to: got });
      }
    }
    expect(
      moved.slice(0, 8),
      `${moved.length} authored time(s) are moved by the runtime's activation quantiser. ` +
        "Every one is an element that turns on or off a frame away from where the deck says " +
        "it does, and no gate in this repository renders, so nothing else will tell you. " +
        "This is what 0.8.30 did; see .planning/2026-09-10-hyperframes-0.8.33.md.",
    ).toEqual([]);
  });

  it("would have caught 0.8.30, which is the only reason to trust the test above", () => {
    // Without this, an extraction that returned something identity-shaped by
    // accident would make the assertion above pass while measuring nothing.
    const moved = AUTHORED.filter((t) => floorGrid(t, 30) !== t);
    expect(moved.length).toBeGreaterThan(0);
    // And the shape of the damage: one frame earlier, never more.
    for (const t of moved.slice(0, 50)) {
      expect(Math.round(t * 30) - Math.round(floorGrid(t, 30) * 30)).toBeLessThanOrEqual(1);
    }
  });

  it("still finds the predicate it is guarding", () => {
    // Separate from the assertion so a restructured runtime reads as "go look",
    // not as "the grids disagree".
    expect(() => activationQuantiser()).not.toThrow();
  });
});

describe("the seek grid, which is a different function and should stay one", () => {
  it("floors, because the renderer asks for frame k and must get frame k", () => {
    // `$t` at the time of writing: five call sites, all on seek/renderSeek. It is
    // correct for it to floor; it is NOT correct for the activation window to.
    // If these two ever become the same function, the activation test above goes
    // red and this comment is where to start.
    const src = readFileSync(RUNTIME, "utf8");
    expect(src).toMatch(/Math\.floor\([\w$]+\*[\w$]+\+1e-9\)\/[\w$]+/);
  });
});

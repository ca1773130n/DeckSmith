/**
 * EQUATIONS FITTED TO THEIR BOXES, measured in the renderer's own browser.
 *
 * `equation-walk` sized its display from a glyph count and its legend chips with
 * 2px of padding, and both were wrong on real decks: HypePaper deck 31b41b88's
 * K-Score formula was set at the 40px floor and still ran 173px off the canvas,
 * and deck 0ef77cae's chip let a `gt` superscript sit 10px above its own painted
 * edge. Each failed `verify` with nothing better than `span.mord`. The beats are
 * copied from those runs (test/fixtures/hypepaper-math.json); the third beat is
 * one no fit can save, to hold the gate that names the formula.
 *
 * Skipped without Chrome, exactly as test/deck-page.test.ts is: CI installs no
 * browser, so this runs on the machine of whoever is about to believe it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNFIT_ATTR } from "../src/emit/tex.js";
import { chromePath, type DeckPage, openDeck } from "../src/render/capture.js";
import type { Term } from "../src/types.js";
import { fidelity, gradeUnfit } from "../src/verify/fidelity.js";

const run = promisify(execFile);
const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const chrome = await chromePath("fit equations with").catch(() => null);

interface Case {
  kind: string;
  beat: string;
  equation: { id: string; tex: string; display: boolean };
  headline: string;
  terms: Term[];
}
const fixture = JSON.parse(await readFile(repo("test/fixtures/hypepaper-math.json"), "utf8")) as {
  cases: Case[];
};
const pick = (kind: string) => fixture.cases.find((c) => c.kind === kind) as Case;
const wide = pick("too_wide");
const chip = pick("chip_overflow");
/**
 * One break, after the `=`, and then a group no break can enter: wider than the
 * box at the 40px floor whichever line it is set on.
 */
const UNFIT = `x = \\left( \\text{${"an argument that will not break anywhere ".repeat(4).trim()}} \\right)`;

describe("gradeUnfit", () => {
  it("says nothing when every equation fit", () => {
    expect(gradeUnfit([])).toEqual([]);
  });

  it("fails the deck naming the scene and the formula, which span.mord never could", () => {
    expect(gradeUnfit([{ sid: "s9", tex: "a = b" }])).toEqual([
      {
        severity: "error",
        gate: "fidelity",
        rule: "math_unfit",
        message:
          's9: the equation does not fit its box even at the 40px floor broken across lines — "a = b". Shorten it in the source, or walk it across two beats.',
      },
    ]);
  });
});

describe.skipIf(chrome === null)("equation-walk, fitted in the renderer's own browser", () => {
  let dir = "";
  let out = "";
  let deck: DeckPage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-math-fit-"));
    out = join(dir, "deck");
    const source = {
      id: "s",
      title: "Math fit",
      lang: "en",
      sections: [{ id: "sec1", depth: 1, heading: "Method", text: "It works." }],
      figures: [],
      equations: [wide.equation, chip.equation, { id: "unfit", tex: UNFIT, display: true }],
      tables: [],
    };
    const beat = (c: Pick<Case, "beat" | "equation" | "terms">) => ({
      id: c.beat,
      intent: "Read the formula.",
      archetype: "equation-walk",
      seconds: 9,
      params: { headline: "The formula", equationId: c.equation.id, terms: c.terms },
    });
    const storyboard = {
      sourceId: "s",
      title: "Math fit",
      beats: [
        beat(wide),
        beat(chip),
        beat({
          beat: "b3-unfit",
          equation: { id: "unfit", tex: UNFIT, display: true },
          terms: [{ tex: "x", label: "the argument", tone: "a" } as Term],
        }),
      ],
    };
    await writeFile(join(dir, "source.json"), JSON.stringify(source));
    await writeFile(join(dir, "storyboard.json"), JSON.stringify(storyboard));
    // The third beat overflows on purpose, so the build's own gate fails and
    // exits non-zero; what is under test is the deck it wrote — all three beats
    // of it, or the assertions below would be about a deck that dropped one.
    const said = await run(process.execPath, [
      repo("dist/cli.js"),
      "build",
      join(dir, "storyboard.json"),
      "--source",
      join(dir, "source.json"),
      "-o",
      out,
      "--no-fidelity",
    ]).then(
      (r) => r.stderr,
      (err: { stderr?: string }) => err.stderr ?? "",
    );
    expect(said).toMatch(/build: 3 beats at/);
    deck = await openDeck(out);
    await deck.page.waitForFunction("window.__hfTimelinesBuilding === false");
  }, 180_000);

  afterAll(async () => {
    await deck?.close().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** How far the scene's rendered display reaches outside its own box, in px. */
  const spill = (sid: string) =>
    deck.page.evaluate((sid: string) => {
      const box = document.getElementById(`${sid}-eq`) as HTMLElement;
      const b = box.getBoundingClientRect();
      let worst = 0;
      for (const base of box.querySelectorAll(".katex-html > .base")) {
        const r = base.getBoundingClientRect();
        worst = Math.max(worst, b.left - r.left, r.right - b.right);
      }
      return { worst, broken: box.classList.contains("eq-broken"), size: box.style.fontSize };
    }, sid);

  it("breaks the K-Score formula into lines inside its box, at or above the floor", async () => {
    const s = await spill("s1");
    expect(s.worst).toBeLessThanOrEqual(0.5);
    expect(s.broken).toBe(true);
    expect(Number.parseFloat(s.size)).toBeGreaterThanOrEqual(40);
  });

  it("grows each chip to hold the glyphs KaTeX set in it", async () => {
    const out = await deck.page.evaluate(() =>
      Array.from(document.querySelectorAll("#s2 .chip")).map((chip) => {
        const c = chip.getBoundingClientRect();
        let worst = 0;
        for (const el of chip.querySelectorAll("span")) {
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
          const r = el.getBoundingClientRect();
          worst = Math.max(
            worst,
            c.top - r.top,
            r.bottom - c.bottom,
            c.left - r.left,
            r.right - c.right,
          );
        }
        return worst;
      }),
    );
    expect(out).toHaveLength(2);
    for (const worst of out) expect(worst).toBeLessThanOrEqual(0.5);
  });

  it("leaves a display it fits without breaking alone", async () => {
    expect((await spill("s2")).broken).toBe(false);
  });

  it("marks a display nothing can fit, with the formula", async () => {
    const marked = await deck.page.evaluate(
      (attr: string) =>
        Array.from(document.querySelectorAll(`[${attr}]`)).map((el) => [
          el.id,
          el.getAttribute(attr),
        ]),
      UNFIT_ATTR,
    );
    expect(marked).toEqual([["s3-eq", UNFIT]]);
  });

  it("and the fidelity gate fails the deck on it, by name", async () => {
    const report = await fidelity(out);
    const unfit = report.findings.filter((f) => f.rule === "math_unfit");
    expect(unfit).toHaveLength(1);
    expect(unfit[0]?.severity).toBe("error");
    expect(unfit[0]?.message).toContain("s3: the equation does not fit");
    expect(unfit[0]?.message).toContain(JSON.stringify(UNFIT));
  }, 120_000);
});

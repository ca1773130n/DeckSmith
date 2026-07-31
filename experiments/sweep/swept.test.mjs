/**
 * THE GATE THAT KEEPS THE SWEEP HONEST.
 *
 * It does NOT run the sweep — a minute and a browser per level do not belong in
 * `npx vitest run`. It reads the receipt the sweep left and checks that the
 * receipt is about THIS tree: this corpus file's bytes, this `dist/`. Staleness
 * is the failure.
 *
 * WHY STALENESS IS THE THING TO CHECK. The sweep's whole claim is "these nine
 * known defects are still fixed". A receipt earned by a previous build of the
 * compiler says nothing whatsoever about the compiler in the working tree — it
 * is the exact disease `toolFingerprint` was written for over in `score.mjs`,
 * and it has already bitten this project twice: two line-chart fixes were
 * committed, the sweep re-run, and the same six collisions reported out of a
 * `dist/` that predated both. A green suite sitting on a receipt from yesterday
 * is worse than a red one, because it looks like evidence.
 *
 * IT WILL GO RED ON YOU MID-EDIT, and that is the design rather than an
 * oversight. Touch `src/**`, rebuild, and the receipt stops being about the tree
 * — because it has stopped being about the tree. The remedy on offer was to hide
 * these three cases behind an env flag so `npm test` stays quiet; a staleness
 * check you can turn off is one that is off, and the whole file would then be
 * decoration. Run `npm run sweep`; it takes a minute.
 *
 * WHAT IT DELIBERATELY DOES NOT REQUIRE: that every cell is clean. `b09-data-table`
 * at 9 and 10 rows is a real, open, unfixed defect, and making the suite red for
 * it would make deleting the cell the cheapest way to green — the incentive that
 * produces a corpus proving nothing. It is pinned in `OPEN` with the verdict it
 * actually has, so it is on the record without being an alarm.
 *
 * TO FIX A FAILURE HERE:  npm run sweep
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  auditCorpus,
  CORPUS,
  corpusSha,
  LEDGER,
  measurable,
  sweepFingerprint,
} from "../../scripts/sweep.mjs";

const ledger = JSON.parse(await readFile(LEDGER, "utf8").catch(() => "null"));

describe("the perturbation sweep has a receipt for this tree", () => {
  it("has been run at all", () => {
    expect(
      ledger,
      `no sweep receipt at ${LEDGER}. The nine layout defects this corpus exists to ` +
        "catch are unverified on this tree. Run:\n    npm run sweep\n",
    ).toBeTruthy();
  });

  it("was run against the corpus that is on disk now", async () => {
    expect(
      ledger?.planSha,
      "scripts/sweep-perturbations.mjs has changed since the last sweep, so the receipt " +
        "is about a different set of inputs. Re-run: npm run sweep",
    ).toBe(await corpusSha());
  });

  it("was run against the dist/ that is on disk now", async () => {
    // The compiler AND the two harness files. A verdict earned by a different
    // emitter is a fact about that emitter; a verdict earned by a different
    // judge is a fact about that judge.
    expect(
      ledger?.tool,
      "the sweep receipt was earned by a different build of dist/ or a different " +
        "harness, so it is not evidence about this one. Re-run: npm run sweep",
    ).toBe(await sweepFingerprint());
  });

  it("records a verdict for every cell the corpus names", () => {
    // A corpus entry with no cell behind it is the vacuous case in its purest
    // form: the assertion passes because there is nothing to assert against.
    const missing = Object.keys(CORPUS).filter((k) => !ledger?.cells?.[k]);
    expect(
      missing,
      `the corpus names cells the sweep never produced:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("recorded a green run", () => {
    // Re-run the sweep's OWN audit over the receipt rather than a second, easier
    // comparison written here. The two used to be separate and the guard's copy
    // checked `rules` alone, so a run in which all 53 cells failed to BUILD —
    // empty rule lists everywhere — satisfied it completely and left a receipt
    // that turned this file green. One definition, used in both places.
    const results = new Map([
      ...Object.entries(ledger?.cells ?? {}).map(([k, v]) => [k, { key: k, ...v }]),
      ...(ledger?.levels ?? []).map((l) => [l.where, l]),
    ]);
    expect(
      auditCorpus(results).map((b) => `${b.key}: ${b.why}`),
      "the last sweep was not clean — a layout fix has been reverted, a new defect " +
        "has appeared, or a gate did not run",
    ).toEqual([]);
  });
});

/**
 * The contract between `collectSvgTextRuns` and the HTML the emitters write.
 *
 * The predicate itself is driven against a DOM stub in `test/verify.test.ts`; a
 * stub cannot tell you that the attribute it looks for is still the attribute
 * the emitter writes. `measurable` is what the sweep applies to each really-built
 * deck for exactly that, and these three cases are what stop it being a check
 * that can only ever say yes.
 */
describe("the sweep can tell a measurable deck from an empty one", () => {
  const deck = '<div data-composition-id="s1"><svg><text x="0">28.90</text></svg></div>';

  it("accepts a deck that names its scenes and draws chart labels as svg text", () => {
    expect(measurable(deck)).toBeNull();
  });

  it("rejects a deck whose scenes lost the id the walk starts from", () => {
    expect(measurable(deck.replace("data-composition-id=", "data-scene-id="))).toContain(
      "data-composition-id",
    );
  });

  it("rejects a deck with no svg text in it at all", () => {
    expect(measurable('<div data-composition-id="s1"><p>28.90</p></div>')).toContain("<text>");
  });
});

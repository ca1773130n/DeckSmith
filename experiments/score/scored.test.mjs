/**
 * THE GATE THAT CANNOT BE SKIPPED.
 *
 * `npx vitest run` is one of the five commands this project keeps green. This
 * file puts one more thing inside it: every storyboard sitting in `experiments/`
 * must have been handed to the shipped `decksmith build`, at the bytes it has
 * right now, and the receipt must say what came back.
 *
 * WHY A TEST AND NOT A CONVENTION. The convention already existed — "look at the
 * artifact" is the first line of AGENTS.md — and it was followed for the morph
 * spike's 60 PNGs and for nothing else. Six investigations and 26 Codex runs
 * produced zero decks (VOCABULARY-REVIEW §4). Hope is not a mechanism. A red
 * suite is.
 *
 * WHAT IT DOES NOT REQUIRE: that the plan PASSED. Requiring a pass would make
 * deleting an inconvenient plan the cheapest way to a green suite, which is the
 * incentive that produces exactly the corpus this exists to prevent. A FAIL with
 * a receipt is a good outcome — it is a finding. A plan with no receipt is the
 * only thing forbidden, because that is a plan nobody built.
 *
 * WHAT IT GOT WRONG ONCE, because the correction is the useful part: it
 * discovered plans by `Array.isArray(o.beats)`, and the first plan shape that was
 * genuinely new — arm VOCAB's `scenes` — walked straight past the guard. Twenty
 * plans, invisible, to the mechanism built precisely to stop a plan being scored
 * without being built. Discovery now asks only for `sourceId` and `title`
 * (`looksLikePlan`), and the plan's shape is a LABEL it reports rather than a
 * filter it applies. 64 plans before, 121 after.
 *
 * TO FIX A FAILURE HERE:  npm run score
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPlans, LEDGER, looksLikePlan, planUnits, REPO } from "../../scripts/score.mjs";

const ledger = JSON.parse(await readFile(LEDGER, "utf8").catch(() => '{"plans":{}}'));
const plans = await discoverPlans([join(REPO, "experiments")]);

describe("every plan in experiments/ has been through `decksmith build`", () => {
  it("finds plans to check", () => {
    // A discovery rule that quietly matches nothing is the same failure in a
    // different costume: a green suite that proves nothing.
    expect(plans.length).toBeGreaterThan(0);
  });

  it("admits a plan whose units are not called `beats`", () => {
    // THE FAILURE THIS FILE ITSELF SHIPPED. Discovery required
    // `Array.isArray(o.beats)`, so all twenty of experiments/015-decision's
    // compositional plans — units named `scenes` — were invisible to the one
    // mechanism built to make "nobody built it" impossible. A guard with a shape
    // assumption is not a guard against a new shape, which is the only kind of
    // plan anybody writes on purpose.
    const composed = { sourceId: "thinksr", title: "Compositional", scenes: [{ id: "sc1" }] };
    expect(looksLikePlan(composed)).toBe(true);
    expect(planUnits(composed)).toEqual({ key: "scenes", count: 1 });
    // And nothing shape-specific is required to get in at all.
    expect(looksLikePlan({ sourceId: "x", title: "y", panels: [{ id: "p1" }] })).toBe(true);
    expect(looksLikePlan({ sourceId: "x", title: "y" })).toBe(true);
    expect(looksLikePlan({ beats: [] })).toBe(false);
  });

  it("can name what every discovered plan is made of", async () => {
    // LOUD, NOT ABSENT. Silently skipping an unrecognised shape is what caused
    // this; a shape the harness cannot describe must therefore name itself here
    // rather than vanish from the corpus.
    const unnameable = [];
    for (const plan of plans)
      if (!planUnits(JSON.parse(await readFile(join(REPO, plan), "utf8")))) unnameable.push(plan);
    expect(unnameable, `no unit array found in:\n  ${unnameable.join("\n  ")}`).toEqual([]);
  });

  it.each(plans)("%s has a build receipt for its current bytes", async (plan) => {
    const receipt = ledger.plans?.[plan];
    expect(
      receipt,
      `${plan} has never been built. Schema-valid is not buildable — run:\n` +
        `    npm run score -- ${plan} --source demo/source.json\n`,
    ).toBeTruthy();

    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256")
      .update(await readFile(join(REPO, plan)))
      .digest("hex");
    expect(
      receipt.planSha,
      `${plan} has changed since it was last built (receipt is for ${receipt.planSha?.slice(0, 12)}, ` +
        `file is ${sha.slice(0, 12)}). Re-run: npm run score`,
    ).toBe(sha);

    // A verdict with no artifact behind it is the thing this whole harness
    // exists to make impossible. A PASS must be able to name the bytes it
    // passed; only a build that never produced a deck may have none.
    if (receipt.passed)
      expect(receipt.deckSha, `${plan} is recorded PASS but no deck was produced.`).toBeTruthy();
  });
});

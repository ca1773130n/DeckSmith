/**
 * Fixtures are real `hyperframes check --json` output, trimmed: the pass case is
 * `experiments/hf-thinksr`, the fail case a deck deliberately broken with an
 * oversized headline and near-invisible body text. Both were captured from 0.7.71.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prefsSchema, type Storyboard, storyboardSchema } from "../src/types.js";
import { profilesFor, readCanvas, scanBudget } from "../src/verify/budget.js";
import { check, parseCheckReport, sampleTimes } from "../src/verify/check.js";
import {
  scanBeatCount,
  scanDeterminism,
  scanDiagrammatic,
  scanHeadlines,
  scanNarrationLead,
  scanRepeatedObject,
} from "../src/verify/index.js";
import {
  collectSvgTextRuns,
  gradeOverprint,
  MIN_OVERLAP,
  overprints,
  type TextRun,
} from "../src/verify/overprint.js";
import { scanTypeFloor, TYPE_FLOOR_PX } from "../src/verify/typefloor.js";

const PASS = `{
  "ok": true,
  "strict": false,
  "lint": {
    "ok": true, "errorCount": 0, "warningCount": 1, "infoCount": 0,
    "findings": [
      {
        "code": "composition_file_too_large",
        "severity": "warning",
        "message": "This HTML composition file has 479 lines. Smaller sub-compositions are easier to read, iterate on, and diff.",
        "selector": "[data-composition-id]",
        "dataAttributes": {},
        "sourceFile": "index.html",
        "bbox": { "x": 0, "y": 0, "width": 0, "height": 0 },
        "time": 0,
        "fixHint": "Split coherent scenes or layers into separate .html files under compositions/."
      }
    ],
    "filesScanned": 1
  },
  "runtime": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [] },
  "layout": {
    "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [],
    "duration": 63, "samples": [3.5, 10.5, 17.5], "tolerance": 2, "totalIssueCount": 0, "truncated": false
  },
  "motion": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [], "enabled": false, "samples": 0 },
  "contrast": {
    "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [],
    "enabled": true, "samples": [3.5, 17.5], "checked": 109, "passed": 109
  },
  "snapshots": { "enabled": false, "files": [], "times": [], "findingFiles": [] },
  "_meta": { "version": "0.7.71", "latestVersion": "0.7.71", "updateAvailable": false }
}
`;

const PASS_STDERR = `[StaticGuard] Invalid HyperFrame contract: Font family used without @font-face declaration: noto sans kr. These are not in the auto-resolved font list.
[INFO] [Compiler] Fetched 77 font face(s) for "Inter" from Google Fonts
`;

const FAIL = `{
  "ok": false,
  "strict": false,
  "lint": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [] },
  "runtime": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [] },
  "layout": {
    "ok": true, "errorCount": 0, "warningCount": 2, "infoCount": 0,
    "findings": [
      {
        "code": "canvas_overflow",
        "severity": "warning",
        "time": 0.556,
        "selector": "#s1 h1.headline",
        "message": "Text extends outside the composition canvas.",
        "rect": { "left": 80, "top": 141.63, "right": 2908.38, "bottom": 252.63, "width": 2828.38, "height": 111 },
        "containerSelector": "#root",
        "text": "A headline so long it will certainly not fit",
        "fixHint": "Move the text inward, reduce its size, or mark intentional off-canvas animation with data-layout-allow-overflow."
      },
      {
        "code": "container_overflow",
        "severity": "warning",
        "time": 0.556,
        "selector": "#s1 div.wide",
        "message": "Element extends outside a clipping layout container.",
        "rect": { "left": 1700, "top": 600, "right": 2600, "bottom": 800, "width": 900, "height": 200 },
        "containerSelector": "#s1",
        "fixHint": "Resize/reposition the child or container."
      }
    ],
    "duration": 10, "samples": [0.556, 2.778, 5], "tolerance": 2, "totalIssueCount": 2, "truncated": false
  },
  "motion": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [], "enabled": false, "samples": 0 },
  "contrast": {
    "ok": false, "errorCount": 2, "warningCount": 0, "infoCount": 0,
    "findings": [
      {
        "code": "contrast_aa_failure",
        "severity": "error",
        "message": "Contrast is 1.06:1; WCAG AA requires 3:1.",
        "text": "Barely visible low contrast text",
        "fg": "rgb(19,21,25)", "bg": "rgb(11,13,16)", "ratio": 1.06, "requiredRatio": 3,
        "suggestedColor": "rgb(93,94,97)", "large": true,
        "selector": "div > div > p", "dataAttributes": {}, "sourceFile": "index.html",
        "bbox": { "x": 80, "y": 314.25, "width": 1760, "height": 54 },
        "time": 0.556
      },
      {
        "code": "contrast_aa_failure",
        "severity": "error",
        "message": "Contrast is 1.06:1; WCAG AA requires 3:1.",
        "text": "Barely visible low contrast text",
        "fg": "rgb(19,21,25)", "bg": "rgb(11,13,16)", "ratio": 1.06, "requiredRatio": 3,
        "suggestedColor": "rgb(93,94,97)", "large": true,
        "selector": "div > div > p", "dataAttributes": {}, "sourceFile": "index.html",
        "bbox": { "x": 80, "y": 314.25, "width": 1760, "height": 54 },
        "time": 2.778
      }
    ],
    "enabled": true, "samples": [0.556, 2.778], "checked": 4, "passed": 2
  },
  "snapshots": { "enabled": false, "files": [], "times": [], "findingFiles": [] },
  "_meta": { "version": "0.7.71", "latestVersion": "0.7.71", "updateAvailable": false }
}
`;

/**
 * The shape that shipped a broken 9x16 deck: three findings about content
 * leaving the frame, all filed as `info`, and `ok: true` over the top of them.
 *
 * Assembled from upstream's schema rather than captured, because the run that
 * proved the point cannot be re-captured — the emitters have since been fixed
 * and the demo no longer overflows. The severities and the `ok` are the part
 * under test, and they are upstream's, not ours.
 */
const OFF_CANVAS = `{
  "ok": true,
  "strict": false,
  "lint": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [] },
  "runtime": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [] },
  "layout": {
    "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 3,
    "findings": [
      {
        "code": "canvas_overflow",
        "severity": "info",
        "time": 14.2,
        "selector": "#s4 .cell-label",
        "message": "Text extends outside the composition canvas.",
        "containerSelector": "#root",
        "text": "the next window"
      },
      {
        "code": "panel_out_of_canvas",
        "severity": "info",
        "time": 31.5,
        "selector": "#s8 .bar-value",
        "message": "Panel lies outside the composition canvas."
      },
      {
        "code": "text_occluded",
        "severity": "info",
        "time": 44.0,
        "selector": "#s12 .note",
        "message": "Text is fully covered by another element."
      }
    ],
    "duration": 246.482, "samples": [14.2, 31.5, 44], "tolerance": 2, "totalIssueCount": 3, "truncated": false
  },
  "motion": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [], "enabled": false, "samples": 0 },
  "contrast": { "ok": true, "errorCount": 0, "warningCount": 0, "infoCount": 0, "findings": [], "enabled": true, "samples": [], "checked": 0, "passed": 0 },
  "snapshots": { "enabled": false, "files": [], "times": [], "findingFiles": [] },
  "_meta": { "version": "0.7.71", "latestVersion": "0.7.71", "updateAvailable": false }
}
`;

describe("parseCheckReport", () => {
  it("reads a clean run as a pass, keeping the warning it did report", () => {
    const verdict = parseCheckReport(PASS, PASS_STDERR);

    expect(verdict.passed).toBe(true);
    expect(verdict.findings).toEqual([
      {
        // Downgraded, not dropped, and annotated with why — see `regrade` in
        // check.ts. It still prints; it just stops counting as a warning, so
        // "PASS, 1 warning" means one thing nobody has decided about yet.
        severity: "info",
        gate: "lint",
        rule: "composition_file_too_large",
        message:
          "This HTML composition file has 479 lines. Smaller sub-compositions are easier to read, iterate on, and diff. [[data-composition-id]] — accepted: generated, not authored.",
      },
      {
        severity: "warning",
        gate: "staticguard",
        rule: "contract_violation",
        message:
          "Invalid HyperFrame contract: Font family used without @font-face declaration: noto sans kr. These are not in the auto-resolved font list.",
      },
    ]);
  });

  it("labels each finding with the gate that produced it and where it happened", () => {
    const verdict = parseCheckReport(FAIL);

    expect(verdict.passed).toBe(false);
    expect(verdict.findings.map((f) => `${f.gate}/${f.rule}/${f.severity}`)).toEqual([
      // Graded up from the reported `warning`: content off the canvas is the
      // deck being wrong, at any severity upstream chose to file it under.
      "layout/canvas_overflow/error",
      "layout/container_overflow/warning",
      "contrast/contrast_aa_failure/error",
      "contrast/contrast_aa_failure/error",
    ]);
    // The selector and the sample time are the only handles a repair round has.
    expect(verdict.findings[0]?.message).toBe(
      "Text extends outside the composition canvas. [#s1 h1.headline t=0.556s]",
    );
    expect(verdict.findings[3]?.message).toBe(
      "Contrast is 1.06:1; WCAG AA requires 3:1. [div > div > p t=2.778s]",
    );
  });

  it("fails a deck whose content leaves the canvas, whatever upstream filed it as", () => {
    const verdict = parseCheckReport(OFF_CANVAS);

    // Upstream said `ok: true` with all three as `info` — this is the exact
    // report that let a 9x16 deck with four cut-off slides out of the door.
    expect(verdict.passed).toBe(false);
    expect(verdict.findings.map((f) => `${f.rule}/${f.severity}`)).toEqual([
      "canvas_overflow/error",
      "panel_out_of_canvas/error",
      "text_occluded/error",
    ]);
    // Each one names the slide, which is the only handle a repair round has.
    expect(verdict.findings.map((f) => f.message)).toEqual([
      "Text extends outside the composition canvas. [#s4 .cell-label t=14.2s]",
      "Panel lies outside the composition canvas. [#s8 .bar-value t=31.5s]",
      "Text is fully covered by another element. [#s12 .note t=44s]",
    ]);
  });

  // The camera's half of the off-canvas rule. During a dive the plate is
  // deliberately bigger than the canvas, so upstream reports overflow on a
  // CORRECT deck; grading that up unconditionally is what made `inside`
  // unbuildable. The exemption is bounded by the window the composition itself
  // published, and by nothing else.
  it("excuses an off-canvas finding that lands inside a published camera window", () => {
    const verdict = parseCheckReport(OFF_CANVAS, "", [
      { sid: "s4", t0: 14, t1: 15 },
      { sid: "s8", t0: 31, t1: 32 },
      { sid: "s12", t0: 43, t1: 45 },
    ]);

    expect(verdict.passed).toBe(true);
    expect(verdict.findings.every((f) => f.severity === "info")).toBe(true);
    // Downgraded, never dropped: a finding that vanishes is how a rule stops
    // being a decision and becomes a habit.
    expect(verdict.findings).toHaveLength(3);
    expect(verdict.findings[0]?.message).toContain("accepted: mid-camera-move");
  });

  it("still fails an off-canvas finding outside every camera window", () => {
    // One window, covering only the first of the three. This is the shape of
    // the real proof: the same fixture with a 130-char unbreakable note is
    // reported at 5.5s AND at 9.9s, and only 9.9 is in the move.
    const verdict = parseCheckReport(OFF_CANVAS, "", [{ sid: "s4", t0: 14, t1: 15 }]);

    expect(verdict.passed).toBe(false);
    expect(verdict.findings.map((f) => `${f.rule}/${f.severity}`)).toEqual([
      "canvas_overflow/info",
      "panel_out_of_canvas/error",
      "text_occluded/error",
    ]);
  });

  it("excuses only what is STRICTLY inside the window, not what sits on its edge", () => {
    // A hold is allowed to sit exactly at the move's boundary —
    // `assertStopsOutsideMove` puts stops at the edges, not beyond them — so a
    // frame sampled at t0 or t1 is a plate the audience reads, not transit.
    const verdict = parseCheckReport(OFF_CANVAS, "", [
      { sid: "s4", t0: 14.2, t1: 20 },
      { sid: "s8", t0: 25, t1: 31.5 },
    ]);

    expect(verdict.findings.map((f) => f.severity)).toEqual(["error", "error", "error"]);
    expect(verdict.passed).toBe(false);
  });

  // The reason the window carries a sid. `assertStopsOutsideMove` promises that no
  // stop of the DIPPING scene lands inside its own move, and promises nothing
  // about any other scene — so a window belonging to s4 must not excuse a finding
  // against s8, however well the times line up.
  it("will not excuse one scene's overflow with another scene's camera window", () => {
    const verdict = parseCheckReport(OFF_CANVAS, "", [
      { sid: "s4", t0: 31, t1: 32 }, // s8's timing, s4's name
    ]);

    expect(verdict.passed).toBe(false);
    expect(verdict.findings.map((f) => f.severity)).toEqual(["error", "error", "error"]);
  });

  it("says which guarantee it applied, and does not claim one it cannot check", () => {
    const verdict = parseCheckReport(OFF_CANVAS, "", [{ sid: "s4", t0: 14, t1: 15 }]);
    // Named scene, real guarantee.
    expect(verdict.findings[0]?.message).toContain("no stop of s4 is inside this window");
  });

  it("grades strictly when the deck publishes no camera window at all", () => {
    // The failure direction that matters: an unreadable or camera-less
    // composition must not become a blanket exemption.
    expect(parseCheckReport(OFF_CANVAS, "", []).passed).toBe(false);
    expect(parseCheckReport(OFF_CANVAS).passed).toBe(false);
  });

  it("does not read a truncated report as a pass", async () => {
    // npx swallows the SIGTERM behind `timeout`, so a cut-off run comes back
    // looking like a clean exit with half a report on stdout.
    const verdict = await check(".", { timeoutMs: 1 });

    expect(verdict.passed).toBe(false);
    expect(verdict.findings[0]?.rule).toBe("timeout");
  });

  it("fails loudly rather than silently passing when there is no report to read", () => {
    const verdict = parseCheckReport("", "Error: Cannot find module 'hyperframes'\n");

    expect(verdict.passed).toBe(false);
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.rule).toBe("unparseable_output");
    expect(verdict.findings[0]?.message).toContain("Cannot find module");
  });
});

/**
 * A built composition, as far as the budget gate is concerned: the root's own
 * attributes and one div per scene. Attribute order is `sceneHtml`'s.
 */
function composition(width: number, height: number, scenes: number[]): string {
  const total = scenes.reduce((a, b) => a + b, 0);
  const divs = scenes
    .map(
      (d, i) =>
        `      <div id="s${i + 1}" class="scene clip" data-composition-id="s${i + 1}" data-start="0" data-duration="${d}" data-label="A slide"></div>`,
    )
    .join("\n");
  return `<!doctype html>
<html><body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${total}"
      data-width="${width}"
      data-height="${height}"
    >
${divs}
    </div>
</body></html>`;
}

/** A storyboard whose beats carry real weights, which is what the remedy sorts by. */
function weighted(...weights: number[]): Storyboard {
  return storyboardSchema.parse({
    sourceId: "s1",
    title: "A deck",
    beats: weights.map((weight, i) => ({
      id: `b${String(i + 1).padStart(2, "0")}`,
      intent: "The viewer understands the mechanism.",
      archetype: "pipeline",
      params: PARAMS.pipeline,
      weight,
    })),
  });
}

describe("scanBudget", () => {
  it("passes a 16x9 deck of any length — no platform imposes one", () => {
    expect(scanBudget(composition(1920, 1080, [600, 600, 600]))).toEqual([]);
  });

  it("fails the four-minute short, in the units a platform limit is quoted in", () => {
    // The demo at short-9x16: twelve beats, 246.482s once narration has
    // lengthened them, against a 180s cap. Every other gate passes it.
    const findings = scanBudget(composition(1080, 1920, Array(12).fill(20.54)));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.gate).toBe("budget");
    expect(findings[0]?.rule).toBe("over_budget");
    expect(findings[0]?.message).toContain("runs 4m07s");
    expect(findings[0]?.message).toContain("short-9x16 allows 3m00s");
  });

  it("names the beats that would fix it, lightest first, when it has the storyboard", () => {
    // 12 scenes of 20.54s = 246.5s, 66.5s over. Dropping the four lightest
    // beats saves 82s, which fits — and 0.85 is the threshold that drops them.
    const html = composition(1080, 1920, Array(12).fill(20.54));
    const sb = weighted(0.95, 0.95, 0.9, 0.85, 0.85, 0.8, 0.9, 0.8, 0.85, 0.95, 0.75, 0.7);

    const message = scanBudget(html, sb).at(0)?.message ?? "";
    expect(message).toContain("Dropping the 4 lowest-weighted beat(s)");
    // Ascending weight, so the beat the author ranked lowest goes first.
    expect(message).toContain(
      "b12 (weight 0.7), b11 (weight 0.75), b06 (weight 0.8), b08 (weight 0.8)",
    );
    // The flag by name, and a value that actually works: strictly above the
    // heaviest beat being cut, so the number can be pasted straight into the
    // command. "raise minWeight above 0.8" read as an instruction to edit the
    // format table, and 0.8 itself would have kept both 0.8-weighted beats.
    expect(message).toContain("Pass --min-weight 0.81 to short-9x16");
    // Nothing above the cut line is named — that would be advice, not arithmetic.
    expect(message).not.toContain("b01");
  });

  it("says the useful half without a storyboard, since `verify <dir>` has none", () => {
    const message = scanBudget(composition(1080, 1920, [200, 100])).at(0)?.message ?? "";

    expect(message).toContain("runs 5m00s");
    expect(message).toContain("shorten their narration by 2m00s");
  });

  it("warns, without failing, at a length only some destinations take", () => {
    // 120s posts to Shorts and not to Reels. That is a real deliverable with a
    // real loss in it, so it is neither an error nor silence.
    const findings = scanBudget(composition(1080, 1920, [60, 60]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.rule).toBe("near_budget");
    expect(findings[0]?.message).toContain("over the 1m30s");
  });

  it("holds a square post to the tightest feed a square video is made for", () => {
    // The same 246.5s demo, this time against post-1x1's 2m20s.
    const findings = scanBudget(composition(1080, 1080, Array(12).fill(20.54)));

    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain("post-1x1 allows 2m20s");
  });

  it("passes a short that fits", () => {
    expect(scanBudget(composition(1080, 1920, [40, 40]))).toEqual([]);
  });

  it("says so when a deck's canvas matches no declared format", () => {
    // Otherwise "no budget applied" and "the budget passed" print identically.
    const findings = scanBudget(composition(1234, 567, [10]));

    expect(findings[0]?.rule).toBe("unknown_canvas");
    expect(findings[0]?.message).toContain("1234x567");
  });

  it("ignores a file that is not a composition", () => {
    expect(scanBudget("<html><body><p>deck.html, not index.html</p></body></html>")).toEqual([]);
  });
});

describe("readCanvas / profilesFor", () => {
  it("reads the root's own attributes and not a scene's", () => {
    expect(readCanvas(composition(1080, 1920, [7, 9]))).toEqual({
      width: 1080,
      height: 1920,
      seconds: 16,
    });
  });

  it("returns both profiles that share 1920x1080, because pixels cannot tell them apart", () => {
    expect(profilesFor(1920, 1080).map((f) => f.id)).toEqual(["deck-16x9", "video-16x9"]);
    expect(profilesFor(1080, 1920).map((f) => f.id)).toEqual(["short-9x16"]);
  });
});

describe("scanDeterminism", () => {
  it("catches render-time variance that the gates would happily pass", () => {
    const html = [
      "<script>",
      "  const jitter = Math.random() * 4;",
      "  const t = Date.now();",
      "</script>",
    ].join("\n");

    expect(scanDeterminism(html, "index.html")).toEqual([
      {
        severity: "error",
        gate: "determinism",
        rule: "math_random",
        message:
          "index.html:2 calls `Math.random(` at render time, so two renders of this deck will not be identical.",
      },
      {
        severity: "error",
        gate: "determinism",
        rule: "date_now",
        message:
          "index.html:3 calls `Date.now(` at render time, so two renders of this deck will not be identical.",
      },
    ]);
  });

  it("leaves a CDN script tag alone — the compiler fetches it once, not per frame", () => {
    expect(
      scanDeterminism(
        `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>`,
        "index.html",
      ),
    ).toEqual([]);
  });
});

/** Minimal valid params per archetype — enough to satisfy the schema, no more. */
const PARAMS: Record<string, unknown> = {
  title: { headline: "The problem is quadratic" },
  callout: { headline: "It has costs", panels: [{ label: "Cost", lines: ["Memory"] }] },
  "data-table": { headline: "Ours wins", tableId: "t1", highlight: [] },
  "claim-figure": { headline: "It works", claim: "It works.", figureId: "f1" },
  pipeline: { headline: "Three stages, one pass", stages: [{ label: "In" }, { label: "Out" }] },
  stack: { headline: "Each layer sees the one below", layers: [{ label: "A" }, { label: "B" }] },
  "bar-compare": {
    headline: "Ours is four times smaller",
    bars: [
      { label: "Base", value: 4 },
      { label: "Ours", value: 1 },
    ],
  },
  grid: {
    headline: "Attention sees one window",
    cols: 4,
    rows: 4,
    regions: [{ x: 0, y: 0, w: 2, h: 2, label: "Window", tone: "a" }],
  },
};

function deck(...archetypes: string[]): Storyboard {
  return storyboardSchema.parse({
    sourceId: "s1",
    title: "A deck",
    beats: archetypes.map((archetype, i) => ({
      id: `b0${i + 1}-${archetype}`,
      intent: "The viewer understands the mechanism.",
      archetype,
      params: PARAMS[archetype],
    })),
  });
}

/**
 * The floor. `--slides` is a number the owner asked to hold, and the planner
 * routinely comes back under it — 8, 9, 9 and 10 against 12 on the last five real
 * plans. Nothing in the codebase compared the two numbers before this.
 */
describe("scanBeatCount", () => {
  const prefs = (over: Record<string, unknown> = {}) => prefsSchema.parse(over);

  it("prices the shortfall in the numbers it moved", () => {
    const findings = scanBeatCount(
      deck("title", "pipeline", "grid", "bar-compare"),
      prefs({ duration: 60, slides: 12, narration: { density: "low" } }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.gate).toBe("storyboard");
    expect(findings[0]?.rule).toBe("beats_under_target");

    const { message } = findings[0] ?? { message: "" };
    expect(message).toContain("12 beats were asked for and the plan returned 4");
    // NAMING THE NUMBERS IS THE VALUE. "the plan is short" changes nothing; the
    // per-slide seconds and characters are what the author can act on, and they
    // are the numbers the re-derivation actually moved.
    expect(message).toContain("15s instead of 5s");
    expect(message).toContain("characters where the prompt budgeted");
    // Reported, never repaired — and it says which of the two repairs is worse.
    expect(message).toContain("RULE 9");
    expect(message).toContain("built for 4 beats, not 12");
  });

  it("says nothing when the plan met its floor, or beat it", () => {
    const met = prefs({ duration: 60, slides: 4, narration: { density: "low" } });
    expect(scanBeatCount(deck("title", "pipeline", "grid", "bar-compare"), met)).toEqual([]);
    // Over the floor is not a defect: a floor is not a ceiling, and the prompt
    // says so in those words.
    expect(scanBeatCount(deck("title", "pipeline", "grid", "bar-compare", "stack"), met)).toEqual(
      [],
    );
  });

  it("still reports the miss with no duration target, in the terms that apply", () => {
    // Without a target there are no seconds to redistribute and no character
    // budget to miss, so the cost is the only one left — points the deck does not
    // make. It must NOT quote `undefined` seconds at the author.
    const findings = scanBeatCount(deck("title", "pipeline"), prefs({ slides: 5 }));
    expect(findings).toHaveLength(1);
    const { message } = findings[0] ?? { message: "" };
    expect(message).toContain("5 beats were asked for and the plan returned 2");
    expect(message).toContain("a point the deck never makes");
    expect(message).not.toContain("undefined");
  });
});

describe("scanDiagrammatic", () => {
  it("passes a deck that mostly draws", () => {
    expect(scanDiagrammatic(deck("title", "pipeline", "grid", "bar-compare", "stack"))).toEqual([]);
  });

  it("passes a deck split exactly down the middle", () => {
    expect(scanDiagrammatic(deck("title", "callout", "pipeline", "stack"))).toEqual([]);
  });

  it("warns on a deck of headlines and panels, naming each beat and what it could have drawn", () => {
    const findings = scanDiagrammatic(
      deck("title", "callout", "data-table", "claim-figure", "pipeline"),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.gate).toBe("storyboard");
    expect(findings[0]?.rule).toBe("text_heavy_deck");

    const { message } = findings[0] ?? { message: "" };
    expect(message).toContain("Only 1 of 5 beats draw anything");
    // Every text-only beat is named, and the one that draws is not accused.
    expect(message).toContain("b02-callout");
    expect(message).toContain("b03-data-table");
    expect(message).toContain("b04-claim-figure");
    expect(message).not.toContain("b05-pipeline");
    // The teaching half: a specific alternative, not "be more visual".
    expect(message).toContain("bar-compare, if the numbers share a unit");
    expect(message).toContain("annotated-figure");
  });
});

/**
 * The headline advisory, checked against the four REAL headlines it was built
 * from — two that must fire and two that must not.
 *
 * The two that must not are the whole point. This started as a prompt rule, and
 * every wording of it either missed the defect or condemned one of these two:
 * a frame-truth test condemns the good pipeline (its `Compact thought` stage is
 * drawn at 2.40 against a 1.55 landing, so the good headline is no truer of its
 * own first frame than the bad one), and an arity-of-coordination test condemns
 * the shipped demo's sharpest line. Both survive here because the check needs
 * BOTH conditions — labels recited AND spread across coordinated clauses — and
 * that conjunction is what these four cases pin.
 */
describe("scanHeadlines", () => {
  const beat = (id: string, archetype: string, headline: string, params: object): Storyboard =>
    storyboardSchema.parse({
      sourceId: "s1",
      title: "A deck",
      beats: [
        {
          id,
          intent: "The viewer understands the mechanism.",
          archetype,
          params: { headline, ...params },
        },
      ],
    });

  const STAGES = {
    stages: [
      { label: "Encoder", note: "From low-resolution input" },
      { label: "Windows", note: "Partitioned" },
      { label: "Shared DQ-CTM ticks", note: "One block" },
      { label: "Decoder", note: "Upsampled" },
    ],
  };

  it("flags a headline reciting its own stage labels as a list", () => {
    const findings = scanHeadlines(
      beat(
        "b06",
        "pipeline",
        "ThinkSR links encoding, windows, thought ticks, and decoding",
        STAGES,
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.gate).toBe("storyboard");
    expect(findings[0]?.rule).toBe("headline_recites_labels");
    expect(findings[0]?.message).toContain("b06");
  });

  it("still flags it when only the verb is swapped", () => {
    // Measured: this is what a real Codex run returned after the same rule was
    // put in the prompt instead. Cosmetic compliance is the failure mode a
    // check on the label strings exists to survive.
    expect(
      scanHeadlines(
        beat(
          "b06",
          "pipeline",
          "ThinkSR runs through encoder, windows, ticks, and decoder",
          STAGES,
        ),
      ),
    ).toHaveLength(1);
  });

  it("leaves the good headline alone, though it names all three of its stages", () => {
    expect(
      scanHeadlines(
        beat("b04", "pipeline", "A dense carrier is read and updated by compact thought", {
          stages: [
            { label: "Dense carrier", note: "Persistent spatial field" },
            { label: "Compact thought", note: "Shared block" },
            { label: "Updated carrier", note: "Written back" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("leaves the shipped demo's coordinated headline alone — it names no stage", () => {
    expect(
      scanHeadlines(
        beat("b02", "pipeline", "One pass in, one pass out, and a loop in the middle", {
          stages: [
            { label: "Encode", note: "SwinIR-style" },
            { label: "Window", note: "no pooling" },
            { label: "DQ-CTM", note: "shared ticks" },
            { label: "Decode", note: "×4 upsample" },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

/**
 * The name-before-reveal advisory, pinned on the two real cases that decided its
 * shape: one it must catch, one it must not.
 */
describe("scanNarrationLead", () => {
  const scene = { id: "s1", start: 0, holds: [2, 4, 6, 8] };
  const seg = (start: number, text: string) => ({
    scene: "s1",
    start,
    cues: [{ start: 0, end: 4, text }],
  });

  const beat = (archetype: string, params: object) =>
    storyboardSchema.parse({
      sourceId: "s1",
      title: "A deck",
      beats: [{ id: "b1", intent: "The viewer follows the path.", archetype, params }],
    }).beats;

  it("flags a stage named before the pipeline has drawn it", () => {
    // MEASURED on a real plan: the narration opened "After windowing, the same
    // DQ-CTM module is applied across ticks" over stages listed Encoder, Windows,
    // ticks, Decoder — so `Windows` was spoken 1.6s before it appeared.
    const found = scanNarrationLead(
      beat("pipeline", {
        headline: "One pass in, one pass out",
        stages: [{ label: "Encoder" }, { label: "Windows" }, { label: "Decoder" }],
      }),
      { scenes: [scene], segments: [seg(0, "After windowing the decoder reconstructs it.")] },
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("name_before_reveal");
    expect(found[0]?.message).toContain("Windows");
  });

  it("says nothing about an equation-walk, whose terms are already on screen", () => {
    // THE FALSE POSITIVE THAT SET THE EXCLUSION. `equation-walk` fades the whole
    // equation in at 0.8s and then tweens `color` and `scale` on symbols that
    // have been visible the whole time — measured off the real emitter. Naming a
    // term early is naming something the viewer is already looking at, and it
    // fired on two of two real plans for that reason alone.
    expect(
      scanNarrationLead(
        beat("equation-walk", {
          headline: "The carrier is read and written back",
          equationId: "eq-carrier",
          terms: [
            { tex: "x", label: "low-resolution input", tone: "a" },
            { tex: "y", label: "dense feature carrier", tone: "b" },
          ],
        }),
        {
          scenes: [scene],
          segments: [seg(0, "The low-resolution input becomes a dense feature carrier.")],
        },
      ),
    ).toEqual([]);
  });

  it("says nothing about bars, which land two holds at a time however many there are", () => {
    // THE 86-OF-90 CORRECTION, and the exact sentence that used to be the
    // prompt's worked example. `bar-compare` draws all its bars on TWO holds, so
    // the `holds[min(j, last)]` this replaces charged the third bar onward to
    // the final hold and read a word spoken over a bar already on screen as
    // 1.05-2.25s early, against a 1.0s threshold. Measured over the committed
    // corpus that arithmetic was 86 of the archetype's 90 flagged parts — 43% of
    // every flagged part there is. Fewer holds than parts means the map is
    // unsound, not that the narration is early.
    expect(
      scanNarrationLead(
        beat("bar-compare", {
          headline: "Four baselines and ours",
          bars: [
            { label: "CARN", value: 28.9 },
            { label: "IMDN", value: 29.1 },
            { label: "RFDN", value: 29.4 },
            { label: "DQ-CTM-SR", value: 30.5 },
          ],
        }),
        {
          scenes: [{ id: "s1", start: 0, holds: [3.65, 4.45] }],
          segments: [seg(0, "The reported averages put DQ-CTM-SR in the CNN baseline range.")],
        },
      ),
    ).toEqual([]);
  });

  it("charges a repeated label to the first thing that drew it", () => {
    // One utterance cannot be early for the SECOND copy of a label. `Decoder` is
    // drawn twice below and spoken once, over the first one, which is on screen
    // by then — the index walk this replaces measured that word against the
    // second draw at 6s and called it 2.7s early.
    expect(
      scanNarrationLead(
        beat("pipeline", {
          headline: "Two passes, one decoder",
          stages: [{ label: "Decoder" }, { label: "Windows" }, { label: "Decoder" }],
        }),
        {
          scenes: [scene],
          segments: [seg(3, "The decoder runs, then windows, then it runs again.")],
        },
      ),
    ).toEqual([]);
  });
});

/**
 * RULE 9, pinned on the four real pairs it was measured against.
 *
 * The two that must NOT fire carry the whole design. Matching on the shared
 * evidence id alone fires on ten of the 134 plans in the repo, and one of them is
 * `demo/storyboard.json` — a bar-compare and then a data-table off `tbl-bench`,
 * which is the shape, then the numbers, and is a deck teaching rather than
 * repeating. Requiring the archetype AND the drawn labels to match as well takes
 * it to four plans, every one of them the identical five bars drawn twice.
 */
describe("scanRepeatedObject", () => {
  const BARS = [
    { label: "CARN", value: 1.59 },
    { label: "IMDN", value: 0.72 },
    { label: "RFDN", value: 0.55 },
    { label: "CATANet", value: 0.48 },
    { label: "DQ-CTM-SR", value: 0.41 },
  ];

  const deck = (...beats: object[]): Storyboard =>
    storyboardSchema.parse({
      sourceId: "s1",
      title: "A deck",
      beats: beats.map((b) => ({
        intent: "The viewer sees the numbers.",
        ...b,
      })),
    });

  it("flags the real pair: two bar-compares over the same five bars from one table", () => {
    const findings = scanRepeatedObject(
      deck(
        {
          id: "b10-params",
          archetype: "bar-compare",
          params: { headline: "DQ-CTM-SR is the smallest of the five", bars: BARS },
          evidence: [{ kind: "table", id: "tbl-bench" }],
        },
        {
          id: "b11-average",
          archetype: "bar-compare",
          params: { headline: "It also scores highest on average", bars: BARS },
          evidence: [{ kind: "table", id: "tbl-bench" }],
        },
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.gate).toBe("storyboard");
    expect(findings[0]?.rule).toBe("object_drawn_twice");
    expect(findings[0]?.message).toContain("b10-params");
    expect(findings[0]?.message).toContain("b11-average");
    expect(findings[0]?.message).toContain("RULE 9");
  });

  it("leaves the shipped demo alone: same table, bars then the table itself", () => {
    // THE CASE THAT SETS THE THRESHOLD. `demo/storyboard.json` does exactly this
    // and it is the deck everything else in the repo is measured against.
    expect(
      scanRepeatedObject(
        deck(
          {
            id: "b08",
            archetype: "bar-compare",
            params: { headline: "Five methods, one axis", bars: BARS },
            evidence: [{ kind: "table", id: "tbl-bench" }],
          },
          {
            id: "b09",
            archetype: "data-table",
            params: {
              headline: "The numbers behind the bars",
              tableId: "tbl-bench",
              highlight: [],
            },
            evidence: [{ kind: "table", id: "tbl-bench" }],
          },
        ),
      ),
    ).toEqual([]);
  });

  it("leaves different cuts of one table alone — different bars are a different picture", () => {
    // Measured on experiments/013-vocabulary/planner/runs/A0-05: three
    // bar-compares off `tbl-bench` with different bars in each. Whether three is
    // too many is editorial; that they draw different pictures is not.
    expect(
      scanRepeatedObject(
        deck(
          {
            id: "b07-cnn",
            archetype: "bar-compare",
            params: { headline: "The CNNs cluster", bars: BARS.slice(0, 3) },
            evidence: [{ kind: "table", id: "tbl-bench" }],
          },
          {
            id: "b08-gap",
            archetype: "bar-compare",
            params: { headline: "The transformers do not", bars: BARS.slice(3) },
            evidence: [{ kind: "table", id: "tbl-bench" }],
          },
        ),
      ),
    ).toEqual([]);
  });

  it("exempts a camera dive — sharing the object is the relation, not a repeat", () => {
    expect(
      scanRepeatedObject(
        deck(
          {
            id: "b06",
            archetype: "pipeline",
            params: {
              headline: "Attention runs inside each window",
              stages: [{ label: "Encoder" }, { label: "Windows" }, { label: "Decoder" }],
            },
            evidence: [{ kind: "figure", id: "fig-arch" }],
          },
          {
            id: "b07",
            archetype: "pipeline",
            params: {
              headline: "Each window carries its own carrier",
              stages: [{ label: "Encoder" }, { label: "Windows" }, { label: "Decoder" }],
            },
            evidence: [{ kind: "figure", id: "fig-arch" }],
            inside: { beat: "b06", element: "stage1" },
          },
        ),
      ),
    ).toEqual([]);
  });

  it("says nothing about two beats reading the same section", () => {
    // A section is a place in the source, not a picture. RULE 9 names only
    // tables, equations and figures, and two beats off one section is ordinary.
    expect(
      scanRepeatedObject(
        deck(
          {
            id: "b01",
            archetype: "callout",
            params: { headline: "The problem", panels: [{ label: "Cost", lines: ["Too slow"] }] },
            evidence: [{ kind: "section", id: "sec1" }],
          },
          {
            id: "b02",
            archetype: "callout",
            params: { headline: "The problem", panels: [{ label: "Cost", lines: ["Too slow"] }] },
            evidence: [{ kind: "section", id: "sec1" }],
          },
        ),
      ),
    ).toEqual([]);
  });
});

/**
 * The floor, measured on the artifact.
 *
 * The pass case here is the one the review actually rendered: a 73-character
 * headline that a `> 60 chars` rule scored as a defect and that comes out at
 * 132px over three lines, looking correct (VOCABULARY-REVIEW §3.3). Every number
 * in these fixtures is a number `decksmith build` emits — `.bighead` at 132,
 * `.sub` at 48, `.eyebrow` at 42 — so a rule that fires here fires on the
 * shipping deck.
 */
describe("scanTypeFloor", () => {
  const page = (css: string, body = "") =>
    `<style>${css}</style><div id="root" data-width="1920">${body}</div>`;

  it("passes the sizes the demo actually declares", () => {
    expect(
      scanTypeFloor(
        page(".bighead{font-size:132px}.sub{font-size:48px}.eyebrow{font-size:42px}"),
        "index.html",
      ),
    ).toEqual([]);
  });

  /**
   * The whole point. 73 characters is not a size, and this headline is 3.3x the
   * floor. A gate that failed it would be teaching people to stop reading it.
   */
  it("says nothing about a 73-character headline, because length is not size", () => {
    const long = "Compact thought, dense output: what a persistent carrier actually buys us";
    expect(long).toHaveLength(73);
    const html = page(".bighead{font-size:132px}", `<h1 class="bighead" id="s1-t">${long}</h1>`);
    expect(scanTypeFloor(html, "index.html")).toEqual([]);
  });

  // Inclusive: the demo declares exactly 40 in ten places.
  it("treats the floor as a floor", () => {
    expect(scanTypeFloor(page(`.cap{font-size:${TYPE_FLOOR_PX}px}`), "index.html")).toEqual([]);
    expect(scanTypeFloor(page(".cap{font-size:39.5px}"), "index.html")).toHaveLength(1);
  });

  it("fails a run under the floor and names where it was declared", () => {
    const findings = scanTypeFloor(page(".sub{font-size:28px}"), "index.html");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.gate).toBe("typography");
    expect(findings[0]?.rule).toBe("type_below_floor");
    expect(findings[0]?.message).toContain("28px on .sub");
    expect(findings[0]?.message).toContain("index.html");
  });

  it("prefers the element's own id to its class, since that is what emit stamped", () => {
    const html = page("", `<div class="cap" id="s7-lab1" style="font-size:30px">x</div>`);
    expect(scanTypeFloor(html, "index.html")[0]?.message).toContain("30px on #s7-lab1");
  });

  /**
   * An SVG's `font-size` is in user units, and a user unit is a reference pixel
   * only while `width` and the viewBox agree — which is how every SVG the
   * archetypes emit is drawn, and not something to assume of the next one.
   */
  it("converts an SVG's user units before judging them", () => {
    const half = `<svg width="850" height="239" viewBox="0 0 1700 478"><text font-size="60">x</text></svg>`;
    expect(scanTypeFloor(page("", half), "index.html")[0]?.message).toContain("30px");

    const flat = `<svg width="1700" height="478" viewBox="0 0 1700 478"><text font-size="40">x</text></svg>`;
    expect(scanTypeFloor(page("", flat), "index.html")).toEqual([]);
  });

  /**
   * "The rule did not apply" and "the rule passed" have to stay distinguishable,
   * or the floor quietly stops covering whatever moved to relative units.
   */
  it("says when it could not resolve a size instead of passing it", () => {
    const findings = scanTypeFloor(page(".cap{font-size:0.8em}"), "index.html");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("type_unmeasurable");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("em");
  });

  it("reports the smallest offenders first, and does not print a hundred of them", () => {
    const css = Array.from({ length: 9 }, (_, i) => `.c${i}{font-size:${39 - i}px}`).join("");
    const message = scanTypeFloor(page(css), "index.html")[0]?.message ?? "";
    expect(message).toContain("9 text size(s)");
    expect(message).toContain("31px on .c8");
    expect(message).toContain("36px on .c3");
    expect(message).not.toContain("37px on .c2");
    expect(message).toContain("…");
  });
});

/**
 * THE INSTRUMENT CHECK the sweep's corpus cannot perform.
 *
 * `experiments/sweep/ledger.json` records nine cells that must be CLEAN, so a
 * predicate that has quietly stopped firing satisfies every one of them — the
 * corpus proves fixes have not been reverted and can never prove the ruler still
 * has marks on it. These cases give both halves inputs whose answer is known and
 * is not "nothing": the widened sampling must actually widen, and the collision
 * rule must actually collide.
 */
describe("the sweep's two instruments still register", () => {
  let seq = 0;
  const run = (text: string, y: number, h = 50) => ({ node: seq++, text, x: 100, y, w: 200, h });
  /** Two client rects of ONE text node — what Chrome hands back for a wrapped label. */
  const split = (text: string, y: number, h = 50) => {
    const node = seq++;
    return [
      { node, text, x: 100, y, w: 200, h },
      { node, text, x: 100, y: y + 10, w: 200, h },
    ];
  };

  it("finds two labels printed through each other", () => {
    // 30px of shared height on 200px of shared width — the shape of the
    // line-chart defect, where a value label sat on the delta label under it.
    const pairs = overprints([run("28.90", 100), run("+0.90", 120)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.overlap).toEqual([200, 30]);
  });

  it("does not call abutting lines a collision", () => {
    // A text run's client rect carries the font's leading, so two lines of one
    // stacked label overlap by a few pixels while being perfectly legible. At a
    // threshold of zero the first sweep called every multi-line label a defect.
    expect(overprints([run("line one", 100), run("line two", 100 + 50 - MIN_OVERLAP)])).toEqual([]);
  });

  it("ignores two rects of ONE text node, which is one label Chrome split", () => {
    expect(overprints(split("T=4", 100))).toEqual([]);
  });

  it("still reports two DIFFERENT labels that happen to read the same", () => {
    // The skip above used to compare the string, so two chart labels showing the
    // same rounded value were exempt from each other — and `text` is truncated
    // at 40 characters, so two long labels agreeing on their opening were too.
    // Both are real collisions: the audience sees one smudge.
    expect(overprints([run("28.90", 100), run("28.90", 120)])).toHaveLength(1);
  });

  /**
   * THE PAGE-SIDE HALF, which is the half that can fail by returning NOTHING.
   *
   * `overprints` above is pure and its failure is loud. `collectSvgTextRuns` runs
   * inside Chrome, is reached only through `page.evaluate`, and is coupled to two
   * things it does not own: the `data-composition-id` attribute the emitter
   * writes, and the fact that chart labels are `<text>` inside an `<svg>`. Rename
   * either and it returns `[]` — every corpus cell stays clean, every case above
   * still passes, and the collision rule is gone without a word. So the walk is
   * driven here against a DOM stub, and `scripts/sweep.mjs` separately checks the
   * attribute against a really-built deck, because a stub cannot.
   */
  interface StubRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  interface StubText {
    nodeType: number;
    textContent: string;
    rects: StubRect[];
  }
  interface StubEl {
    tagName: string;
    style: { display: string; visibility: string; opacity: string };
    childNodes: (StubText | StubEl)[];
    children: StubEl[];
  }
  const rect = (x: number, y: number, width = 60, height = 20): StubRect => ({
    x,
    y,
    width,
    height,
  });
  const txt = (textContent: string, ...rects: StubRect[]): StubText => ({
    nodeType: 3,
    textContent,
    rects,
  });
  const tag = (
    tagName: string,
    kids: (StubText | StubEl)[] = [],
    style: Partial<StubEl["style"]> = {},
  ): StubEl => ({
    tagName,
    style: { display: "block", visibility: "visible", opacity: "1", ...style },
    childNodes: kids,
    children: kids.filter((k): k is StubEl => "tagName" in k),
  });

  /** Install just enough `document`/`CSS`/`getComputedStyle` to run the walk. */
  const inPage = (scene: StubEl | null): TextRun[] => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = {
      document: g.document,
      CSS: g.CSS,
      getComputedStyle: g.getComputedStyle,
    };
    const cur: { node?: StubText } = {};
    g.CSS = { escape: (s: string) => s };
    g.getComputedStyle = (e: StubEl) => e.style;
    g.document = {
      querySelector: () => scene,
      createRange: () => ({
        selectNodeContents: (n: StubText) => {
          cur.node = n;
        },
        getClientRects: () => cur.node?.rects ?? [],
      }),
    };
    try {
      return collectSvgTextRuns("s6");
    } finally {
      Object.assign(g, saved);
    }
  };

  it("collects the glyphs of every text node inside the scene's svg", () => {
    const runs = inPage(
      tag("div", [
        tag("div", [tag("svg", [tag("g", [tag("text", [txt("28.90", rect(10, 20))])])])]),
      ]),
    );
    expect(runs).toEqual([{ node: 0, text: "28.90", x: 10, y: 20, w: 60, h: 20 }]);
  });

  it("gives one text node one id however many line boxes Chrome returns", () => {
    // The pairing rule leans on this: two rects of one node must not be a
    // collision, and it is this function that has to make them recognisable.
    const runs = inPage(
      tag("div", [
        tag("svg", [tag("text", [txt("a long wrapped label", rect(0, 0), rect(0, 18))])]),
      ]),
    );
    expect(runs.map((r) => r.node)).toEqual([0, 0]);
    expect(overprints(runs)).toEqual([]);
  });

  it("ignores text that is not inside an svg", () => {
    // Everything outside a chart is `hyperframes check`'s business; a second
    // opinion on it is how two definitions of "broken" start to drift.
    expect(
      inPage(tag("div", [tag("h1", [txt("The encoder makes the field", rect(0, 0))])])),
    ).toEqual([]);
  });

  it("does not measure a chart that is hidden or not yet faded in", () => {
    const hidden = (style: Partial<StubEl["style"]>) =>
      inPage(tag("div", [tag("div", [tag("svg", [tag("text", [txt("x", rect(0, 0))])])], style)]));
    expect(hidden({ display: "none" })).toEqual([]);
    expect(hidden({ visibility: "hidden" })).toEqual([]);
    expect(hidden({ opacity: "0" })).toEqual([]);
    expect(hidden({ opacity: "0.3" })).toHaveLength(1);
  });

  it("returns nothing when the scene selector matches nothing", () => {
    // Pinned because this is the silent-failure path: if the emitter stops
    // writing `data-composition-id`, this is what every scene looks like.
    expect(inPage(null)).toEqual([]);
  });

  it("reports one finding per scene, naming the worst stop", () => {
    const findings = gradeOverprint([
      { sid: "s7", t: 1, pairs: [{ a: "a", b: "b", overlap: [10, 10] }] },
      {
        sid: "s7",
        t: 2,
        pairs: [
          { a: "a", b: "b", overlap: [10, 10] },
          { a: "c", b: "d", overlap: [12, 12] },
        ],
      },
      { sid: "s8", t: 3, pairs: [] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("svg_text_overprint");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain("2 overlapping pair(s) at t=2s");
  });

  it("adds the deck's stops to the midpoint grid rather than replacing it", () => {
    // `--at` REPLACES upstream's nine midpoints. Handing over only the stops
    // would silently delete the coverage that catches `data-table` at 9 rows,
    // which no stop of its own reaches.
    const times = sampleTimes([91.4], 92.5);
    expect(times).toContain(91.4);
    // (0 + 0.5) / 9 * 92.5, upstream's own formula.
    expect(times).toContain(5.139);
    expect(times).toHaveLength(10);
  });

  it("drops a stop past the end and keeps the list sorted and unique", () => {
    expect(sampleTimes([50, 50, 999], 100)).toEqual([
      5.556, 16.667, 27.778, 38.889, 50, 61.111, 72.222, 83.333, 94.444,
    ]);
  });

  it("falls back to the plain grid when there are no stops", () => {
    expect(sampleTimes([], 9)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
  });

  /**
   * THE COPY IS ONLY SAFE WHILE IT IS STILL A COPY.
   *
   * `sampleTimes` reproduces three facts about the pinned `hyperframes`: that
   * `--at` REPLACES the grid rather than adding to it, that the grid is nine
   * points, and that a point is `(i + 0.5) / n * duration`. All three are read
   * off a private function in a dependency, and nothing else in this repository
   * would notice them changing — `.github/workflows/upstream-drift.yml` watches
   * the version string, and a version bump is exactly when they would change.
   * Get any of them wrong and the union silently NARROWS, which is the one
   * outcome the union exists to prevent, so the alarm is here.
   *
   * If this fails, read `buildLayoutSampleTimes` in the new version and make
   * `sampleTimes` agree with it again. Do not relax the assertion.
   */
  it("still matches the grid the pinned hyperframes would have used", async () => {
    const cli = await readFile(
      new URL("../node_modules/hyperframes/dist/cli.js", import.meta.url),
      "utf8",
    );
    const fn = /function buildLayoutSampleTimes\([\s\S]{0,600}?\n\}/.exec(cli)?.[0] ?? "";
    expect(fn, "buildLayoutSampleTimes is gone from hyperframes/dist/cli.js").not.toBe("");
    // `at` short-circuits, so passing stops DELETES the grid.
    expect(fn).toMatch(/if \(at\w*\?\.length\) \{\s*return/);
    // …and the grid it deletes is nine of these.
    expect(fn).toContain("(index + 0.5) / count * duration");
    expect(cli).toMatch(/DEFAULT_CHECK_OPTIONS = \{[\s\S]{0,400}?samples: 9,/);
  });
});

/**
 * Fixtures are real `hyperframes check --json` output, trimmed: the pass case is
 * `experiments/hf-thinksr`, the fail case a deck deliberately broken with an
 * oversized headline and near-invisible body text. Both were captured from 0.7.71.
 */
import { describe, expect, it } from "vitest";
import { type Storyboard, storyboardSchema } from "../src/types.js";
import { profilesFor, readCanvas, scanBudget } from "../src/verify/budget.js";
import { check, parseCheckReport } from "../src/verify/check.js";
import {
  scanDeterminism,
  scanDiagrammatic,
  scanHeadlines,
  scanRepeatedObject,
} from "../src/verify/index.js";
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

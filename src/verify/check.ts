/**
 * The mechanical gate.
 *
 * `hyperframes check` boots one headless Chrome and runs five passes over a built
 * composition — lint, runtime, layout, motion, WCAG contrast — and since 0.7.71
 * prints the whole report as JSON under `--json`. So this module shells out and
 * relabels; it does not parse prose. There is no text-parsing fallback because
 * the CLI is pinned and every pinned version has the flag — output we cannot
 * parse is reported as a finding rather than guessed at.
 *
 * What these gates prove: the deck loads, no element escapes its clip container
 * or the canvas, no tween lands on NaN, every run of text clears AA contrast.
 *
 * What they do not prove: that a slide says anything true, or anything at all. A
 * deck whose every beat is a beautifully typeset non-sequitur passes all five.
 * Closing that gap is the T2 fidelity pass (INITIAL_DESIGN §5) — a VLM reading
 * frames against each beat's `intent` and cited `evidence` — and is explicitly
 * not in v0. Treat a green verdict as "shippable mechanics", never as "correct".
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Finding, Verdict } from "../types.js";

const run = promisify(execFile);

/** A real check boots Chrome and samples nine frames; ~60s is normal, so leave room. */
const DEFAULT_TIMEOUT_MS = 240_000;

/** The report's per-gate sections, in the order the CLI runs them. */
const GATES = ["lint", "runtime", "layout", "motion", "contrast"] as const;

const SEVERITIES = new Set(["error", "warning", "info"]);

/**
 * No `strict` option on purpose. Upstream's `--strict` fails on warnings, and
 * every real deck emits `composition_file_too_large` — its limit is 300
 * structural lines, which a seven-beat deck already passes. Its remedy is to
 * split into sub-compositions, which is exactly the structure that makes a deck
 * non-navigable (EXPERIMENT-003). So the flag could never pass, and a switch
 * that cannot succeed is worse than no switch.
 */
export interface CheckOptions {
  /** Also write the five contrast-pass PNGs to `<dir>/snapshots`. */
  snapshots?: boolean;
  timeoutMs?: number;
}

/** Run the HyperFrames gates over a built project directory. */
export async function check(dir: string, opts: CheckOptions = {}): Promise<Verdict> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = ["hyperframes", "check", "--json", dir];
  if (opts.snapshots) args.push("--snapshots");

  // The deadline, not the exit status, is what tells us a run was cut short: npx
  // swallows the SIGTERM that `timeout` sends, so the promise resolves normally
  // with a truncated stdout and `killed` never gets set.
  const started = Date.now();
  // Read before the run, not after: the windows describe the artifact we are
  // about to gate, and a concurrent rebuild between the two would grade this
  // report against another deck's camera.
  const transit = await readTransit(dir);
  try {
    const { stdout, stderr } = await run("npx", args, { timeout: timeoutMs, maxBuffer: 32 << 20 });
    return interpret(stdout, stderr, { timeoutMs, elapsed: Date.now() - started, transit });
  } catch (err) {
    // A failing gate exits non-zero but still prints the whole report on stdout.
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return interpret(e.stdout ?? "", e.stderr ?? "", {
      timeoutMs,
      elapsed: Date.now() - started,
      failure: e.message.trim(),
      transit,
    });
  }
}

/**
 * The camera's transit windows, as the composition itself published them.
 *
 * `emitDeck` writes `data-ds-transit="t0,t1"` on a scene the camera flies out
 * of (`transitWindow` in `emit/camera.ts`). Reading them back here is what lets
 * `regrade` tell "the plate is cut off" from "the plate is mid-flight", without
 * the gate needing to know what a camera is.
 *
 * A deck we cannot read yields no windows, which grades exactly as it did
 * before this existed — the strict direction. Never the permissive one: a
 * missing file must not become a blanket exemption.
 */
async function readTransit(dir: string): Promise<Window[]> {
  let html: string;
  try {
    html = await readFile(join(dir, "index.html"), "utf8");
  } catch {
    return [];
  }
  const out: Window[] = [];
  // The id and the window live in the same tag, so one match gets both. `[^>]*`
  // rather than `.*` so a second scene's attributes cannot be spliced onto the
  // first scene's id.
  for (const m of html.matchAll(/id="(s\d+)"[^>]*?data-ds-transit="([\d.]+),([\d.]+)"/g)) {
    const t0 = Number(m[2]);
    const t1 = Number(m[3]);
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0)
      out.push({ sid: m[1] as string, t0, t1 });
  }
  return out;
}

/**
 * Turn one `hyperframes check --json` run into a verdict.
 *
 * Findings carry no `beatId`: the gates report DOM selectors, and mapping a
 * selector back to a beat needs the scene→beat table that `emit` owns. The scene
 * id survives inside the message (`[#s3 .term t=12.5s]`), which is enough to aim
 * a repair round by hand until T2 makes it mechanical.
 *
 * `transit` defaults to none, which is the STRICT grading — a caller who does
 * not supply the deck's camera windows gets every off-canvas finding as an
 * error, exactly as before the camera existed.
 */
export function parseCheckReport(stdout: string, stderr = "", transit: Window[] = []): Verdict {
  return interpret(stdout, stderr, { transit });
}

interface RunContext {
  timeoutMs?: number;
  elapsed?: number;
  /** The error message, when the process itself failed to run. */
  failure?: string;
  /** Camera transit windows read off the composition; see `readTransit`. */
  transit?: Window[];
}

/** One camera transit, `[t0, t1]` in absolute deck seconds. */
/**
 * A camera's transit window, and WHOSE it is.
 *
 * The sid matters because the guarantee is not symmetric. `assertStopsOutsideMove`
 * promises that no stop of the DIPPING scene lands inside its own move; it
 * promises nothing about the INCOMING scene, whose first stop can fall inside the
 * tail (a review built exactly that deck to check). So an exemption granted on
 * time alone excuses a finding about a scene the emitter never vouched for.
 */
type Window = { sid: string; t0: number; t1: number };

/**
 * A finding plus the numeric time upstream reported it at.
 *
 * `toFinding` folds the time into the message for the human, and the number is
 * gone by then. `regrade` needs it back, so it travels alongside rather than
 * being re-parsed out of prose.
 */
interface Timed {
  f: Finding;
  time: number | undefined;
  /**
   * The raw selector, carried rather than re-parsed out of the message.
   *
   * `regrade` needs to know WHICH scene a finding is about, and `Finding` has
   * nowhere to put a selector — so it travels alongside for the same reason
   * `time` does. Digging it back out of prose would make the exemption depend on
   * how the message happens to be formatted.
   */
  selector: string | undefined;
}

function interpret(stdout: string, stderr: string, ctx: RunContext): Verdict {
  const report = readJson(stdout);
  if (!report) {
    if (ctx.timeoutMs !== undefined && (ctx.elapsed ?? 0) >= ctx.timeoutMs) {
      return {
        passed: false,
        findings: [
          tooling(
            "timeout",
            `\`hyperframes check\` was cut off after ${ctx.timeoutMs} ms. The deck may hang on load, or Chrome may still be downloading — try \`npx hyperframes browser install\`.`,
          ),
        ],
      };
    }
    if (ctx.failure)
      return {
        passed: false,
        findings: [
          tooling("invocation_failed", `Could not run \`npx hyperframes check\`: ${ctx.failure}`),
        ],
      };
    return {
      passed: false,
      findings: [
        tooling(
          "unparseable_output",
          `\`hyperframes check --json\` produced no JSON report. Last output: ${tail(stderr || stdout)}`,
        ),
      ],
    };
  }

  const findings: Timed[] = [];
  for (const gate of GATES) {
    const section = record(report[gate]);
    const raw = section?.findings;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      const f = record(item);
      if (f) findings.push(toFinding(gate, f));
    }
  }
  findings.push(
    ...staticGuardFindings(stderr).map((f) => ({ f, time: undefined, selector: undefined })),
  );

  const graded = findings.map((t) => regrade(t, ctx.transit));
  // `ok` is upstream's verdict at upstream's severities; ours is that verdict
  // AND our own re-grading. It cannot be left to `ok` alone, because the whole
  // point of `regrade` is that some findings matter more here than there — a
  // deck whose content leaves the canvas comes back `ok: true` (see below).
  return {
    passed: report.ok === true && graded.every((f) => f.severity !== "error"),
    findings: graded,
  };
}

/**
 * Findings whose severity is ours to set, in both directions.
 *
 * Re-graded rather than dropped or hand-counted. A filtered-out finding is
 * invisible, and invisible is how a rule stops being a decision and becomes a
 * habit; `info` still prints in `report()` and just stops counting against the
 * warning total, so the deck reads PASS with the warnings that are genuinely
 * still open.
 *
 * UP — `canvas_overflow`, `panel_out_of_canvas` and `text_occluded` arrive as
 * `info` or `warning`, never as an error, and `ok` stays true over all of them.
 * MEASURED on 0.7.71 against a deck built to overflow: 41 `info` + 7 `warning`,
 * `ok: true`. Upstream is not wrong for a
 * general composition tool: an element outside the canvas is often deliberate,
 * mid-flight in a transition, and a hidden element is often about to be shown.
 * Neither is true of a slide. Every DeckSmith frame the audience sees is a
 * static plate at a hold, so content outside the canvas is content that was
 * cut off, and text under a panel is text nobody reads. That is not a note on a
 * correct deck; it is the deck being wrong. What it looked like when this was
 * only informational: the 9x16 demo cut "the next window" to "the / win",
 * truncated `X = W(F)` to `X =` and then explained a symbol that is not on
 * screen, and sliced "0.7" through the middle of the number — and reported PASS.
 *
 * Graded up for EVERY format, not only portrait. A 16x9 deck that overflows is
 * broken in exactly the same way and escaped notice only because it does not
 * happen to overflow today; a rule that fires only where the bug was found is a
 * rule that lets the next one through.
 *
 * DOWN — the two below.
 *
 * IN TRANSIT — the grade-up above assumes every sampled frame is a plate the
 * audience reads. During a camera dive it is not: the plate is deliberately
 * larger than the canvas, because that is what flying into part of it means.
 * MEASURED on `demo/fixtures/camera.storyboard.json`, whose move is [9, 10.8]:
 * upstream samples 9 frames over 19.8s, exactly one of which (9.9s) lands in
 * the move, and reports 7 `canvas_overflow` there. Upstream itself calls them
 * `info` — `applyPersistenceTier` demotes a dynamic issue seen in a single
 * sample — and `ok` stays true. The grade-up alone was turning that into
 * `FAIL — 7 error(s)` on a correct camera, which is why no storyboard in the
 * repo could use `inside`.
 *
 * The exemption is TIME-BOUNDED and nothing else. A finding is spared only if
 * its own reported time falls strictly inside a window the composition itself
 * published, so the rule keeps its teeth everywhere the audience is actually
 * looking: `assertStopsOutsideMove` guarantees no hold is ever inside a window,
 * so anything genuinely wrong with the plate is wrong at rest, and at rest the
 * gate is still sampling it and still grading it up. PROVED by building the
 * same fixture with a 130-char unbreakable word in the containing beat's note,
 * which overflows at scale 1 forever: it is reported at 5.5s as well as 9.9s,
 * 5.5 is outside [9, 10.8], and the deck still FAILs.
 *
 * This is deliberately not `data-layout-allow-overflow`, which was tried first
 * and does work: upstream's `hasAllowOverflowFlag` is a `closest()` ancestor
 * test with no notion of time, and every moving glyph is inside the camera rig,
 * so the flag hides the 5.5s defect too. A gate that cannot see a real overflow
 * is worse than one that shouts about a fake one.
 *
 * `composition_file_too_large` — upstream counts LINES and justifies itself by
 * "easier to read, iterate on, and diff". Every word of that is about a
 * composition a person maintains. Ours is generated on every build from the
 * storyboard, and no human reads, edits or diffs it; the artifact people work on
 * is `src/emit/`. Splitting it into sub-compositions to satisfy the rule would
 * buy nothing and put real things at risk: invariant 7 (`deck.html` must never
 * contain "data-composition-id"), the island's fragment layout, and the
 * byte-identical fixture. And because the count grows about 52 lines a beat, it
 * fires on every correct deck of more than a dozen beats — a warning that is
 * always on is one nobody reads. Revisit only if upstream starts measuring
 * something that tracks a real cost, like bytes or parse time.
 */
function regrade({ f, time, selector }: Timed, transit: Window[] = []): Finding {
  if (OFF_CANVAS.has(f.rule)) {
    // Scoped to the DIPPING scene where the selector names a scene at all. The
    // emitter's guarantee is about that scene's own stops, so excusing a finding
    // against a different scene on the strength of it is excusing something
    // nobody promised. Where the selector names no scene — `div.ds-zoom`, the rig
    // itself — time is all there is, and the message says so rather than claiming
    // a guarantee it cannot check.
    const named = /#(s\d+)\b/.exec(selector ?? "")?.[1];
    const hit =
      time === undefined
        ? undefined
        : transit.find(
            (w) => time > w.t0 && time < w.t1 && (named === undefined || named === w.sid),
          );
    if (hit) {
      const why =
        named === hit.sid
          ? `no stop of ${hit.sid} is inside this window`
          : "the element names no scene, so this is excused on time alone";
      return {
        ...f,
        severity: "info",
        message: `${f.message} — accepted: mid-camera-move, ${why}.`,
      };
    }
    return { ...f, severity: "error" };
  }
  if (f.gate === "lint" && f.rule === "composition_file_too_large") {
    return { ...f, severity: "info", message: `${f.message} — accepted: generated, not authored.` };
  }
  return f;
}

/**
 * Matched on rule alone, not on `gate` + rule. These three names are
 * unambiguous across the report, and if upstream ever moves one between the
 * layout and runtime passes we would still want it graded up — pinning the gate
 * would turn their refactor into our silent regression.
 */
const OFF_CANVAS = new Set(["canvas_overflow", "panel_out_of_canvas", "text_occluded"]);

function toFinding(gate: string, f: Record<string, unknown>): Timed {
  const severity =
    typeof f.severity === "string" && SEVERITIES.has(f.severity)
      ? (f.severity as Finding["severity"])
      : "warning";
  const message = str(f.message) ?? "(no message)";
  // Static gates stamp `time: 0` on findings that have no timeline position at
  // all; printing "t=0s" there would send a repair round hunting for a moment.
  const time = typeof f.time === "number" && f.time > 0 ? f.time : undefined;
  const at = time !== undefined ? `t=${time}s` : undefined;
  const where = [str(f.selector) ?? str(f.containerSelector), at].filter(Boolean).join(" ");
  return {
    f: {
      severity,
      gate,
      rule: str(f.code) ?? "unknown",
      // "Text extends outside the composition canvas." is unactionable without the
      // element it happened to, and Finding has nowhere else to put it.
      message: where ? `${message} [${where}]` : message,
    },
    time,
    selector: str(f.selector) ?? str(f.containerSelector),
  };
}

/**
 * StaticGuard writes to stderr and never appears in the JSON report, so a deck can
 * come back `ok: true` while a font silently falls back (invariant 9). It is a
 * warning rather than an error because it disagrees with `lint` on the one case we
 * ship: an `@font-face` in an external stylesheet satisfies lint and still trips
 * StaticGuard (INITIAL_DESIGN §3, gap 5). Surface it; do not let it fail a build.
 */
function staticGuardFindings(stderr: string): Finding[] {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("[StaticGuard]"))
    .map((line) => ({
      severity: "warning" as const,
      gate: "staticguard",
      rule: "contract_violation",
      message: line.slice("[StaticGuard]".length).trim(),
    }));
}

function tooling(rule: string, message: string): Finding {
  return { severity: "error", gate: "check", rule, message };
}

/** The CLI prints bare JSON, but tolerate a banner or a trailing newline of noise. */
function readJson(stdout: string): Record<string, unknown> | undefined {
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  if (first < 0 || last < first) return undefined;
  try {
    return record(JSON.parse(stdout.slice(first, last + 1)));
  } catch {
    return undefined;
  }
}

function record(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function tail(s: string): string {
  const lines = s.trim().split("\n");
  return lines.slice(-3).join(" / ").slice(0, 400) || "(nothing)";
}

/**
 * Three gates on a scene's MOTION, which no other gate here looks at, run in
 * the renderer's own browser at the narration's cue boundaries.
 *
 *  1. `static_hold` — the picture must change during every narration cue. A
 *     v2 archetype finishes building in about five seconds and then holds still
 *     for fifteen to twenty seconds of speech (spike, 2026-10-07: 0 px changed
 *     between cue ends on two of four beats). A bespoke scene exists to keep
 *     explaining while the voice does, so for one this is an error.
 *  2. `graphic_crosses_text` (with `text_overlap`, `bespoke_type_floor`,
 *     `off_canvas`) — a drawn stroke must not run through a label, and a filled
 *     shape painted later must not cover one. The spike's worst defect was a
 *     giant stray arc across a whole diagram that every gate passed, including a
 *     text-on-text overlap check; strokes were simply not text. Strokes are
 *     sampled along their geometry and their dash pattern, so a line drawn by
 *     DrawSVG is checked only where it is visible at that instant.
 *     Round 2 adds what round 1's frames showed a person and no gate: the
 *     settled drawing must span `STAGE_FILL` of its box (`stage_fill`) and carry
 *     one label of `KEY_TYPE_PX` or more (`type_hierarchy`); an arrowhead must
 *     not show where its line is not drawn (`stray_marker`); and a group the
 *     scene tags `data-cue="N"` must not show before cue N starts
 *     (`early_reveal`, with `cue_groups` failing a scene that tags nothing).
 *  3. `seek_order` — the frame at time t must not depend on which times were
 *     seeked before it. Capture shards a render across workers and the deck
 *     player jumps around, so a frame that depends on history is a frame that
 *     differs between two renders of one input. Ascending, descending (after
 *     jumping past the scene), a fixed scramble, and a cold page are compared.
 *     This is what found v2's equation-walk bug: a `fromTo` authored with
 *     `immediateRender` set its from-state at BUILD time, so a cold seek showed
 *     a swollen term that a warm seek did not.
 *
 * The graders are pure and take what the browser measured, so each is tested
 * without one; `probeScenes` is the one place a browser is opened.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeckPage } from "../render/capture.js";
import type { Timing } from "../render/timing.js";
import type { Finding } from "../types.js";
import { decodePng, type Frame } from "./fidelity.js";

/** A pixel counts as changed when its RGB moved by more than this, summed. Same as the spike's. */
export const PIXEL_DELTA = 24;
/**
 * Fewer changed pixels than this between two seeks of one instant is rasterising,
 * not state. MEASURED: a never-seeked page against a warm one differs by up to
 * 644px on a scene that looks identical — antialiasing along the headline's
 * glyphs, which the shell's own entrance had moved — and a KaTeX glyph by 529px.
 * The leaks this gate exists for are an order of magnitude past it: 13,958 and
 * 22,037px for the equation-walk bug, a dimmed label in the test at several
 * thousand.
 */
export const SEEK_TOLERANCE_PX = 1500;
/** Bump whenever a gate's verdict can change: cached rejections from another version are retried. */
export const GATES_VERSION = "gates-3";
/**
 * A cue whose picture changes by less than this share of the frame held still:
 * about 310 px at 1080p. A frame that does not move renders to the same bytes,
 * so the floor only has to clear antialiasing; a 14px dot crossing a wire
 * changes ~1,200 px and passes, which is right — that dot IS the explanation.
 * Whether the motion is worth watching is the critique round's question and a
 * person's, not a pixel count's.
 */
export const MIN_CHANGE = 0.00015;
/** Cues shorter than this are exempt from `static_hold`: there is no room to show anything. */
export const MIN_CUE_SECONDS = 1.2;
/** Below this the text is not text the audience can read (AGENTS.md invariant 5). */
export const TYPE_FLOOR_PX = 39.5;

/** One narration cue on a scene's own clock. */
export interface SceneCue {
  t0: number;
  t1: number;
  text: string;
}

/** A scene to probe, with the cues spoken over it. */
export interface SceneWindow {
  sid: string;
  beatId?: string;
  /** Absolute composition seconds. */
  start: number;
  duration: number;
  cues: SceneCue[];
}

/* -------------------------------------------------------------------- graders */

export interface CueChange {
  sid: string;
  cue: number;
  t0: number;
  t1: number;
  changed: number;
  total: number;
}

export function gradeStillCues(rows: readonly CueChange[], min = MIN_CHANGE): Finding[] {
  return rows
    .filter((r) => r.t1 - r.t0 >= MIN_CUE_SECONDS && r.changed / r.total < min)
    .map((r) => ({
      severity: "error" as const,
      gate: "motion",
      rule: "static_hold",
      message: `#${r.sid} cue ${r.cue + 1} (${r.t0.toFixed(2)}–${r.t1.toFixed(2)}s): the picture changed by ${((100 * r.changed) / r.total).toFixed(3)}% while the narration spoke — under ${(100 * min).toFixed(1)}%, so the scene holds still over its own sentence.`,
    }));
}

/**
 * The settled frame's drawing must span this share of the body box (the
 * bounding box of everything drawn, over the box's area). Round 1's scenes sat
 * at 55-70%: a diagram in the top-left two thirds with the right third or the
 * bottom band empty, at a size the founder called small.
 */
export const STAGE_FILL = 0.8;
/** The settled frame's largest label, px at 1080p: one thing on the stage is read first. */
export const KEY_TYPE_PX = 64;
/** A cue group may appear this long before its cue starts (the prompt's own sync window). */
export const EARLY_SLACK = 0.5;

/** What the page measured at one frame of one scene. */
export interface Layout {
  sid: string;
  key: string;
  t: number;
  crossings: string[];
  occlusions: string[];
  overlaps: string[];
  small: string[];
  off: string[];
  /** Markers painted where their line is not (an arrowhead on an undrawn path). */
  strays?: string[];
  /** Bounding box of what is drawn in the body box, over the box's area. Bespoke scenes only. */
  fill?: number;
  /** Share of a 6x4 grid over the body box that something is drawn in. Reported, not graded. */
  cells?: number;
  /** The largest visible label in the body box, px. */
  maxType?: number;
  /** Share of the body box the settled drawing paints (`paintedShare`). Reported; the rubric probe reads it. */
  mass?: number;
  /** Share of the drawn labels and shapes in the body box at under 0.6 opacity. */
  dimmed?: number;
  /** Distinct `data-cue` numbers the scene's groups declare. */
  groups?: number[];
  /** The cue groups showing at this instant. */
  revealed?: Array<{ id: string; cue: number }>;
  /** Scene seconds each cue starts at, so `early_reveal` can be graded off this row alone. */
  cueStarts?: number[];
}

export function gradeLayout(rows: readonly Layout[]): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, r: Layout, what: string[], say: string) => {
    if (what.length === 0) return;
    out.push({
      severity: "error",
      gate: "layout",
      rule,
      message: `#${r.sid} at ${r.key} (${r.t.toFixed(2)}s): ${say} ${what.slice(0, 4).join("; ")}${what.length > 4 ? ` (+${what.length - 4})` : ""}`,
    });
  };
  for (const r of rows) {
    add("graphic_crosses_text", r, r.crossings, "a stroke runs through text —");
    add("graphic_crosses_text", r, r.occlusions, "a shape painted over text —");
    add("text_overlap", r, r.overlaps, "text prints over text —");
    add("bespoke_type_floor", r, r.small, "text under 40px —");
    add("off_canvas", r, r.off, "drawn outside the frame —");
    add("stray_marker", r, r.strays ?? [], "a marker without its line —");
    const starts = r.cueStarts ?? [];
    const early = (r.revealed ?? []).filter((g) => {
      const t0 = starts[g.cue - 1];
      return t0 !== undefined && r.t < t0 - EARLY_SLACK;
    });
    add(
      "early_reveal",
      r,
      early.map((g) => `${g.id} (cue ${g.cue}, which starts at ${starts[g.cue - 1]?.toFixed(2)}s)`),
      "shown before the cue that introduces it —",
    );
    if (r.key !== "end" || r.fill === undefined) continue;
    // The settled frame: the stage, the hierarchy and the cue groups.
    if (r.fill < STAGE_FILL)
      add(
        "stage_fill",
        r,
        [`${Math.round(100 * r.fill)}% of the body box`],
        `the drawing spans under ${100 * STAGE_FILL}% of its box —`,
      );
    if ((r.maxType ?? 0) < KEY_TYPE_PX)
      add(
        "type_hierarchy",
        r,
        [`the largest is ${(r.maxType ?? 0).toFixed(0)}px`],
        `no label reaches ${KEY_TYPE_PX}px, so nothing reads first —`,
      );
    const groups = r.groups ?? [];
    if (groups.length === 0)
      add(
        "cue_groups",
        r,
        ["none found"],
        'no <g data-cue="N"> groups: what each cue introduces is undeclared —',
      );
    const beyond = groups.filter((g) => !Number.isInteger(g) || g < 1 || g > starts.length);
    if (starts.length && beyond.length)
      add(
        "cue_groups",
        r,
        beyond.map((g) => `data-cue="${g}"`),
        `names a cue the scene does not have (it has ${starts.length}) —`,
      );
  }
  return out;
}

/**
 * What the page did that a scene must not, pinned to the scenes it implicates.
 * A bespoke script that throws is caught by the shell and logged with its scene
 * id (`bespokeCall`), so it lands on that scene alone. A request, a navigation
 * or a CSP refusal names no scene, so it fails every scene probed with it —
 * none of them can be shown to be innocent from inside one page.
 */
export function gradeErrors(errors: readonly string[], sids: readonly string[]): Finding[] {
  const out: Finding[] = [];
  const loose: string[] = [];
  for (const e of new Set(errors)) {
    const named = sids.find((sid) => e.includes(`bespoke #${sid}:`));
    if (named)
      out.push({
        severity: "error",
        gate: "runtime",
        rule: "scene_error",
        message: `#${named}: ${e}`,
      });
    else loose.push(e);
  }
  if (loose.length)
    for (const sid of sids)
      out.push({
        severity: "error",
        gate: "runtime",
        rule: "page_error",
        message: `#${sid}: the page ${loose.slice(0, 3).join(" | ")}`,
      });
  return out;
}

export interface SeekDiff {
  sid: string;
  key: string;
  t: number;
  /** Which comparison: `descending`, `scrambled`, `cold`. */
  order: string;
  px: number;
}

export function gradeSeekOrder(
  rows: readonly SeekDiff[],
  severity: Finding["severity"] = "error",
  tolerance = SEEK_TOLERANCE_PX,
): Finding[] {
  const bad = rows.filter((r) => r.px > tolerance);
  const bySid = new Map<string, SeekDiff[]>();
  for (const r of bad) bySid.set(r.sid, [...(bySid.get(r.sid) ?? []), r]);
  return [...bySid.entries()].map(([sid, list]) => ({
    severity,
    gate: "determinism",
    rule: "seek_order",
    message: `#${sid}: the frame depends on what was seeked before it — ${list
      .slice(0, 4)
      .map((r) => `${r.key} (${r.t.toFixed(2)}s) ${r.order} differs by ${r.px}px`)
      .join(
        ", ",
      )}. A from-state applied at build time (a fromTo without immediateRender:false after the first on its target) or a value written from outside the timeline.`,
  }));
}

/* ------------------------------------------------------------------- pixels */

/**
 * The share of a box's pixels that differ between two frames — with and without
 * a scene's drawing — i.e. how much of its stage the drawing actually paints.
 * `box` is in CSS px of a 1920-wide page; frames may be any scale of it.
 */
export function paintedShare(
  shown: Frame,
  hidden: Frame,
  box: { x: number; y: number; w: number; h: number },
  delta = 40,
): number {
  if (shown.width !== hidden.width || shown.height !== hidden.height) return 0;
  const k = shown.width / 1920;
  const x0 = Math.max(0, Math.round(box.x * k));
  const y0 = Math.max(0, Math.round(box.y * k));
  const x1 = Math.min(shown.width, Math.round((box.x + box.w) * k));
  const y1 = Math.min(shown.height, Math.round((box.y + box.h) * k));
  let n = 0;
  let total = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * shown.width + x) * shown.channels;
      const j = (y * hidden.width + x) * hidden.channels;
      const d =
        Math.abs((shown.pixels[i] as number) - (hidden.pixels[j] as number)) +
        Math.abs((shown.pixels[i + 1] as number) - (hidden.pixels[j + 1] as number)) +
        Math.abs((shown.pixels[i + 2] as number) - (hidden.pixels[j + 2] as number));
      if (d > delta) n++;
      total++;
    }
  return total ? n / total : 0;
}

export function changedPixels(a: Frame, b: Frame, delta = PIXEL_DELTA): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let n = 0;
  const ca = a.channels;
  const cb = b.channels;
  for (let i = 0, j = 0; i < a.pixels.length; i += ca, j += cb) {
    const d =
      Math.abs((a.pixels[i] as number) - (b.pixels[j] as number)) +
      Math.abs((a.pixels[i + 1] as number) - (b.pixels[j + 1] as number)) +
      Math.abs((a.pixels[i + 2] as number) - (b.pixels[j + 2] as number));
    if (d > delta) n++;
  }
  return n;
}

/* ---------------------------------------------------------- the scene windows */

/**
 * Each scene's cues, scene-relative, from the manifest `build` wrote. Segment
 * cues are relative to their own audio; the segment's `start` is where that
 * audio sits on the composition clock (which is the output clock — nothing is
 * frozen, see `framePlan`).
 */
export function sceneWindows(timing: Timing, sids?: ReadonlySet<string>): SceneWindow[] {
  return timing.scenes
    .filter((s) => !sids || sids.has(s.id))
    .map((s) => ({
      sid: s.id,
      start: s.start,
      duration: s.duration,
      cues: timing.segments
        .filter((g) => g.scene === s.id)
        .flatMap((g) =>
          g.cues.map((c) => ({
            t0: round(g.start + c.start - s.start),
            t1: round(g.start + c.end - s.start),
            text: c.text,
          })),
        )
        .filter((c) => c.t1 > c.t0)
        .sort((a, b) => a.t0 - b.t0),
    }));
}

/**
 * The instants a scene is photographed at: just after each cue starts, 0.6s in,
 * just before it ends, and the settled end. `sparse` keeps the first cue's start,
 * the cue ends and the end — what `seek_order` on a deck's other scenes needs,
 * at about a third of the screenshots.
 */
export function probeTimes(
  w: SceneWindow,
  sparse = false,
): Array<{ key: string; t: number; cue?: number; edge?: "a" | "s" | "z" }> {
  const out: Array<{ key: string; t: number; cue?: number; edge?: "a" | "s" | "z" }> = [];
  w.cues.forEach((c, i) => {
    // The first cue's start stays in a sparse probe: a from-state written at
    // build time shows only before the tween that owns it, i.e. early.
    if (!sparse || i === 0) {
      out.push({ key: `c${i + 1}s`, t: round(c.t0 + 0.05), cue: i, edge: "s" });
      out.push({
        key: `c${i + 1}a`,
        t: round(Math.min(c.t0 + 0.6, c.t1 - 0.1)),
        cue: i,
        edge: "a",
      });
    }
    out.push({ key: `c${i + 1}z`, t: round(c.t1 - 0.05), cue: i, edge: "z" });
  });
  out.push({ key: "end", t: round(Math.max(0, w.duration - 0.5)) });
  return out;
}

/* -------------------------------------------------------------- the browser */

export interface ProbedFrame {
  sid: string;
  key: string;
  /** Scene-relative seconds. */
  t: number;
  png: Buffer;
}

export interface Probe {
  findings: Finding[];
  /** Ascending-pass frames, for a contact sheet. */
  frames: ProbedFrame[];
  cueChanges: CueChange[];
  layout: Layout[];
  seek: SeekDiff[];
}

export interface ProbeOptions {
  /** Which gates. Default all three. `seek` alone is what `verify` runs on plain v2 scenes. */
  gates?: ReadonlyArray<"motion" | "layout" | "seek">;
  /** `seek_order` severity; `verify` passes `warning` for scenes nobody generated. */
  seekSeverity?: Finding["severity"];
  /** Keep the PNGs (the critique round needs them). */
  keepFrames?: boolean;
  /** Also compare a never-seeked page per scene. Default true; a fresh browser each. */
  cold?: boolean;
  /** Photograph cue ends only (see `probeTimes`). */
  sparse?: boolean;
  /** Opens a fresh page; injected so the graders' wiring is testable. */
  open: () => Promise<DeckPage>;
  /** The array `open` hands to `openDeck({ watch })`; read once the probe ends. */
  errors?: readonly string[];
}

/**
 * Photograph `windows` and grade them. One warm page for the ordered passes, one
 * cold page per scene for the first-seek comparison.
 */
export async function probeScenes(
  windows: readonly SceneWindow[],
  opts: ProbeOptions,
): Promise<Probe> {
  const gates = new Set(opts.gates ?? ["motion", "layout", "seek"]);
  const frames: ProbedFrame[] = [];
  const cueChanges: CueChange[] = [];
  const layout: Layout[] = [];
  const seek: SeekDiff[] = [];
  const warm = new Map<string, Map<string, Buffer>>();
  const deck = await opts.open();
  try {
    for (const w of windows) {
      const times = probeTimes(w, opts.sparse);
      const shots = new Map<string, Buffer>();
      warm.set(w.sid, shots);
      // NO WARM-UP PASS, on purpose: scenes are probed in deck order, so the
      // first seek into each one is its first ever — which is the history that
      // exposes a from-state written at build time (v2's equation-walk showed
      // a swollen term only there). Fonts are the other thing a first paint
      // differs by, and `settle` waits for those instead.
      for (const p of times) {
        await deck.seek(w.start + p.t);
        await settle(deck);
        const png = await deck.shoot();
        shots.set(p.key, png);
        if (opts.keepFrames) frames.push({ sid: w.sid, key: p.key, t: p.t, png });
        if (gates.has("layout") && p.edge !== "s") {
          const m = (await deck.page.evaluate(`(${MEASURE})(${JSON.stringify(w.sid)})`)) as Omit<
            Layout,
            "sid" | "key" | "t"
          >;
          const mass = p.key === "end" ? await paintedOf(deck, w.sid, png) : undefined;
          layout.push({
            sid: w.sid,
            key: p.key,
            t: p.t,
            ...m,
            ...(mass === undefined ? {} : { mass }),
            cueStarts: w.cues.map((c) => c.t0),
          });
        }
      }
      if (gates.has("motion")) {
        for (const [i, c] of w.cues.entries()) {
          // Three instants per cue, and the LARGEST pairwise change: a looping
          // motion can be back where it started by the cue's end.
          const pngs = ["s", "a", "z"]
            .map((e) => shots.get(`c${i + 1}${e}`))
            .filter((b): b is Buffer => b !== undefined);
          if (pngs.length < 2) continue;
          const decoded = await Promise.all(pngs.map((b) => decodePng(b)));
          let changed = 0;
          for (let x = 0; x < decoded.length; x++)
            for (let y = x + 1; y < decoded.length; y++)
              changed = Math.max(changed, changedPixels(decoded[x] as Frame, decoded[y] as Frame));
          const first = decoded[0] as Frame;
          cueChanges.push({
            sid: w.sid,
            cue: i,
            t0: c.t0,
            t1: c.t1,
            changed,
            total: first.width * first.height,
          });
        }
      }
      if (gates.has("seek")) {
        const compare = async (order: string, list: typeof times) => {
          for (const p of list) {
            await deck.seek(w.start + w.duration + 3);
            await deck.seek(w.start + p.t);
            await settle(deck);
            const png = await deck.shoot();
            const ref = shots.get(p.key);
            if (!ref || png.equals(ref)) continue;
            const px = changedPixels(await decodePng(png), await decodePng(ref));
            if (px > 0) seek.push({ sid: w.sid, key: p.key, t: p.t, order, px });
          }
        };
        await compare("descending", [...times].reverse());
        await compare(
          "scrambled",
          [...times].sort((a, b) => ((a.t * 7919) % 1) - ((b.t * 7919) % 1)),
        );
      }
    }
  } finally {
    await deck.close();
  }
  if (gates.has("seek") && opts.cold !== false) {
    // Cold: a page that has never seeked anything, asked for one late frame. A
    // page per scene, because seeking one scene seeks every scene's timeline.
    for (const w of windows) {
      const times = probeTimes(w, opts.sparse);
      const p = times[Math.max(0, times.length - 2)];
      const ref = p ? warm.get(w.sid)?.get(p.key) : undefined;
      if (!p || !ref) continue;
      const cold = await opts.open();
      try {
        await cold.seek(w.start + p.t);
        await settle(cold);
        const png = await cold.shoot();
        if (!png.equals(ref)) {
          const px = changedPixels(await decodePng(png), await decodePng(ref));
          if (px > 0) seek.push({ sid: w.sid, key: p.key, t: p.t, order: "cold", px });
        }
      } finally {
        await cold.close();
      }
    }
  }
  const findings = [
    ...(opts.errors
      ? gradeErrors(
          opts.errors,
          windows.map((w) => w.sid),
        )
      : []),
    ...(gates.has("motion") ? gradeStillCues(cueChanges) : []),
    ...(gates.has("layout") ? gradeLayout(layout) : []),
    ...(gates.has("seek") ? gradeSeekOrder(seek, opts.seekSeverity ?? "error") : []),
  ];
  return { findings, frames, cueChanges, layout, seek };
}

/**
 * Lay the frame out, then wait for any face that layout asked for. A glyph a
 * scene uses first (KaTeX, a CJK fallback) starts loading when the scene first
 * paints — after `document.fonts.ready` resolved at load — and a frame shot
 * before it arrives differs from one shot after by a few hundred pixels. That
 * is a font, not seek history: measured as a 413px `seek_order` on an equation
 * that vanished when the scene was probed alone.
 */
async function settle(deck: DeckPage): Promise<void> {
  await deck.page.evaluate(() => {
    void document.body.offsetHeight;
    return document.fonts.ready.then(() => undefined);
  });
}

/**
 * The settled frame's painted share of a bespoke scene's body box: the same
 * instant shot again with the body hidden, so a gradient or textured pack
 * background is subtracted exactly. Absent on a scene with no body box.
 */
async function paintedOf(deck: DeckPage, sid: string, shown: Buffer): Promise<number | undefined> {
  const id = JSON.stringify(`${sid}-g`);
  const box = (await deck.page.evaluate(
    `(() => { const e = document.getElementById(${id}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
  )) as { x: number; y: number; w: number; h: number } | null;
  if (!box) return undefined;
  // Whatever inline visibility it had is put back exactly, so later seeks see the page as it was.
  const was = (await deck.page.evaluate(
    `(() => { const s = document.getElementById(${id}).style; const v = s.visibility; s.visibility = "hidden"; return v; })()`,
  )) as string;
  try {
    await settle(deck);
    const hidden = await deck.shoot();
    return paintedShare(await decodePng(shown), await decodePng(hidden), box);
  } finally {
    await deck.page.evaluate(
      `document.getElementById(${id}).style.visibility = ${JSON.stringify(was)}`,
    );
    await settle(deck);
  }
}

/** `timing.json`, or nothing. */
export async function readTimingFile(dir: string): Promise<Timing | undefined> {
  const text = await readFile(join(dir, "timing.json"), "utf8").catch(() => null);
  return text ? (JSON.parse(text) as Timing) : undefined;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Serialised into the page: everything `gradeLayout` needs about one scene at
 * the instant just seeked. A string, so it carries no closure and no bundler
 * helper into the browser.
 */
const MEASURE = `(sid) => {
  const root = document.getElementById(sid);
  if (!root) return { crossings: [], occlusions: [], overlaps: [], small: [], off: [], strays: [] };
  const W = window.innerWidth, H = window.innerHeight;
  const alpha = (el) => {
    let o = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") return 0;
      o *= Number(cs.opacity);
    }
    return o;
  };
  const name = (el) => el.id || (el.tagName.toLowerCase() + ":" + (el.textContent || "").trim().slice(0, 16));
  // What an element's box is after any clipping <svg> (overflow other than
  // visible) — a camera move zooms a viewBox, and what it leaves outside is
  // not drawn, so it is neither off the frame nor crossing anything.
  const clipOf = (el) => {
    const svg = el.ownerSVGElement || (el.closest && el.closest("svg"));
    if (!svg || getComputedStyle(svg).overflow === "visible") return null;
    return svg.getBoundingClientRect();
  };
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    const c = clipOf(el);
    if (!c) return { x: r.x, y: r.y, width: r.width, height: r.height, clip: null };
    const x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y);
    const x1 = Math.min(r.x + r.width, c.x + c.width), y1 = Math.min(r.y + r.height, c.y + c.height);
    // >=, not >: a horizontal line has no height and is still drawn.
    return x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0, clip: c } : { x: 0, y: 0, width: 0, height: 0, clip: c };
  };
  // Text boxes: SVG <text>, a KaTeX run, or an HTML element with its own text.
  const texts = [];
  // Where a label sits, in the body box's own px (= the scene's svg units when it
  // has no camera move): a fix round can act on "x 1210-1330" where it cannot on
  // "these two overlap" — round 2's drafts failed on overlaps it could not see.
  const origin = document.getElementById(sid + "-g");
  const o0 = origin ? origin.getBoundingClientRect() : { x: 0, y: 0 };
  const at = (t) => t.id + " [x " + Math.round(t.x - o0.x) + "-" + Math.round(t.x + t.w - o0.x) + ", y " + Math.round(t.y - o0.y) + "-" + Math.round(t.y + t.h - o0.y) + "]";
  const walk = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "defs") return;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const katex = el.classList && el.classList.contains("katex");
    if (tag === "text" || katex || (own && !(el instanceof SVGElement))) {
      const r = boxOf(el);
      const o = alpha(el);
      if (r.width > 0 && r.height > 0 && o > 0.15) {
        let fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (el instanceof SVGGraphicsElement && el.getScreenCTM) {
          const m = el.getScreenCTM();
          if (m) fs *= Math.hypot(m.a, m.b);
        }
        texts.push({ el, id: name(el), x: r.x, y: r.y, w: r.width, h: r.height, fs, o });
      }
      if (tag === "text" || katex) return;
    }
    for (const c of el.children) walk(c);
  };
  walk(root);

  const overlaps = [];
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 4 && iy > 4) overlaps.push(at(a) + " × " + at(b));
    }
  const small = texts.filter((t) => t.fs > 0 && t.fs < ${TYPE_FLOOR_PX}).map((t) => t.id + "@" + t.fs.toFixed(1) + "px");

  // Strokes and fills. Every shape that paints something at this instant is a
  // LEAF: what the stage-fill and early-reveal measures below are made of.
  const crossings = [], occlusions = [], off = [], strays = [], leaves = [];
  const shapes = root.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect");
  const inset = 4;
  const inside = (p, t) => p.x > t.x + inset && p.x < t.x + t.w - inset && p.y > t.y + inset && p.y < t.y + t.h - inset;
  for (const g of shapes) {
    if (g.closest("defs, marker, clipPath, mask, pattern, symbol")) continue;
    const o = alpha(g);
    if (o <= 0.15) continue;
    const cs = getComputedStyle(g);
    const r = boxOf(g);
    if (r.width === 0 && r.height === 0) continue;
    if (r.x < -2 || r.y < -2 || r.x + r.width > W + 2 || r.y + r.height > H + 2) off.push(name(g));
    // A shape that wholly contains a text box is that label's plate, not a collision.
    const plate = (t) => r.x <= t.x + 1 && r.y <= t.y + 1 && r.x + r.width >= t.x + t.w - 1 && r.y + r.height >= t.y + t.h - 1;
    const sw = parseFloat(cs.strokeWidth) || 0;
    const stroked = cs.stroke && cs.stroke !== "none" && sw > 0 && Number(cs.strokeOpacity) * o > 0.15;
    // A <line> has no inside, and a shape scaled flat paints no area, whatever its fill says.
    const filled = cs.fill && cs.fill !== "none" && Number(cs.fillOpacity) * o > 0.15 &&
      g.tagName.toLowerCase() !== "line" && r.width >= 1 && r.height >= 1;
    // A marker paints with the element's opacity, not its stroke's, and DrawSVG
    // draws by dashing: an arrowhead stays where it is while its line is drawn
    // to 0%, or half way — the "stray arrowhead" of an undrawn line.
    const markerStart = cs.markerStart && cs.markerStart !== "none";
    const markerEnd = cs.markerEnd && cs.markerEnd !== "none";
    let paints = filled;
    if (!stroked && (markerStart || markerEnd)) strays.push(name(g) + " (its arrowhead shows, its line does not)");
    if (stroked && typeof g.getTotalLength !== "function") paints = true;
    if (stroked && typeof g.getTotalLength === "function") {
      let len = 0;
      try { len = g.getTotalLength(); } catch (e) { len = 0; }
      const m = g.getScreenCTM();
      if (len > 0 && m) {
        const dash = (cs.strokeDasharray && cs.strokeDasharray !== "none")
          ? cs.strokeDasharray.split(/[ ,]+/).map(parseFloat).filter((v) => v >= 0)
          : [];
        const pattern = dash.length % 2 ? dash.concat(dash) : dash;
        const period = pattern.reduce((a, b) => a + b, 0);
        const offset = parseFloat(cs.strokeDashoffset) || 0;
        const visible = (d) => {
          if (!period) return true;
          let pos = ((d + offset) % period + period) % period;
          for (let k = 0; k < pattern.length; k++) {
            if (pos < pattern[k]) return k % 2 === 0;
            pos -= pattern[k];
          }
          return true;
        };
        const step = Math.max(4, len / 400);
        const hit = new Set();
        let drawn = 0;
        for (let d = 0; d <= len; d += step) {
          if (!visible(d)) continue;
          drawn += step;
          const q = g.getPointAtLength(d);
          const p = { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
          if (r.clip && (p.x < r.clip.x || p.y < r.clip.y || p.x > r.clip.x + r.clip.width || p.y > r.clip.y + r.clip.height)) continue;
          // No plate exemption here: a long curve's bounding box contains half
          // the labels on a chart, and its stroke still runs through them.
          for (const t of texts) if (!hit.has(t) && inside(p, t)) hit.add(t);
        }
        for (const t of hit) crossings.push(name(g) + " through " + at(t));
        if (drawn > 2) paints = true;
        const edge = Math.min(2, len / 100);
        if (markerEnd && !visible(len - edge)) strays.push(name(g) + " (an arrowhead at the end of a line not drawn that far)");
        else if (markerStart && !visible(edge)) strays.push(name(g) + " (an arrowhead at the start of a line not drawn from there)");
      } else if (len > 0) paints = true;
    }
    if (paints) leaves.push({ el: g, x: r.x, y: r.y, w: r.width, h: r.height, o });
    if (filled) {
      for (const t of texts) {
        if (plate(t)) continue;
        // Only a shape painted AFTER the text can cover it.
        if (!(t.el.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const ix = Math.min(r.x + r.width, t.x + t.w) - Math.max(r.x, t.x);
        const iy = Math.min(r.y + r.height, t.y + t.h) - Math.max(r.y, t.y);
        if (ix > inset && iy > inset && ix * iy > 0.15 * t.w * t.h) occlusions.push(name(g) + " over " + at(t));
      }
    }
  }
  for (const t of texts)
    if (t.x < -1 || t.y < -1 || t.x + t.w > W + 1 || t.y + t.h > H + 1) off.push(t.id);

  // The body box a bespoke scene draws in. Absent on an archetype's scene, and
  // then there is no stage to fill and no cue group to reveal.
  const box = document.getElementById(sid + "-g");
  let fill, maxType, cells, groups, revealed, dimmed;
  if (box) {
    const b = box.getBoundingClientRect();
    const mine = texts.filter((t) => box.contains(t.el)).map((t) => ({ el: t.el, x: t.x, y: t.y, w: t.w, h: t.h }))
      .concat(leaves.filter((l) => box.contains(l.el)));
    // A backdrop the size of the box fills it by being there; it is not content.
    const content = mine.filter((l) => l.w * l.h < 0.85 * b.width * b.height);
    const clip = (l) => {
      const x0 = Math.max(b.x, l.x), y0 = Math.max(b.y, l.y);
      const x1 = Math.min(b.x + b.width, l.x + l.w), y1 = Math.min(b.y + b.height, l.y + l.h);
      return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
    };
    const parts = content.map(clip).filter(Boolean);
    if (parts.length && b.width > 0 && b.height > 0) {
      const u = parts.reduce((a, p) => ({ x0: Math.min(a.x0, p.x0), y0: Math.min(a.y0, p.y0), x1: Math.max(a.x1, p.x1), y1: Math.max(a.y1, p.y1) }));
      fill = ((u.x1 - u.x0) * (u.y1 - u.y0)) / (b.width * b.height);
      // How many of a 6x4 grid's cells something is drawn in: a bbox can be
      // stretched by one stray dot, a grid cannot.
      let n = 0;
      for (let cx = 0; cx < 6; cx++)
        for (let cy = 0; cy < 4; cy++) {
          const gx0 = b.x + (cx * b.width) / 6, gx1 = b.x + ((cx + 1) * b.width) / 6;
          const gy0 = b.y + (cy * b.height) / 4, gy1 = b.y + ((cy + 1) * b.height) / 4;
          if (parts.some((p) => p.x0 < gx1 && p.x1 > gx0 && p.y0 < gy1 && p.y1 > gy0)) n++;
        }
      cells = n / 24;
    } else fill = 0;
    maxType = texts.filter((t) => box.contains(t.el)).reduce((a, t) => Math.max(a, t.fs), 0);
    // How much of what is drawn is drawn dimmed (focus): at the end, a summary
    // that is mostly ghosts is not one.
    const shown = texts.filter((t) => box.contains(t.el)).concat(leaves.filter((l) => box.contains(l.el)));
    dimmed = shown.length ? shown.filter((x) => x.o < 0.6).length / shown.length : 0;
    // Cue groups: what the scene says each cue introduces, and which are showing now.
    const tagged = [...box.querySelectorAll("[data-cue]")];
    groups = [...new Set(tagged.map((e) => Number(e.getAttribute("data-cue"))))].sort((a, c) => a - c);
    const showing = (e) => texts.some((t) => e === t.el || e.contains(t.el)) || leaves.some((l) => e === l.el || e.contains(l.el));
    revealed = tagged.filter(showing).map((e) => ({ id: name(e), cue: Number(e.getAttribute("data-cue")) }));
  }
  return { crossings, occlusions, overlaps, small, off, strays, fill, cells, maxType, groups, revealed, dimmed };
}`;

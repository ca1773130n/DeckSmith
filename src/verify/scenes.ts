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
export const GATES_VERSION = "gates-2";
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
          layout.push({ sid: w.sid, key: p.key, t: p.t, ...m });
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
  if (!root) return { crossings: [], occlusions: [], overlaps: [], small: [], off: [] };
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
  // Text boxes: SVG <text>, a KaTeX run, or an HTML element with its own text.
  const texts = [];
  const walk = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "defs") return;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const katex = el.classList && el.classList.contains("katex");
    if (tag === "text" || katex || (own && !(el instanceof SVGElement))) {
      const r = el.getBoundingClientRect();
      const o = alpha(el);
      if (r.width > 0 && r.height > 0 && o > 0.15) {
        let fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (el instanceof SVGGraphicsElement && el.getScreenCTM) {
          const m = el.getScreenCTM();
          if (m) fs *= Math.hypot(m.a, m.b);
        }
        texts.push({ el, id: name(el), x: r.x, y: r.y, w: r.width, h: r.height, fs });
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
      if (ix > 4 && iy > 4) overlaps.push(a.id + " × " + b.id);
    }
  const small = texts.filter((t) => t.fs > 0 && t.fs < ${TYPE_FLOOR_PX}).map((t) => t.id + "@" + t.fs.toFixed(1) + "px");

  // Strokes and fills.
  const crossings = [], occlusions = [], off = [];
  const shapes = root.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect");
  const inset = 4;
  const inside = (p, t) => p.x > t.x + inset && p.x < t.x + t.w - inset && p.y > t.y + inset && p.y < t.y + t.h - inset;
  for (const g of shapes) {
    if (g.closest("defs, marker, clipPath, mask, pattern, symbol")) continue;
    const o = alpha(g);
    if (o <= 0.15) continue;
    const cs = getComputedStyle(g);
    const r = g.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.x < -2 || r.y < -2 || r.x + r.width > W + 2 || r.y + r.height > H + 2) off.push(name(g));
    // A shape that wholly contains a text box is that label's plate, not a collision.
    const plate = (t) => r.x <= t.x + 1 && r.y <= t.y + 1 && r.x + r.width >= t.x + t.w - 1 && r.y + r.height >= t.y + t.h - 1;
    const sw = parseFloat(cs.strokeWidth) || 0;
    const stroked = cs.stroke && cs.stroke !== "none" && sw > 0 && Number(cs.strokeOpacity) * o > 0.15;
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
        for (let d = 0; d <= len; d += step) {
          if (!visible(d)) continue;
          const q = g.getPointAtLength(d);
          const p = { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
          for (const t of texts) if (!hit.has(t) && !plate(t) && inside(p, t)) hit.add(t);
        }
        for (const t of hit) crossings.push(name(g) + " through " + t.id);
      }
    }
    const filled = cs.fill && cs.fill !== "none" && Number(cs.fillOpacity) * o > 0.15;
    if (filled) {
      for (const t of texts) {
        if (plate(t)) continue;
        // Only a shape painted AFTER the text can cover it.
        if (!(t.el.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const ix = Math.min(r.x + r.width, t.x + t.w) - Math.max(r.x, t.x);
        const iy = Math.min(r.y + r.height, t.y + t.h) - Math.max(r.y, t.y);
        if (ix > inset && iy > inset && ix * iy > 0.15 * t.w * t.h) occlusions.push(name(g) + " over " + t.id);
      }
    }
  }
  for (const t of texts)
    if (t.x < -1 || t.y < -1 || t.x + t.w > W + 1 || t.y + t.h > H + 1) off.push(t.id);
  return { crossings, occlusions, overlaps, small, off };
}`;

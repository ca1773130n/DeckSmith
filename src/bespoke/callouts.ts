/**
 * The labels of an illustrated scene, drawn by the shell ON their subjects.
 *
 * WHY THE SHELL AND NOT THE SCENE. Round 3's labels were plates in a row along
 * the top of the box. Round 4's first run (2026-10-09, en deck) asked the scene
 * to put each label on its subject itself: the labels went on their subjects
 * (3-4 of 3-4 within 96px in every draft), and four of five scenes then failed
 * on their own plates and leader lines running through their own text — the
 * model guesses a label's width, and at 56px a guess is wrong by more than the
 * plate's margin. The shell knows the width (the same estimator the archetypes
 * lay out with), so the scene says WHAT each subject is called (`labels`) and
 * the shell says WHERE: a plate in a zone just above the subject (or across
 * its top when there is no room above), a leader line to a dot on it, entering
 * when the camera first arrives on that subject. One grammar for every deck.
 *
 * Zones are fixed from the subjects alone, before the scene is written, so the
 * prompt can tell the scene where they are and to keep its own drawing out.
 */
import type { Theme } from "../emit/kit.js";
import { faceOf, textWidth } from "../emit/svg.js";
import type { Box, CamMove } from "./shots.js";

/** One subject's label, as the scene names it. */
export interface Label {
  subject: number;
  text: string;
}

/** Where a subject's label goes: its zone (box px), and the dot its leader ends on. */
export interface Zone extends Box {
  subject: number;
  /** "above" the subject, or across its "top" inside it. */
  side: "above" | "top";
  dot: { x: number; y: number };
}

/** The label's size, and the floor it may shrink to to fit its zone. */
export const LABEL_PX = 56;
export const LABEL_MIN_PX = 44;
/** Zone height: the plate is 1.6 x the type. */
const ZONE_H = Math.round(LABEL_PX * 1.7);
/** Gap between the zone and the subject's top, and between zones. */
const GAP = 12;
/** The widest a zone is. */
const ZONE_W = 560;
/** The box's inner margin. */
const EDGE = 8;
/** How far inside the subject's top edge its leader's dot sits. */
const DOT_IN = 14;

/**
 * Each subject's label zone: centred over the subject, as wide as half the
 * distance to each neighbour allows (so neighbours' zones never meet), above
 * the subject when there is room, else across its top.
 */
export function calloutZones(subjects: readonly Box[], W: number): Zone[] {
  const cx = subjects.map((s) => s.x + s.w / 2);
  const order = cx.map((_, i) => i).sort((a, b) => (cx[a] as number) - (cx[b] as number));
  const zones: Zone[] = [];
  order.forEach((i, rank) => {
    const s = subjects[i] as Box;
    const c = cx[i] as number;
    const left =
      rank > 0 ? (c - (cx[order[rank - 1] as number] as number)) / 2 - GAP / 2 : c - EDGE;
    const right =
      rank < order.length - 1
        ? ((cx[order[rank + 1] as number] as number) - c) / 2 - GAP / 2
        : W - EDGE - c;
    const half = Math.max(80, Math.min(ZONE_W / 2, left, right));
    const x0 = Math.max(EDGE, Math.min(W - EDGE - 2 * half, c - half));
    const above = s.y - GAP - ZONE_H;
    const side: Zone["side"] = above >= EDGE ? "above" : "top";
    const y = side === "above" ? above : Math.max(EDGE, s.y + GAP);
    // The dot sits just inside the subject's top edge: a leader that reached a
    // sixth of the way down ran through the scene's own words drawn on the
    // subject (MEASURED 2026-10-09: two of eight fallbacks across both runs).
    const dotY =
      side === "above"
        ? Math.min(s.y + s.h - 10, s.y + DOT_IN)
        : Math.min(s.y + s.h - 10, y + ZONE_H + DOT_IN);
    zones.push({
      subject: i + 1,
      side,
      x: Math.round(x0),
      y: Math.round(y),
      w: Math.round(2 * half),
      h: ZONE_H,
      dot: { x: Math.round(c), y: Math.round(dotY) },
    });
  });
  return zones.sort((a, b) => a.subject - b.subject);
}

/** How a label is set: its size and its line(s). */
export interface Fit {
  fs: number;
  lines: string[];
}

/** The two halves of a label for a second line: at the space nearest the middle, else mid-text (CJK). */
function halves(text: string): [string, string] | undefined {
  const t = text.trim();
  const spaces = [...t.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (spaces.length) {
    const mid = t.length / 2;
    const at = spaces.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
    return [t.slice(0, at), t.slice(at + 1)];
  }
  const chars = [...t];
  // Latin with no space is one word, and a word is not broken.
  if (chars.length < 4 || chars.every((c) => (c.codePointAt(0) ?? 0) < 0x80)) return undefined;
  const k = Math.ceil(chars.length / 2);
  return [chars.slice(0, k).join(""), chars.slice(k).join("")];
}

/** Plate height for `n` lines at `fs`. */
const plateH = (n: number, fs: number) => Math.round(n === 1 ? fs * 1.6 : fs * (1.25 * n + 0.5));

/**
 * How a label fits its zone: one line from `LABEL_PX` down to `LABEL_MIN_PX`,
 * else two lines (the plate grows away from the subject, as far as the box
 * allows), else not at all.
 */
export function fitLabel(text: string, zone: Zone, theme: Theme, boxH = Infinity): Fit | undefined {
  const face = faceOf(theme.fontStack);
  const w = (s: string, fs: number) => textWidth(s, fs, 700, 0, false, face) + 0.8 * fs;
  for (let fs = LABEL_PX; fs >= LABEL_MIN_PX; fs -= 2)
    if (w(text, fs) <= zone.w) return { fs, lines: [text] };
  const two = halves(text);
  if (!two) return undefined;
  for (let fs = LABEL_PX; fs >= LABEL_MIN_PX; fs -= 2) {
    if (Math.max(w(two[0], fs), w(two[1], fs)) > zone.w) continue;
    const h = plateH(2, fs);
    // Above the subject it grows upward from the zone's bottom; on the subject, downward.
    const ok = zone.side === "above" ? zone.y + zone.h - h >= EDGE : zone.y + h <= boxH - EDGE;
    if (ok) return { fs, lines: two };
  }
  return undefined;
}

/**
 * Roughly how many characters fit a zone at the floor size, for the prompt
 * ("at most N characters"): Latin lowercase if the deck is Latin, else the
 * deck's script, at `LABEL_MIN_PX`. The fit itself is `fitLabel`'s.
 */
export function longestFit(zone: Zone, theme: Theme): number {
  const face = faceOf(theme.fontStack);
  const sample = typeof face === "string" ? face : face.script;
  const ch =
    sample === "latin"
      ? "abcdefghij"
      : sample === "hangul"
        ? "가나다라마바사아자차"
        : "模型学习方法数据结构流";
  const per = textWidth(ch, LABEL_MIN_PX, 700, 0, false, face) / [...ch].length;
  return Math.max(4, Math.floor((zone.w - 0.8 * LABEL_MIN_PX) / per));
}

/** What the camera frames for a subject: the subject and its label zone together. */
export function withZone(s: Box, z: Zone | undefined): Box {
  if (!z) return s;
  const x0 = Math.min(s.x, z.x);
  const y0 = Math.min(s.y, z.y);
  const x1 = Math.max(s.x + s.w, z.x + z.w);
  const y1 = Math.max(s.y + s.h, z.y + z.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );

/** One placed label: its plate, text, leader and dot, in box px. */
export interface Placed {
  k: number;
  fs: number;
  lines: string[];
  plate: Box;
  text: { x: number; y: number };
  lead: { x1: number; y1: number; x2: number; y2: number };
  dot: { x: number; y: number };
}

function place(label: Label, zone: Zone, theme: Theme, boxH: number): Placed | undefined {
  const fit = fitLabel(label.text, zone, theme, boxH);
  if (!fit) return undefined;
  const { fs, lines } = fit;
  const face = faceOf(theme.fontStack);
  const pw = Math.ceil(
    Math.max(...lines.map((l) => textWidth(l, fs, 700, 0, false, face))) + 0.8 * fs,
  );
  const ph = plateH(lines.length, fs);
  const cx = Math.max(zone.x + pw / 2, Math.min(zone.x + zone.w - pw / 2, zone.dot.x));
  // One line: centred in the zone. Two: grown away from the subject.
  const py =
    lines.length === 1
      ? zone.y + (zone.h - ph) / 2
      : zone.side === "above"
        ? zone.y + zone.h - ph
        : zone.y;
  const plate = { x: Math.round(cx - pw / 2), y: Math.round(py), w: pw, h: ph };
  // The leader leaves the plate's bottom edge, at the point nearest the dot.
  const lx = Math.max(plate.x + 24, Math.min(plate.x + plate.w - 24, zone.dot.x));
  const dotY = Math.max(zone.dot.y, plate.y + plate.h + 22);
  return {
    k: label.subject,
    fs,
    lines,
    plate,
    text: { x: Math.round(cx), y: Math.round(py + ph / 2) },
    lead: { x1: lx, y1: plate.y + plate.h, x2: zone.dot.x, y2: dotY - 10 },
    dot: { x: zone.dot.x, y: dotY },
  };
}

/** When each subject's label enters: as the camera arrives on it, else at the reveal. */
export function entrances(moves: readonly CamMove[], subjects: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of moves)
    if (m.subject > 0 && !out.has(m.subject)) out.set(m.subject, m.t + 0.6 * m.dur);
  const reveal = moves.find((m, i) => m.subject === 0 && i === moves.length - 1);
  for (let k = 1; k <= subjects; k++) if (!out.has(k)) out.set(k, reveal ? reveal.t + 0.4 : 0.5);
  return out;
}

/**
 * The labels as markup and GSAP for the shell to put in the scene: a layer of
 * `<g data-subject="K">` groups (so `label_anchor` measures them like any
 * label), each hidden until its entrance, then the plate rises in, the leader
 * draws to the dot. Labels that do not fit their zone are left out (the
 * static check refuses a scene that has one, so this is belt and braces).
 */
export function calloutLayer(
  sid: string,
  labels: readonly Label[],
  zones: readonly Zone[],
  moves: readonly CamMove[],
  theme: Theme,
  W: number,
  H: number,
): { markup: string; script: string } {
  const seen = new Set<number>();
  const placed: Placed[] = [];
  for (const l of labels) {
    const z = zones.find((x) => x.subject === l.subject);
    if (!z || seen.has(l.subject)) continue;
    const p = place(l, z, theme, H);
    if (!p) continue;
    seen.add(l.subject);
    placed.push({ ...p, k: l.subject });
  }
  if (!placed.length) return { markup: "", script: "" };
  const tone = [theme.tones.a, theme.tones.b, theme.tones.c, theme.tones.d];
  const markup = `<svg class="ds-callouts" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">${placed
    .map((p) => {
      const lab = labels.find((l) => l.subject === p.k) as Label;
      const len = Math.round(Math.hypot(p.lead.x2 - p.lead.x1, p.lead.y2 - p.lead.y1));
      return `<g id="${sid}-callout${p.k}" data-subject="${p.k}"><line id="${sid}-callout${p.k}-lead" x1="${p.lead.x1}" y1="${p.lead.y1}" x2="${p.lead.x2}" y2="${p.lead.y2}" stroke="${theme.fg}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="0"/><circle id="${sid}-callout${p.k}-dot" cx="${p.dot.x}" cy="${p.dot.y}" r="11" fill="${theme.fg}" stroke="${theme.bg}" stroke-width="4"/><g id="${sid}-callout${p.k}-tag"><rect x="${p.plate.x}" y="${p.plate.y}" width="${p.plate.w}" height="${p.plate.h}" rx="${Math.round(p.fs * 0.4)}" fill="${theme.panel}" stroke="${tone[(p.k - 1) % 4]}" stroke-width="5"/><text x="${p.text.x}" y="${p.text.y}" font-size="${p.fs}" font-weight="700" fill="${theme.fg}" text-anchor="middle" dominant-baseline="middle">${
        p.lines.length === 1
          ? esc(lab.text)
          : p.lines
              .map(
                (l, i) =>
                  `<tspan x="${p.text.x}" dy="${i === 0 ? -0.625 * p.fs : 1.25 * p.fs}">${esc(l)}</tspan>`,
              )
              .join("")
      }</text></g></g>`;
    })
    .join("")}</svg>`;
  const at = entrances(moves, Math.max(...placed.map((p) => p.k)));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines = [
    "// The shell's labels (src/bespoke/callouts.ts): each enters as the camera arrives on its subject.",
  ];
  for (const p of placed) {
    const g = JSON.stringify(`#${sid}-callout${p.k}`);
    const t0 = r2(at.get(p.k) ?? 0.5);
    const tag = JSON.stringify(`#${sid}-callout${p.k}-tag`);
    const lead = JSON.stringify(`#${sid}-callout${p.k}-lead`);
    const dot = JSON.stringify(`#${sid}-callout${p.k}-dot`);
    const len = Math.round(Math.hypot(p.lead.x2 - p.lead.x1, p.lead.y2 - p.lead.y1));
    const t = r2(at.get(p.k) ?? 0.5);
    lines.push(
      `gsap.set(${g}, { opacity: 0 });`,
      `gsap.set(${tag}, { y: 14 });`,
      `gsap.set(${lead}, { strokeDashoffset: ${len} });`,
      `gsap.set(${dot}, { scale: 0, transformOrigin: "50% 50%" });`,
      `tl.fromTo(${g}, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out", immediateRender: false }, ${t});`,
      `tl.fromTo(${tag}, { y: 14 }, { y: 0, duration: 0.45, ease: "power3.out", immediateRender: false }, ${t});`,
      `tl.fromTo(${lead}, { strokeDashoffset: ${len} }, { strokeDashoffset: 0, duration: 0.4, ease: "power2.out", immediateRender: false }, ${r2(t + 0.1)});`,
      `tl.fromTo(${dot}, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.3, ease: "back.out(2)", immediateRender: false }, ${r2(t + 0.4)});`,
    );
    // Out of the way of a shot that would cut it, back when one shows it whole.
    for (const f of labelFades(p, moves, t0, W, H))
      lines.push(
        `tl.fromTo(${g}, { opacity: ${f.to ? 0 : 1} }, { opacity: ${f.to}, duration: ${FADE}, ease: "power1.inOut", immediateRender: false }, ${f.t});`,
      );
  }
  return { markup, script: lines.join("\n") };
}

/** Seconds a label takes to step out of a shot that would cut it, or back in. */
export const FADE = 0.3;

/**
 * When a placed label leaves and comes back. A push-in on a neighbour often
 * frames a label half in and half out: held at the frame's edge it reads as a
 * cut word ('…인된 결과' for 2.5s, r1 s12; '…절차', s14). So a label steps out
 * as a move starts whose framing would cut it — plate, leader or dot — and
 * steps back in as the camera arrives on a framing that shows it whole (the
 * reveal shows every one). A framing it is wholly outside leaves it as it is.
 */
export function labelFades(
  p: Pick<Placed, "plate" | "lead" | "dot">,
  moves: readonly CamMove[],
  entered: number,
  W: number,
  H: number,
): Array<{ t: number; to: 0 | 1 }> {
  const x0 = Math.min(p.plate.x, p.lead.x1, p.lead.x2, p.dot.x - 15);
  const y0 = Math.min(p.plate.y, p.lead.y1, p.dot.y - 15);
  const x1 = Math.max(p.plate.x + p.plate.w, p.lead.x1, p.lead.x2, p.dot.x + 15);
  const y1 = Math.max(p.plate.y + p.plate.h, p.lead.y2, p.dot.y + 15);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: Array<{ t: number; to: 0 | 1 }> = [];
  let shown = true;
  for (const m of moves) {
    // Only moves after the label is on screen: its entrance owns its first fade.
    if (m.t + m.dur <= entered + FADE) continue;
    const vx0 = -m.x / m.s;
    const vy0 = -m.y / m.s;
    const vx1 = vx0 + W / m.s;
    const vy1 = vy0 + H / m.s;
    const inside = x0 >= vx0 - 0.5 && y0 >= vy0 - 0.5 && x1 <= vx1 + 0.5 && y1 <= vy1 + 0.5;
    const outside = x1 <= vx0 || x0 >= vx1 || y1 <= vy0 || y0 >= vy1;
    if (shown && !inside && !outside) {
      out.push({ t: r2(Math.max(m.t, entered + FADE)), to: 0 });
      shown = false;
    } else if (!shown && inside) {
      out.push({ t: r2(m.t + m.dur - FADE), to: 1 });
      shown = true;
    }
  }
  return out;
}

/**
 * Motion variety, measured off a built composition — the M4 exit metrics.
 *
 * Read from the emitted `index.html` rather than from the in-memory plan, so the
 * number is about what ships: a plan that said "push" and an emitter that wrote
 * a dissolve would read as a dissolve here. The three numbers are the ones the
 * redesign plan set against v0.8.0's audit of 124 HypePaper scenes:
 *
 * | metric                         | v0.8.0 | v2 target |
 * |--------------------------------|--------|-----------|
 * | modal entrance (share)         | 92%    | ≤ 40%     |
 * | seam kinds (deck of 10+ beats) | 1      | ≥ 3       |
 * | top-2 ease share of tweens     | 85%    | ≤ 60%     |
 *
 * MODAL is deliberately generous to the old look: a scene "opens modal" when its
 * headline enters as a bare opacity + y fade-up, whatever the ease. v2's `rise`
 * verb therefore counts as modal, which is why `planMotion` caps it.
 */

export interface MotionStats {
  scenes: number;
  /** Scenes whose headline (`#sN-h`, or the title's `#sN-t`) enters as opacity + y only. */
  modalScenes: number;
  /** Scenes with at least one emphasis (glow, underline, or a sine-eased pulse) after the build. */
  emphasisScenes: number;
  /** Seam kind per handoff, in scene order. */
  seams: string[];
  /** Tween count per ease name; a tween naming none is `"default"`. */
  eases: Record<string, number>;
  tweens: number;
}

/** One `tl.fromTo(...)` statement, split into its four arguments. */
interface Stmt {
  target: string;
  from: string;
  to: string;
  at: number;
}

const STMT = /tl\.fromTo\("([^"]+)", (\{.*?\}), (\{.*\}), (-?[\d.]+)\);$/;

function statements(block: string): Stmt[] {
  const out: Stmt[] = [];
  for (const line of block.split("\n")) {
    const m = STMT.exec(line.trim());
    if (m)
      out.push({
        target: m[1] as string,
        from: m[2] as string,
        to: m[3] as string,
        at: Number(m[4]),
      });
  }
  return out;
}

/** The keys a `{ a: 1, b: "x" }` vars literal names, top level only. */
function keys(vars: string): string[] {
  const inner = vars.trim().slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let token = "";
  for (const ch of inner) {
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(token);
      token = "";
    } else token += ch;
  }
  if (token.trim()) out.push(token);
  return out.map((kv) => (kv.split(":")[0] ?? "").trim()).filter(Boolean);
}

function seamKind(from: string): string {
  const k = keys(from);
  if (k.includes("clipPath")) return "wipe";
  if (k.includes("xPercent")) return "push";
  if (k.includes("yPercent")) return "lift";
  if (k.includes("scale")) return "zoom";
  return "dissolve";
}

export function motionStats(composition: string): MotionStats {
  const parts = composition.split(/<div\s+id="(s\d+)"\s+class="scene clip"/);
  const eases: Record<string, number> = {};
  const seams: string[] = [];
  let scenes = 0;
  let modalScenes = 0;
  let tweens = 0;
  let emphasisScenes = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const sid = parts[i] as string;
    const tl = statements(parts[i + 1] ?? "");
    scenes++;
    for (const s of tl) {
      tweens++;
      const ease = /\bease: ("[^"]*"|[\w.]+)/.exec(s.to)?.[1]?.replace(/"/g, "") ?? "default";
      eases[ease] = (eases[ease] ?? 0) + 1;
    }
    if (
      tl.some(
        (s) =>
          /drop-shadow|textDecorationColor/.test(s.from) ||
          (/\bscale: 1\b/.test(s.from) && /ease: "sine\.out"/.test(s.to)),
      )
    )
      emphasisScenes++;
    const head = tl.find((s) => s.target === `#${sid}-h` || s.target.startsWith(`#${sid}-t`));
    if (head) {
      const k = keys(head.from).sort().join(",");
      if (k === "opacity,y") modalScenes++;
    }
    // The handoff is the root tween that does NOT render immediately: the
    // incoming half of a v2 seam does, at 0, and is not a handoff.
    const out = tl.filter((s) => s.target === `#${sid}` && /immediateRender: false/.test(s.to));
    const last = out[out.length - 1];
    if (last) seams.push(seamKind(last.from));
    // A camera's dip is `.ds-zoom`/`.ds-pan` and a fade on the plate; it is one kind.
    else if (tl.some((s) => s.target.includes(".ds-zoom"))) seams.push("dive");
  }
  return { scenes, modalScenes, emphasisScenes, seams, eases, tweens };
}

/** The share of tweens carried by the two most common eases. */
export function topTwoEaseShare(stats: MotionStats): number {
  const counts = Object.values(stats.eases).sort((a, b) => b - a);
  return stats.tweens === 0 ? 0 : ((counts[0] ?? 0) + (counts[1] ?? 0)) / stats.tweens;
}

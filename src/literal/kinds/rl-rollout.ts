/**
 * rl-rollout — a policy computed for real in a gridworld, and the agent
 * following it: value heatmap, policy arrows, trajectory, reward per step.
 *
 * WHAT IS EXACT. The MDP is the source's grid: walls, terminal cells with
 * their rewards, a reward per step, γ, and an optional slip probability (the
 * intended move with 1 − slip, each perpendicular move with slip/2; a move
 * into a wall or off the grid stays put). Rewards are paid on entering a
 * cell; terminals end the episode (V = 0 there). The policy is computed by
 *   - "value-iteration": synchronous Bellman optimality backups
 *     V_{k+1}(s) = max_a Σ P(s'|s,a)[r + γ V_k(s')] until max |ΔV| < tol, or
 *   - "q-learning": tabular Q-learning (Watkins 1989), ε-greedy, seeded.
 * Ties break in the fixed action order up, right, down, left. The rollout
 * follows the greedy policy, sampling slips from a seeded generator.
 *
 * Frames: the values as they converge (chosen sweeps or episodes), then the
 * agent's walk, step by step, with the reward of each step beside the grid.
 */
import {
  type Frame,
  fillTemplate,
  flat,
  fmt,
  type LiteralSlot,
  type MechanismResult,
  mulberry32,
  type Prim,
  type Region,
  TYPE,
} from "./common.js";

/* -------------------------------------------------------------------- maths */

export type Cell = [number, number];

export interface Grid {
  width: number;
  height: number;
  walls?: Cell[];
  terminals: Array<{ at: Cell; reward: number }>;
  stepReward?: number;
  gamma?: number;
  slip?: number;
}

/** up, right, down, left — y grows downward. */
export const ACTIONS: readonly Cell[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface Mdp {
  n: number;
  w: number;
  h: number;
  wall: boolean[];
  terminal: Array<number | undefined>;
  gamma: number;
  /** P[s][a] = [[s', p, r], …]. */
  P: Array<Array<Array<[number, number, number]>>>;
}

export function buildMdp(g: Grid): Mdp {
  const { width: w, height: h } = g;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 1 || w * h > 400)
    throw new Error(`rl-rollout: a ${w}×${h} grid is out of range (2..400 cells)`);
  const n = w * h;
  const at = ([x, y]: Cell) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w || y >= h)
      throw new Error(`rl-rollout: cell (${x}, ${y}) is off the ${w}×${h} grid`);
    return y * w + x;
  };
  const wall = new Array<boolean>(n).fill(false);
  for (const c of g.walls ?? []) wall[at(c)] = true;
  const terminal = new Array<number | undefined>(n).fill(undefined);
  for (const t of g.terminals) terminal[at(t.at)] = t.reward;
  if (!g.terminals.length) throw new Error("rl-rollout: needs at least one terminal cell");
  const slip = g.slip ?? 0;
  if (slip < 0 || slip > 1) throw new Error(`rl-rollout: slip must be 0..1, got ${slip}`);
  const step = g.stepReward ?? 0;
  const move = (s: number, a: number) => {
    const x = s % w;
    const y = Math.floor(s / w);
    const [dx, dy] = ACTIONS[a] as Cell;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h || wall[ny * w + nx]) return s;
    return ny * w + nx;
  };
  const P = Array.from({ length: n }, (_, s) =>
    ACTIONS.map((_, a) => {
      const out = new Map<number, number>();
      const add = (b: number, p: number) => {
        if (p <= 0) return;
        const t = move(s, b);
        out.set(t, (out.get(t) ?? 0) + p);
      };
      add(a, 1 - slip);
      add((a + 1) % 4, slip / 2);
      add((a + 3) % 4, slip / 2);
      return [...out]
        .sort((p, q) => p[0] - q[0])
        .map(([t, p]) => [t, p, step + (terminal[t] ?? 0)] as [number, number, number]);
    }),
  );
  return { n, w, h, wall, terminal, gamma: g.gamma ?? 0.9, P };
}

const live = (m: Mdp, s: number) => !m.wall[s] && m.terminal[s] === undefined;

function qOf(m: Mdp, V: Float64Array, s: number, a: number): number {
  let q = 0;
  for (const [t, p, r] of (m.P[s] as Array<Array<[number, number, number]>>)[a] as Array<
    [number, number, number]
  >)
    q += p * (r + m.gamma * (V[t] as number));
  return q;
}

/** Synchronous value iteration; every sweep's V (V_0 = 0). */
export function valueIteration(m: Mdp, tol = 1e-6, maxSweeps = 1000): Float64Array[] {
  const Vs = [new Float64Array(m.n)];
  for (let k = 0; k < maxSweeps; k++) {
    const V = Vs[Vs.length - 1] as Float64Array;
    const N = new Float64Array(m.n);
    let delta = 0;
    for (let s = 0; s < m.n; s++) {
      if (!live(m, s)) continue;
      let best = Number.NEGATIVE_INFINITY;
      for (let a = 0; a < 4; a++) best = Math.max(best, qOf(m, V, s, a));
      N[s] = best;
      delta = Math.max(delta, Math.abs(best - (V[s] as number)));
    }
    Vs.push(N);
    if (delta < tol) return Vs;
  }
  throw new Error(
    `rl-rollout: value iteration did not converge in ${maxSweeps} sweeps (γ too close to 1?)`,
  );
}

/** The largest |V(s) − max_a Q(s, a)| over live cells: 0 at the fixed point. */
export function bellmanResidual(m: Mdp, V: Float64Array): number {
  let r = 0;
  for (let s = 0; s < m.n; s++) {
    if (!live(m, s)) continue;
    let best = Number.NEGATIVE_INFINITY;
    for (let a = 0; a < 4; a++) best = Math.max(best, qOf(m, V, s, a));
    r = Math.max(r, Math.abs(best - (V[s] as number)));
  }
  return r;
}

/** Greedy action per cell (−1 where nothing is chosen), ties to the earlier action. */
export function greedy(m: Mdp, V: Float64Array): number[] {
  return Array.from({ length: m.n }, (_, s) => {
    if (!live(m, s)) return -1;
    let best = 0;
    let bq = Number.NEGATIVE_INFINITY;
    for (let a = 0; a < 4; a++) {
      const q = qOf(m, V, s, a);
      if (q > bq + 1e-12) {
        bq = q;
        best = a;
      }
    }
    return best;
  });
}

function sample(
  rng: () => number,
  outs: ReadonlyArray<readonly [number, number, number]>,
): readonly [number, number, number] {
  let u = rng();
  for (const o of outs) {
    u -= o[1];
    if (u < 0) return o;
  }
  return outs[outs.length - 1] as readonly [number, number, number];
}

/** Tabular Q-learning; returns Q (n×4) after each checkpoint episode. */
export function qLearning(
  m: Mdp,
  start: number,
  opts: {
    episodes: number;
    alpha: number;
    epsilon: number;
    seed: number;
    maxSteps: number;
    checkpoints: number[];
  },
): { Q: Float64Array; at: Map<number, Float64Array> } {
  const rng = mulberry32(opts.seed);
  const Q = new Float64Array(m.n * 4);
  const at = new Map<number, Float64Array>();
  const want = new Set(opts.checkpoints);
  const argmax = (s: number) => {
    let b = 0;
    for (let a = 1; a < 4; a++)
      if ((Q[s * 4 + a] as number) > (Q[s * 4 + b] as number) + 1e-12) b = a;
    return b;
  };
  for (let e = 1; e <= opts.episodes; e++) {
    let s = start;
    for (let t = 0; t < opts.maxSteps && live(m, s); t++) {
      const a = rng() < opts.epsilon ? Math.floor(rng() * 4) : argmax(s);
      const [s2, , r] = sample(
        rng,
        (m.P[s] as Array<Array<[number, number, number]>>)[a] as Array<[number, number, number]>,
      );
      const next = live(m, s2) ? Math.max(...[0, 1, 2, 3].map((b) => Q[s2 * 4 + b] as number)) : 0;
      Q[s * 4 + a] =
        (Q[s * 4 + a] as number) + opts.alpha * (r + m.gamma * next - (Q[s * 4 + a] as number));
      s = s2;
    }
    if (want.has(e)) at.set(e, Q.slice());
  }
  return { Q, at };
}

export function vFromQ(m: Mdp, Q: Float64Array): Float64Array {
  const V = new Float64Array(m.n);
  for (let s = 0; s < m.n; s++)
    if (live(m, s)) V[s] = Math.max(...[0, 1, 2, 3].map((a) => Q[s * 4 + a] as number));
  return V;
}

/** The greedy walk from `start`, slips sampled from `seed`. */
export function rollout(
  m: Mdp,
  policy: readonly number[],
  start: number,
  seed: number,
  maxSteps: number,
): { cells: number[]; rewards: number[] } {
  const rng = mulberry32(seed);
  const cells = [start];
  const rewards: number[] = [];
  let s = start;
  for (let t = 0; t < maxSteps && live(m, s); t++) {
    const a = policy[s] as number;
    const [s2, , r] = sample(
      rng,
      (m.P[s] as Array<Array<[number, number, number]>>)[a] as Array<[number, number, number]>,
    );
    cells.push(s2);
    rewards.push(r);
    s = s2;
  }
  return { cells, rewards };
}

/* ------------------------------------------------------------------- input */

export interface RlInput extends Grid {
  start: Cell;
  algorithm: "value-iteration" | "q-learning";
  /** VI: sweeps to show (default 0, 1, 2, 4, 8, last); QL: episodes to show (default ~log-spaced to the last). */
  show?: number[];
  episodes?: number;
  alpha?: number;
  epsilon?: number;
  seed?: number;
  maxSteps?: number;
}

export const SLOTS: Readonly<Record<string, LiteralSlot>> = {
  sweep: { what: "while the values converge: which sweep (or episode) this is", vars: ["k"] },
  step: { what: "while the agent walks: the step and the return so far", vars: ["t", "G"] },
  reward: { what: "title of the reward-per-step bars" },
};

export const TAKEAWAY =
  "The values spread back from the reward until they settle; following the arrows to higher value, the agent reaches the goal in {steps} steps with return {G}.";

/* ---------------------------------------------------------------- the kind */

export function rlRollout(input: RlInput, region: Region): MechanismResult {
  const m = buildMdp(input);
  const start = input.start[1] * m.w + input.start[0];
  if (!live(m, start)) throw new Error("rl-rollout: the start must be a free, non-terminal cell");
  const maxSteps = input.maxSteps ?? 4 * m.n;
  let Vs: Array<{ k: number; V: Float64Array }>;
  let Vfinal: Float64Array;
  let policy: number[];
  if (input.algorithm === "value-iteration") {
    const all = valueIteration(m);
    const last = all.length - 1;
    const show = (input.show ?? [0, 1, 2, 4, 8]).filter((k) => k < last);
    Vs = [...show, last].map((k) => ({ k, V: all[k] as Float64Array }));
    Vfinal = all[last] as Float64Array;
    policy = greedy(m, Vfinal);
  } else {
    const episodes = input.episodes ?? 500;
    const show = input.show ?? [1, 10, 50, 200].filter((e) => e < episodes);
    const ql = qLearning(m, start, {
      episodes,
      alpha: input.alpha ?? 0.5,
      epsilon: input.epsilon ?? 0.2,
      seed: input.seed ?? 1,
      maxSteps,
      checkpoints: [...show, episodes],
    });
    Vs = [...show, episodes].map((k) => ({ k, V: vFromQ(m, ql.at.get(k) as Float64Array) }));
    Vfinal = vFromQ(m, ql.Q);
    policy = Array.from({ length: m.n }, (_, s) => {
      if (!live(m, s)) return -1;
      let b = 0;
      for (let a = 1; a < 4; a++)
        if ((ql.Q[s * 4 + a] as number) > (ql.Q[s * 4 + b] as number) + 1e-12) b = a;
      return b;
    });
  }
  const walk = rollout(m, policy, start, (input.seed ?? 1) + 1, maxSteps);
  const G = walk.rewards.reduce((s, r, t) => s + m.gamma ** t * r, 0);

  // Layout: the grid on the left, the reward bars on the right.
  const { width: W, height: H } = region;
  const size = TYPE.label;
  const top = size + 24;
  const gridW = W * 0.62;
  const cell = Math.min(gridW / m.w, (H - top) / m.h);
  const gx = (gridW - cell * m.w) / 2;
  const gy = top;
  const cx = (s: number) => gx + ((s % m.w) + 0.5) * cell;
  const cy = (s: number) => gy + (Math.floor(s / m.w) + 0.5) * cell;
  const lo = Math.min(0, ...Array.from(Vfinal));
  const hi = Math.max(1e-12, ...Array.from(Vfinal));
  const numbers = cell >= 110;
  /** The cells, then `under` (the trail), then the values and arrows on top. */
  const gridPrims = (V: Float64Array, arrows: boolean, under: Prim[] = []): Prim[] => {
    const out: Prim[] = [];
    for (let s = 0; s < m.n; s++) {
      const x = gx + (s % m.w) * cell;
      const y = gy + Math.floor(s / m.w) * cell;
      if (m.wall[s]) {
        out.push({
          p: "rect",
          id: `c${s}`,
          x,
          y,
          w: cell,
          h: cell,
          fill: "dim",
          role: "rule",
          width: 2,
        });
        continue;
      }
      const t = m.terminal[s];
      if (t !== undefined) {
        out.push({
          p: "rect",
          id: `c${s}`,
          x,
          y,
          w: cell,
          h: cell,
          fill: t >= 0 ? "d" : "c",
          role: "rule",
          width: 2,
        });
        out.push({
          p: "text",
          id: `v${s}`,
          x: x + cell / 2,
          y: y + cell / 2 - size / 2,
          size,
          role: "auto",
          anchor: "middle",
          text: fmt(t, 2),
          weight: 700,
        });
        continue;
      }
      const v = V[s] as number;
      out.push({
        p: "rect",
        id: `c${s}`,
        x,
        y,
        w: cell,
        h: cell,
        // The ramp stops at 60% of the accent so the values and arrows read on every cell, dark or light.
        heat: (0.6 * (v - lo)) / (hi - lo),
        role: "rule",
        width: 2,
      });
      if (numbers)
        out.push({
          p: "text",
          id: `v${s}`,
          x: x + cell / 2,
          y: y + 8,
          size,
          role: "auto",
          anchor: "middle",
          text: fmt(v, 2),
        });
      if (arrows && (policy[s] as number) >= 0) {
        const [dx, dy] = ACTIONS[policy[s] as number] as Cell;
        const L = cell * 0.22;
        const my = numbers ? y + cell * 0.66 : y + cell / 2;
        out.push({
          p: "line",
          id: `a${s}`,
          x1: x + cell / 2 - dx * L,
          y1: my - dy * L,
          x2: x + cell / 2 + dx * L,
          y2: my + dy * L,
          role: "fg",
          width: 4,
          arrow: true,
        });
      }
    }
    return [...out.filter((p) => p.p === "rect"), ...under, ...out.filter((p) => p.p !== "rect")];
  };
  // Reward bars: one per step, to scale, zero line in the middle when any is negative.
  const bx = gridW + 80;
  const bw = W - bx;
  const steps = walk.rewards.length;
  const rmax = Math.max(1e-12, ...walk.rewards.map(Math.abs));
  const neg = walk.rewards.some((r) => r < 0);
  const bTop = top + size + 20;
  const bH = H - bTop - (size + 16);
  const zero = neg ? bTop + bH / 2 : bTop + bH;
  const span = neg ? bH / 2 : bH;
  const barW = Math.min(60, bw / Math.max(1, steps) - 6);
  const bars = (upto: number): Prim[] => {
    const out: Prim[] = [
      { p: "text", id: "rt", x: bx, y: top, size, role: "muted", anchor: "start", slot: "reward" },
      { p: "line", id: "r0", x1: bx, y1: zero, x2: bx + bw, y2: zero, role: "rule", width: 2 },
    ];
    for (let t = 0; t < upto; t++) {
      const r = walk.rewards[t] as number;
      const hh = (Math.abs(r) / rmax) * span;
      out.push({
        p: "rect",
        id: `b${t}`,
        x: bx + t * (barW + 6),
        y: r >= 0 ? zero - hh : zero,
        w: barW,
        h: Math.max(2, hh),
        fill: r >= 0 ? "d" : "c",
      });
    }
    const last = walk.rewards[upto - 1];
    if (last !== undefined && Math.abs(last) === rmax)
      out.push({
        p: "text",
        id: "rv",
        x: bx + (upto - 1) * (barW + 6) + barW / 2,
        y: last >= 0 ? zero - span - size - 6 : zero + span + 6,
        size,
        role: "fg",
        anchor: "middle",
        text: fmt(last, 2),
      });
    return out;
  };
  const frames: Frame[] = Vs.map(({ k, V }, i) => ({
    id: `k${k}`,
    prims: [
      ...gridPrims(V, i === Vs.length - 1),
      {
        p: "text",
        id: "head",
        x: gx,
        y: 0,
        size,
        role: "fg",
        anchor: "start",
        slot: "sweep",
        vars: { k },
      },
    ],
    vars: { k },
  }));
  const walkFrames = Math.min(steps, 10);
  for (let f = 1; f <= walkFrames; f++) {
    const t = Math.round((steps * f) / walkFrames);
    const Gt = walk.rewards.slice(0, t).reduce((s, r, j) => s + m.gamma ** j * r, 0);
    const pos = walk.cells[t] as number;
    frames.push({
      id: `t${t}`,
      prims: [
        ...gridPrims(Vfinal, true, [
          {
            p: "path",
            id: "trail",
            pts: flat(walk.cells.slice(0, t + 1).map((s) => [cx(s), cy(s)] as const)),
            role: "accent",
            width: 8,
            opacity: 0.6,
          },
        ]),
        {
          p: "circle",
          id: "agent",
          cx: cx(pos),
          cy: cy(pos),
          r: cell * 0.2,
          fill: "fg",
          role: "panel",
          width: 4,
        },
        {
          p: "text",
          id: "head",
          x: gx,
          y: 0,
          size,
          role: "fg",
          anchor: "start",
          slot: "step",
          vars: { t, G: fmt(Gt, 2) },
        },
        ...bars(t),
      ],
      vars: { t, G: fmt(Gt, 2) },
    });
  }
  return {
    rasters: {},
    frames,
    data: {
      V: Vfinal,
      policy,
      cells: walk.cells,
      rewards: walk.rewards,
      sweeps: Vs.map((v) => v.k),
    },
    vars: { steps, G: fmt(G, 2) },
  };
}

export function takeaway(r: MechanismResult): string {
  return fillTemplate(TAKEAWAY, r.vars);
}

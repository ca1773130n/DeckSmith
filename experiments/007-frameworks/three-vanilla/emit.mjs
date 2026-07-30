/**
 * The prototype `scene-3d` emitter, written against DeckSmith's real Scene
 * contract. Nothing here is three.js-aware beyond the JSON spec it serialises —
 * the 3D lives entirely in the bundle the shell loads once.
 *
 *   type Emitter<A> = (beat: BeatOf<A>, ctx: EmitContext) => Scene
 *   interface Scene { html; tl: string[]; setup?: string[]; holds: number[]; css? }
 */

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

const CSS = `.s3d { position: absolute; inset: 0; }
.s3d canvas.ds3d { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
/* A 3D backdrop has no fixed luminance, so the copy band needs its own floor —
   without it \`hyperframes check\` fails contrast the moment the camera swings a
   bright surface under the kicker. Found by the gate, not by looking. */
.s3d .scrim {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 380px;
  background: linear-gradient(180deg, rgba(6, 9, 16, 0.94) 0%, rgba(6, 9, 16, 0.72) 55%, rgba(6, 9, 16, 0) 100%);
  pointer-events: none;
}
.s3d .lbl { position: absolute; left: 0; top: 0; will-change: transform, opacity; }
.s3d .lbl > span {
  display: block;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  font-size: 44px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #f2f5f9;
  background: rgba(10, 14, 22, 0.72);
  border: 2px solid rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  padding: 10px 20px;
}
.s3d .headline {
  position: absolute;
  left: 96px;
  top: 84px;
  margin: 0;
  font-size: 76px;
  line-height: 1.1;
  font-weight: 700;
  max-width: 1180px;
  color: #f2f5f9;
}
.s3d .kicker {
  position: absolute;
  left: 96px;
  top: 196px;
  margin: 0;
  font-size: 42px;
  font-weight: 500;
  color: #9fb0c6;
}`;

/**
 * @param {{kind:string, headline:string, kicker:string, labels:string[], spec:object,
 *          moves:Array<{prop:string,from:number,to:number,at:number,dur:number,ease?:string}>,
 *          holds:number[]}} beat
 * @param {{sid:string, format:{width:number,height:number}}} ctx
 * @returns {{html:string, tl:string[], setup:string[], holds:number[], css:string}}
 */
export function emitScene3d(beat, ctx) {
  const { sid, format } = ctx;
  const spec = { ...beat.spec, kind: beat.kind, width: format.width, height: format.height };
  const html = `        <div class="s3d">
          <canvas class="ds3d" width="${format.width}" height="${format.height}"></canvas>
          <div class="scrim"></div>
${beat.labels.map((l, i) => `          <div class="lbl" data-anchor="${i}"><span>${esc(l)}</span></div>`).join("\n")}
          <h2 class="headline">${esc(beat.headline)}</h2>
          <p class="kicker">${esc(beat.kicker)}</p>
        </div>`;

  // One statement. The 3D scene is built before the timeline exists, exactly like
  // `katex.render` in equation-walk — same slot, same rules.
  const setup = [`var h = DS3D.mount('${sid}', ${json(spec)});`];

  const tl = [
    `.fromTo('#${sid} .headline', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0)`,
    `.fromTo('#${sid} .kicker', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out' }, 0.25)`,
    ...beat.moves.map(
      (m) =>
        `.fromTo(h.s, { ${m.prop}: ${m.from} }, { ${m.prop}: ${m.to}, duration: ${m.dur}, ease: '${m.ease ?? "power2.inOut"}' }, ${m.at})`,
    ),
  ];

  return { html, tl, setup, holds: beat.holds, css: CSS };
}

/** The three beats a planner would have emitted. Data, not code — invariant 3. */
export const BEATS = [
  {
    id: "b1",
    kind: "cloud",
    seconds: 7,
    headline: "Embeddings are not a metaphor",
    kicker: "12,000 vectors, three classes, one space",
    labels: ["class A", "class B", "class C"],
    spec: { seed: "decksmith-007", count: 12000 },
    moves: [
      { prop: "assemble", from: 0, to: 1, at: 0.4, dur: 3.6, ease: "power3.out" },
      { prop: "orbit", from: 0, to: 1, at: 0.4, dur: 6.4, ease: "none" },
      { prop: "tag", from: 0, to: 1, at: 4.2, dur: 0.6, ease: "power1.out" },
    ],
    holds: [1.2, 4.2, 6.4],
  },
  {
    id: "b2",
    kind: "layers",
    seconds: 7,
    headline: "The pipeline, pulled apart",
    kicker: "each stage is a pure function of the one above",
    labels: ["ingest", "plan", "emit", "compose", "render"],
    spec: { layers: ["ingest", "plan", "emit", "compose", "render"] },
    moves: [
      { prop: "reveal", from: 0, to: 5, at: 0.3, dur: 2.6, ease: "none" },
      { prop: "cam", from: 0, to: 1, at: 1.2, dur: 3.4, ease: "power2.inOut" },
      { prop: "explode", from: 0, to: 1, at: 3.2, dur: 2.2, ease: "power2.out" },
    ],
    holds: [1.4, 3.2, 5.6],
  },
  {
    id: "b3",
    kind: "surface",
    seconds: 8,
    headline: "Descent on a real landscape",
    kicker: "the path is precomputed; the frame is a function of t",
    labels: ["start", "current θ"],
    spec: {},
    moves: [
      { prop: "grow", from: 0, to: 1, at: 0.3, dur: 1.8, ease: "power2.out" },
      { prop: "tag", from: 0, to: 1, at: 1.6, dur: 0.5, ease: "power1.out" },
      { prop: "walk", from: 0, to: 1, at: 2.2, dur: 4.2, ease: "power1.inOut" },
      { prop: "cam", from: 0, to: 1, at: 0.3, dur: 6.6, ease: "power1.inOut" },
    ],
    holds: [2.0, 4.4, 6.8],
  },
];

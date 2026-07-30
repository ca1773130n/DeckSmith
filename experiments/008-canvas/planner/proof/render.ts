/**
 * The proof. One geometry, three choreographies, plus a check that the new
 * representation can reproduce the old timeline.
 *
 * Writes standalone pages to ../out/. GSAP is vendored beside this file, the
 * timeline is paused, and `?t=` seeks it — so every screenshot is a seek, which
 * is the only way the deck ever advances a frame.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATS, type BeatOf } from "../../../../src/types.js";
import type { EmitContext } from "../../../../src/emit/kit.js";
import { baseCss, resolveTheme } from "../../../../src/emit/theme.js";
import { stack as realStack } from "../../../../src/emit/archetypes/stack.js";
import { stackFigure } from "./figure-stack.js";
import { choreograph, type MotionStyle, style, zoomCeiling } from "./motion.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out");
const format = FORMATS["deck-16x9"] as (typeof FORMATS)[string];
const theme = resolveTheme("ink");

const beat = {
  id: "b1",
  archetype: "stack",
  intent: "The retrieval stack is four layers and each one only talks to the one below it.",
  weight: 0.9,
  seconds: 16,
  params: {
    eyebrow: "How it is put together",
    headline: "Each layer only ever talks to the one below it",
    layers: [
      { label: "Raw corpus", note: "12M documents on disk" },
      { label: "Chunker", note: "512-token windows" },
      { label: "Embedder", note: "one vector per chunk" },
      { label: "Index", note: "HNSW, cosine" },
      { label: "Reranker", note: "cross-encoder, top 50" },
    ],
    note: "Nothing above the index ever reads the corpus directly.",
  },
} as unknown as BeatOf<"stack">;

const ctx = { source: {} as never, format, theme, sid: "s1" } as EmitContext & {
  format: typeof format;
};

const fig = stackFigure(beat, ctx);

const styles: Record<string, MotionStyle> = {
  // The rhythm extracted from the twelve emitters. Should land where the real
  // stack emitter lands.
  even: style("even"),
  // Same geometry, same length, different rhythm AND a different emphasis
  // policy: elements snap in, the deck sits on them, and the top plane — the one
  // the beat is about — arrives late, further, and overshooting, with the camera
  // riding up the pile so no stop is reached by a cut.
  emphatic: style("staccato", { emphasis: "focal", camera: "follow", zoom: 99 }),
  // A third, to show the knobs are independent of each other.
  brisk: style("brisk"),
};

/* ------------------------------------------------------- what changed, in numbers */

const real = realStack(beat, ctx);
const planned = Object.fromEntries(
  Object.entries(styles).map(([k, s]) => [k, choreograph(fig, beat.seconds, s)]),
);

const rows: string[] = [];
rows.push(`real emitter   holds: ${JSON.stringify(real.holds)}  tweens: ${real.tl.length}`);
for (const [k, p] of Object.entries(planned)) {
  const gaps = p.holds.slice(1).map((h, i) => Math.round((h - (p.holds[i] as number)) * 100) / 100);
  rows.push(
    `planner:${k.padEnd(9)} holds: ${JSON.stringify(p.holds)}  tweens: ${p.tl.length}  gaps: ${JSON.stringify(gaps)}`,
  );
}
const evenHolds = planned.even?.holds ?? [];
const delta = evenHolds.map((h, i) => Math.round((h - (real.holds[i] ?? Number.NaN)) * 100) / 100);
rows.push(`\n"even" vs the hand-written timeline, per stop: ${JSON.stringify(delta)}`);
const st = fig.stage as NonNullable<typeof fig.stage>;
rows.push(
  `camera viewport ${st.w}x${st.h}, safe ${st.safe.w}x${st.safe.h} -> zoom ceiling ${Math.round(zoomCeiling(st) * 1000) / 1000}`,
);
console.log(rows.join("\n"));

/* ------------------------------------------------------------------- pages */

function page(name: string, s: MotionStyle): string {
  const { tl, holds, plan } = choreograph(fig, beat.seconds, s);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>stack — ${name}</title>
    <script src="../proof/gsap.min.js"></script>
    <style>
${baseCss(theme, format)}
${(fig.css ?? "").replace(/^/gm, "      ")}
    </style>
  </head>
  <body>
    <div id="root" data-width="1920" data-height="1080">
      <div id="s1" class="scene clip" data-composition-id="s1" data-start="0" data-duration="${beat.seconds}">
${fig.html}
      </div>
    </div>
    <script>
      (function () {
        var tl = gsap.timeline({ paused: true });
        ${tl.join("\n        ")}
        window.__timelines = { s1: tl };
        window.__holds = ${JSON.stringify(holds)};
        window.__plan = ${JSON.stringify(plan.steps)};
        window.__style = ${JSON.stringify({ ...s, name })};
        window.__seek = function (t) { tl.pause(t); };
        var q = new URLSearchParams(location.search);
        var hold = q.get("hold");
        tl.pause(hold !== null ? window.__holds[Number(hold)] : Number(q.get("t") || 0));
      })();
    </script>
  </body>
</html>
`;
}

for (const [name, s] of Object.entries(styles)) {
  writeFileSync(join(out, `${name}.html`), page(name, s));
}
writeFileSync(join(out, "numbers.txt"), `${rows.join("\n")}\n`);
console.log(`\nwrote ${Object.keys(styles).join(", ")} to ${out}`);

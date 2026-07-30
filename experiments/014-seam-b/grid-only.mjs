// The control that separates the grid from the camera, and the reason the
// twelfth case's headline number belongs to neither this experiment nor
// `camera.ts`. It writes the camera fixture with the camera taken away — one
// `grid` beat, no `inside`, nothing to measure — so `drift --identical` is
// pointed at the grid archetype alone.
//
// Measured: 180 of 270 frames differ at 1 vs 3 workers, worst 51.52 dB, which
// is the SAME worst dB the two-beat camera fixture reports, on the same 10,393
// pixels in the same bounding box. See `grid-only-mask.png` — the difference is
// the grid's cell outlines on a 74.5px lattice, max 14/255, and it is identical
// from one frame to the next across a whole worker shard. `grid.ts` fits a
// fractional cell pitch by construction, so the hairline borders never land on
// device pixels and the flag cannot hold on any deck containing a grid.
//
// The fixture is written OUTSIDE the repo on purpose: a storyboard committed
// under experiments/ adds a `scored.test.mjs` case that fails until somebody
// receipts it, and this is a throwaway control, not a plan worth a receipt.
//
//   node experiments/014-seam-b/grid-only.mjs /tmp/grid-only.json
//   node dist/cli.js build /tmp/grid-only.json \
//     --source demo/fixtures/plain.source.json -o /tmp/grid-only-deck
//   node dist/cli.js drift /tmp/grid-only-deck --identical --keep
import { readFile, writeFile } from "node:fs/promises";

const out = process.argv[2];
if (!out) throw new Error("usage: node grid-only.mjs <out.json>");

const sb = JSON.parse(await readFile("demo/fixtures/camera.storyboard.json", "utf8"));
const grid = sb.beats.find((b) => b.archetype === "grid");
if (!grid) throw new Error("the camera fixture no longer has a grid beat");
delete grid.inside; // no camera anywhere in the deck: that is the whole point
await writeFile(out, JSON.stringify({ ...sb, title: "Grid only, no camera", beats: [grid] }, null, 2));
process.stdout.write(`wrote ${out}\n`);

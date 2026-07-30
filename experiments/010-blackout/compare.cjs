// Before/after floor across each handoff.
// INK = mean frame luma above the deck's background. A frame at ink 0 has
// NOTHING painted on it — that is the blackout, and it is the number that has to
// move. YMAX is reported beside it because a single bright pixel can hold YMAX
// off the floor while the frame is, to a viewer, empty: at the 0.15s overlap the
// floor read YMAX 34 and ink 0.007, which is background with a rounding error on
// it. Measure the ink.
const fs = require("node:fs");
const BG = 27;
const load = (p) =>
  fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(/\s+/))
    .map(([t, mn, mx, av]) => ({ t: +t, mn: +mn, mx: +mx, ink: +av - BG }))
    .sort((a, b) => a.t - b.t);
const [before, after] = [load(process.argv[2]), load(process.argv[3])];
const bounds = process.argv.slice(4).map(Number);
const win = (rows, b) => rows.filter((r) => r.t > b - 0.05 && r.t < b + 0.5);
const floor = (rows) => rows.reduce((lo, r) => (r.ink < lo.ink ? r : lo), rows[0]);
console.log("seam      before: ink  ymax  flat   ->   after: ink  ymax  flat");
for (const b of bounds) {
  const [x, y] = [win(before, b), win(after, b)];
  const [fx, fy] = [floor(x), floor(y)];
  const flat = (rows) => rows.filter((r) => r.mn === r.mx).length;
  console.log(
    `${b.toFixed(3).padStart(8)}  ${fx.ink.toFixed(3).padStart(11)} ${String(fx.mx).padStart(5)} ${String(flat(x)).padStart(5)}f  ->  ` +
      `${fy.ink.toFixed(3).padStart(11)} ${String(fy.mx).padStart(5)} ${String(flat(y)).padStart(5)}f`,
  );
}

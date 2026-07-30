// Group luma samples by handoff and report the run of frames with nothing painted.
// A frame is BLACK when YMAX == YMIN: no ink anywhere, the whole plate is one flat
// colour. That is the defect; a dim frame is not.
const fs = require("node:fs");
const rows = fs
  .readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((l) => l.split(/\s+/))
  .map(([t, mn, mx, av]) => ({ t: +t, mn: +mn, mx: +mx, av: +av }))
  // The snapshot filenames sort lexicographically, not numerically, so the raw
  // file is out of time order. Sorting here is load-bearing: an unsorted window
  // reports a black RUN that never happened.
  .sort((a, b) => a.t - b.t);
const bounds = process.argv.slice(3).map(Number);
for (const b of bounds) {
  const win = rows.filter((r) => r.t > b - 0.3 && r.t < b + 0.5);
  const black = win.filter((r) => r.mx === r.mn);
  const minMax = Math.min(...win.map((r) => r.mx));
  console.log(
    `handoff @${b.toFixed(3)}  minYMAX=${minMax}  black=${black.length}f` +
      (black.length ? ` [${black[0].t.toFixed(3)}..${black[black.length - 1].t.toFixed(3)}] luma=${black[0].mx}` : "") +
      `  ${win.map((r) => r.mx).join(",")}`,
  );
}

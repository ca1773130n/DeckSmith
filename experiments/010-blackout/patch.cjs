// Patch a BUILT deck the way composition.ts would, so the shape of the fix can be
// measured before it is written. Extends every scene clip except the last by
// `ov`, and (optionally) dissolves the outgoing scene across that extension.
//   node patch.cjs <index.html> <ov> <fade|nofade>
const fs = require("node:fs");
const [file, ovArg, mode] = process.argv.slice(2);
const ov = Number(ovArg);
let h = fs.readFileSync(file, "utf8");
const sids = [...h.matchAll(/<div\s+id="(s\d+)"/g)].map((m) => m[1]);
const last = sids[sids.length - 1];
for (const sid of sids) {
  if (sid === last) continue;
  const re = new RegExp(`(id="${sid}"[\\s\\S]{0,220}?data-duration=")([\\d.]+)(")`);
  const m = re.exec(h);
  const dur = Number(m[2]);
  h = h.replace(re, `$1${Math.round((dur + ov) * 1000) / 1000}$3`);
  if (mode === "fade") {
    const anchor = `window.__timelines["${sid}"] = tl;`;
    h = h.replace(
      anchor,
      `tl.fromTo("#${sid}", { opacity: 1 }, { opacity: 0, duration: ${ov}, ease: "power2.in", immediateRender: false }, ${dur});\n            ${anchor}`,
    );
  }
}
fs.writeFileSync(file, h);
console.log(`patched ${sids.length - 1} handoffs, ov=${ov}, ${mode}`);

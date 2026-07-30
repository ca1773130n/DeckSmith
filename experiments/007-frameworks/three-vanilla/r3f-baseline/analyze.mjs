import * as esbuild from "esbuild";
const r = await esbuild.build({
  entryPoints: ["cloud-r3f.jsx"], bundle: true, minify: true, format: "iife", target: "chrome120",
  jsx: "automatic", write: false, metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const inputs = r.metafile.outputs[Object.keys(r.metafile.outputs)[0]].inputs;
const byPkg = {};
for (const [f, v] of Object.entries(inputs)) {
  const m = f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  const k = m ? m[1] : "(own code)";
  byPkg[k] = (byPkg[k] || 0) + v.bytesInOutput;
}
for (const [k, v] of Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(String(v).padStart(9), k);
console.log(String(Object.values(byPkg).reduce((a, b) => a + b, 0)).padStart(9), "TOTAL (pre-minify accounting)");

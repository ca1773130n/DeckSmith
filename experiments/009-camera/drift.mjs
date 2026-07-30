const { drift } = await import("../../dist/drift.js");
const r = await drift(process.argv[2], { mode: "psnr", keep: true, workDir: process.argv[3] });
console.log(JSON.stringify({ passed: r.passed, mode: r.mode, frames: r.frames, identical: r.identical, worst: r.worst, findings: r.findings }, null, 1));

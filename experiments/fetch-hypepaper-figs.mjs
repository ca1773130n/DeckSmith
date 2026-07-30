// Download the figures referenced by the hypepaper analysis and report dimensions,
// so layout can be chosen per-figure instead of guessing (see EXPERIMENT-001).
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const BASE =
  "https://cdn.hypepaper.app/fb1f717c-06e4-4e31-93bd-fe528dd35a0a/figures";
const NAMES = [
  "figure_000_000.jpg",
  "figure_001_001.jpg",
  "figure_002_002.jpg",
  "figure_005_005.jpg",
  "figure_006_006.jpg",
  "figure_007_007.jpg",
  "table_003_003.jpg",
  "table_004_004.jpg",
];

const dir = "hf-thinksr/assets";
await mkdir(dir, { recursive: true });

for (const n of NAMES) {
  const res = await fetch(`${BASE}/${n}`);
  if (!res.ok) {
    console.log(`${n}  HTTP ${res.status}`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(`${dir}/${n}`, buf);
  const probe = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x", `${dir}/${n}`,
  ]).toString().trim();
  const [w, h] = probe.split("x").map(Number);
  console.log(
    `${n.padEnd(22)} ${String((buf.length / 1024) | 0).padStart(5)}KB  ${probe.padEnd(11)} aspect ${(w / h).toFixed(2)}`,
  );
}

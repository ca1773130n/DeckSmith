// Pull real "extracted figures + captions" from an arXiv HTML paper, the same shape
// hypepaper produces. Paper: 3D Gaussian Splatting (2308.04079).
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://ar5iv.labs.arxiv.org";
const html = await (await fetch(`${BASE}/html/2308.04079`)).text();

// figure blocks: <figure ...> ... <img src=...> ... <figcaption>...</figcaption>
const figs = [];
for (const m of html.matchAll(/<figure[^>]*>([\s\S]*?)<\/figure>/g)) {
  const block = m[1];
  const src = block.match(/<img[^>]+src="([^"]+)"/)?.[1];
  const cap = block
    .match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (src && cap && /\.(png|jpg|jpeg)$/i.test(src)) figs.push({ src, cap });
}

await mkdir("hf-paper-deck/assets", { recursive: true });
const picked = figs.slice(0, 4);
for (const [i, f] of picked.entries()) {
  const url = f.src.startsWith("http") ? f.src : BASE + f.src;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const name = `fig${i + 1}${f.src.match(/\.\w+$/)[0]}`;
  await writeFile(`hf-paper-deck/assets/${name}`, buf);
  console.log(`${name}  ${(buf.length / 1024) | 0}KB  ${f.cap.slice(0, 110)}`);
}
await writeFile(
  "hf-paper-deck/assets/captions.json",
  JSON.stringify(picked.map((f, i) => ({ file: `fig${i + 1}`, caption: f.cap })), null, 2),
);
console.log(`\ntotal figures found in paper: ${figs.length}`);

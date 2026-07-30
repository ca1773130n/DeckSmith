/** Subset Noto Sans KR to exactly the glyphs this spike shows. Same trick the
 *  thinksr deck uses; keeps the render offline and byte-stable. */
import { mkdir, writeFile } from "node:fs/promises";

const SAMPLES = [
  "생성형 슬라이드는 왜 죽어 보이는가",
  "카메라는 시간의 순수 함수여야 한다",
  "Seeking, not playing — determinism first",
  "DOM SVG Pixi Text BitmapText 40px 56px 88px 0123456789",
];
const chars = [...new Set(SAMPLES.join(""))].sort().join("");
const url =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700" +
  `&text=${encodeURIComponent(chars)}&display=block`;
const css = await (
  await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    },
  })
).text();

await mkdir("assets/fonts", { recursive: true });
const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
let out = css;
let total = 0;
for (const [i, u] of urls.entries()) {
  const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
  const name = `notosanskr-${i}.woff2`;
  await writeFile(`assets/fonts/${name}`, buf);
  out = out.replaceAll(u, `${name}`);
  total += buf.length;
}
await writeFile("assets/fonts/fonts.css", out);
console.log(`${urls.length} font file(s), ${(total / 1024).toFixed(1)} KB, ${chars.length} glyphs`);

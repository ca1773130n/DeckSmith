// HyperFrames' auto font resolution has a fixed allowlist (Inter is in it, Noto Sans KR
// is not), so Korean decks must ship their own @font-face. Rather than pull ~120 unicode
// -range subsets, ask Google Fonts for a subset containing exactly the glyphs this deck
// uses via &text= — tiny, self-contained, and deterministic.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const PROJ = "hf-thinksr";
const html = await readFile(`${PROJ}/index.html`, "utf8");

// every distinct character in the file; ASCII is free, what matters is the Hangul
const chars = [...new Set(html)].filter((c) => c.charCodeAt(0) > 31).sort().join("");
const hangul = [...chars].filter((c) => /[ᄀ-ᇿ㄰-㆏가-힯]/.test(c));
console.log(`unique chars: ${chars.length}  (hangul: ${hangul.length})`);

const url =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700" +
  `&text=${encodeURIComponent(chars)}&display=block`;
const css = await (
  await fetch(url, {
    headers: {
      // woff2 is only served to modern-UA requests
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    },
  })
).text();

await mkdir(`${PROJ}/assets/fonts`, { recursive: true });
// Google returns dynamic-subset URLs (/l/font?kit=…) with no file extension, not
// the usual /s/…/x.woff2 — match any https url inside src().
const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
console.log(`font files referenced: ${urls.length}`);

let out = css;
let total = 0;
for (const [i, u] of urls.entries()) {
  const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
  const name = `notosanskr-${i}.woff2`;
  await writeFile(`${PROJ}/assets/fonts/${name}`, buf);
  out = out.replaceAll(u, `assets/fonts/${name}`);
  total += buf.length;
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(1)}KB`);
}
await writeFile(`${PROJ}/assets/fonts/fonts.css`, out);
console.log(`total font payload: ${(total / 1024).toFixed(1)}KB`);

/** Prove the CJK path: bundled Noto Sans KR, real Hangul, no tofu. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bundleFont } from "./kolib.mjs";
import { renderCaptions } from "./kolib.mjs";
import { burnStyle } from "./kolib.mjs";

const deck = new URL("./kodeck", import.meta.url).pathname;
const work = new URL("./kowork", import.meta.url).pathname;

const cues = [
  { start: 0, end: 3, text: "이 논문은 작게 유지되는 사고 과정을 출력이 커야만 하는 과제와 맞붙입니다." },
  { start: 3, end: 6, text: "인코더가 SwinIR이 확립한 방식으로 무거운 작업을 먼저 처리합니다." },
  { start: 6, end: 9, text: "짧은 자막." },
];

const glyphs = cues.map((c) => c.text).join("");
await mkdir(join(deck, "assets", "fonts"), { recursive: true });
const bundle = await bundleFont("ko", glyphs, join(deck, "assets", "fonts"));
console.log("bundled:", bundle?.family, bundle?.files);

const style = burnStyle(1080, 1920, "Noto Sans KR");
const band = await renderCaptions(cues, style, deck, work);
console.log("band:", JSON.stringify(band));
console.log("usable width:", style.width - 2 * style.marginX, " band width:", band.width);
console.log("band height:", band.height, "= lines:", (band.height / 60).toFixed(2));

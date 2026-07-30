import { open } from "./drive.mjs";
import { mkdirSync } from "node:fs";
const OUT = "/Users/neo/Developer/Projects/DeckSmith/experiments/008-canvas/gap/shots";
mkdirSync(OUT, { recursive: true });

const [file, sid, tag, ...times] = process.argv.slice(2);
const { browser, page } = await open(`http://127.0.0.1:8138/${file}`);
await page.waitForTimeout(900);
for (const t of times) {
  await page.evaluate(([s, tt]) => window.__go(s, +tt), [sid, t]);
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/${tag}-t${String(t).replace(".", "_")}.png` });
}
console.log(tag, "→", times.length, "frames");
await browser.close();

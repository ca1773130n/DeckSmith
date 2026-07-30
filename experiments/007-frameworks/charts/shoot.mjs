// Seek each slide's PAUSED GSAP timeline to fixed absolute times and capture.
// Never plays. Captures twice at the same time to test frame determinism.
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const EXE = `${homedir()}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync("out/shots", { recursive: true });
const browser = await chromium.launch({
  executablePath: EXE,
  args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

const TIMES = [1.2, 2.0, 3.6];
const report = [];
for (const k of ["A", "B", "C"]) {
  await page.goto(`file://${process.cwd()}/out/slide-${k}.html`);
  await page.waitForFunction("window.__seek !== undefined");
  const dur = await page.evaluate("window.__dur");
  for (const t of TIMES) {
    await page.evaluate((tt) => window.__seek(tt), t);
    const a = await page.screenshot({ path: `out/shots/${k}-t${t}.png` });
    await page.evaluate(() => window.__seek(0));
    await page.evaluate((tt) => window.__seek(tt), t);
    const b = await page.screenshot();
    report.push({
      slide: k,
      t,
      dur: +dur.toFixed(2),
      bytes: a.length,
      reseekIdentical: createHash("sha256").update(a).digest("hex") === createHash("sha256").update(b).digest("hex"),
    });
  }
}
console.table(report);
await browser.close();

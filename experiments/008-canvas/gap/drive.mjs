// Own browser, so the two other workflows driving the shared Playwright MCP
// browser cannot steal the tab out from under a screenshot pass.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("/Users/neo/Developer/Projects/HypePaper/qa/");
const { chromium } = require("playwright-core");

export const OUT = "/Users/neo/Developer/Projects/DeckSmith/experiments/008-canvas/gap/shots";
mkdirSync(OUT, { recursive: true });

export async function open(url, { live = true } = {}) {
  const browser = await chromium.launch({
    executablePath:
      "/Users/neo/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  return { browser, page, errs, frame: () => page.frames().find((f) => f !== page.mainFrame()) };
}

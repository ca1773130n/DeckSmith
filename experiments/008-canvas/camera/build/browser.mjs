/**
 * One browser, shared by every measuring script here.
 *
 * puppeteer-core plus the Chrome `hyperframes browser path` reports, so what we
 * measure is what the renderer captures — a different Chrome would make every
 * pixel comparison in FINDINGS.md an assertion rather than a measurement.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

const run = promisify(execFile);

export async function chromePath() {
  const { stdout } = await run("npx", ["hyperframes", "browser", "path"]);
  return stdout.trim().split("\n").pop().trim();
}

export async function open({ width = 1920, height = 1080, dsf = 1 } = {}) {
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    args: ["--font-render-hinting=none", "--force-color-profile=srgb", "--hide-scrollbars"],
    defaultViewport: { width, height, deviceScaleFactor: dsf },
  });
  const page = await browser.newPage();
  return { browser, page };
}

/** Load a composition and wait until its root timeline exists. */
export async function loadComp(page, fileUrl) {
  await page.goto(fileUrl, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__timelines && Object.keys(window.__timelines).length > 0", {
    timeout: 20000,
  });
}

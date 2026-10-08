/**
 * A contact sheet: one scene's probe frames, scaled down and labelled, in one
 * PNG — the image the critique round attaches (`codex exec -i`). One image
 * rather than nine because the model has to compare frames against each other
 * ("at c2z the arc still crosses the label it crossed at c1z"), and the spike's
 * critic found its best defect that way.
 *
 * Drawn by the same Chrome the gates use, from an HTML page of <img> tags,
 * because the repository has a PNG decoder and no encoder, and a browser is
 * already a dependency of every gate that produced these frames.
 */
import { writeFile } from "node:fs/promises";
import { launchOwnPage, resolveChrome } from "../render/capture.js";

export interface SheetFrame {
  label: string;
  png: Buffer;
}

/** Columns of 640x360 cells; the frames are 1920x1080. */
export async function contactSheet(
  frames: readonly SheetFrame[],
  path: string,
  cols = 3,
): Promise<void> {
  const cellW = 640;
  const cellH = 360;
  const rows = Math.ceil(frames.length / cols);
  const html = `<!doctype html><html><body style="margin:0;background:#111;font:600 20px sans-serif;color:#fff">
<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:6px;padding:6px">
${frames
  .map(
    (f) => `<div style="position:relative;width:${cellW}px;height:${cellH}px">
<img src="data:image/png;base64,${f.png.toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block"/>
<div style="position:absolute;left:0;top:0;background:#000c;padding:2px 8px">${f.label.replace(/[<&]/g, "")}</div></div>`,
  )
  .join("\n")}
</div></body></html>`;
  const { default: puppeteer } = await import("puppeteer-core");
  const chrome = await resolveChrome("draw a contact sheet with");
  const browser = await launchOwnPage(
    (args) => puppeteer.launch({ executablePath: chrome.path, headless: true, args }),
    ["--force-device-scale-factor=1", "--hide-scrollbars"],
    "the contact sheet",
  );
  try {
    const page = await browser.newPage();
    const width = cols * cellW + (cols + 1) * 6;
    const height = rows * cellH + (rows + 1) * 6;
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    // No network in a data-URI page, so nothing to wait for but the decode.
    await page.setContent(html, { waitUntil: "load" });
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    await writeFile(path, png);
  } finally {
    await browser.close();
  }
}

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
  await contactSheets([{ frames, path }], cols);
}

/** Several contact sheets in one Chrome (a probe round draws one per scene). */
export async function contactSheets(
  sheets: ReadonlyArray<{ frames: readonly SheetFrame[]; path: string }>,
  cols = 3,
): Promise<void> {
  if (!sheets.length) return;
  const cellW = 640;
  const cellH = 360;
  await withChrome("the contact sheet", async (browser) => {
    const page = await browser.newPage();
    for (const { frames, path } of sheets) {
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
      const width = cols * cellW + (cols + 1) * 6;
      const height = Math.max(1, rows) * cellH + (Math.max(1, rows) + 1) * 6;
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      // No network in a data-URI page, so nothing to wait for but the decode.
      await page.setContent(html, { waitUntil: "load" });
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
      await writeFile(path, png);
    }
  });
}

type Browser = Awaited<ReturnType<typeof import("puppeteer-core").default.launch>>;

async function withChrome<T>(what: string, fn: (b: Browser) => Promise<T>): Promise<T> {
  const { default: puppeteer } = await import("puppeteer-core");
  const chrome = await resolveChrome(`draw ${what} with`);
  const browser = await launchOwnPage(
    (args) => puppeteer.launch({ executablePath: chrome.path, headless: true, args }),
    ["--force-device-scale-factor=1", "--hide-scrollbars"],
    what,
  );
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/**
 * The deck's copy of an illustration, and the draft call's copy with its
 * subjects boxed and numbered, drawn on a canvas by the same Chrome. WebP,
 * because a flat picture's PNG is 1-2 MB and its WebP at 0.84 is ~5-10% of
 * that (round 3 shipped 7-10 MB of PNG per deck); the repository has no image
 * encoder, and Chrome is already every gate's dependency.
 */
export async function pictureCopies(
  png: Buffer,
  boxes: ReadonlyArray<readonly [number, number, number, number]>,
  feather?: { width: number; height: number },
  quality = 0.84,
): Promise<{ webp: Buffer; boxed: Buffer; feathered: boolean }> {
  return withChrome("an illustration's copies", async (browser) => {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    const out = (await page.evaluate(
      `(async (src, boxes, q, box) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        if (box) {
          // The feather, baked in: alpha falls to 0 at the edges of the part of the
          // picture the box shows (slice: scaled to cover, centred), 6% at the sides
          // and 10% top and bottom, as the shell's CSS mask did at ~0.7s a frame.
          const W = c.width, H = c.height;
          const k = Math.max(box.width / W, box.height / H);
          const vw = box.width / k, vh = box.height / k;
          const x0 = (W - vw) / 2, y0 = (H - vh) / 2;
          const a = document.createElement("canvas");
          a.width = W; a.height = H;
          const m = a.getContext("2d");
          const h = m.createLinearGradient(x0, 0, x0 + vw, 0);
          h.addColorStop(0, "rgba(0,0,0,0)"); h.addColorStop(0.06, "#000"); h.addColorStop(0.94, "#000"); h.addColorStop(1, "rgba(0,0,0,0)");
          m.fillStyle = h; m.fillRect(0, 0, W, H);
          m.globalCompositeOperation = "destination-in";
          const v = m.createLinearGradient(0, y0, 0, y0 + vh);
          v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.1, "#000"); v.addColorStop(0.9, "#000"); v.addColorStop(1, "rgba(0,0,0,0)");
          m.fillStyle = v; m.fillRect(0, 0, W, H);
          g.globalCompositeOperation = "destination-in";
          g.drawImage(a, 0, 0);
          g.globalCompositeOperation = "source-over";
        }
        const webp = c.toDataURL("image/webp", q);
        // The boxed copy is drawn over the unfeathered picture.
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0);
        const w = c.width, h = c.height, lw = Math.max(4, Math.round(w / 300));
        boxes.forEach((b, i) => {
          const [x, y, bw, bh] = [b[0] * w, b[1] * h, b[2] * w, b[3] * h];
          g.lineWidth = lw; g.strokeStyle = "#ff2d55"; g.strokeRect(x, y, bw, bh);
          const r = Math.round(h / 22);
          g.fillStyle = "#ff2d55"; g.beginPath(); g.arc(x + r, y + r, r, 0, 2 * Math.PI); g.fill();
          g.fillStyle = "#ffffff"; g.font = "700 " + Math.round(r * 1.3) + "px sans-serif";
          g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), x + r, y + r + 1);
        });
        return [webp, c.toDataURL("image/png")];
      })(${JSON.stringify(`data:image/png;base64,${png.toString("base64")}`)}, ${JSON.stringify(boxes)}, ${quality}, ${JSON.stringify(feather ?? null)})`,
    )) as [string, string];
    const bytes = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const webp = bytes(out[0]);
    // A Chrome that cannot encode WebP hands back a PNG under that name.
    if (webp.toString("latin1", 8, 12) !== "WEBP")
      throw new Error("this Chrome cannot encode WebP");
    return { webp, boxed: bytes(out[1]), feathered: feather !== undefined };
  });
}

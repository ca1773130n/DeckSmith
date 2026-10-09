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
 *
 * ROUND 5, two layers. With a backdrop (`plate`) the subjects stand in front
 * of it: the subjects' copy keeps its transparent ground (a picture drawn on a
 * flat ground after all is keyed: its ground made transparent), the backdrop
 * gets the feathered edges, and `composite` is the two as the box shows them
 * (each scaled to cover the box, centred) — what the draft call is shown, with
 * `boxed` drawn over it in the same coordinates.
 */
export async function pictureCopies(
  png: Buffer,
  boxes: ReadonlyArray<readonly [number, number, number, number]>,
  feather?: { width: number; height: number },
  quality = 0.84,
  opts: { plate?: Buffer; ground?: string; cutout?: boolean } = {},
): Promise<{
  webp: Buffer;
  boxed: Buffer;
  feathered: boolean;
  plateWebp?: Buffer;
  composite?: Buffer;
}> {
  return withChrome("an illustration's copies", async (browser) => {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    const out = (await page.evaluate(
      `(async (src, plateSrc, boxes, q, box, ground, cutout) => {
        const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
        const img = await load(src);
        const plate = plateSrc ? await load(plateSrc) : null;
        const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
        // The feather, baked in: alpha falls to 0 at the edges of the part of the
        // picture the box shows (slice: scaled to cover, centred), 6% at the sides
        // and 10% top and bottom, as the shell's CSS mask did at ~0.7s a frame.
        const featherOn = (g, W, H) => {
          const k = Math.max(box.width / W, box.height / H);
          const vw = box.width / k, vh = box.height / k;
          const x0 = (W - vw) / 2, y0 = (H - vh) / 2;
          const [a, m] = canvas(W, H);
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
        };
        const W = img.naturalWidth, H = img.naturalHeight;
        const [c, g] = canvas(W, H);
        g.drawImage(img, 0, 0);
        let feathered = false;
        if (plate && !cutout && ground) {
          // Drawn on a flat ground after all: key the ground out (soft edge), so the backdrop shows.
          const gr = [1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16));
          const d = g.getImageData(0, 0, W, H);
          for (let i = 0; i < d.data.length; i += 4) {
            const e = Math.abs(d.data[i] - gr[0]) + Math.abs(d.data[i + 1] - gr[1]) + Math.abs(d.data[i + 2] - gr[2]);
            d.data[i + 3] = Math.round(d.data[i + 3] * Math.max(0, Math.min(1, (e - 30) / 50)));
          }
          g.putImageData(d, 0, 0);
        } else if (box && !cutout) {
          featherOn(g, W, H);
          feathered = true;
        }
        const webp = c.toDataURL("image/webp", q);
        let plateWebp = null;
        if (plate) {
          const [pc, pg] = canvas(plate.naturalWidth, plate.naturalHeight);
          pg.drawImage(plate, 0, 0);
          if (box) featherOn(pg, plate.naturalWidth, plate.naturalHeight);
          plateWebp = pc.toDataURL("image/webp", q);
        }
        // What the draft call sees: the box as the deck shows it (backdrop, then
        // subjects, each covering it), 1600px wide; or the picture itself.
        const cover = (i, CW, CH) => { const k = Math.max(CW / i.naturalWidth, CH / i.naturalHeight); return [k, (CW - i.naturalWidth * k) / 2, (CH - i.naturalHeight * k) / 2]; };
        let bc, bg, map;
        if (box && (plate || cutout)) {
          const CW = 1600, CH = Math.round((1600 * box.height) / box.width);
          [bc, bg] = canvas(CW, CH);
          bg.fillStyle = ground || "#ffffff"; bg.fillRect(0, 0, CW, CH);
          if (plate) { const [k, ox, oy] = cover(plate, CW, CH); bg.drawImage(plate, ox, oy, plate.naturalWidth * k, plate.naturalHeight * k); }
          const [k, ox, oy] = cover(img, CW, CH);
          bg.drawImage(c, ox, oy, W * k, H * k);
          map = (b) => [ox + b[0] * W * k, oy + b[1] * H * k, b[2] * W * k, b[3] * H * k];
        } else {
          [bc, bg] = canvas(W, H);
          bg.drawImage(img, 0, 0);
          map = (b) => [b[0] * W, b[1] * H, b[2] * W, b[3] * H];
        }
        const composite = box && (plate || cutout) ? bc.toDataURL("image/png") : null;
        const w = bc.width, h = bc.height, lw = Math.max(4, Math.round(w / 300));
        boxes.forEach((b, i) => {
          const [x, y, bw, bh] = map(b);
          bg.lineWidth = lw; bg.strokeStyle = "#ff2d55"; bg.strokeRect(x, y, bw, bh);
          const r = Math.round(h / 22);
          bg.fillStyle = "#ff2d55"; bg.beginPath(); bg.arc(x + r, y + r, r, 0, 2 * Math.PI); bg.fill();
          bg.fillStyle = "#ffffff"; bg.font = "700 " + Math.round(r * 1.3) + "px sans-serif";
          bg.textAlign = "center"; bg.textBaseline = "middle"; bg.fillText(String(i + 1), x + r, y + r + 1);
        });
        return [webp, bc.toDataURL("image/png"), feathered, plateWebp, composite];
      })(${JSON.stringify(`data:image/png;base64,${png.toString("base64")}`)}, ${JSON.stringify(opts.plate ? `data:image/png;base64,${opts.plate.toString("base64")}` : null)}, ${JSON.stringify(boxes)}, ${quality}, ${JSON.stringify(feather ?? null)}, ${JSON.stringify(opts.ground ?? null)}, ${JSON.stringify(opts.cutout === true)})`,
    )) as [string, string, boolean, string | null, string | null];
    const bytes = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const webp = bytes(out[0]);
    // A Chrome that cannot encode WebP hands back a PNG under that name.
    if (webp.toString("latin1", 8, 12) !== "WEBP")
      throw new Error("this Chrome cannot encode WebP");
    return {
      webp,
      boxed: bytes(out[1]),
      feathered: out[2],
      ...(out[3] ? { plateWebp: bytes(out[3]) } : {}),
      ...(out[4] ? { composite: bytes(out[4]) } : {}),
    };
  });
}

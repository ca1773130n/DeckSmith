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

/** The resolution planes are stored at, as a multiple of the frame: sharp up to this push-in. */
export const PLANE_SCALE = 1.4;
/**
 * How out of focus a plane's soft twin is, frame px. Rack focus cross-fades a
 * plane with this twin instead of tweening a CSS blur: MEASURED 2026-10-10 in
 * the gates' browser (SwiftShader), a CSS \`filter: blur()\` on six frame-sized
 * layers cost ~1.5s a frame (2.2s against 0.55s without), which made one deck's
 * motion gates take 672s.
 */
export const SOFT_PX = 6;

/** One backdrop plane as the deck stores it: frame-shaped, covering the frame at rest. */
export interface PlaneCopy {
  webp: Buffer;
  /** The same plane out of focus: blurred `SOFT_PX`, stored at a quarter of the size. */
  soft: Buffer;
  /** Mean relative inverse depth of the band it holds (0 far .. 1 near); absent when flat. */
  u?: number;
}

/** One subject, cut out of the subjects' picture: its own WebP and its box in frame px. */
export interface SubjectCopy {
  /** Which subject (0-based, the inspection's left-to-right order). */
  index: number;
  webp: Buffer;
  soft: Buffer;
  box: { x: number; y: number; w: number; h: number };
}

/**
 * ROUND 6. The backdrop sliced into depth planes (src/bespoke/depth.ts), and
 * each subject cut out on its own, every one already cropped to what covers
 * `frame` and stored at `PLANE_SCALE` times it. A plane holds its depth band's
 * real pixels; where a NEARER band covers it, it holds colours pushed and
 * pulled in from its own band at quarter resolution — what a nearer plane
 * uncovers when it slides — and it is transparent where nothing at or behind
 * its band is. The farthest plane is opaque everywhere. Without a depth map
 * (`depth` undefined) the backdrop is one plane. The pixel work runs at a
 * quarter of the stored size and the full-size planes are composited by the
 * canvas, so a picture takes ~3s, not minutes (MEASURED 2026-10-10: a per-pixel
 * pass at full size did not finish in 10 minutes).
 */
export async function depthPlanes(
  plate: Buffer,
  depth: Buffer | undefined,
  cuts: readonly number[],
  subjects: Buffer,
  boxes: ReadonlyArray<readonly [number, number, number, number]>,
  frame: { width: number; height: number },
  quality = 0.82,
): Promise<{ planes: PlaneCopy[]; subjects: SubjectCopy[]; scale: number }> {
  return withChrome("an illustration's depth planes", async (browser) => {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    const out = (await page.evaluate(
      `(async (plateSrc, depthSrc, cuts, subjSrc, boxes, frame, scale, q, soft) => {
        const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
        const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d", { willReadFrequently: true })]; };
        const plate = await load(plateSrc);
        const subj = await load(subjSrc);
        // The stored frame: the frame's aspect, PLANE_SCALE times it, never past the source's own pixels.
        const cover = (i) => Math.max(frame.width / i.naturalWidth, frame.height / i.naturalHeight);
        const kp = cover(plate);
        const S = Math.min(scale, 1 / kp);
        const W = Math.round(frame.width * Math.max(1, S)), H = Math.round(frame.height * Math.max(1, S));
        // The part of a picture that covers the frame, centred, as a source rect.
        const srcRect = (i) => { const k = cover(i); const sw = frame.width / k, sh = frame.height / k; return [(i.naturalWidth - sw) / 2, (i.naturalHeight - sh) / 2, sw, sh]; };
        const [px, py, pw, ph] = srcRect(plate);
        const drawCover = (g, i, w, h) => { const [x, y, sw, sh] = srcRect(i); g.imageSmoothingQuality = "high"; g.drawImage(i, x, y, sw, sh, 0, 0, w, h); };
        const planes = [];
        // The out-of-focus twin: a quarter of the size, blurred there (SOFT_PX at frame scale).
        const softOf = (c) => { const [sc, sg] = mk(Math.max(8, Math.round(c.width / 4)), Math.max(8, Math.round(c.height / 4))); sg.filter = "blur(" + (soft * sc.width / frame.width) + "px)"; sg.drawImage(c, 0, 0, sc.width, sc.height); return sc.toDataURL("image/webp", q); };
        if (!depthSrc) {
          const [c, g] = mk(W, H); drawCover(g, plate, W, H);
          planes.push([c.toDataURL("image/webp", q), null, softOf(c)]);
        } else {
          const depth = await load(depthSrc);
          const w = Math.max(64, Math.round(W / 4)), h = Math.max(64, Math.round(H / 4)), N = w * h;
          const [, sg] = mk(w, h); drawCover(sg, plate, w, h);
          const P = sg.getImageData(0, 0, w, h).data;
          // The depth map is the plate's, stretched to it: crop it the same way.
          const [, dg] = mk(w, h); dg.imageSmoothingQuality = "high";
          dg.drawImage(depth, (px / plate.naturalWidth) * depth.naturalWidth, (py / plate.naturalHeight) * depth.naturalHeight, (pw / plate.naturalWidth) * depth.naturalWidth, (ph / plate.naturalHeight) * depth.naturalHeight, 0, 0, w, h);
          const Dd = dg.getImageData(0, 0, w, h).data;
          const d = new Float32Array(N);
          for (let i = 0; i < N; i++) d[i] = Dd[i * 4] / 255;
          const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
          const nearer = (t) => { const m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = ss(t - 0.02, t + 0.02, d[i]); return m; };
          // Push-pull: a pyramid of weighted means, then each hole takes its parent's colour.
          const fill = (rgb, wt) => {
            const lv = [{ w, h, c: rgb.slice(), k: wt.slice() }];
            while (lv[lv.length - 1].w > 2 && lv[lv.length - 1].h > 2) {
              const p = lv[lv.length - 1], w2 = Math.ceil(p.w / 2), h2 = Math.ceil(p.h / 2);
              const c = new Float32Array(w2 * h2 * 3), k = new Float32Array(w2 * h2);
              for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
                const s = y * p.w + x, a = p.k[s]; if (!a) continue;
                const t = (y >> 1) * w2 + (x >> 1);
                k[t] += a; c[t * 3] += p.c[s * 3] * a; c[t * 3 + 1] += p.c[s * 3 + 1] * a; c[t * 3 + 2] += p.c[s * 3 + 2] * a;
              }
              for (let t = 0; t < w2 * h2; t++) if (k[t] > 0) { c[t * 3] /= k[t]; c[t * 3 + 1] /= k[t]; c[t * 3 + 2] /= k[t]; k[t] = Math.min(1, k[t]); }
              lv.push({ w: w2, h: h2, c, k });
            }
            for (let l = lv.length - 2; l >= 0; l--) {
              const p = lv[l], qq = lv[l + 1];
              for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
                const s = y * p.w + x, a = p.k[s]; if (a >= 0.999) continue;
                // The parent level sampled BILINEARLY: a nearest-parent pull left
                // 2^k-px blocks where a nearer plane slid off (ja r6a, a running track).
                const fx = Math.min(qq.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(qq.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
                const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(qq.w - 1, x0 + 1), y1 = Math.min(qq.h - 1, y0 + 1);
                const ax = fx - x0, ay = fy - y0;
                const i00 = y0 * qq.w + x0, i10 = y0 * qq.w + x1, i01 = y1 * qq.w + x0, i11 = y1 * qq.w + x1;
                for (let j = 0; j < 3; j++) {
                  const v = (qq.c[i00 * 3 + j] * (1 - ax) + qq.c[i10 * 3 + j] * ax) * (1 - ay) + (qq.c[i01 * 3 + j] * (1 - ax) + qq.c[i11 * 3 + j] * ax) * ay;
                  p.c[s * 3 + j] = p.c[s * 3 + j] * a + v * (1 - a);
                }
                p.k[s] = 1;
              }
            }
            return lv[0].c;
          };
          const rgb = new Float32Array(N * 3);
          for (let i = 0; i < N; i++) { rgb[i * 3] = P[i * 4]; rgb[i * 3 + 1] = P[i * 4 + 1]; rgb[i * 3 + 2] = P[i * 4 + 2]; }
          const masks = cuts.map(nearer);
          const small = (fn) => { const [c, g] = mk(w, h); const im = g.createImageData(w, h); for (let i = 0; i < N; i++) fn(im.data, i); g.putImageData(im, 0, 0); return c; };
          for (let k = 0; k <= cuts.length; k++) {
            const band = new Float32Array(N), cov = new Float32Array(N);
            let sd = 0, n = 0;
            for (let i = 0; i < N; i++) {
              const below = k > 0 ? masks[k - 1][i] : 1, above = k < cuts.length ? masks[k][i] : 0;
              band[i] = below * (1 - above); cov[i] = below;
              if (band[i] > 0.9) { sd += d[i]; n++; }
            }
            const [oc, og] = mk(W, H); og.imageSmoothingQuality = "high";
            if (k < cuts.length) {
              const col = fill(rgb, band.map((v) => (v > 0.98 ? 1 : 0)));
              og.drawImage(small((D, i) => { D[i * 4] = col[i * 3]; D[i * 4 + 1] = col[i * 3 + 1]; D[i * 4 + 2] = col[i * 3 + 2]; D[i * 4 + 3] = 255; }), 0, 0, W, H);
              const [bc, bg] = mk(W, H); drawCover(bg, plate, W, H);
              bg.globalCompositeOperation = "destination-in";
              bg.drawImage(small((D, i) => { D[i * 4 + 3] = Math.round(255 * Math.min(1, band[i] * 1.15)); }), 0, 0, W, H);
              og.drawImage(bc, 0, 0);
            } else drawCover(og, plate, W, H);
            if (k > 0) {
              og.globalCompositeOperation = "destination-in";
              og.drawImage(small((D, i) => { D[i * 4 + 3] = Math.round(255 * cov[i]); }), 0, 0, W, H);
            }
            planes.push([oc.toDataURL("image/webp", q), n ? Math.round((sd / n) * 1000) / 1000 : null, softOf(oc)]);
          }
        }
        // Each subject: its box (shares of the subjects' picture), padded, cut out at the stored scale.
        const ks = cover(subj), [sx, sy] = srcRect(subj);
        const toFrame = (ux, uy) => [(ux * subj.naturalWidth - sx) * ks, (uy * subj.naturalHeight - sy) * ks];
        const cut = boxes.map(([x, y, bw, bh]) => {
          const pad = 0.04;
          const [x0, y0] = toFrame(Math.max(0, x - pad * bw), Math.max(0, y - pad * bh));
          const [x1, y1] = toFrame(Math.min(1, x + bw * (1 + pad)), Math.min(1, y + bh * (1 + pad)));
          const fx = Math.max(0, x0), fy = Math.max(0, y0), fw = Math.min(frame.width, x1) - fx, fh = Math.min(frame.height, y1) - fy;
          if (fw < 8 || fh < 8) return null;
          const sc = W / frame.width;
          const [c, g] = mk(Math.round(fw * sc), Math.round(fh * sc)); g.imageSmoothingQuality = "high";
          g.drawImage(subj, sx + fx / ks, sy + fy / ks, fw / ks, fh / ks, 0, 0, c.width, c.height);
          return [c.toDataURL("image/webp", q), [Math.round(fx), Math.round(fy), Math.round(fw), Math.round(fh)], softOf(c)];
        });
        return [planes, cut, Math.round(S * 1000) / 1000];
      })(${JSON.stringify(`data:image/png;base64,${plate.toString("base64")}`)}, ${JSON.stringify(depth ? `data:image/png;base64,${depth.toString("base64")}` : null)}, ${JSON.stringify(cuts)}, ${JSON.stringify(`data:image/png;base64,${subjects.toString("base64")}`)}, ${JSON.stringify(boxes)}, ${JSON.stringify(frame)}, ${PLANE_SCALE}, ${quality}, ${SOFT_PX})`,
    )) as [
      Array<[string, number | null, string]>,
      Array<[string, [number, number, number, number], string] | null>,
      number,
    ];
    const bytes = (url: string) => {
      const b = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      if (b.toString("latin1", 8, 12) !== "WEBP") throw new Error("this Chrome cannot encode WebP");
      return b;
    };
    return {
      planes: out[0].map(([url, u, soft]) => ({
        webp: bytes(url),
        soft: bytes(soft),
        ...(u === null ? {} : { u }),
      })),
      subjects: out[1].flatMap((s, index) =>
        s
          ? [
              {
                index,
                webp: bytes(s[0]),
                soft: bytes(s[2]),
                box: { x: s[1][0], y: s[1][1], w: s[1][2], h: s[1][3] },
              },
            ]
          : [],
      ),
      scale: out[2],
    };
  });
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

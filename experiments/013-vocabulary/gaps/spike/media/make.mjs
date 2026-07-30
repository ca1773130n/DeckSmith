/**
 * A 4s/30fps video in which frame n is a flat grey of value 2n.
 *
 * Flat, so the answer survives chroma subsampling and scaling; linear in n, so
 * the mean pixel value of a captured cell READS BACK the source frame index
 * exactly. "The video moved" is not the question — "which frame did we get" is.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

await mkdir(new URL("./src/", import.meta.url), { recursive: true });
for (let n = 0; n < 120; n++) {
  const v = n * 2;
  const png = await sharp({
    create: { width: 480, height: 360, channels: 3, background: { r: v, g: v, b: v } },
  })
    .png()
    .toBuffer();
  await writeFile(new URL(`./src/f${String(n).padStart(3, "0")}.png`, import.meta.url), png);
}
const dir = new URL("./", import.meta.url).pathname;
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-framerate", "30", "-i", `${dir}src/f%03d.png`,
  "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p", `${dir}ramp.mp4`,
]);
console.log("wrote ramp.mp4");

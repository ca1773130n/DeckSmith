/**
 * The claim that actually matters for invariant 1: is the frame a pure function
 * of t? Test it the way capture exercises it — seek away, seek back, compare.
 * Doing it inside ONE session removes browser-startup variance, which is a
 * property of my harness rather than of the scene.
 */
import { createHash } from "node:crypto";
import { open } from "./drive.mjs";

for (const [file, sid, probes] of [
  ["p1-camera.html", "s2", [2.9, 4.25, 6.4, 7.6]],
  ["p2-morph.html", "s3", [5.4, 5.8, 6.4, 7.0]],
  ["p3-matchcut.html", "s3", [0.2, 0.9, 1.3, 2.6]],
]) {
  const { browser, page } = await open(`http://127.0.0.1:8138/${file}`);
  await page.waitForTimeout(1200);
  const seen = new Map();
  // visit every probe five times, in a shuffled-but-fixed order
  const order = [];
  for (let r = 0; r < 5; r++) for (const t of probes) order.push(t);
  for (const t of order) {
    await page.evaluate(([s, tt]) => window.__go(s, tt), [sid, t]);
    await page.waitForTimeout(220);
    const h = createHash("sha256").update(await page.screenshot()).digest("hex").slice(0, 12);
    (seen.get(t) ?? seen.set(t, new Set()).get(t)).add(h);
  }
  const bad = [...seen].filter(([, s]) => s.size > 1);
  console.log(
    `${file} ${sid}: ${bad.length === 0 ? "PURE" : "IMPURE"} — ` +
      [...seen].map(([t, s]) => `t=${t}:${s.size}`).join(" ") +
      "  (distinct frames per time over 5 revisits)",
  );
  await browser.close();
}

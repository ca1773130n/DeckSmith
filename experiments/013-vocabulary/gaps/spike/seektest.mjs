/**
 * The narrow question invariant 11 turns on: with suppressEvents TRUE, which
 * sinks still receive state?
 *
 * Reads the DOM directly rather than pixels, because the thing being decided is
 * whether the write happened at all. Runs the exact call hyperframes' GSAP
 * adapter makes: pause(); totalTime(t+0.001, true); totalTime(t, suppress).
 */
import { launch } from "puppeteer-core";
import { readdir } from "node:fs/promises";

const chromeDir = `${process.env.HOME}/.cache/puppeteer/chrome`;
const [ver] = await readdir(chromeDir);
const exe = `${chromeDir}/${ver}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`file://${process.cwd()}/index.html`, { waitUntil: "networkidle0" });

const probe = async (t, suppress) =>
  page.evaluate(
    (t, suppress) => {
      const tl = window.__timelines.main;
      tl.pause();
      tl.totalTime(t + 0.001, true);
      tl.totalTime(t, suppress);
      const at = (id, a) => document.getElementById(id).getAttribute(a);
      const cs = (id, p) => getComputedStyle(document.getElementById(id))[p];
      const canvasInk = () => {
        const c = document.getElementById("c12");
        const d = c.getContext("2d").getImageData(0, 0, 480, 360).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
        return n;
      };
      const dLen = (id) => (at(id, "d") || "").length;
      const firstY = (id) => {
        const m = /L 20 ([\d.-]+)/.exec(at(id, "d") || "");
        const m2 = /L 90 ([\d.-]+)/.exec(at(id, "d") || "");
        return m2 ? m2[1] : m ? m[1] : "none";
      };
      return {
        "01 attr cx": at("c01", "cx"),
        "02 dashoffset": document.getElementById("c02").style.strokeDashoffset || cs("c02", "strokeDashoffset"),
        "03 drawSVG dashoffset": document.getElementById("c03").style.strokeDashoffset || "-",
        "04 morphSVG d[len]": String(dLen("c04")),
        "05 motionPath transform": cs("c05", "transform").slice(0, 40),
        "06 offsetDistance": cs("c06dot", "offsetDistance"),
        "07 clip width": at("c07", "width"),
        "08 SMIL cx(anim)": String(
          document.querySelector("#c08, .cell:nth-child(8) circle")?.cx?.animVal?.value ?? "n/a",
        ),
        "09 css kf transform": cs("c09dot", "transform").slice(0, 40),
        "10 plugin d y@90": firstY("c10"),
        "11 onUpdate d y@90": firstY("c11"),
        "12 canvas ink": String(canvasInk()),
      };
    },
    t,
    suppress,
  );

for (const suppress of [false, true]) {
  const a = await probe(0, suppress);
  const b = await probe(2, suppress);
  const c = await probe(4, suppress);
  console.log(`\n=== suppressEvents = ${suppress} ===`);
  console.log("sink".padEnd(24), "t=0".padEnd(24), "t=2".padEnd(24), "t=4".padEnd(24), "changes?");
  for (const k of Object.keys(a)) {
    const vals = [a[k], b[k], c[k]];
    const moved = new Set(vals).size > 1;
    console.log(
      k.padEnd(24),
      ...vals.map((v) => String(v).slice(0, 23).padEnd(24)),
      moved ? "yes" : "NO — FROZEN",
    );
  }
}
await browser.close();

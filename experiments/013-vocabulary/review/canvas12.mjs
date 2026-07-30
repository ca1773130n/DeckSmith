/**
 * Is gaps/spike cell 12 (canvas driven by a plugin render) a pure function of t?
 * Seek the SAME t repeatedly, always with suppressEvents=true, and read the ink.
 */
import puppeteer from "puppeteer-core";
const CHROME =
  "/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const SPIKE = new URL("../gaps/spike/index.html", import.meta.url).pathname;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--force-device-scale-factor=1"] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`file://${SPIKE}`, { waitUntil: "networkidle0" });

const probe = (t, suppress) =>
  page.evaluate(
    (t, suppress) => {
      const tl = window.__timelines.main;
      tl.pause();
      tl.totalTime(t + 0.001, true);
      tl.totalTime(t, suppress);
      const c = document.getElementById("c12");
      const d = c.getContext("2d").getImageData(0, 0, 480, 360).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
      return n;
    },
    t,
    suppress,
  );

const rows = [];
for (const step of [
  ["cold t=2 suppress", 2, true],
  ["again t=2 suppress", 2, true],
  ["again t=2 suppress", 2, true],
  ["t=4 suppress", 4, true],
  ["back t=2 suppress", 2, true],
  ["t=0 suppress", 0, true],
  ["back t=2 suppress", 2, true],
  ["t=2 NO suppress", 2, false],
  ["t=2 suppress", 2, true],
])
  rows.push([step[0], await probe(step[1], step[2])]);
for (const [k, v] of rows) console.log(k.padEnd(22), v);
await browser.close();

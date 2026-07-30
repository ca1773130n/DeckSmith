import { launch } from "puppeteer-core";
import { readdir } from "node:fs/promises";
const chromeDir = `${process.env.HOME}/.cache/puppeteer/chrome`;
const [ver] = await readdir(chromeDir);
const browser = await launch({
  executablePath: `${chromeDir}/${ver}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`file://${process.cwd()}/index.html`, { waitUntil: "networkidle0" });
console.log(
  await page.evaluate(() => {
    const tl = window.__timelines.main;
    tl.pause();
    tl.seek(3.9);
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return {
      worldTransform: getComputedStyle(document.getElementById("world")).transform,
      k1rect: `${r("k1").left.toFixed(1)},${r("k1").top.toFixed(1)} ${r("k1").width.toFixed(1)}x${r("k1").height.toFixed(1)}`,
      k3rect: `${r("k3").left.toFixed(1)},${r("k3").top.toFixed(1)} ${r("k3").width.toFixed(1)}x${r("k3").height.toFixed(1)}`,
      gsapVersion: window.gsap.version,
    };
  }),
);
await page.screenshot({ path: "probe-3900ms.png" });
await browser.close();

import { homedir } from "node:os";
import { join } from "node:path";
const { getInstalledBrowsers } = await import("@puppeteer/browsers");
const inst = await getInstalledBrowsers({ cacheDir: process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer") });
const exe = (inst.find(b=>b.browser==="chrome-headless-shell")??inst[0]).executablePath;
const { default: p } = await import("puppeteer-core");
const b = await p.launch({ executablePath: exe, args:["--allow-file-access-from-files","--hide-scrollbars"] });
const pg = await b.newPage();
await pg.setViewport({width:1920,height:1080});
await pg.goto(`file://${process.argv[2]}/index.html`, {waitUntil:"load"});
await pg.waitForFunction("window.__hfTimelinesBuilding === false", {timeout:30000});
const r = await pg.evaluate(() => {
  const scenes = [...document.querySelectorAll('[data-composition-id]')].filter(e=>e.id!=="root");
  const out = [];
  for (const s of scenes) {
    const els = s.querySelectorAll('*');
    const t0 = performance.now();
    let n = 0;
    for (const e of els) { const r = e.getBoundingClientRect(); if (r.width) n++; }
    out.push({ sid: s.id, elements: els.length, measured: n, ms: +(performance.now()-t0).toFixed(2) });
  }
  return { scenes: out, total: +out.reduce((a,x)=>a+x.ms,0).toFixed(2), fonts: document.fonts.size };
});
console.log(JSON.stringify(r, null, 1));
await b.close();

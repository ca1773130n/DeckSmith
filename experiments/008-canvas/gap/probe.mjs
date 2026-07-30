import { open, OUT } from "./drive.mjs";

const { browser, page, errs, frame } = await open("http://127.0.0.1:8137/deck.html");
const f = frame();
console.log("frames:", page.frames().length, "errs:", errs.length);

const info = await page.evaluate(() => {
  const g = window;
  const keys = Object.keys(g).filter((k) => /deck|stop|hf|hyper|frame/i.test(k));
  return { title: document.title, keys, html: document.body.innerHTML.slice(0, 400) };
});
console.log(JSON.stringify(info, null, 1).slice(0, 1500));

const inner = await f.evaluate(() => {
  const scenes = [...document.querySelectorAll("[data-composition-id]")].map((e) => ({
    id: e.dataset.compositionId,
    start: +e.dataset.start,
    dur: +e.dataset.duration,
    label: e.dataset.label,
  }));
  return {
    rootCls: document.documentElement.className,
    tls: Object.keys(window.__timelines || {}),
    scenes,
    animCount: document.getAnimations().length,
  };
});
console.log(JSON.stringify(inner, null, 1));
await browser.close();

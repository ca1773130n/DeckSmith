import { open } from "./drive.mjs";
const { browser, page, frame } = await open("http://127.0.0.1:8137/deck.html");
const f = frame();
const r = await f.evaluate(() => {
  const out = [];
  for (const s of document.querySelectorAll("[data-composition-id].scene")) {
    const prev = s.style.display;
    s.style.display = "";
    const h = s.querySelector("h1,h2");
    const hb = h?.getBoundingClientRect();
    // content ink bbox: union of every leaf box, excluding the headline block
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const e of s.querySelectorAll("*")) {
      if (e.children.length) continue;
      const b = e.getBoundingClientRect();
      if (b.width < 3 || b.height < 3) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
    }
    out.push({
      sid: s.id,
      head: hb ? [Math.round(hb.x), Math.round(hb.y), Math.round(hb.width), Math.round(hb.height)] : null,
      headFont: h ? getComputedStyle(h).fontSize : null,
      ink: [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)],
      fill: +(((x1 - x0) * (y1 - y0)) / (1920 * 1080)).toFixed(2),
    });
    s.style.display = prev;
  }
  return out;
});
console.table(r.map((o) => ({ sid: o.sid, headX: o.head?.[0], headY: o.head?.[1], font: o.headFont, ink: o.ink.join(","), fill: o.fill })));
await browser.close();

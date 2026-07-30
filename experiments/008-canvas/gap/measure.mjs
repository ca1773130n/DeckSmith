import { open, OUT } from "./drive.mjs";

const { browser, page, frame } = await open("http://127.0.0.1:8137/deck.html");
const f = frame();

// --- 1. background: is anything but a flat fill behind the content?
const bg = await f.evaluate(() => {
  const cs = getComputedStyle(document.body);
  const html = getComputedStyle(document.documentElement);
  const layers = [...document.querySelectorAll("*")].filter((e) => {
    const s = getComputedStyle(e);
    return s.backgroundImage !== "none";
  });
  return {
    bodyBg: cs.backgroundColor,
    bodyBgImage: cs.backgroundImage,
    htmlBg: html.backgroundColor,
    elementsWithBgImage: layers.length,
    sceneTransforms: [...document.querySelectorAll(".scene")].map((e) => getComputedStyle(e).transform),
  };
});
console.log("BACKGROUND", JSON.stringify(bg));

// --- 2. ambient: how many elements actually animate on a held slide, and by how much
await page.evaluate(() => { location.hash = "#2.5"; });
await page.waitForTimeout(1500);
const amb = await f.evaluate(async () => {
  const anims = document.getAnimations();
  const targets = anims.map((a) => ({
    name: a.animationName,
    id: a.effect?.target?.id || a.effect?.target?.className,
    state: a.playState,
  }));
  // sample the animated property over 3s
  const el = anims[0]?.effect?.target;
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(getComputedStyle(el).filter);
    await new Promise((r) => setTimeout(r, 300));
  }
  return { count: anims.length, targets, samples: [...new Set(samples)] };
});
console.log("AMBIENT", JSON.stringify(amb, null, 1));

// --- 3. pixel-level: does a held slide change at all over 3s?
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/hold-a.png` });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/hold-b.png` });

// --- 4. any element shared across two consecutive scenes? (identical geometry+text)
const carry = await f.evaluate(() => {
  const boxes = (sid) => {
    const root = document.getElementById(sid);
    const prev = root.style.display;
    root.style.display = "";
    const out = [...root.querySelectorAll("*")]
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { t: (e.textContent || "").trim().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((b) => b.w > 4 && b.h > 4);
    root.style.display = prev;
    return out;
  };
  const a = boxes("s2"), b = boxes("s3");
  const key = (o) => `${o.t}|${o.x},${o.y},${o.w},${o.h}`;
  const setA = new Set(a.map(key));
  const shared = b.filter((o) => setA.has(key(o)));
  // same text, any position
  const textA = new Set(a.map((o) => o.t).filter(Boolean));
  const sharedText = [...new Set(b.map((o) => o.t).filter((t) => t && textA.has(t)))];
  return { s2: a.length, s3: b.length, identicalBoxes: shared.length, sharedText };
});
console.log("CARRYOVER s2->s3", JSON.stringify(carry));

// --- 5. figure inventory: how big are real paper figures on screen
const figs = await f.evaluate(() => {
  return [...document.querySelectorAll("img")].map((im) => {
    const scene = im.closest("[data-composition-id]");
    const prev = scene.style.display; scene.style.display = "";
    const r = im.getBoundingClientRect();
    const p = im.parentElement.getBoundingClientRect();
    scene.style.display = prev;
    return { sid: scene.id, src: im.getAttribute("src"), nat: [im.naturalWidth, im.naturalHeight], on: [Math.round(r.width), Math.round(r.height)], plate: [Math.round(p.width), Math.round(p.height)], zoom: +(r.width / im.naturalWidth).toFixed(3) };
  });
});
console.log("FIGURES", JSON.stringify(figs, null, 1));

await browser.close();

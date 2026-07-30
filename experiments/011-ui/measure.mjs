/**
 * Measure the page rather than admire it.
 *
 * The ratio glyph on a format tile went missing for a whole screenshot run
 * because a CSS rule named an element and the code built a span — the page
 * looked fine and was wrong. So every claim below is a number read out of the
 * live layout: rendered size, computed colour, accessible name, tap target.
 *
 * Contrast is computed from the RESOLVED colours, and against the nearest
 * painted ancestor, because a bounding box tells you nothing about what a pixel
 * ended up being.
 */
async (page) => {
  const BASE = "http://127.0.0.1:8791";
  const DIR = "/Users/neo/Developer/Projects/DeckSmith/experiments/011-ui";
  const ctx = page.context();
  const out = {};

  const probe = async (p) => p.evaluate(() => {
    /* Normalise ANY computed colour to 0-255 sRGB.
       The first version of this split the string on numbers, which silently
       read `color(srgb 0.55 0.6 0.65)` — what color-mix() computes to — as
       near-black and reported every mixed colour as failing 1.19:1. The canvas
       is the browser's own colour parser, so it cannot disagree with what was
       painted. */
    const pad = document.createElement("canvas").getContext("2d");
    const rgb = (s) => {
      pad.fillStyle = "#000";
      pad.fillStyle = String(s);
      const hex = pad.fillStyle;                       // "#rrggbb" or "rgba(...)"
      if (hex[0] === "#") return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const m = String(hex).match(/[\d.]+/g);
      return m ? m.slice(0, 3).map(Number) : null;
    };
    const lum = (c) => {
      const f = c.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
    };
    // The colour actually painted behind an element: walk up past transparents.
    const ground = (el) => {
      let n = el;
      while (n) {
        const bg = rgb(getComputedStyle(n).backgroundColor);
        const a = String(getComputedStyle(n).backgroundColor).match(/[\d.]+/g);
        if (bg && !(a && a.length === 4 && Number(a[3]) === 0)) return bg;
        n = n.parentElement;
      }
      return [0, 0, 0];
    };
    const contrast = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return ratio(rgb(getComputedStyle(el).color), ground(el));
    };
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };

    // Every visible glyph on a format tile, with its painted fill.
    const glyphs = [...document.querySelectorAll(".ratio i")].map((i) => {
      const r = i.getBoundingClientRect();
      const cs = getComputedStyle(i);
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        ar: r.height ? Math.round((r.width / r.height) * 100) / 100 : 0,
        painted: cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px",
      };
    });

    // Anything focusable must have an accessible name.
    const focusables = [...document.querySelectorAll(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1']), summary",
    )].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const unnamed = focusables.filter((el) => {
      const name = el.getAttribute("aria-label")
        || (el.labels && el.labels.length && el.labels[0].textContent.trim())
        || el.textContent.trim()
        || el.getAttribute("title")
        || el.getAttribute("placeholder");
      return !name;
    }).map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + el.className);

    // Tap targets: everything a finger must hit.
    const small = [...document.querySelectorAll("button, label.tile, label.chip, label.sws, .seg label, .x, .iconbtn, .gets a, .gets button")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el: (el.id || el.className || el.tagName), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((x) => x.h > 0 && x.h < 36);

    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      glyphs,
      unnamed,
      smallTargets: small,
      contrast: {
        body: contrast("body"),
        tag: contrast(".tag"),
        secLabel: contrast("h2.sec"),
        dropHint: contrast(".drop small"),
        tileDim: contrast(".tdim"),
        fmtnote: contrast(".fmtnote"),
        goHint: contrast(".hint"),
        stepDetail: contrast(".steps .dt"),
        log: contrast(".log pre"),
        errHint: contrast(".fail .hint"),
        facts: contrast(".facts"),
      },
      boxes: { go: box("#go"), drop: box("#drop"), canvas: box("#d-canvas") },
      sub: getComputedStyle(document.documentElement).getPropertyValue("--sub").trim(),
    };
  });

  let SCHEME = "dark";
  async function at(width, url, prep) {
    const p = await ctx.newPage();
    await p.emulateMedia({ colorScheme: SCHEME });
    await p.setViewportSize({ width, height: 900 });
    await p.goto(url);
    await p.waitForTimeout(400);
    if (prep) await prep(p);
    const r = await probe(p);
    await p.close({ runBeforeUnload: false });
    return r;
  }

  const run = async (p, video) => {
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    if (video) await p.click("label.sws:has(#video)");
    await p.click("#go");
    await p.waitForTimeout(1600);
  };

  const open390 = async (p) => {
    await p.setInputFiles("#fileinput", DIR + "/fixture.zip");
    await p.click("details.more summary");
    await p.click("label.tile:has(input[value=custom])");
    await p.waitForTimeout(300);
  };

  for (const s of ["dark", "light"]) {
    SCHEME = s;
    out[s + ":compose@1280"] = await at(1280, BASE + "/");
    out[s + ":compose@390"] = await at(390, BASE + "/");
    out[s + ":options@390"] = await at(390, BASE + "/", open390);
    out[s + ":run@390"] = await at(390, BASE + "/?s=run-render", (p) => run(p, true));
    out[s + ":done@390"] = await at(390, BASE + "/?s=done-video", (p) => run(p, true));
    out[s + ":done@1280"] = await at(1280, BASE + "/?s=done-video", (p) => run(p, true));
    out[s + ":err@390"] = await at(390, BASE + "/?s=err-plan", (p) => run(p, false));
  }

  // Condense: report only what is wrong, plus the few numbers worth quoting.
  const report = {};
  for (const [k, v] of Object.entries(out)) {
    const bad = Object.entries(v.contrast).filter(([, r]) => r !== null && r < 4.5);
    const worst = Object.entries(v.contrast).filter(([, r]) => r !== null)
      .sort((a, b) => a[1] - b[1]).slice(0, 3);
    report[k] = {
      overflowX: v.overflowX,
      unnamed: v.unnamed,
      under40pxTargets: v.smallTargets.length,
      glyphAspects: v.glyphs.filter((g) => g.w).map((g) => g.ar + (g.painted ? "" : " UNPAINTED")),
      contrastFails: bad,
      lowestThree: worst,
      canvas: v.boxes.canvas,
      sub: v.sub,
    };
  }
  return JSON.stringify(report);
}

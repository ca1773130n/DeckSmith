// src/emit/kit.ts
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function js(s) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

// src/emit/svg.ts
var MIN_FONT = 40;
function n(v) {
  return (Math.round(v * 100) / 100).toString();
}
function drawFrom(length) {
  const l = Math.ceil(length) + 1;
  return `{ strokeDasharray: ${l}, strokeDashoffset: ${l} }`;
}
function id(sid, part, i) {
  return i === void 0 ? `${sid}-${part}` : `${sid}-${part}${i}`;
}
function charUnits(c) {
  if (c === " ") return 0.3;
  const code = c.codePointAt(0) ?? 0;
  if (code > 11903) return 1.02;
  if (c >= "0" && c <= "9" || c === "." || c === ",") return 0.6;
  if ("MW@%".includes(c)) return 0.95;
  if ("mw".includes(c)) return 0.88;
  if ("ijltI:;'`|!()[]".includes(c)) return 0.33;
  if (c >= "A" && c <= "Z") return 0.72;
  if (code >= 192 && code <= 223) return 0.72;
  return 0.56;
}
function weightFactor(weight) {
  return weight >= 700 ? 1.07 : weight >= 600 ? 1.04 : 1;
}
function textWidth(text2, fontSize, weight = 400) {
  let units = 0;
  for (const c of text2) units += charUnits(c);
  return units * fontSize * weightFactor(weight);
}
function wrap(text2, fontSize, maxWidth, weight = 400) {
  if (maxWidth <= 0) return [text2];
  const lines = [];
  let line2 = "";
  const push = () => {
    if (line2) lines.push(line2);
    line2 = "";
  };
  for (const word of text2.split(/\s+/).filter(Boolean)) {
    const candidate = line2 ? `${line2} ${word}` : word;
    if (textWidth(candidate, fontSize, weight) <= maxWidth) {
      line2 = candidate;
      continue;
    }
    push();
    if (textWidth(word, fontSize, weight) <= maxWidth) {
      line2 = word;
      continue;
    }
    for (const c of word) {
      if (line2 && textWidth(line2 + c, fontSize, weight) > maxWidth) push();
      line2 += c;
    }
  }
  push();
  return lines.length > 0 ? lines : [text2];
}
function attrs(a) {
  return Object.entries(a).filter(([, v]) => v !== void 0 && v !== "").map(([k, v]) => `${k}="${esc(String(v))}"`).join(" ");
}
function svg(elementId, w, h, body) {
  return `<svg id="${esc(elementId)}" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">${body}</svg>`;
}
function rect(b, a = {}) {
  return `<rect ${attrs({ x: n(b.x), y: n(b.y), width: n(b.w), height: n(b.h), ...a })} />`;
}
function roundRect(b, r, a = {}) {
  const rr = Math.min(r, b.w / 2, b.h / 2);
  return rect(b, { rx: n(rr), ...a });
}
function line(from, to, a = {}) {
  return `<line ${attrs({ x1: n(from.x), y1: n(from.y), x2: n(to.x), y2: n(to.y), ...a })} />`;
}
function path(d, a = {}) {
  return `<path ${attrs({ d, fill: "none", ...a })} />`;
}
function circle(c, r, a = {}) {
  return `<circle ${attrs({ cx: n(c.x), cy: n(c.y), r: n(r), ...a })} />`;
}
function group(children, a = {}) {
  const body = Array.isArray(children) ? children.join("") : children;
  const head = attrs(a);
  return `<g${head ? ` ${head}` : ""}>${body}</g>`;
}
function text(content, at, o) {
  const weight = o.weight ?? 400;
  const lines = o.maxWidth ? wrap(content, o.size, o.maxWidth, weight) : [content];
  const lh = (o.lineHeight ?? 1.3) * o.size;
  const first = o.vAlign === "middle" ? -((lines.length - 1) * lh) / 2 + o.size * 0.34 : 0;
  const a = {
    x: n(at.x),
    y: n(at.y),
    class: o.class,
    id: o.id,
    "font-size": n(o.size),
    "font-weight": o.weight,
    fill: o.fill,
    "text-anchor": o.anchor && o.anchor !== "start" ? o.anchor : void 0
  };
  const body = lines.length === 1 && first === 0 ? esc(lines[0] ?? "") : lines.map((l, i) => `<tspan x="${n(at.x)}" dy="${n(i === 0 ? first : lh)}">${esc(l)}</tspan>`).join("");
  return `<text ${attrs(a)}>${body}</text>`;
}
function headId(sid, color) {
  return `${sid}-ah-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
}
function arrowDefs(sid, colors) {
  const markers = [...new Set(colors)].map(
    (c) => (
      // userSpaceOnUse: the head is a fixed 26px whatever the stroke width, so a
      // hairline connector and a heavy one still look like the same diagram.
      `<marker id="${headId(sid, c)}" viewBox="0 0 12 12" refX="10.5" refY="6" markerWidth="26" markerHeight="26" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L12,6 L0,12 Z" fill="${esc(c)}" /></marker>`
    )
  ).join("");
  return `<defs>${markers}</defs>`;
}
function strokeAttrs(o) {
  return {
    class: o.class,
    id: o.id,
    fill: "none",
    stroke: o.stroke,
    "stroke-width": n(o.width ?? 4),
    "stroke-linecap": "round",
    "stroke-dasharray": o.dash
  };
}
function pullBack(from, to, back) {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d === 0 || back <= 0) return to;
  const k = Math.max(0, (d - back) / d);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}
function arrow(sid, from, to, o) {
  const end = pullBack(from, to, o.inset ?? 0);
  return line(from, end, { ...strokeAttrs(o), "marker-end": `url(#${headId(sid, o.stroke)})` });
}
function elbow(sid, from, to, o) {
  const vertical = (o.axis ?? "v") === "v";
  const f = vertical ? from : { x: from.y, y: from.x };
  const t2 = vertical ? to : { x: to.y, y: to.x };
  const end = { x: t2.x, y: t2.y - Math.sign(t2.y - o.via) * (o.inset ?? 0) };
  const legs = [Math.abs(o.via - f.y), Math.abs(t2.x - f.x), Math.abs(end.y - o.via)];
  const r = Math.min(o.radius ?? 18, ...legs.map((l) => l / 2));
  const p = (x, y) => vertical ? `${n(x)},${n(y)}` : `${n(y)},${n(x)}`;
  let d;
  if (r < 1) {
    d = `M${p(f.x, f.y)} L${p(f.x, o.via)} L${p(end.x, o.via)} L${p(end.x, end.y)}`;
  } else {
    const s1 = Math.sign(o.via - f.y);
    const s2 = Math.sign(t2.x - f.x);
    const s3 = Math.sign(end.y - o.via);
    d = `M${p(f.x, f.y)} L${p(f.x, o.via - s1 * r)} Q${p(f.x, o.via)} ${p(f.x + s2 * r, o.via)} L${p(end.x - s2 * r, o.via)} Q${p(end.x, o.via)} ${p(end.x, o.via + s3 * r)} L${p(end.x, end.y)}`;
  }
  return path(d, { ...strokeAttrs(o), "marker-end": `url(#${headId(sid, o.stroke)})` });
}
function tracks(width, count, gap, x0 = 0) {
  const w = count > 1 ? (width - gap * (count - 1)) / count : width;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), w }));
}
function fitBoxes(req) {
  const count = req.labels.length;
  const minGap = req.minGap ?? 24;
  const padEm = req.padEm ?? 0.8;
  const weight = req.weight ?? 600;
  const x0 = req.x0 ?? 0;
  const unit = Math.max(1, ...req.labels.map((l) => textWidth(l, 1, weight) + 2 * padEm));
  const sizeAt = (gap) => count < 1 ? req.size : (req.width - gap * (count - 1)) / count / unit;
  if (sizeAt(req.gap) >= req.size) {
    return { ok: true, size: req.size, gap: req.gap, boxes: tracks(req.width, count, req.gap, x0) };
  }
  if (count > 1 && sizeAt(minGap) >= req.size) {
    const gap = (req.width - count * req.size * unit) / (count - 1);
    return { ok: true, size: req.size, gap, boxes: tracks(req.width, count, gap, x0) };
  }
  const size = sizeAt(minGap);
  if (size >= MIN_FONT) {
    return { ok: true, size, gap: minGap, boxes: tracks(req.width, count, minGap, x0) };
  }
  return {
    ok: false,
    size: MIN_FONT,
    gap: minGap,
    boxes: tracks(req.width, count, minGap, x0),
    needed: count * MIN_FONT * unit + minGap * (count - 1)
  };
}

// src/emit/themes/ink.ts
var ink = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#9aa7b5",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif'
};

// src/emit/themes/mono.ts
var mono = {
  bg: "#ffffff",
  fg: "#0a0a0a",
  muted: "#3a3a3a",
  dim: "#5e5e5e",
  rule: "#b0b0b0",
  panel: "#f4f4f4",
  accent: "#c8102e",
  tones: { a: "#c8102e", b: "#0a0a0a", c: "#464646", d: "#6f6f6f" },
  fontStack: '"Inter", system-ui, sans-serif',
  bodyWeight: 500
};

// src/emit/themes/paper.ts
var paper = {
  // Warm, not white: #fff under a projector is a lamp pointed at the audience.
  bg: "#faf7f2",
  fg: "#14110d",
  muted: "#57503f",
  dim: "#6b6252",
  rule: "#ded7c9",
  // A half-step off the ground. Anything darker reads as a hole in the slide,
  // and drags every tone drawn on it below AA.
  panel: "#f3eee5",
  accent: "#1f5fa8",
  tones: { a: "#1b5fa8", b: "#8a5000", c: "#a8203f", d: "#1c6b45" },
  fontStack: '"Inter", system-ui, sans-serif'
};

// src/emit/themes/index.ts
var THEMES = { ink, mono, paper };
var THEME_NAMES = Object.keys(THEMES).sort();
function resolveTheme(name) {
  const theme = THEMES[name];
  if (!theme) throw new Error(`unknown theme "${name}" \u2014 known: ${THEME_NAMES.join(", ")}`);
  return theme;
}

// src/emit/theme.ts
var FONT_BUNDLE_HREF = "assets/fonts/fonts.css";
var AMBIENT_KEYFRAMES = `      @keyframes ds-breathe { from { filter: brightness(1); } to { filter: brightness(1.12); } }
      @keyframes ds-drift { from { transform: scale(1); } to { transform: scale(1.012); } }`;
var BREATHE = "ds-breathe 6s ease-in-out infinite alternate";
var DRIFT = "ds-drift 11s ease-in-out infinite alternate";
function ambient(sid, rest, animation) {
  return `@media (prefers-reduced-motion: no-preference){.ds-live #${sid}${rest}{animation:${animation}}}`;
}
function baseCss(theme, format) {
  return `      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${format.width}px; height: ${format.height}px;
        overflow: hidden; background: ${theme.bg};
      }
      body { font-family: ${theme.fontStack}; color: ${theme.fg}; font-weight: ${theme.bodyWeight ?? 400}; }

      /* Centred, not top-anchored. Top-anchoring left every archetype but the
         title sitting in the upper 40% above a 500-600px dead band \u2014 it passes
         every gate and reads as unfinished. Centring is safe here because the
         gate still catches anything taller than the canvas; it just now
         overflows symmetrically instead of only downwards. */
      .scene { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
               padding: 84px 110px; display: flex; flex-direction: column;
               justify-content: center; }

${AMBIENT_KEYFRAMES}`;
}
function pace(scene, speed) {
  if (speed === 1) return scene;
  return {
    ...scene,
    tl: scene.tl.map((s) => paceStatement(s, speed)),
    holds: scene.holds.map((h) => round(h * speed))
  };
}
var TIMES = /\b(duration|delay|stagger|amount|each|repeatDelay):\s*(-?\d*\.?\d+)/g;
var AT = /,\s*(-?\d*\.?\d+)\s*\)\s*;?\s*$/;
function paceStatement(statement2, speed) {
  return statement2.replace(TIMES, (_m, key, value) => `${key}: ${round(Number(value) * speed)}`).replace(AT, (_m, at) => `, ${round(Number(at) * speed)});`);
}
function round(n3) {
  return Math.round(n3 * 1e4) / 1e4;
}

// src/emit/archetypes/title.ts
function sec(n3) {
  return (Math.round(n3 * 100) / 100).toString();
}
function tween(target, from, to, at) {
  return `tl.fromTo("${target}", ${from}, ${to}, ${sec(at)});`;
}
function holdsWithin(times, seconds) {
  const last = Math.round(Math.max(0, seconds - 0.15) * 100) / 100;
  const clamped = times.map((t2) => Math.min(Math.round(t2 * 100) / 100, last));
  return [...new Set(clamped)].sort((a, b) => a - b);
}
function chrome(sid, eyebrow, headline) {
  const brow = eyebrow ? `<div class="eyebrow" id="${sid}-e">${esc(eyebrow)}</div>
` : "";
  return `${brow}<h2 class="headline" id="${sid}-h">${esc(headline)}</h2>`;
}
function chromeIn(sid, eyebrow) {
  const s = [];
  if (eyebrow) {
    s.push(
      tween(`#${sid}-e`, "{ opacity: 0, y: 14 }", "{ opacity: 1, y: 0, duration: 0.5 }", 0.15)
    );
  }
  s.push(tween(`#${sid}-h`, "{ opacity: 0, y: 22 }", "{ opacity: 1, y: 0, duration: 0.6 }", 0.3));
  return s;
}
function chromeCss(t2) {
  return [
    `.eyebrow{font-size:40px;line-height:1.2;letter-spacing:.14em;text-transform:uppercase;color:${t2.muted};font-weight:500;margin-bottom:22px}`,
    `.headline{font-size:66px;line-height:1.15;font-weight:700;letter-spacing:-.015em;color:${t2.fg}}`
  ].join("\n");
}
var title = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const brow = p.eyebrow ? `<div class="eyebrow" id="${sid}-e">${esc(p.eyebrow)}</div>
  ` : "";
  const sub = p.sub ? `
  <div class="sub" id="${sid}-s">${esc(p.sub)}</div>` : "";
  const html = `<div class="titleslide">
  ${brow}<h1 class="bighead" id="${sid}-t">${esc(p.headline)}</h1>${sub}
</div>`;
  const tl = [];
  if (p.eyebrow) {
    tl.push(
      tween(`#${sid}-e`, "{ opacity: 0, y: 18 }", "{ opacity: 1, y: 0, duration: 0.6 }", 0.2)
    );
  }
  tl.push(tween(`#${sid}-t`, "{ opacity: 0, y: 38 }", "{ opacity: 1, y: 0, duration: 0.9 }", 0.4));
  let end = 1.3;
  if (p.sub) {
    tl.push(
      tween(`#${sid}-s`, "{ opacity: 0, y: 22 }", "{ opacity: 1, y: 0, duration: 0.7 }", 1)
    );
    end = 1.7;
  }
  return {
    html,
    tl,
    holds: holdsWithin([end + 0.2], beat.seconds),
    css: [
      chromeCss(theme),
      ".titleslide{display:flex;flex-direction:column;justify-content:center;height:100%}",
      `.bighead{font-size:88px;line-height:1.12;font-weight:700;letter-spacing:-.02em;color:${theme.fg}}`,
      `.sub{font-size:42px;line-height:1.55;color:${theme.muted};margin-top:34px;max-width:1500px}`,
      // The headline is the slide. Its entrance owns `opacity` and `y`, so the
      // ambient breath takes the one property left.
      ambient(sid, "-t", BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/annotated-figure.ts
var STAGE_W = 1700;
var BODY_H = 912;
var HEAD_H = 76;
var BROW_H = 70;
var STAGE_GAP = 30;
var CAP_GAP = 26;
var CAP_LH = 1.35;
var CAP_LINES = 2;
var PLATE = 15;
var LEAD = 18;
var EDGE = 10;
var LAB = MIN_FONT;
var LAB_WEIGHT = 600;
var LAB_LH = 1.3;
var ASCENT = LAB * 0.78;
var RULE_LIFT = 16;
var RULE_W = 3;
var LAB_GAP = Math.round(LAB * LAB_LH) + 12;
var LINE_CEIL = 4;
function lineBudget(count, stageH) {
  const perSide = Math.max(1, Math.ceil(count / 2));
  const room = (stageH - (perSide - 1) * LAB_GAP) / perSide;
  const lines = Math.floor((room - ASCENT - RULE_LIFT - RULE_W) / (LAB * LAB_LH)) + 1;
  return Math.min(LINE_CEIL, Math.max(1, lines));
}
var COLS = [380, 470, 560];
var MAX_UPSCALE = 1.5;
var DOT_R = 9;
var HALO_R = 18;
function measure(content, col, maxLines) {
  const all = wrap(content, LAB, col, LAB_WEIGHT);
  const clipped = all.length > maxLines;
  const lines = all.slice(0, maxLines);
  if (clipped) {
    let tail = lines[maxLines - 1] ?? "";
    while (tail && textWidth(`${tail}\u2026`, LAB, LAB_WEIGHT) > col) tail = tail.slice(0, -1);
    lines[maxLines - 1] = `${tail.trimEnd()}\u2026`;
  }
  return {
    lines,
    w: Math.max(0, ...lines.map((l) => textWidth(l, LAB, LAB_WEIGHT))),
    h: (lines.length - 1) * LAB * LAB_LH + ASCENT + RULE_LIFT + RULE_W,
    clipped
  };
}
function attempt(notes, fig, stageH, want) {
  const plateMax = STAGE_W - 2 * (want + LEAD + EDGE);
  const scale = Math.min(
    (plateMax - 2 * PLATE) / fig.width,
    (stageH - 2 * PLATE) / fig.height,
    MAX_UPSCALE
  );
  const img = {
    w: fig.width * scale,
    h: fig.height * scale,
    x: (STAGE_W - fig.width * scale) / 2,
    y: (stageH - fig.height * scale) / 2
  };
  const col = img.x - PLATE - LEAD - EDGE;
  const maxLines = lineBudget(notes.length, stageH);
  const work = notes.map((no, i) => ({
    ...measure(no.text, col, maxLines),
    i,
    at: { x: img.x + no.x * img.w, y: img.y + no.y * img.h },
    side: "l",
    top: 0
  }));
  const order = [...work].sort((a, b) => a.at.y - b.at.y || a.i - b.i);
  const used = { l: 0, r: 0 };
  const cost = (s, h) => used[s] + (used[s] > 0 ? LAB_GAP : 0) + h;
  for (const w of order) {
    const pref = (notes[w.i]?.x ?? 0) < 0.5 ? "l" : "r";
    const other = pref === "l" ? "r" : "l";
    w.side = cost(pref, w.h) <= stageH ? pref : cost(other, w.h) <= stageH ? other : used[pref] <= used[other] ? pref : other;
    used[w.side] = cost(w.side, w.h);
  }
  for (const side of ["l", "r"]) {
    const stack2 = order.filter((w) => w.side === side);
    let floorY = 0;
    for (const w of stack2) {
      w.top = Math.max(w.at.y - w.h / 2, floorY);
      floorY = w.top + w.h + LAB_GAP;
    }
    let ceilY = stageH;
    for (let k = stack2.length - 1; k >= 0; k--) {
      const w = stack2[k];
      if (!w) continue;
      w.top = Math.max(0, Math.min(w.top, ceilY - w.h));
      ceilY = w.top - LAB_GAP;
    }
  }
  const top = Math.min(img.y, ...work.map((w) => w.top));
  const bottom = Math.max(img.y + img.h, ...work.map((w) => w.top + w.h));
  return {
    img: { ...img, y: img.y - top },
    col,
    height: bottom - top,
    ok: used.l <= stageH && used.r <= stageH && !work.some((w) => w.clipped),
    boxes: work.map((w) => ({
      side: w.side,
      lines: w.lines,
      w: w.w,
      h: w.h,
      top: w.top - top,
      ruleY: w.top - top + (w.lines.length - 1) * LAB * LAB_LH + ASCENT + RULE_LIFT + RULE_W / 2,
      at: { x: w.at.x, y: w.at.y - top },
      clipped: w.clipped
    }))
  };
}
function planFigure(notes, fig, stageH) {
  let plan = attempt(notes, fig, stageH, COLS[0] ?? 380);
  for (let k = 1; k < COLS.length && !plan.ok; k++) {
    plan = attempt(notes, fig, stageH, COLS[k] ?? 560);
  }
  return plan;
}
function stageBudget(eyebrow, caption) {
  const lines = Math.min(CAP_LINES, wrap(caption, LAB, STAGE_W).length);
  const capH = lines * LAB * CAP_LH;
  return Math.max(360, BODY_H - (eyebrow ? BROW_H : 0) - HEAD_H - STAGE_GAP - CAP_GAP - capH);
}
function offDot(from, to) {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d === 0) return from;
  const k = Math.min(1, (DOT_R + 8) / d);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}
var FIG_IN = 1.55;
var NOTE_0 = 1.9;
var STEP = 0.95;
var annotatedFigure = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const fig = ctx.source.figures.find((f) => f.id === p.figureId);
  if (!fig) {
    throw new Error(
      `annotated-figure ${beat.id}: no figure "${p.figureId}" in source ${ctx.source.id}`
    );
  }
  const crop = p.crop;
  const view = crop ? { width: fig.width * crop.w, height: fig.height * crop.h } : { width: fig.width, height: fig.height };
  const clamp2 = (v) => Math.min(1, Math.max(0, v));
  const notes = crop ? p.notes.map((no) => ({
    ...no,
    x: clamp2((no.x - crop.x) / crop.w),
    y: clamp2((no.y - crop.y) / crop.h)
  })) : p.notes;
  const plan = planFigure(notes, view, stageBudget(p.eyebrow !== void 0, fig.caption));
  const stageH = plan.height;
  const plate = {
    x: plan.img.x - PLATE,
    y: plan.img.y - PLATE,
    w: plan.img.w + 2 * PLATE,
    h: plan.img.h + 2 * PLATE
  };
  const lengths = [];
  const parts = plan.boxes.map((b, i) => {
    const left = b.side === "l";
    const tone2 = notes[i]?.tone;
    const c = tone2 ? theme.tones[tone2] : theme.accent;
    const inner = left ? plate.x - LEAD : plate.x + plate.w + LEAD;
    const outer = left ? inner - b.w : inner + b.w;
    const knee = { x: inner, y: b.ruleY };
    const start = offDot(b.at, knee);
    lengths[i] = Math.hypot(knee.x - start.x, knee.y - start.y) + b.w;
    const anchor = left ? "end" : "start";
    const first = b.top + ASCENT;
    return [
      path(`M${n(start.x)},${n(start.y)} L${n(knee.x)},${n(knee.y)} L${n(outer)},${n(knee.y)}`, {
        id: id(sid, "lead", i),
        stroke: c,
        "stroke-width": 3,
        "stroke-linejoin": "round"
      }),
      group(
        [
          circle(b.at, HALO_R, { fill: c, opacity: 0.22, class: "af-halo" }),
          // The background-coloured ring is what keeps a dot legible on top of a
          // figure that is white here and a dense plot two inches away.
          circle(b.at, DOT_R, {
            fill: c,
            class: "af-dot",
            stroke: theme.bg,
            "stroke-width": 4
          })
        ],
        { id: id(sid, "dot", i) }
      ),
      group(
        [
          ...b.lines.map(
            (l, k) => text(
              l,
              { x: inner, y: first + k * LAB * LAB_LH },
              { size: LAB, weight: LAB_WEIGHT, anchor }
            )
          ),
          line(knee, { x: outer, y: knee.y }, { stroke: c, "stroke-width": RULE_W })
        ],
        { id: id(sid, "lab", i), class: "af-lab" }
      )
    ].join("");
  });
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="af-stage" id="${sid}-stage">
  <div class="af-plate" id="${sid}-plate"><img${crop ? " data-layout-allow-overflow" : ""} src="assets/${esc(fig.src)}" alt="${esc(fig.caption)}" /></div>
  ${svg(`${sid}-ov`, STAGE_W, stageH, `<g class="af-ov-g">${parts.join("")}</g>`)}
</div>
<div class="af-cap" id="${sid}-cap">${esc(fig.caption)}</div>`;
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    tween(
      `#${sid}-plate`,
      "{ opacity: 0, scale: 0.97 }",
      "{ opacity: 1, scale: 1, duration: 0.8 }",
      0.7
    )
  ];
  const holds = [FIG_IN];
  plan.boxes.forEach((b, i) => {
    const at = NOTE_0 + i * STEP;
    tl.push(
      tween(
        `#${sid}-dot${i}`,
        // An explicit svgOrigin, not "center": a group's bbox includes the halo,
        // and the dot must grow out of the pixel it is pointing at. It has to be
        // named in both halves — an origin declared only in the `to` vars is an
        // origin *change*, and GSAP absorbs a change with a compensating translate
        // that never unwinds, leaving the dot 18px up-left of that exact pixel.
        `{ opacity: 0, scale: 0, svgOrigin: "${n(b.at.x)} ${n(b.at.y)}" }`,
        `{ opacity: 1, scale: 1, svgOrigin: "${n(b.at.x)} ${n(b.at.y)}", duration: 0.3, ease: "back.out(2)" }`,
        at
      ),
      tween(
        `#${sid}-lead${i}`,
        drawFrom(lengths[i] ?? 0),
        '{ strokeDashoffset: 0, duration: 0.55, ease: "none" }',
        at + 0.1
      ),
      tween(
        `#${sid}-lab${i}`,
        `{ opacity: 0, x: ${b.side === "l" ? -16 : 16} }`,
        "{ opacity: 1, x: 0, duration: 0.4 }",
        at + 0.45
      )
    );
    holds.push(at + 0.9);
  });
  tl.push(tween(`#${sid}-cap`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.5 }", 1));
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".af-stage{position:relative;flex:none}",
      `.af-plate{position:absolute;background:#fff;border:1px solid ${theme.rule};border-radius:12px;padding:${PLATE - 1}px}`,
      // The plate clips, and a cropped image is deliberately bigger than it —
      // that is the crop. The layout gate is right to flag an overflowing child
      // in general, so the image opts out explicitly rather than the rule being
      // weakened for every figure.
      ".af-plate{overflow:hidden}",
      ".af-plate img{display:block;width:100%;height:100%}",
      // A crop shows one panel of the figure at the plate's size. Papers set
      // their figures for A4 at reading distance, which lands their internal
      // type near 12px on a 1920 canvas — unreadable from the back of a room,
      // and invisible to every gate, because it is pixels in a raster rather
      // than DOM the contrast gate can measure. Scaling the image up and
      // clipping to the region is what a presenter does with a laser pointer.
      ...crop ? [
        `#${sid}-plate img{position:absolute;width:${n(plan.img.w / crop.w)}px;height:${n(plan.img.h / crop.h)}px;left:${n(PLATE - crop.x * plan.img.w / crop.w)}px;top:${n(PLATE - crop.y * plan.img.h / crop.h)}px;max-width:none}`
      ] : [],
      // One shadow for the whole overlay, not one per element: it outlines every
      // stroke and glyph at once, which is what lets a light tone survive a white
      // figure without a second backing stroke under every leader.
      ".af-ov-g{filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}",
      `.af-lab text{fill:${theme.fg}}`,
      `.af-cap{font-size:${LAB}px;line-height:${CAP_LH};color:${theme.dim};margin-top:${CAP_GAP}px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${CAP_LINES};overflow:hidden}`,
      // Per-scene geometry: the overlay is only correct because the image box is
      // stated rather than negotiated with the layout engine.
      `#${sid}-stage{width:${STAGE_W}px;height:${n(stageH)}px;margin-top:${STAGE_GAP}px}`,
      `#${sid}-plate{left:${n(plate.x)}px;top:${n(plate.y)}px;width:${n(plate.w)}px;height:${n(plate.h)}px}`,
      // `overflow:visible` because a dot sitting on the figure's own edge puts its
      // halo outside the viewBox, and a clipped halo reads as a rendering fault.
      `#${sid}-ov{position:absolute;left:0;top:0;overflow:visible}`,
      // The dots are the archetype. Their entrance owns opacity and transform, so
      // the breath takes `filter` — the one property nothing else here writes.
      ambient(sid, " .af-dot", BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/bar-compare.ts
var W = 1700;
var CANVAS_H = 912;
var CHROME_H = { with: 146, without: 76 };
var BODY_TOP = 34;
var NOTE_H = 84;
var UNIT_BAND = 58;
var FOOT = 40;
var BAR_MAX = 96;
var GAP_RATIO = 0.55;
var LABEL_MAX = 46;
var LABEL_WEIGHT = 600;
var VALUE_MAX = 48;
var GUTTER_PAD = 34;
var GUTTER_MAX = 714;
var VALUE_GAP = 22;
var MIN_PLOT = 420;
var MIN_LEN = 8;
var DESCENT = 0.25;
var barCompare = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const count = p.bars.length;
  const unitBand = p.unit ? UNIT_BAND : 0;
  const avail = CANVAS_H - (p.eyebrow ? CHROME_H.with : CHROME_H.without) - BODY_TOP - (p.note ? NOTE_H : 0);
  let bar = Math.min(BAR_MAX, (avail - unitBand - FOOT) / (count + GAP_RATIO * (count - 1)));
  let pitch = bar * (1 + GAP_RATIO);
  const gutterInner = GUTTER_MAX - GUTTER_PAD;
  const unitWidth = Math.max(1, ...p.bars.map((b) => textWidth(b.label, 1, LABEL_WEIGHT)));
  const labelSize = Math.max(MIN_FONT, Math.min(LABEL_MAX, bar * 0.86, gutterInner / unitWidth));
  const lines = p.bars.map((b) => wrap(b.label, labelSize, gutterInner, LABEL_WEIGHT));
  const maxLines = Math.max(...lines.map((l) => l.length));
  const lead = labelSize * 1.12;
  const needed = maxLines * lead + 10;
  if (needed > pitch) {
    pitch = needed;
    bar = Math.min(bar, pitch / (1 + GAP_RATIO));
  }
  const valueSize = Math.max(MIN_FONT, Math.min(VALUE_MAX, bar * 0.9));
  const barsH = (count - 1) * pitch + bar;
  const foot = Math.max(
    0,
    Math.ceil(
      Math.max(
        valueSize * (0.34 + DESCENT),
        (maxLines - 1) * lead / 2 + labelSize * (0.34 + DESCENT)
      ) - bar / 2
    ) + 4
  );
  const H3 = barsH + unitBand + foot;
  if (H3 > avail) {
    throw new Error(
      `bar-compare ${beat.id}: ${count} bars with labels this long need ${Math.ceil(H3)}px of the ${Math.floor(avail)}px this slide has. Shorten the labels or split the beat.`
    );
  }
  const gutter = Math.min(
    GUTTER_MAX,
    Math.max(...lines.flat().map((l) => textWidth(l, labelSize, LABEL_WEIGHT))) + GUTTER_PAD
  );
  const metrics = p.bars.map((b) => {
    const printed = String(b.value);
    const dot = printed.indexOf(".");
    const decimals = dot < 0 ? 0 : printed.length - dot - 1;
    return {
      ...b,
      printed,
      /** The decimal grid `printed` sits on, so the counter cannot land beside it. */
      snap: decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`,
      /** Exponent notation and deep decimals have no such grid; those labels fade. */
      countable: !printed.includes("e") && decimals <= 4,
      tail: textWidth(printed, valueSize, 700) + VALUE_GAP
    };
  });
  const reserveR = Math.max(...metrics.map((m) => m.value < 0 ? 0 : m.tail));
  const reserveL = Math.max(0, ...metrics.map((m) => m.value < 0 ? m.tail : 0));
  const plotW = W - gutter - reserveL - reserveR;
  if (plotW < MIN_PLOT) {
    throw new Error(
      `bar-compare ${beat.id}: labels and values leave only ${Math.floor(plotW)}px to compare in. Shorten them or split the beat.`
    );
  }
  const plotX = gutter + reserveL;
  const lo = Math.min(0, ...p.bars.map((b) => b.value));
  const hi = Math.max(0, ...p.bars.map((b) => b.value));
  const span = hi - lo || 1;
  const zeroX = plotX + (0 - lo) / span * plotW;
  const rows = metrics.map((m, i) => {
    const top = i * pitch;
    const mid = top + bar / 2;
    const len = m.value === 0 ? 0 : Math.max(MIN_LEN, Math.abs(m.value) / span * plotW);
    const x = m.value < 0 ? zeroX - len : zeroX;
    return {
      ...m,
      i,
      top,
      mid,
      len,
      x,
      valueX: m.value < 0 ? x - VALUE_GAP : x + len + VALUE_GAP,
      anchor: m.value < 0 ? "end" : "start"
    };
  });
  const toned = p.bars.some((b) => b.tone);
  const fillOf = (t2) => t2 ? theme.tones[t2] : toned ? theme.dim : theme.accent;
  const valueFill = (t2) => t2 ? theme.tones[t2] : toned ? theme.muted : theme.fg;
  const unitText = p.unit ? text(
    p.unit,
    { x: zeroX, y: barsH + 44 },
    {
      size: MIN_FONT,
      weight: 500,
      fill: theme.dim,
      // The caption follows the axis, and the axis is only at the left edge
      // when every value is positive.
      anchor: zeroX + textWidth(p.unit, MIN_FONT, 500) > W ? "end" : "start",
      id: id(sid, "unit")
    }
  ) : "";
  const body = [
    ...rows.map(
      (r) => roundRect({ x: plotX, y: r.top, w: plotW, h: bar }, bar / 2, { class: "bc-rail" })
    ),
    line(
      { x: zeroX, y: 0 },
      { x: zeroX, y: barsH },
      {
        id: id(sid, "zero"),
        stroke: theme.rule,
        "stroke-width": 2
      }
    ),
    ...rows.map(
      (r) => roundRect({ x: r.x, y: r.top, w: r.len, h: bar }, bar / 2, {
        id: id(sid, "bar", r.i),
        fill: fillOf(r.tone)
      })
    ),
    ...rows.map(
      (r) => text(
        r.label,
        { x: gutter - GUTTER_PAD, y: r.mid },
        {
          size: labelSize,
          weight: LABEL_WEIGHT,
          fill: r.tone ? theme.fg : theme.muted,
          anchor: "end",
          maxWidth: gutterInner,
          lineHeight: 1.12,
          vAlign: "middle",
          class: "bc-lab"
        }
      )
    ),
    ...rows.map(
      (r) => text(
        r.printed,
        // Baseline, not `vAlign: "middle"`. Centring emits a <tspan>, and the
        // counter writes textContent on the <text>, which would delete it and
        // drop the value back to its own y on the first frame.
        { x: r.valueX, y: r.mid + valueSize * 0.34 },
        {
          size: valueSize,
          weight: 700,
          fill: valueFill(r.tone),
          anchor: r.anchor,
          class: "bc-val",
          id: id(sid, "v", r.i)
        }
      )
    ),
    unitText
  ].join("");
  const note = p.note ? `
<div class="bc-note" id="${id(sid, "note")}">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="bc-wrap">
${svg(id(sid, "chart"), W, H3, body)}
</div>${note}`;
  const railsAt = 0.6;
  const barsAt = 0.95;
  const step = Math.min(0.4, 2.4 / count);
  const grow = 0.85;
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    tween(
      `#${sid} .bc-rail`,
      "{ opacity: 0 }",
      "{ opacity: 1, duration: 0.45, stagger: 0.05 }",
      railsAt
    ),
    tween(`#${id(sid, "zero")}`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.5 }", railsAt),
    tween(
      `#${sid} .bc-lab`,
      "{ opacity: 0, x: -18 }",
      `{ opacity: 1, x: 0, duration: 0.4, stagger: ${n(step)} }`,
      0.8
    ),
    tween(
      `#${sid} .bc-val`,
      "{ opacity: 0 }",
      `{ opacity: 1, duration: 0.3, stagger: ${n(step)} }`,
      barsAt + 0.15
    )
  ];
  for (const r of rows) {
    const at = barsAt + r.i * step;
    tl.push(
      tween(
        `#${id(sid, "bar", r.i)}`,
        `{ attr: { x: ${n(zeroX)}, width: 0 } }`,
        `{ attr: { x: ${n(r.x)}, width: ${n(r.len)} }, duration: ${grow}, ease: "power3.out" }`,
        at
      )
    );
    if (r.countable) {
      tl.push(
        tween(
          `#${id(sid, "v", r.i)}`,
          "{ textContent: 0 }",
          `{ textContent: ${r.printed}, snap: { textContent: ${r.snap} }, duration: 0.8, ease: "power2.out" }`,
          at + 0.1
        )
      );
    }
  }
  const settled = barsAt + (count - 1) * step + grow + 0.05;
  const holds = [settled + 0.2];
  const tailAt = settled + 0.3;
  if (p.unit) {
    tl.push(
      tween(`#${id(sid, "unit")}`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.5 }", tailAt)
    );
  }
  if (p.note) {
    tl.push(
      tween(
        `#${id(sid, "note")}`,
        "{ opacity: 0, y: 14 }",
        "{ opacity: 1, y: 0, duration: 0.6 }",
        tailAt
      )
    );
  }
  if (p.unit || p.note) holds.push(tailAt + 0.7);
  const focal = rows.reduce((best, r) => Math.abs(r.value) > Math.abs(best.value) ? r : best);
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      `.bc-wrap{margin-top:${BODY_TOP}px}`,
      `.bc-rail{fill:${theme.panel}}`,
      `.bc-note{font-size:${MIN_FONT}px;line-height:1.45;color:${theme.dim};margin-top:26px}`,
      // `filter`, because this bar's entrance owns its `width` and `x` attributes
      // and a CSS animation outranks whatever GSAP wrote there.
      ambient(sid, `-bar${focal.i}`, BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/callout.ts
var TONES = ["a", "b", "c"];
var callout = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const panels = p.panels.map((panel, i) => {
    const colour = theme.tones[TONES[i] ?? "a"];
    const lines = panel.lines.map((l) => `<div class="pline">${esc(l)}</div>`).join("");
    return `<div class="panel" id="${sid}-p${i}" style="border-left-color:${colour}"><div class="plabel" style="color:${colour}">${esc(panel.label)}</div>${lines}</div>`;
  }).join("\n  ");
  const note = p.note ? `
<div class="conote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="panels" style="grid-template-columns:repeat(${p.panels.length}, 1fr)">
  ${panels}
</div>${note}`;
  const first = 0.8;
  const step = Math.min(0.9, Math.max(0.4, (beat.seconds - first - 1.6) / p.panels.length));
  const tl = [...chromeIn(sid, p.eyebrow !== void 0)];
  const holds = [];
  p.panels.forEach((_, i) => {
    const at = first + i * step;
    tl.push(
      tween(`#${sid}-p${i}`, "{ opacity: 0, y: 18 }", "{ opacity: 1, y: 0, duration: 0.55 }", at)
    );
    holds.push(at + 0.65);
  });
  if (p.note) {
    const at = first + p.panels.length * step;
    tl.push(tween(`#${sid}-note`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.6 }", at));
    holds.push(at + 0.7);
  }
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // Column count is set inline, so this block is identical for every callout
      // scene and the shell emits it once.
      ".panels{display:grid;gap:40px;margin-top:34px;align-items:start}",
      `.panel{background:${theme.panel};border:1px solid ${theme.rule};border-left:5px solid ${theme.accent};border-radius:12px;padding:28px 32px;font-size:40px;line-height:1.55;color:${theme.fg}}`,
      ".plabel{font-weight:600;margin-bottom:14px}",
      `.pline{color:${theme.muted}}`,
      `.conote{font-size:40px;line-height:1.55;color:${theme.muted};margin-top:34px;max-width:1600px}`,
      // The last panel's label — the panel that lands last is the one still being
      // spoken to at the final hold. Its label carries the panel's accent colour,
      // and no tween touches it: the entrance moves the panel around it.
      ...p.panels.length === 0 ? [] : [ambient(sid, `-p${p.panels.length - 1} .plabel`, BREATHE)]
    ].join("\n")
  };
};

// src/emit/archetypes/claim-figure.ts
var FULL_WIDTH_ASPECT = 3;
var claimFigure = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const fig = ctx.source.figures.find((f) => f.id === p.figureId);
  if (!fig) {
    throw new Error(
      `claim-figure ${beat.id}: no figure "${p.figureId}" in source ${ctx.source.id}`
    );
  }
  const wide = fig.width / fig.height >= FULL_WIDTH_ASPECT;
  const claim = `<div class="claim" id="${sid}-c">${esc(p.claim)}</div>`;
  const figure = `<div class="figwrap" id="${sid}-f"><img src="assets/${esc(fig.src)}" alt="${esc(fig.caption)}" /></div>`;
  const caption = `<div class="caption" id="${sid}-cap">${esc(fig.caption)}</div>`;
  const body = wide ? `${figure}
<div class="cf-under">${claim}
${caption}</div>` : `<div class="cf-beside">${claim}
<div>${figure}
${caption}</div></div>`;
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    tween(`#${sid}-c`, "{ opacity: 0, x: -20 }", "{ opacity: 1, x: 0, duration: 0.6 }", 0.7),
    tween(
      `#${sid}-f`,
      "{ opacity: 0, scale: 0.97 }",
      "{ opacity: 1, scale: 1, duration: 0.8 }",
      1
    ),
    tween(`#${sid}-cap`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.6 }", 1.7)
  ];
  return {
    html: `${chrome(sid, p.eyebrow, p.headline)}
${body}`,
    tl,
    holds: holdsWithin([1.4, 2.4], beat.seconds),
    css: [
      chromeCss(theme),
      ".cf-beside{display:grid;grid-template-columns:640px 1fr;gap:56px;align-items:center;margin-top:34px}",
      ".cf-under{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start;margin-top:26px}",
      `.claim{font-size:42px;line-height:1.6;color:${theme.fg};border-left:5px solid ${theme.accent};padding-left:28px}`,
      `.figwrap{background:#fff;border:1px solid ${theme.rule};border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:center;margin-top:26px}`,
      // Height-capped rather than width-driven: a square figure in the beside
      // layout would otherwise be ~970px tall and run off the canvas.
      ".figwrap img{max-width:100%;max-height:550px;width:auto;height:auto;display:block}",
      `.caption{font-size:40px;line-height:1.4;color:${theme.dim};margin-top:16px}`,
      // The image, not its wrapper: the wrapper's entrance already writes
      // `transform`. 1.2% of the 550px cap is 3.3px a side, which the wrapper's
      // 16px padding absorbs — the swell can never reach the canvas edge.
      ambient(sid, "-f img", DRIFT)
    ].join("\n")
  };
};

// src/emit/archetypes/data-table.ts
var dataTable = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const table = ctx.source.tables.find((t2) => t2.id === p.tableId);
  if (!table) {
    throw new Error(`data-table ${beat.id}: no table "${p.tableId}" in source ${ctx.source.id}`);
  }
  const head = table.columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = table.rows.map(
    (row, i) => `<tr class="trow" id="${sid}-r${i}">${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`
  ).join("\n      ");
  const note = p.note ? `
<div class="rownote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<table>
  <thead><tr id="${sid}-thead">${head}</tr></thead>
  <tbody>
      ${body}
  </tbody>
</table>${note}`;
  const rowsIn = 0.9;
  const stagger = Math.min(0.16, 2.4 / Math.max(1, table.rows.length));
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    tween(`#${sid}-thead`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.4 }", 0.7),
    tween(
      `#${sid} .trow`,
      "{ opacity: 0, y: 14 }",
      `{ opacity: 1, y: 0, duration: 0.45, stagger: ${stagger} }`,
      rowsIn
    )
  ];
  const settled = rowsIn + stagger * table.rows.length + 0.45;
  const holds = [settled + 0.2];
  const room = Math.max(0.6, (beat.seconds - settled - 1.2) / Math.max(1, p.highlight.length));
  const step = Math.min(1.2, room);
  let focus;
  p.highlight.forEach((h, i) => {
    const index = table.rows.findIndex((row) => row[0] === h.row);
    if (index < 0) {
      throw new Error(`data-table ${beat.id}: no row labelled "${h.row}" in table ${table.id}`);
    }
    const at = settled + 0.3 + i * step;
    tl.push(
      tween(
        `#${sid}-r${index} td`,
        `{ color: "${theme.muted}", fontWeight: 400 }`,
        `{ color: "${theme.tones[h.tone]}", fontWeight: 600, duration: 0.5 }`,
        at
      )
    );
    focus = index;
    holds.push(at + 0.6);
  });
  if (p.note) {
    const at = settled + 0.3 + p.highlight.length * step;
    tl.push(
      tween(`#${sid}-note`, "{ opacity: 0, y: 14 }", "{ opacity: 1, y: 0, duration: 0.6 }", at)
    );
    holds.push(at + 0.7);
  }
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // 40px flat, never derived from the table's width. Shrinking to fit is the
      // one failure mode invariant 10 names: a 30px table clears every automated
      // gate and is unreadable projected. A table too wide at 40px eats its
      // margin first and then trips the layout gate at the canvas edge — both of
      // which someone can see, which small type is not.
      "table{border-collapse:collapse;width:100%;margin-top:34px;font-size:40px}",
      "th,td{font-size:inherit;padding:12px 14px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
      `th{color:${theme.dim};font-weight:500;letter-spacing:.04em;border-bottom:2px solid ${theme.rule}}`,
      "td:first-child,th:first-child{text-align:left}",
      `tbody tr{border-bottom:1px solid ${theme.rule}}`,
      `tbody td{color:${theme.muted}}`,
      `.rownote{font-size:40px;line-height:1.45;color:${theme.dim};margin-top:26px}`,
      // A table with nothing emphasised has no focal row, and so no ambient life.
      // `filter` again: the emphasis tween owns this row's colour and weight.
      ...focus === void 0 ? [] : [ambient(sid, `-r${focus} td`, BREATHE)]
    ].join("\n")
  };
};

// src/emit/archetypes/equation-walk.ts
var OPTS = '{ displayMode: true, trust: true, strict: false, output: "html" }';
var INLINE_OPTS = '{ displayMode: false, trust: true, strict: false, output: "html" }';
function wrapTerms(tex, terms, beatId) {
  let parts = [{ text: tex, raw: true }];
  for (const term of terms) {
    const i = parts.findIndex((part2) => part2.raw && part2.text.includes(term.tex));
    const part = parts[i];
    if (!part) {
      throw new Error(`equation-walk ${beatId}: term "${term.tex}" does not occur in the equation`);
    }
    const at = part.text.indexOf(term.tex);
    parts = parts.toSpliced(
      i,
      1,
      { text: part.text.slice(0, at), raw: true },
      { text: `\\htmlClass{term t-${term.tone}}{${term.tex}}`, raw: false },
      { text: part.text.slice(at + term.tex.length), raw: true }
    );
  }
  return parts.map((part) => part.text).join("");
}
function equationSize(tex) {
  return tex.length > 90 ? 60 : tex.length > 55 ? 66 : 72;
}
var equationWalk = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const eq = ctx.source.equations.find((e) => e.id === p.equationId);
  if (!eq) {
    throw new Error(
      `equation-walk ${beat.id}: no equation "${p.equationId}" in source ${ctx.source.id}`
    );
  }
  const legend = p.terms.map(
    (t2) => `<div class="leg" id="${sid}-leg-${t2.tone}"><span class="chip" id="${sid}-chip-${t2.tone}" style="color:${theme.tones[t2.tone]}"></span><span>${esc(t2.label)}</span></div>`
  ).join("\n    ");
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="eqslide">
  <div class="eq" id="${sid}-eq" style="font-size:${equationSize(eq.tex)}px"></div>
  <div class="legend">
    ${legend}
  </div>
</div>`;
  const setup = [
    `var OPTS = ${OPTS};`,
    `katex.render('${js(wrapTerms(eq.tex, p.terms, beat.id))}', document.getElementById("${sid}-eq"), OPTS);`,
    ...p.terms.map(
      (t2) => `katex.render('${js(t2.tex)}', document.getElementById("${sid}-chip-${t2.tone}"), ${INLINE_OPTS});`
    )
  ];
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    tween(`#${sid}-eq`, "{ opacity: 0, y: 22 }", "{ opacity: 1, y: 0, duration: 0.7 }", 0.8)
  ];
  const first = 1.8;
  const step = Math.max(
    0.7,
    Math.min(1.9, (beat.seconds - first - 0.9) / Math.max(1, p.terms.length - 1))
  );
  const holds = [];
  p.terms.forEach((term, i) => {
    const at = first + i * step;
    const colour = theme.tones[term.tone];
    tl.push(
      tween(
        `#${sid}-leg-${term.tone}`,
        "{ opacity: 0, x: -18 }",
        "{ opacity: 1, x: 0, duration: 0.5 }",
        at
      ),
      // The tint stays for the rest of the slide — it is what ties the symbol to
      // its legend chip. Only the swell is taken back, on the next term's cue.
      tween(
        `#${sid} .t-${term.tone}`,
        `{ color: "${theme.fg}", scale: 1 }`,
        `{ color: "${colour}", scale: 1.16, duration: 0.5 }`,
        at
      )
    );
    const prev = p.terms[i - 1];
    if (prev) {
      tl.push(
        tween(`#${sid} .t-${prev.tone}`, "{ scale: 1.16 }", "{ scale: 1, duration: 0.4 }", at)
      );
    }
    holds.push(at + 0.6);
  });
  const last = p.terms[p.terms.length - 1];
  if (last) {
    const at = first + p.terms.length * step;
    tl.push(tween(`#${sid} .t-${last.tone}`, "{ scale: 1.16 }", "{ scale: 1, duration: 0.4 }", at));
  }
  return {
    html,
    tl,
    setup,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".eqslide{display:flex;flex-direction:column;justify-content:center;gap:56px;height:68vh}",
      ".katex-display{margin:0 !important}",
      `.eq{text-align:center;color:${theme.fg}}`,
      // Transforms do not apply to inline boxes, and KaTeX spans are inline.
      ".term{display:inline-block}",
      // `width:fit-content` + auto margins, not `align-items:center`: centring
      // each row individually gave the legend a ragged left edge, because a short
      // label indented its own chip further than a long one did. The column is
      // centred as one block and the rows start on a shared spine.
      ".legend{display:flex;flex-direction:column;gap:24px;width:fit-content;margin-inline:auto}",
      `.leg{display:flex;gap:22px;align-items:baseline;max-width:1400px;font-size:40px;color:${theme.muted}}`,
      // A common chip width, so the labels share a spine too — the glyphs inside
      // are one symbol each and their natural widths differ by a few pixels.
      `.chip{display:inline-block;min-width:72px;text-align:center;background:${theme.panel};border-radius:10px;padding:2px 20px;white-space:nowrap;font-weight:700}`,
      // The block, not the term under discussion: which term that is, is a fact
      // about the paused timeline, and CSS cannot see it. The terms are also the
      // one thing here GSAP tints and swells, so a rule on them would win the
      // cascade and cancel the walk.
      ambient(sid, "-eq", BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/grid.ts
var W2 = 1700;
var LABEL = 42;
var LH = 1.25;
var PAD = 16;
var GAP = 0.14;
var CELL_MAX = 280;
var MARGIN = 6;
var MAX_LINES = 2;
var AVAIL = 900;
var EYEBROW_H = 48 + 22;
var HEADLINE_H = 76;
var NOTE_H2 = 62;
var NOTE_TOP = 34;
var FIELD_TOP = 52;
var grid = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  for (const r of p.regions) {
    if (r.x + r.w > p.cols || r.y + r.h > p.rows) {
      throw new Error(
        `grid: region "${r.label}" (${r.x},${r.y} ${r.w}x${r.h}) falls outside the ${p.cols}x${p.rows} field`
      );
    }
  }
  const chromeH = (p.eyebrow ? EYEBROW_H : 0) + wrap(p.headline, 66, W2, 700).length * HEADLINE_H;
  const noteH = p.note ? wrap(p.note, 40, 1600).length * NOTE_H2 + NOTE_TOP : 0;
  const budget = Math.max(320, AVAIL - chromeH - FIELD_TOP - noteH);
  const solve3 = (boxW) => {
    const cell = Math.min(
      CELL_MAX,
      (boxW - 2 * MARGIN) / (p.cols + GAP * (p.cols - 1)),
      (budget - 2 * MARGIN) / (p.rows + GAP * (p.rows - 1))
    );
    const gap = cell * GAP;
    return {
      cell,
      gap,
      w: p.cols * cell + (p.cols - 1) * gap,
      h: p.rows * cell + (p.rows - 1) * gap
    };
  };
  const innerW = (f2, w) => w * f2.cell + (w - 1) * f2.gap - 2 * PAD;
  const fitsInside = (f2, r) => {
    const bw = innerW(f2, r.w);
    const bh = r.h * f2.cell + (r.h - 1) * f2.gap - 2 * PAD;
    if (bw <= 0 || bh <= 0) return false;
    const lines2 = wrap(r.label, LABEL, bw, 700);
    if (Math.max(...lines2.map((l) => textWidth(l, LABEL, 700))) > bw) return false;
    return lines2.length * LABEL * LH <= bh;
  };
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const crowded = p.regions.map((r, i) => p.regions.some((o, k) => k !== i && hits(r, o)));
  const bare = solve3(W2);
  const needsGutter = p.regions.some((r, i) => crowded[i] || !fitsInside(bare, r));
  const widest2 = Math.max(...p.regions.map((r) => textWidth(r.label, LABEL, 600)));
  const lw = needsGutter ? Math.min(620, Math.max(220, widest2 / MAX_LINES * 1.12)) : 0;
  const gutter = needsGutter ? lw + 90 : 0;
  const f = needsGutter ? solve3(W2 - gutter) : bare;
  const inGutter = p.regions.map((r, i) => crowded[i] || !fitsInside(f, r));
  const lines = (r) => wrap(r.label, LABEL, lw, 600).length;
  const stackH = p.regions.filter((_, i) => inGutter[i]).reduce((t2, r, i) => t2 + lines(r) * LABEL * LH + (i > 0 ? 14 : 16), 0);
  const H3 = Math.min(budget, Math.max(f.h + 2 * MARGIN, stackH));
  const fx = needsGutter ? (W2 - gutter - f.w) / 2 : MARGIN;
  const fy = (H3 - f.h) / 2;
  const cols = tracks(f.w, p.cols, f.gap, fx);
  const rows = tracks(f.h, p.rows, f.gap, fy);
  const corner = Math.min(10, f.cell * 0.12);
  const cells = rows.flatMap(
    (row) => cols.map(
      (col) => roundRect({ x: col.x, y: row.x, w: col.w, h: row.w }, corner, { class: "gcell" })
    )
  ).join("");
  const stroke = Math.max(3, Math.min(6, f.cell * 0.16));
  const boxOf = (r) => {
    const c0 = cols[r.x] ?? { x: fx, w: f.cell };
    const y0 = rows[r.y] ?? { x: fy, w: f.cell };
    const bleed = Math.max(0, Math.min(f.gap * 0.35, fx - stroke / 2, fy - stroke / 2));
    return {
      x: c0.x - bleed,
      y: y0.x - bleed,
      w: r.w * c0.w + (r.w - 1) * f.gap + 2 * bleed,
      h: r.h * y0.w + (r.h - 1) * f.gap + 2 * bleed
    };
  };
  const boxes = p.regions.map(boxOf);
  const perimeter = (b) => {
    const rr = Math.min(corner, b.w / 2, b.h / 2);
    return 2 * (b.w - 2 * rr) + 2 * (b.h - 2 * rr) + 2 * Math.PI * rr;
  };
  const lx = W2 - gutter + 40;
  const outside = p.regions.map((r, i) => ({ r, i })).filter(({ i }) => inGutter[i]).map(({ r, i }) => {
    const b = boxes[i] ?? { x: fx, y: fy, w: f.cell, h: f.cell };
    const half = lines(r) * LABEL * LH / 2;
    return { i, half, y: b.y + b.h / 2, from: { x: b.x + b.w, y: b.y + b.h / 2 } };
  }).sort((a, b) => a.y - b.y || a.i - b.i);
  let floor = 8;
  for (const o of outside) {
    o.y = Math.max(o.y, floor + o.half);
    floor = o.y + o.half + 14;
  }
  const spill = floor - 14 - (H3 - 8);
  if (spill > 0) for (const o of outside) o.y = Math.max(o.half + 8, o.y - spill);
  const outById = new Map(outside.map((o) => [o.i, o]));
  const rects = [];
  const leads = [];
  const labels = [];
  const leadLen = [];
  p.regions.forEach((r, i) => {
    const b = boxes[i] ?? { x: fx, y: fy, w: f.cell, h: f.cell };
    const tone2 = theme.tones[r.tone];
    rects.push(
      roundRect(b, corner, {
        class: "grgn",
        id: id(sid, "rgn", i),
        fill: tone2,
        stroke: tone2,
        "stroke-width": n(stroke)
      })
    );
    const out = outById.get(i);
    if (out) {
      const to = { x: lx - 16, y: out.y };
      leadLen.push(Math.hypot(to.x - out.from.x, to.y - out.from.y));
      leads.push(line(out.from, to, { class: "glead", id: id(sid, "lead", i), stroke: tone2 }));
      labels.push(
        text(
          r.label,
          { x: lx, y: out.y },
          {
            size: LABEL,
            fill: tone2,
            weight: 600,
            maxWidth: lw,
            lineHeight: LH,
            vAlign: "middle",
            class: "grlab",
            id: id(sid, "lab", i)
          }
        )
      );
      return;
    }
    leadLen.push(0);
    labels.push(
      text(
        r.label,
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        {
          size: LABEL,
          fill: tone2,
          weight: 700,
          anchor: "middle",
          maxWidth: innerW(f, r.w),
          lineHeight: LH,
          vAlign: "middle",
          class: "grlab",
          id: id(sid, "lab", i)
        }
      )
    );
  });
  const field = svg(
    id(sid, "field"),
    W2,
    H3,
    group(cells, { class: "gcells" }) + group(rects) + leads.join("") + labels.join("")
  );
  const note = p.note ? `
<div class="gdnote" id="${id(sid, "note")}">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="gwrap">${field}</div>${note}`;
  const drawn = 1.6;
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    tween(
      `#${sid} .gcell`,
      // transformOrigin belongs in BOTH halves. Declared only in the `to` vars it
      // is an origin *change*, which GSAP's smoothOrigin absorbs with a translate
      // that never unwinds: the cells came to rest 8.08px up-left of the field,
      // 2.08px outside the svg, and the layout gate caught it at a hold.
      '{ opacity: 0, scale: 0.72, transformOrigin: "center" }',
      `{ opacity: 1, scale: 1, transformOrigin: "center", duration: 0.35, ease: "power2.out", stagger: { amount: 0.55, grid: [${p.rows}, ${p.cols}], from: "start" } }`,
      0.7
    )
  ];
  const holds = [drawn];
  const first = drawn + 0.15;
  const step = Math.min(1.2, Math.max(0.6, (beat.seconds - first - 1.3) / p.regions.length));
  p.regions.forEach((_, i) => {
    const at = first + i * step;
    const len = perimeter(boxes[i] ?? { x: 0, y: 0, w: 0, h: 0 });
    tl.push(
      tween(
        `#${id(sid, "rgn", i)}`,
        drawFrom(len),
        '{ strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }',
        at
      ),
      tween(
        `#${id(sid, "rgn", i)}`,
        "{ fillOpacity: 0 }",
        "{ fillOpacity: 0.18, duration: 0.45 }",
        at + 0.35
      )
    );
    if (outById.has(i)) {
      const len2 = leadLen[i] ?? 0;
      tl.push(
        tween(
          `#${id(sid, "lead", i)}`,
          drawFrom(len2),
          '{ strokeDashoffset: 0, duration: 0.35, ease: "none" }',
          at + 0.3
        )
      );
    }
    tl.push(
      tween(
        `#${id(sid, "lab", i)}`,
        "{ opacity: 0, y: 10 }",
        "{ opacity: 1, y: 0, duration: 0.45 }",
        at + 0.45
      )
    );
    holds.push(at + 0.9);
  });
  if (p.note) {
    const at = first + p.regions.length * step;
    tl.push(tween(`#${id(sid, "note")}`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.6 }", at));
    holds.push(at + 0.7);
  }
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".gwrap{margin-top:52px}",
      `.gcell{fill:${theme.panel};stroke:${theme.rule};stroke-width:1}`,
      // `fill-opacity` and the dash offset are what the reveal animates; the
      // stylesheet holds the pre-reveal state so a still render is a bare field.
      ".grgn{fill-opacity:0;stroke-linejoin:round}",
      // Subordinate to both the region it leaves and the label it arrives at: a
      // leader that competes with them is a line across the diagram for nothing.
      ".glead{stroke-width:3;stroke-linecap:round;opacity:.62}",
      `.gdnote{font-size:40px;line-height:1.55;color:${theme.muted};margin-top:34px;max-width:1600px}`,
      // The last region is the one still being spoken to at the final hold. Its
      // entrance owns the dash and the fill, so the breath takes `filter`.
      ambient(sid, `-rgn${p.regions.length - 1}`, BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/line-chart.ts
function chartScale(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const leading = raw / magnitude;
  const step = (leading <= 1 ? 1 : leading <= 2 ? 2 : leading <= 5 ? 5 : 10) * magnitude;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  return { min, max: max > min ? max : min + step, step, decimals };
}
function n2(v) {
  return (Math.round(v * 100) / 100).toString();
}
var H = 600;
var PAD2 = { l: 150, r: 40, t: 96, b: 140 };
var lineChart = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const scale = chartScale(p.points.map((pt) => pt.y));
  const width = p.readout ? 1120 : 1700;
  const last = p.points[p.points.length - 1];
  const valueW = String(last?.y ?? "").length * 40 * 0.58;
  const labelW = (last?.x ?? "").length * 40 * 0.68;
  const padR = Math.max(PAD2.r, Math.ceil(Math.max(valueW, labelW) / 2) + 16);
  const plotW = width - PAD2.l - padR;
  const plotH = H - PAD2.t - PAD2.b;
  const x = (i) => PAD2.l + i * plotW / (p.points.length - 1);
  const y = (v) => PAD2.t + (scale.max - v) / (scale.max - scale.min) * plotH;
  const ticks = Array.from(
    { length: Math.round((scale.max - scale.min) / scale.step) + 1 },
    (_, i) => scale.min + i * scale.step
  );
  const grid2 = ticks.map((v) => `<line x1="${PAD2.l}" y1="${n2(y(v))}" x2="${width - padR}" y2="${n2(y(v))}" />`).join("");
  const yLabels = ticks.map((v) => `<text x="${PAD2.l - 22}" y="${n2(y(v) + 13)}">${v.toFixed(scale.decimals)}</text>`).join("");
  const xLabels = p.points.map((pt, i) => `<text x="${n2(x(i))}" y="${H - PAD2.b + 56}">${esc(pt.x)}</text>`).join("");
  const path2 = p.points.map((pt, i) => `${i === 0 ? "M" : "L"}${n2(x(i))},${n2(y(pt.y))}`).join(" ");
  const length = p.points.reduce(
    (total, pt, i) => i === 0 ? 0 : total + Math.hypot(x(i) - x(i - 1), y(pt.y) - y(p.points[i - 1]?.y ?? pt.y)),
    0
  );
  const dots = p.points.map(
    (pt, i) => `<circle class="dot" cx="${n2(x(i))}" cy="${n2(y(pt.y))}" r="${i === p.points.length - 1 ? 11 : 9}" fill="${i === p.points.length - 1 ? theme.tones.b : theme.accent}" />`
  ).join("");
  const values = p.points.map(
    (pt, i) => `<text class="pv" x="${n2(x(i))}" y="${n2(Math.max(44, y(pt.y) - 26))}">${esc(String(pt.y))}</text>`
  ).join("");
  const deltas = (p.deltas ?? []).slice(0, p.points.length - 1).map((d, i) => {
    const a = p.points[i];
    const b = p.points[i + 1];
    if (!a || !b) return "";
    const mid = (y(a.y) + y(b.y)) / 2;
    return `<text class="dv" x="${n2((x(i) + x(i + 1)) / 2)}" y="${n2(Math.max(44, mid - 28))}">${esc(d)}</text>`;
  }).join("");
  const readout = p.readout ? `
  <div class="readout" id="${sid}-read">${esc(p.readout)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="chartwrap">
  <svg id="${sid}-chart" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">
    <g class="grid">${grid2}</g>
    <g class="axlab" text-anchor="end">${yLabels}</g>
    <g class="axlab" text-anchor="middle">${xLabels}</g>
    <!-- Baseline, not top edge: at 40px a y of 26 puts the cap height 13px above
         the svg and the layout gate reports container_overflow. -->
    <text class="axname" x="0" y="42">${esc(p.yLabel)}</text>
    <text class="axname" x="${n2(PAD2.l + plotW / 2)}" y="${H - 16}" text-anchor="middle">${esc(p.xLabel)}</text>
    <path class="chartline" id="${sid}-line" d="${path2}" fill="none" stroke="${theme.accent}" />
    <g>${dots}</g>
    <g class="ptlab" text-anchor="middle">${values}</g>
    <g class="delta" text-anchor="middle">${deltas}</g>
  </svg>${readout}
</div>`;
  const draw = 0.8;
  const step = Math.min(0.45, 1.8 / p.points.length);
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    tween(
      `#${sid}-line`,
      drawFrom(length),
      '{ strokeDashoffset: 0, duration: 1.8, ease: "none" }',
      draw
    ),
    tween(
      `#${sid} .dot`,
      // Origin in both halves, or GSAP's smoothOrigin compensates the change with
      // a translate that survives the tween — the dots rested 9px off the very
      // polyline they mark, inside the frame and so invisible to every gate.
      '{ opacity: 0, scale: 0, transformOrigin: "center" }',
      `{ opacity: 1, scale: 1, transformOrigin: "center", duration: 0.3, stagger: ${step} }`,
      draw
    ),
    tween(
      `#${sid} .pv`,
      "{ opacity: 0 }",
      `{ opacity: 1, duration: 0.3, stagger: ${step} }`,
      draw + 0.2
    )
  ];
  if (deltas) {
    tl.push(
      tween(
        `#${sid} .dv`,
        "{ opacity: 0, y: -10 }",
        `{ opacity: 1, y: 0, duration: 0.35, stagger: ${step} }`,
        draw + 0.6
      )
    );
  }
  const drawn = draw + step * p.points.length + 0.4;
  const holds = [drawn];
  if (p.readout) {
    tl.push(
      tween(`#${sid}-read`, "{ opacity: 0, x: 24 }", "{ opacity: 1, x: 0, duration: 0.7 }", drawn)
    );
    holds.push(drawn + 0.8);
  }
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".chartwrap{display:flex;gap:60px;align-items:center;margin-top:24px}",
      `.grid line{stroke:${theme.rule};stroke-width:1}`,
      `.chartline{stroke-width:5;stroke-linejoin:round;stroke-linecap:round}`,
      `.axlab{font-size:40px;fill:${theme.dim}}`,
      `.axname{font-size:40px;fill:${theme.muted};font-weight:500}`,
      `.ptlab{font-size:40px;fill:${theme.fg};font-weight:600}`,
      `.delta{font-size:40px;fill:${theme.tones.b};font-weight:600}`,
      // 1.7 set the two lines of a wrapped readout 68px apart, which reads as two
      // unrelated fragments rather than one sentence. 1.35 keeps it a paragraph.
      `.readout{font-size:40px;line-height:1.35;color:${theme.muted};max-width:520px}`,
      // The last point — the one the readout is about. It is drawn larger and in
      // a different tone for the same reason. Its own `<g>` holds circles only,
      // so `:last-of-type` is the endpoint. The dots' entrance owns `scale`.
      ambient(sid, " .dot:last-of-type", BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/pipeline.ts
var W3 = 1700;
var M = 2;
var R = 18;
var LABEL2 = 46;
var NOTE = MIN_FONT;
var LABEL_LH = 1.2;
var NOTE_LH = 1.3;
var NOTE_TOP2 = 16;
var PAD_X_EM = 0.45;
var PAD_Y = 34;
var MIN_BOX_H = 172;
var GAP2 = 120;
var MIN_GAP = 30;
var MAX_BOX_W = 430;
var LOOP_TOP = 56;
var LOOP_LABEL_TOP = 18;
var LOOP_BOTTOM = 10;
function balance(label, k) {
  const words = label.split(/\s+/).filter(Boolean);
  if (k <= 1 || words.length <= 1) return [label];
  const w = words.map((x) => textWidth(x, 1, 600));
  const share = w.reduce((a, b) => a + b, 0) / k;
  const lines = [];
  let cur = [];
  let run = 0;
  words.forEach((word, i) => {
    if (cur.length > 0 && lines.length < k - 1 && run >= share && words.length - i >= k - lines.length - 1) {
      lines.push(cur.join(" "));
      cur = [];
      run = 0;
    }
    cur.push(word);
    run += w[i] ?? 0;
  });
  if (cur.length > 0) lines.push(cur.join(" "));
  return lines;
}
function centre(boxes, i) {
  const b = boxes[i];
  return b ? b.x + b.w / 2 : 0;
}
function loopLabelWidth(boxes, from, to) {
  const mid = (centre(boxes, from) + centre(boxes, to)) / 2;
  return Math.max(NOTE * 6, Math.min(W3 - 2 * M - 80, 2 * Math.min(mid, W3 - mid) - 40));
}
function widest(lines) {
  return lines.reduce((a, b) => textWidth(b, 1, 600) > textWidth(a, 1, 600) ? b : a);
}
function fitAt(stages, k, width) {
  return fitBoxes({
    labels: stages.map((s) => widest([...balance(s.label, k), ...balance(s.note ?? "", k)])),
    width,
    size: LABEL2,
    gap: GAP2,
    minGap: MIN_GAP,
    padEm: PAD_X_EM,
    weight: 600,
    x0: M + (W3 - 2 * M - width) / 2
  });
}
function solve(stages, width) {
  let fit = fitAt(stages, 1, width);
  for (let k = 2; !fit.ok && k <= 3; k++) fit = fitAt(stages, k, width);
  return fit;
}
function pipeLayout(stages, loop) {
  const width = W3 - 2 * M;
  const capped = Math.min(width, stages.length * MAX_BOX_W + (stages.length - 1) * GAP2);
  let fit = solve(stages, capped);
  if (!fit.ok && capped < width) fit = solve(stages, width);
  const size = Math.max(MIN_FONT, Math.floor(fit.size));
  const boxes = fit.boxes;
  const innerW = Math.max(size, (boxes[0]?.w ?? width) - 2 * PAD_X_EM * size);
  const labelLines = stages.map((s) => wrap(s.label, size, innerW, 600));
  const noteLines = stages.map((s) => s.note ? wrap(s.note, NOTE, innerW, 400) : []);
  const boxH = Math.max(
    MIN_BOX_H,
    ...stages.map((_, i) => {
      const label = (labelLines[i]?.length ?? 1) * size * LABEL_LH;
      const note = noteLines[i]?.length ?? 0;
      return Math.ceil(2 * PAD_Y + label + (note > 0 ? NOTE_TOP2 + note * NOTE * NOTE_LH : 0));
    })
  );
  let loopLines = [];
  if (loop) {
    loopLines = wrap(loop.label, NOTE, loopLabelWidth(boxes, loop.from, loop.to), 500);
  }
  return {
    size,
    boxes,
    boxH,
    innerW,
    labelLines,
    noteLines,
    loopDrop: loop ? LOOP_TOP : 0,
    loopLines,
    svgH: M + boxH + (loop ? LOOP_TOP + LOOP_LABEL_TOP + loopLines.length * NOTE * NOTE_LH + LOOP_BOTTOM : M)
  };
}
var pipeline = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const last = p.stages.length - 1;
  const loop = (() => {
    if (!p.loop) return void 0;
    const from = Math.min(Math.max(0, p.loop.from ?? last), last);
    const to = Math.min(Math.max(0, p.loop.to), Math.max(0, from - 1));
    return from > to ? { from, to, label: p.loop.label } : void 0;
  })();
  const L = pipeLayout(p.stages, loop);
  const cy = M + L.boxH / 2;
  const cx = (i) => {
    const b = L.boxes[i];
    return b ? b.x + b.w / 2 : 0;
  };
  const stages = p.stages.map((stage, i) => {
    const b = L.boxes[i] ?? { x: M, w: 0 };
    const box = { x: b.x, y: M, w: b.w, h: L.boxH };
    const tone2 = stage.tone ? theme.tones[stage.tone] : void 0;
    const shell = tone2 ? roundRect(box, R, { fill: tone2, "fill-opacity": "0.12", stroke: tone2, "stroke-width": 4 }) : roundRect(box, R, { fill: theme.panel, stroke: theme.rule, "stroke-width": 3 });
    const labelH = (L.labelLines[i]?.length ?? 1) * L.size * LABEL_LH;
    const noteCount = L.noteLines[i]?.length ?? 0;
    const noteH = noteCount > 0 ? NOTE_TOP2 + noteCount * NOTE * NOTE_LH : 0;
    const top = M + (L.boxH - labelH - noteH) / 2;
    const label = text(
      stage.label,
      { x: box.x + box.w / 2, y: top + labelH / 2 },
      {
        size: L.size,
        weight: 600,
        fill: tone2 ?? theme.fg,
        anchor: "middle",
        maxWidth: L.innerW,
        lineHeight: LABEL_LH,
        vAlign: "middle"
      }
    );
    const note2 = noteCount > 0 && stage.note ? text(
      stage.note,
      { x: box.x + box.w / 2, y: top + labelH + NOTE_TOP2 + (noteH - NOTE_TOP2) / 2 },
      {
        size: NOTE,
        fill: theme.muted,
        anchor: "middle",
        maxWidth: L.innerW,
        lineHeight: NOTE_LH,
        vAlign: "middle"
      }
    ) : "";
    return group([shell, label, note2], { id: id(sid, "stage", i) });
  });
  const connectors = p.stages.slice(1).map((_, i) => {
    const a = L.boxes[i];
    const b = L.boxes[i + 1];
    if (!a || !b) return "";
    return arrow(
      sid,
      { x: a.x + a.w, y: cy },
      { x: b.x, y: cy },
      { stroke: theme.muted, width: 5, inset: 8, id: id(sid, "arrow", i) }
    );
  });
  const loopColour = theme.tones.b;
  let loopSvg = "";
  let sweepW = 0;
  if (loop) {
    const bottom = M + L.boxH;
    const via = bottom + L.loopDrop;
    const label = text(
      loop.label,
      {
        x: (cx(loop.from) + cx(loop.to)) / 2,
        y: via + LOOP_LABEL_TOP + L.loopLines.length * NOTE * NOTE_LH / 2
      },
      {
        size: NOTE,
        weight: 500,
        fill: loopColour,
        anchor: "middle",
        maxWidth: loopLabelWidth(L.boxes, last, loop.to),
        lineHeight: NOTE_LH,
        vAlign: "middle"
      }
    );
    const route = elbow(
      sid,
      { x: cx(loop.from), y: bottom },
      { x: cx(loop.to), y: bottom },
      { stroke: loopColour, width: 4, dash: "16 12", inset: 10, via, radius: 22 }
    );
    const mid = (cx(loop.from) + cx(loop.to)) / 2;
    const half = Math.max(...L.loopLines.map((l) => textWidth(l, NOTE, 500)), 0) / 2 + 10;
    const x0 = Math.max(0, Math.min(cx(loop.to) - 30, mid - half));
    sweepW = Math.min(W3, Math.max(cx(loop.from) + 30, mid + half)) - x0;
    loopSvg = `<defs><clipPath id="${id(sid, "loopclip")}">${rect({ x: x0, y: 0, w: sweepW, h: L.svgH }, { id: id(sid, "sweep") })}</clipPath></defs>` + group([route, label], { "clip-path": `url(#${id(sid, "loopclip")})` });
  }
  const body = [
    arrowDefs(sid, loop ? [theme.muted, loopColour] : [theme.muted]),
    loopSvg,
    ...connectors,
    ...stages
  ].join("");
  const note = p.note ? `
<div class="pipenote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="pipewrap">${svg(id(sid, "pipe"), W3, L.svgH, body)}</div>${note}`;
  const t0 = 1;
  const step = Math.min(1.4, Math.max(0.55, (beat.seconds - 2.8) / p.stages.length));
  const tl = [...chromeIn(sid, p.eyebrow !== void 0)];
  const holds = [];
  p.stages.forEach((_, i) => {
    const at = t0 + i * step;
    if (i > 0) {
      tl.push(
        tween(
          `#${id(sid, "arrow", i - 1)}`,
          "{ opacity: 0, x: -18 }",
          '{ opacity: 1, x: 0, duration: 0.32, ease: "power2.out" }',
          at - 0.3
        )
      );
    }
    tl.push(
      tween(
        `#${id(sid, "stage", i)}`,
        "{ opacity: 0, y: 24 }",
        '{ opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }',
        at
      )
    );
    holds.push(at + 0.55);
  });
  let end = t0 + last * step + 0.55;
  if (loop) {
    const at = end + 0.25;
    tl.push(
      tween(
        `#${id(sid, "sweep")}`,
        `{ x: ${n(sweepW)} }`,
        '{ x: 0, duration: 0.9, ease: "power2.inOut" }',
        at
      )
    );
    end = at + 1;
    holds.push(end);
  }
  if (p.note) {
    const at = end + 0.15;
    tl.push(
      tween(`#${sid}-note`, "{ opacity: 0, y: 12 }", "{ opacity: 1, y: 0, duration: 0.5 }", at)
    );
    holds.push(at + 0.6);
  }
  const focus = p.stages.reduce((acc, s, i) => s.tone ? i : acc, last);
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".pipewrap{margin-top:38px;display:flex;justify-content:center}",
      `.pipenote{font-size:40px;line-height:1.5;color:${theme.muted};margin-top:36px;max-width:1500px}`,
      ambient(sid, `-stage${focus}`, BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/split-compare.ts
var W4 = 1700;
var H2 = 560;
var GUTTER = 46;
var LABEL_MAX2 = 46;
var PAD3 = 16;
var INDENT = 40;
var MIN_FIG = 180;
var STACK_GAP = 28;
var ITEM_LH = 1.45;
var ITEM_GAP = 0.45;
var ITEM_SIZES = [42, 41, MIN_FONT];
var NAME = ["left", "right"];
function itemHeight(t2, size, width) {
  return wrap(t2, size, width).length * size * ITEM_LH;
}
function listHeight(lines, size, width) {
  if (lines.length === 0) return 0;
  return lines.reduce((h, t2) => h + itemHeight(t2, size, width), 0) + size * ITEM_GAP * (lines.length - 1);
}
function image(fig, b) {
  return `<image href="assets/${esc(fig.src)}" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" preserveAspectRatio="xMidYMid meet"><title>${esc(fig.caption)}</title></image>`;
}
var splitCompare = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const sides = [p.left, p.right];
  const tones = [theme.tones.a, theme.tones.b];
  const figs = sides.map((side) => {
    if (side.figureId === void 0) return void 0;
    const fig = ctx.source.figures.find((f) => f.id === side.figureId);
    if (!fig) {
      throw new Error(
        `split-compare ${beat.id}: no figure "${side.figureId}" in source ${ctx.source.id}`
      );
    }
    if (fig.width <= 0 || fig.height <= 0) {
      throw new Error(`split-compare ${beat.id}: figure "${fig.id}" has no usable dimensions`);
    }
    return fig;
  });
  sides.forEach((side, i) => {
    if (!figs[i] && !side.lines?.length) {
      throw new Error(
        `split-compare ${beat.id}: the ${NAME[i]} side has neither a figure nor lines`
      );
    }
  });
  const cols = tracks(W4, 2, GUTTER * 2);
  const pw = cols[0]?.w ?? W4 / 2;
  const colX = (i) => cols[i]?.x ?? 0;
  const mid = W4 / 2;
  const labelSize = Math.max(
    MIN_FONT,
    Math.floor(Math.min(LABEL_MAX2, ...sides.map((s) => pw / textWidth(s.label, 1, 700))))
  );
  const labelLh = labelSize * 1.25;
  const bandH = Math.max(...sides.map((s) => wrap(s.label, labelSize, pw, 700).length)) * labelLh;
  const hairY = bandH + 20;
  const contentY = hairY + 36;
  const contentH = H2 - contentY;
  const fits = (size) => sides.every((side, i) => {
    const list = listHeight(side.lines ?? [], size, pw - INDENT);
    const fig = figs[i] ? MIN_FIG + (list > 0 ? STACK_GAP : 0) : 0;
    return list + fig <= contentH;
  });
  const itemSize = ITEM_SIZES.find(fits);
  if (itemSize === void 0) {
    throw new Error(
      `split-compare ${beat.id}: the panels do not fit beside each other at the ${MIN_FONT}px floor \u2014 shorten the lines or split the beat`
    );
  }
  const itemW = pw - INDENT;
  const natural = figs.map((fig, i) => {
    const side = sides[i];
    if (!fig || !side) return 0;
    const list = listHeight(side.lines ?? [], itemSize, itemW);
    const boxH = contentH - list - (list > 0 ? STACK_GAP : 0);
    return Math.min(boxH - 2 * PAD3, (pw - 2 * PAD3) * fig.height / fig.width);
  });
  const matched = figs[0] && figs[1] ? Math.min(...natural) : void 0;
  const groups = sides.map((side, i) => {
    const tone2 = tones[i] ?? theme.accent;
    const x0 = colX(i);
    const inner = i === 0 ? mid - GUTTER : mid + GUTTER;
    const outer = i === 0 ? x0 : x0 + pw;
    const fig = figs[i];
    const parts = [
      text(
        side.label,
        { x: inner, y: bandH / 2 },
        {
          size: labelSize,
          fill: theme.fg,
          weight: 700,
          anchor: i === 0 ? "end" : "start",
          maxWidth: pw,
          lineHeight: 1.25,
          vAlign: "middle",
          id: `${sid}-lab${i}`
        }
      ),
      // Drawn from the rule outwards, so the hairline reads as belonging to the
      // divider rather than underlining a column that happens to sit near it.
      // Butt caps, not round: a round cap would put 1.5px of ink past the outer
      // edge of the canvas, where it is clipped rather than seen.
      line(
        { x: inner, y: hairY },
        { x: outer, y: hairY },
        { id: `${sid}-hair${i}`, stroke: tone2, "stroke-width": 3 }
      )
    ];
    const imgH = fig ? matched ?? natural[i] ?? 0 : 0;
    const imgW = fig ? fig.width * imgH / fig.height : 0;
    const cardH = fig ? imgH + 2 * PAD3 : 0;
    const list = side.lines ?? [];
    const listH = listHeight(list, itemSize, itemW);
    const stackH = cardH + listH + (cardH > 0 && listH > 0 ? STACK_GAP : 0);
    let y = contentY + (contentH - stackH) / 2;
    if (fig) {
      const cardX = x0 + (pw - imgW - 2 * PAD3) / 2;
      parts.push(
        roundRect({ x: cardX, y, w: imgW + 2 * PAD3, h: cardH }, 14, {
          fill: "#ffffff",
          stroke: theme.rule,
          "stroke-width": 1
        }),
        image(fig, { x: cardX + PAD3, y: y + PAD3, w: imgW, h: imgH })
      );
      y += cardH + (listH > 0 ? STACK_GAP : 0);
    }
    for (const item of list) {
      const h = itemHeight(item, itemSize, itemW);
      parts.push(
        roundRect({ x: x0, y: y + itemSize * 0.32, w: 5, h: itemSize * 0.95 }, 2.5, { fill: tone2 }),
        text(
          item,
          { x: x0 + INDENT, y: y + h / 2 },
          {
            size: itemSize,
            fill: theme.fg,
            maxWidth: itemW,
            lineHeight: ITEM_LH,
            vAlign: "middle"
          }
        )
      );
      y += h + itemSize * ITEM_GAP;
    }
    return `<g id="${sid}-side${i}">${parts.join("")}</g>`;
  });
  const divider = `<g id="${sid}-div">` + line({ x: mid, y: 0 }, { x: mid, y: H2 }, { stroke: theme.rule, "stroke-width": 2 }) + // The stretch the labels stand on is weighted, so the device reads as a header
  // rule that continues downwards rather than a hairline someone forgot to stop.
  line({ x: mid, y: 0 }, { x: mid, y: hairY }, { stroke: theme.muted, "stroke-width": 3 }) + "</g>";
  const note = p.note ? `
<div class="sc-note" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="sc-body">${svg(`${sid}-sc`, W4, H2, divider + groups.join(""))}</div>${note}`;
  const at = [1.15, 2.05];
  const tl = [
    ...chromeIn(sid, p.eyebrow !== void 0),
    // The frame before either side of the argument: the divider grows down from
    // under the headline, and the panels arrive into a structure that already exists.
    tween(
      `#${sid}-div`,
      // The origin is named in both halves so it never *changes* mid-tween; GSAP
      // compensates an origin change with a translate that outlives the tween.
      `{ opacity: 0, scaleY: 0, svgOrigin: "${n(mid)} 0" }`,
      `{ opacity: 1, scaleY: 1, svgOrigin: "${n(mid)} 0", duration: 0.6, ease: "power2.out" }`,
      0.75
    )
  ];
  const holds = [];
  sides.forEach((_, i) => {
    const t2 = at[i] ?? 0;
    tl.push(
      tween(
        `#${sid}-side${i}`,
        `{ opacity: 0, x: ${i === 0 ? -26 : 26} }`,
        '{ opacity: 1, x: 0, duration: 0.6, ease: "power2.out" }',
        t2
      ),
      tween(
        `#${sid}-hair${i}`,
        drawFrom(pw),
        '{ strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }',
        t2
      )
    );
    holds.push(t2 + 0.8);
  });
  if (p.note) {
    const t2 = (at[1] ?? 0) + 0.9;
    tl.push(tween(`#${sid}-note`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.6 }", t2));
    holds.push(t2 + 0.7);
  }
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      ".sc-body{margin-top:34px;display:flex;justify-content:center}",
      `.sc-note{font-size:40px;line-height:1.55;color:${theme.muted};margin-top:34px;max-width:1600px}`,
      // The right-hand label — the side the comparison is arguing for, and the one
      // still on screen at the last hold. Its group's entrance owns `opacity` and
      // `transform`; the breath is on the label itself and moves `filter`, so the
      // two never write the same property on the same element.
      ambient(sid, "-lab1", BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/stack.ts
var PAD_X = 110;
var PAD_Y2 = 84;
var GAP3 = 44;
var NUM_X = 48;
var NUM_W = 70;
var LABEL_SIZE = 46;
var RISE_MAX = 180;
var RISE_MIN = 24;
var SY_MAX = 100;
var T_MAX = 18;
var EDGE2 = 10;
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function stackLayout(p, format) {
  const stacked = solve2(p, format, false);
  if (stacked.fits || !p.layers.some((l) => l.note)) return stacked;
  const inline = solve2(p, format, true);
  return inline.fits || inline.blockH < stacked.blockH ? inline : stacked;
}
function solve2(p, format, inline) {
  const width = format.width - 2 * PAD_X;
  const contentH = format.height - 2 * PAD_Y2;
  const count = p.layers.length;
  const noteW = (l) => inline && l.note !== void 0 ? textWidth(l.note, MIN_FONT, 400) + 28 : 0;
  const want = Math.max(...p.layers.map((l) => textWidth(l.label, LABEL_SIZE, 600) + noteW(l)));
  const colCap = inline ? width * 0.56 : width * 0.5;
  const colW = clamp(Math.ceil(want) + 12, Math.min(520, width * 0.34), colCap);
  const labelX = width - colW;
  const labelRoom = Math.min(
    ...p.layers.map((l) => (colW - noteW(l)) / Math.max(1, textWidth(l.label, 1, 600)))
  );
  const labelSize = Math.max(MIN_FONT, Math.min(LABEL_SIZE, labelRoom));
  const lines = p.layers.map((l) => {
    const nw = noteW(l);
    const labelMaxW = Math.max(labelSize, colW - nw);
    return {
      label: wrap(l.label, labelSize, labelMaxW, 600),
      // Inline notes stay on one line by contract — the schema calls a note "one
      // short line" — and wrapping one would put its second line under the label.
      note: l.note === void 0 ? [] : inline ? [l.note] : wrap(l.note, MIN_FONT, colW, 400),
      noteW: nw,
      labelMaxW
    };
  });
  const blockH = Math.max(
    ...lines.map(
      (l) => inline ? Math.max(l.label.length * labelSize, l.note.length * MIN_FONT) * 1.16 : l.label.length * labelSize * 1.16 + (l.note.length > 0 ? 6 + l.note.length * MIN_FONT * 1.16 : 0)
    )
  );
  const pad = Math.max(EDGE2, blockH / 2);
  const chromeH = (p.eyebrow ? MIN_FONT * 1.2 + 22 : 0) + wrap(p.headline, 66, width, 700).length * 66 * 1.15;
  const noteH = p.note ? 28 + wrap(p.note, MIN_FONT, Math.min(width, 1600)).length * 62 : 0;
  const free = contentH - chromeH - 20 - noteH;
  const avail = Math.max(300, free);
  const room = (avail - 2 * pad - SY_MAX - T_MAX) / Math.max(1, count - 1);
  const rise = clamp(room, RISE_MIN, RISE_MAX);
  const sy = clamp(rise * 0.62, 46, SY_MAX);
  const t2 = clamp(rise * 0.14, 10, T_MAX);
  const span = width - NUM_W - GAP3 - colW;
  const sx = clamp(span * 0.2, 110, 220);
  const height = 2 * pad + (count - 1) * rise + sy + t2;
  return {
    // A rise shorter than a label block prints the note through the label below.
    fits: room >= blockH + 10 && height <= free,
    inline,
    width,
    height,
    avail,
    chromeH,
    noteH,
    rise,
    sx,
    sy,
    t: t2,
    x0: NUM_W,
    w: span - sx,
    labelX,
    colW,
    labelSize,
    blockH,
    pad,
    yBase: pad + (count - 1) * rise + sy,
    lines
  };
}
function slab(x0, y0, L, fill, lift, stroke) {
  const { w, sx, sy, t: t2 } = L;
  const top = `M${n(x0)},${n(y0)} L${n(x0 + w)},${n(y0)} L${n(x0 + w + sx)},${n(y0 - sy)} L${n(x0 + sx)},${n(y0 - sy)} Z`;
  const front = `M${n(x0)},${n(y0)} L${n(x0)},${n(y0 + t2)} L${n(x0 + w)},${n(y0 + t2)} L${n(x0 + w)},${n(y0)} Z`;
  const side = `M${n(x0 + w)},${n(y0)} L${n(x0 + w)},${n(y0 + t2)} L${n(x0 + w + sx)},${n(y0 + t2 - sy)} L${n(x0 + w + sx)},${n(y0 - sy)} Z`;
  const edge = { stroke, "stroke-width": 2, "stroke-opacity": 0.75 };
  return path(front, { fill, "fill-opacity": n(lift * 0.5), ...edge }) + path(side, { fill, "fill-opacity": n(lift * 0.3), ...edge }) + path(top, { fill, "fill-opacity": n(lift), stroke, "stroke-width": 2 });
}
var stack = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;
  const L = stackLayout(p, ctx.format);
  const count = p.layers.length;
  const last = count - 1;
  const body = p.layers.map((layer, i) => {
    const y0 = L.yBase - i * L.rise;
    const mid = y0 - L.sy / 2;
    const top = i === last;
    const tint = top ? theme.tones.b : theme.accent;
    const stroke = top ? theme.tones.b : theme.rule;
    const lift = 0.09 + 0.13 * (i / Math.max(1, last));
    const leader = line(
      { x: L.x0 + L.w + L.sx / 2 + 8, y: mid },
      { x: L.labelX - 14, y: mid },
      { stroke: theme.rule, "stroke-width": 2 }
    );
    const dot = circle({ x: L.x0 + L.w + L.sx / 2 + 8, y: mid }, 6, { fill: tint });
    const block = L.lines[i] ?? { label: [], note: [], noteW: 0, labelMaxW: L.colW };
    const labelH = block.label.length * L.labelSize * 1.16;
    const noteH = block.note.length > 0 ? 6 + block.note.length * MIN_FONT * 1.16 : 0;
    const label = text(
      layer.label,
      { x: L.labelX, y: L.inline ? mid : mid - noteH / 2 },
      {
        size: L.labelSize,
        weight: top ? 700 : 600,
        fill: top ? theme.tones.b : theme.fg,
        maxWidth: block.labelMaxW,
        lineHeight: 1.16,
        vAlign: "middle"
      }
    );
    const note = layer.note === void 0 ? "" : text(
      layer.note,
      L.inline ? { x: L.labelX + L.colW, y: mid } : (
        // Relative to the label's own centre (`mid - noteH/2`), not to
        // `mid`: measuring the drop from `mid` put the note 20px low, so
        // it sat 26px under its own label and 18px over the *next* one —
        // a note reads as belonging to whichever label it is nearer, and
        // that was the wrong one. Half a lead below the label's baseline
        // box centres the pair on the leader dot again.
        { x: L.labelX, y: mid + labelH / 2 + 3 }
      ),
      {
        size: MIN_FONT,
        fill: theme.muted,
        anchor: L.inline ? "end" : "start",
        maxWidth: L.inline ? void 0 : L.colW,
        lineHeight: 1.16,
        vAlign: "middle"
      }
    );
    const num = text(
      String(i + 1),
      { x: NUM_X, y: mid },
      { size: MIN_FONT, weight: 600, fill: theme.dim, anchor: "end", vAlign: "middle" }
    );
    return group(slab(L.x0, y0, L, tint, lift, stroke), { id: id(sid, "lay", i), class: "lay" }) + group(num + leader + dot + label + note, { id: id(sid, "cap", i), class: "cap" });
  }).join("");
  const noteHtml = p.note ? `
<div class="stnote" id="${sid}-note">${esc(p.note)}</div>` : "";
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="stackwrap">${svg(id(sid, "stack"), L.width, L.height, body)}</div>${noteHtml}`;
  const first = 0.9;
  const step = Math.min(0.8, Math.max(0.4, (beat.seconds - first - 1.5) / count));
  const tl = [...chromeIn(sid, p.eyebrow !== void 0)];
  const holds = [];
  p.layers.forEach((_, i) => {
    const at = first + i * step;
    tl.push(
      tween(
        `#${sid}-lay${i}`,
        "{ opacity: 0, y: 34 }",
        '{ opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }',
        at
      )
    );
    tl.push(tween(`#${sid}-cap${i}`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.4 }", at + 0.2));
    holds.push(at + 0.62);
  });
  if (p.note) {
    const at = first + count * step;
    tl.push(tween(`#${sid}-note`, "{ opacity: 0 }", "{ opacity: 1, duration: 0.6 }", at));
    holds.push(at + 0.7);
  }
  return {
    html,
    tl,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // Every size the diagram picks is per-beat, so it rides on the elements as
      // attributes; what is left here is identical for every stack scene and the
      // shell emits it once.
      ".stackwrap{align-self:center;margin-top:20px}",
      `.stnote{font-size:40px;line-height:1.55;color:${theme.muted};margin-top:28px;max-width:1600px}`,
      // The top plane is the focal point — last built, differently toned, and the
      // one the final hold sits on. Its entrance owns `opacity` and `transform`,
      // so the breath takes `filter`, the property nothing else writes.
      ambient(sid, `-lay${last}`, BREATHE)
    ].join("\n")
  };
};

// src/emit/archetypes/index.ts
var emitters = {
  // The ones that draw the mechanism. Listed first because that is the order the
  // planner is told to reach for them in.
  pipeline,
  "annotated-figure": annotatedFigure,
  grid,
  "bar-compare": barCompare,
  stack,
  "split-compare": splitCompare,
  "equation-walk": equationWalk,
  "line-chart": lineChart,
  // The ones that describe.
  title,
  "claim-figure": claimFigure,
  "data-table": dataTable,
  callout
};
function emitScene(beat, ctx) {
  return emitters[beat.archetype](beat, ctx);
}

// src/source/fonts.ts
function familyFor(lang) {
  const tag = lang.toLowerCase();
  if (tag.startsWith("ko")) return "Noto Sans KR";
  if (tag.startsWith("ja")) return "Noto Sans JP";
  if (tag.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(tag) ? "Noto Sans TC" : "Noto Sans SC";
  return null;
}

// src/emit/island.ts
function emitIsland(slides) {
  const manifest = {
    slides: slides.map((s) => {
      const end = s.start + s.duration;
      const fragments = s.holds.map((h) => round2(s.start + h));
      for (const f of fragments) {
        if (f < s.start || f >= end) {
          throw new Error(
            `${s.sid}: fragment ${f}s is outside its slide window [${s.start}, ${end})`
          );
        }
      }
      const placed = { sceneId: s.sid, startTime: round2(s.start), endTime: round2(end) };
      return fragments.length > 0 ? { ...placed, notes: s.notes, fragments } : { ...placed, notes: s.notes };
    }),
    slideSequences: []
  };
  const json = JSON.stringify(manifest, null, 2).replace(/</g, "\\u003c");
  return `    <script type="application/hyperframes-slideshow+json">
${json}
    </script>`;
}
function round2(n3) {
  return Math.round(n3 * 1e3) / 1e3;
}

// src/emit/composition.ts
var GSAP_SRC = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
var KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex";
function layout(storyboard, source, format, opts = {}) {
  const beats = storyboard.beats.filter((b) => b.weight >= format.minWeight);
  if (beats.length === 0) {
    throw new Error(`no beat survives ${format.id}'s minWeight of ${format.minWeight}`);
  }
  const base = resolveTheme(opts.theme ?? storyboard.theme);
  const family = familyFor(storyboard.lang);
  const theme = family ? { ...base, fontStack: `"${family}", ${base.fontStack}` } : base;
  const speed = opts.speed ?? 1;
  const archetypeCss = /* @__PURE__ */ new Set();
  const scenes = [];
  const slides = [];
  const spoken = {};
  let start = 0;
  beats.forEach((beat, i) => {
    const sid = `s${i + 1}`;
    const ctx = { source, format, theme, sid };
    const scene = pace(emitScene(beat, ctx), speed);
    const segments = opts.narration?.beats[beat.id];
    if (segments?.length) spoken[sid] = segments;
    const seconds = beatSeconds(beat.seconds * speed, scene, segments);
    if (scene.css) archetypeCss.add(scene.css.trim());
    scenes.push(sceneHtml(sid, start, seconds, beat.params.headline, scene));
    slides.push({
      sid,
      start,
      duration: seconds,
      notes: beat.narration ?? beat.intent,
      holds: scene.holds
    });
    start += seconds;
  });
  return { family, theme, archetypeCss, scenes, slides, spoken, total: start };
}
function beatSeconds(authored, scene, segments) {
  if (!segments?.length) return authored;
  const lastHold = scene.holds.reduce((a, b) => Math.max(a, b), 0);
  const spoken = segments.reduce((sum, s) => sum + s.seconds, 0);
  return Math.max(authored, lastHold + spoken);
}
function emitComposition(storyboard, source, format, opts = {}) {
  const { family, theme, archetypeCss, scenes, slides, total } = layout(
    storyboard,
    source,
    format,
    opts
  );
  const hasImages = scenes.some((html) => html.includes("<img"));
  const orientation = format.width > format.height ? "landscape" : format.width < format.height ? "portrait" : "square";
  const fontLink = family ? `
    <link rel="stylesheet" href="${FONT_BUNDLE_HREF}" />` : "";
  const island = format.navigable ? `
${emitIsland(slides)}` : "";
  return `<!doctype html>
<html lang="${esc(storyboard.lang)}" data-resolution="${orientation}">
  <head>
    <meta charset="UTF-8" />
    <title>${esc(storyboard.title)}</title>
    <meta name="viewport" content="width=${format.width}, height=${format.height}" />
    <script src="${GSAP_SRC}"></script>
    <link rel="stylesheet" href="${KATEX}.min.css" />
    <script src="${KATEX}.min.js"></script>${fontLink}
    <style>
${baseCss(theme, format)}
${[...archetypeCss].map(indent).join("\n")}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${t(total)}"
      data-width="${format.width}"
      data-height="${format.height}"
    >
${scenes.join("\n")}
      <script>
        (function () {
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          // Spans the deck. All real motion lives on the per-scene timelines.
          tl.to({}, { duration: ${t(total)} });
          window.__timelines["main"] = tl;
        })();
      </script>${readyGate(hasImages)}
    </div>${island}
  </body>
</html>
`;
}
function readyGate(hasImages) {
  if (!hasImages) return "";
  return `
      <script>
        window.__renderReady = false;
        Promise.all(
          Array.prototype.map.call(document.images, function (img) {
            return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
          }),
        ).then(function () {
          window.__renderReady = true;
        });
      </script>`;
}
function sceneHtml(sid, start, duration, label, scene) {
  const setup = (scene.setup ?? []).map(statement).join("\n            ");
  const timeline = scene.tl.map(statement).join("\n            ");
  return `      <div
        id="${sid}"
        class="scene clip"
        data-composition-id="${sid}"
        data-start="${t(start)}"
        data-duration="${t(duration)}"
        data-label="${esc(label)}"
      >
${scene.html}
        <script>
          (function () {
            ${setup}
            window.__timelines = window.__timelines || {};
            // Each scene owns a paused timeline under its own composition id, with
            // times relative to its start \u2014 one absolute root timeline yields a
            // deck the slideshow controller cannot bind to.
            var tl = gsap.timeline({ paused: true });
            ${timeline}
            window.__timelines["${sid}"] = tl;
          })();
        </script>
      </div>`;
}
function statement(s) {
  const line2 = s.trim().startsWith(".") ? `tl${s.trim()}` : s.trim();
  return line2.endsWith(";") ? line2 : `${line2};`;
}
function indent(css) {
  return css.replace(/^/gm, "      ");
}
function t(n3) {
  return String(Math.round(n3 * 1e3) / 1e3);
}

// src/types.ts
import { z } from "zod";
var refSchema = z.object({
  kind: z.enum(["figure", "equation", "table", "section"]),
  id: z.string()
});
var figureSchema = z.object({
  id: z.string(),
  /** Path relative to the deck's asset directory. */
  src: z.string(),
  caption: z.string(),
  width: z.int().positive(),
  height: z.int().positive()
});
var equationSchema = z.object({
  id: z.string(),
  tex: z.string(),
  display: z.boolean()
});
var tableSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string()))
});
var sectionSchema = z.object({
  id: z.string(),
  depth: z.int().min(1).max(6),
  heading: z.string(),
  /** Prose under this heading, with figures/equations/tables lifted out. */
  text: z.string()
});
var sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** BCP-47. Drives font subsetting and the language of generated copy. */
  lang: z.string().default("en"),
  sections: z.array(sectionSchema),
  figures: z.array(figureSchema),
  equations: z.array(equationSchema),
  tables: z.array(tableSchema)
});
var termSchema = z.object({
  /** Exactly as it appears in the TeX, e.g. "R" or "\\mathcal{E}". */
  tex: z.string(),
  label: z.string(),
  tone: z.enum(["a", "b", "c", "d"])
});
var titleParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  sub: z.string().optional()
});
var claimFigureParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  claim: z.string(),
  figureId: z.string()
});
var equationWalkParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  equationId: z.string(),
  /** Walked in order, one hold-point each. */
  terms: z.array(termSchema).min(1).max(4)
});
var dataTableParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  tableId: z.string(),
  /** Row labels (first-column values) to emphasise, in reveal order. */
  highlight: z.array(z.object({ row: z.string(), tone: z.enum(["a", "b", "c", "d"]) })).max(4),
  note: z.string().optional()
});
var lineChartParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  xLabel: z.string(),
  yLabel: z.string(),
  points: z.array(z.object({ x: z.string(), y: z.number() })).min(2),
  /** Inter-point annotations, e.g. per-step deltas. One fewer than `points`. */
  deltas: z.array(z.string()).optional(),
  readout: z.string().optional()
});
var calloutParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  panels: z.array(z.object({ label: z.string(), lines: z.array(z.string()) })).min(1).max(3),
  note: z.string().optional()
});
var tone = z.enum(["a", "b", "c", "d"]);
var stageSchema = z.object({
  label: z.string(),
  /** One short line under the label — a shape, a count, a rate. */
  note: z.string().optional(),
  tone: tone.optional()
});
var pipelineParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  /** Drawn left to right, arrowed, revealed one at a time. */
  stages: z.array(stageSchema).min(2).max(6),
  /**
   * A labelled feedback arrow routed below the row, from stage `from` back to
   * stage `to` (both 0-based). `from` defaults to the last stage.
   *
   * It is not optional decoration: a recurrent block in the middle of a pipeline
   * is the most common thing this archetype is asked to draw, and looping from
   * the end instead draws a claim the method does not make — the tick appearing
   * to pass through every later stage.
   */
  loop: z.object({ from: z.int().min(0).optional(), to: z.int().min(0), label: z.string() }).optional(),
  note: z.string().optional()
});
var annotatedFigureParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  figureId: z.string(),
  /**
   * Show only this region of the figure, as fractions of the whole, scaled to
   * fill the plate.
   *
   * A paper figure is drawn to be read at A4 with the reader's nose a foot away:
   * its internal type lands around 12px on a 1920 canvas, which is invisible
   * from the back of a room and which no automated gate can see, because the
   * text is pixels in a raster rather than DOM the contrast gate can measure.
   * Cropping to the panel actually under discussion is what a presenter does
   * with a laser pointer, and it is the difference between showing a figure and
   * using one. `notes` stay in whole-figure coordinates — the emitter maps them.
   */
  crop: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.05).max(1),
    h: z.number().min(0.05).max(1)
  }).optional(),
  /**
   * Leader lines drawn onto the figure and revealed in turn. `x`/`y` are
   * fractions of the figure's own box, so they survive any layout decision.
   */
  notes: z.array(
    z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      text: z.string(),
      tone: tone.optional()
    })
  ).min(1).max(5)
});
var gridParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  cols: z.int().min(2).max(24),
  rows: z.int().min(1).max(16),
  /** Cell-space rectangles lit in turn: windows, patches, tokens, receptive fields. */
  regions: z.array(
    z.object({
      x: z.int().min(0),
      y: z.int().min(0),
      w: z.int().min(1),
      h: z.int().min(1),
      label: z.string(),
      tone
    })
  ).min(1).max(4),
  note: z.string().optional()
});
var barCompareParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  unit: z.string().optional(),
  /** Grown from zero in order. A magnitude comparison beats a table of figures. */
  bars: z.array(z.object({ label: z.string(), value: z.number(), tone: tone.optional() })).min(2).max(8),
  note: z.string().optional()
});
var stackParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  /** Drawn bottom-up as offset planes, revealed in order. */
  layers: z.array(z.object({ label: z.string(), note: z.string().optional() })).min(2).max(7),
  note: z.string().optional()
});
var splitCompareParamsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string(),
  left: z.object({
    label: z.string(),
    figureId: z.string().optional(),
    lines: z.array(z.string()).optional()
  }),
  right: z.object({
    label: z.string(),
    figureId: z.string().optional(),
    lines: z.array(z.string()).optional()
  }),
  note: z.string().optional()
});
var beatCore = {
  id: z.string(),
  /** What the viewer should understand after this beat. */
  intent: z.string(),
  /** The source sentence or equation this beat is accountable to. */
  claim: z.string().optional(),
  evidence: z.array(refSchema).default([]),
  narration: z.string().optional(),
  /** Salience, 0–1. Decides what survives a 30-second cut. */
  weight: z.number().min(0).max(1).default(0.5),
  /** Seconds this beat holds in a linear render. Deck mode is human-paced. */
  seconds: z.number().positive().max(60).default(7)
};
var beatSchema = z.discriminatedUnion("archetype", [
  z.object({ ...beatCore, archetype: z.literal("title"), params: titleParamsSchema }),
  z.object({ ...beatCore, archetype: z.literal("claim-figure"), params: claimFigureParamsSchema }),
  z.object({
    ...beatCore,
    archetype: z.literal("equation-walk"),
    params: equationWalkParamsSchema
  }),
  z.object({ ...beatCore, archetype: z.literal("data-table"), params: dataTableParamsSchema }),
  z.object({ ...beatCore, archetype: z.literal("line-chart"), params: lineChartParamsSchema }),
  z.object({ ...beatCore, archetype: z.literal("callout"), params: calloutParamsSchema }),
  z.object({ ...beatCore, archetype: z.literal("pipeline"), params: pipelineParamsSchema }),
  z.object({
    ...beatCore,
    archetype: z.literal("annotated-figure"),
    params: annotatedFigureParamsSchema
  }),
  z.object({ ...beatCore, archetype: z.literal("grid"), params: gridParamsSchema }),
  z.object({ ...beatCore, archetype: z.literal("bar-compare"), params: barCompareParamsSchema }),
  z.object({ ...beatCore, archetype: z.literal("stack"), params: stackParamsSchema }),
  z.object({
    ...beatCore,
    archetype: z.literal("split-compare"),
    params: splitCompareParamsSchema
  })
]);
var storyboardSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  lang: z.string().default("en"),
  theme: z.string().default("ink"),
  beats: z.array(beatSchema).min(1)
});
var prefsSchema = z.object({
  /* --- planning --- */
  /** Target beat count. The planner treats it as a target, not a quota. */
  slides: z.int().min(3).max(40).default(12),
  /** BCP-47. Drives the copy, the TTS voice, and the font subset. */
  lang: z.string().default("en"),
  /** Register of the written copy and the narration. */
  tone: z.enum(["plain", "academic", "conversational", "punchy"]).default("plain"),
  /** How much text a slide may carry before it should have been a diagram. */
  density: z.enum(["sparse", "normal", "dense"]).default("normal"),
  /* --- look --- */
  theme: z.string().default("ink"),
  /** Multiplies every emitted tween duration. Below 1 is faster. */
  animationSpeed: z.number().min(0.25).max(3).default(1),
  /* --- narration --- */
  narration: z.object({
    enabled: z.boolean().default(false),
    /** Explicit edge-tts voice. Omitted means "pick one for `lang` and `tone`". */
    voice: z.string().optional(),
    /** edge-tts prosody, e.g. "+10%" / "-5%". */
    rate: z.string().default("+0%"),
    pitch: z.string().default("+0Hz"),
    subtitles: z.boolean().default(true)
  }).default({ enabled: false, rate: "+0%", pitch: "+0Hz", subtitles: true })
});
var cueSchema = z.object({
  /** Seconds from the start of this segment's audio. */
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string()
});
var segmentSchema = z.object({
  /** Stop index within the beat: 0 is the beat's landing, 1..n its reveals. */
  stop: z.int().min(0),
  text: z.string(),
  /** Path relative to the deck's audio directory. */
  audio: z.string(),
  seconds: z.number().positive(),
  cues: z.array(cueSchema)
});
var narrationSchema = z.object({
  voice: z.string(),
  beats: z.record(z.string(), z.array(segmentSchema))
});
var mediaSchema = z.object({
  id: z.string(),
  policy: z.enum(["bake", "link", "embed"]),
  /** Present for `bake`: path inside the pack. */
  path: z.string().optional(),
  /** Present for `link` and `embed`. */
  url: z.string().optional(),
  mime: z.string().optional(),
  bytes: z.int().nonnegative().optional()
});
var PACK_VERSION = 1;
var packSchema = z.object({
  version: z.literal(PACK_VERSION),
  createdAt: z.string(),
  title: z.string(),
  prefs: prefsSchema,
  source: sourceSchema,
  storyboard: storyboardSchema,
  narration: narrationSchema.optional(),
  media: z.array(mediaSchema).default([])
});
var FORMATS = {
  "deck-16x9": { id: "deck-16x9", width: 1920, height: 1080, minWeight: 0, navigable: true },
  "video-16x9": { id: "video-16x9", width: 1920, height: 1080, minWeight: 0, navigable: false },
  "short-9x16": { id: "short-9x16", width: 1080, height: 1920, minWeight: 0.6, navigable: false },
  "post-1x1": { id: "post-1x1", width: 1080, height: 1080, minWeight: 0.7, navigable: false }
};
export {
  FORMATS,
  baseCss,
  emitComposition,
  emitIsland,
  emitScene,
  pace,
  resolveTheme
};

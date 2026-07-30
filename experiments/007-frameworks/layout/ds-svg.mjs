// src/emit/kit.ts
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const t = vertical ? to : { x: to.y, y: to.x };
  const end = { x: t.x, y: t.y - Math.sign(t.y - o.via) * (o.inset ?? 0) };
  const legs = [Math.abs(o.via - f.y), Math.abs(t.x - f.x), Math.abs(end.y - o.via)];
  const r = Math.min(o.radius ?? 18, ...legs.map((l) => l / 2));
  const p = (x, y) => vertical ? `${n(x)},${n(y)}` : `${n(y)},${n(x)}`;
  let d;
  if (r < 1) {
    d = `M${p(f.x, f.y)} L${p(f.x, o.via)} L${p(end.x, o.via)} L${p(end.x, end.y)}`;
  } else {
    const s1 = Math.sign(o.via - f.y);
    const s2 = Math.sign(t.x - f.x);
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
export {
  MIN_FONT,
  arrow,
  arrowDefs,
  circle,
  drawFrom,
  elbow,
  fitBoxes,
  group,
  id,
  line,
  n,
  path,
  rect,
  roundRect,
  svg,
  text,
  textWidth,
  tracks,
  wrap
};

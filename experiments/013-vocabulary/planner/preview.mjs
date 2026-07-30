/**
 * Render a compositional plan to SVG frames, one per hold, as a pure function
 * of t — which is also a cheap proof that the vocabulary IS seek-evaluable.
 * Nothing here is a callback; every property is read off the fromTo windows.
 *
 *   node preview.mjs runs/B-03/out.json > out/B-03.html
 */
import { readFileSync } from "node:fs";

const TONES = { a: "#5b8dff", b: "#ff8a5b", c: "#4fd1a5", d: "#c77dff", muted: "#8a8f98" };
const W = 1920;
const H = 1080;

function ease(name, p) {
  switch (name) {
    case "out":
      return 1 - (1 - p) ** 3;
    case "inOut":
      return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
    case "back":
      return 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
    default:
      return p;
  }
}

/** State of every object at absolute scene time t. Pure. */
function stateAt(scene, t) {
  const st = new Map();
  for (const o of scene.objects)
    st.set(o.id, {
      opacity: o.opacity ?? 1,
      scale: 1,
      growX: 1,
      growY: 1,
      pos: { ...o.at },
      stroke: 1,
      tone: o.tone ?? "muted",
      emph: null,
    });
  for (const an of scene.anims) {
    const s = st.get(an.target);
    if (!s) continue;
    const p = t <= an.start ? 0 : t >= an.start + an.dur ? 1 : (t - an.start) / an.dur;
    const e = ease(an.ease, p);
    switch (an.op) {
      case "fadeIn":
        s.opacity = e;
        break;
      case "fadeOut":
        s.opacity = 1 - e;
        break;
      case "draw":
        s.stroke = e;
        if (p > 0) s.opacity = Math.max(s.opacity, 1);
        break;
      case "growFrom":
        if (an.anchor === "left" || an.anchor === "right") s.growX = e;
        else s.growY = e;
        break;
      case "scaleTo":
        s.scale = 1 + ((an.to ?? 1) - 1) * e;
        break;
      case "moveTo":
        if (an.toPos) {
          s.pos = {
            x: s.pos.x + (an.toPos.x - s.pos.x) * e,
            y: s.pos.y + (an.toPos.y - s.pos.y) * e,
          };
        }
        break;
      case "recolor":
        if (e > 0.5 && an.toTone) s.tone = an.toTone;
        break;
      case "highlight":
        if (p > 0 && p < 1.0001 && t >= an.start) s.emph = an.part;
        break;
    }
  }
  return st;
}

function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
}

function frame(scene, t) {
  const st = stateAt(scene, t);
  const out = [`<rect width="${W}" height="${H}" fill="#12141a"/>`];
  for (const o of scene.objects) {
    const s = st.get(o.id);
    if (s.opacity <= 0.01) continue;
    const col = TONES[s.tone] ?? "#8a8f98";
    const cx = s.pos.x * W;
    const cy = s.pos.y * H;
    const g = `opacity="${s.opacity.toFixed(3)}"`;
    if (o.kind === "rect" || o.kind === "ellipse") {
      const w = (o.size?.w ?? 0.1) * W * s.scale * s.growX;
      const h = (o.size?.h ?? 0.1) * H * s.scale * s.growY;
      // growFrom "bottom" keeps the baseline fixed
      const bottom = cy + ((o.size?.h ?? 0.1) * H) / 2;
      const y = o.kind === "rect" && s.growY < 1 ? bottom - h : cy - h / 2;
      const fill = o.fill === "tone" ? col : o.fill === "surface" ? "#1d212b" : "none";
      out.push(
        o.kind === "rect"
          ? `<rect ${g} x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${col}" stroke-width="3"/>`
          : `<ellipse ${g} cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${col}" stroke-width="3"/>`,
      );
    } else if (o.kind === "arrow" || o.kind === "polyline") {
      const pts = (o.points ?? []).map((p) => [p.x * W, p.y * H]);
      if (pts.length < 2) continue;
      let len = 0;
      for (let i = 1; i < pts.length; i++)
        len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
      out.push(
        `<path ${g} d="${d}" fill="none" stroke="${col}" stroke-width="4" stroke-dasharray="${len}" stroke-dashoffset="${(len * (1 - s.stroke)).toFixed(1)}"${o.kind === "arrow" ? ' marker-end="url(#ah)"' : ""}/>`,
      );
    } else if (o.kind === "text") {
      const px = (o.fontPx ?? 48) * s.scale;
      out.push(
        `<text ${g} x="${cx}" y="${cy + px * 0.35}" font-size="${px}" font-family="Inter, system-ui, sans-serif" fill="${col}" text-anchor="middle">${esc(o.text ?? "")}</text>`,
      );
    } else if (o.kind === "tex") {
      const px = o.fontPx ?? 56;
      out.push(
        `<text ${g} x="${cx}" y="${cy + px * 0.35}" font-size="${px}" font-family="Latin Modern Math, Cambria Math, serif" fill="${col}" text-anchor="middle">${esc(o.tex ?? "")}</text>`,
      );
      if (s.emph)
        out.push(
          `<text x="${cx}" y="${cy - px}" font-size="34" fill="#ffd166" text-anchor="middle">highlight: ${esc(s.emph)}</text>`,
        );
    } else if (o.kind === "image") {
      const w = (o.size?.w ?? 0.3) * W;
      const h = (o.size?.h ?? 0.3) * H;
      out.push(
        `<rect ${g} x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="#2a2f3a" stroke="#555"/><text ${g} x="${cx}" y="${cy}" font-size="40" fill="#aaa" text-anchor="middle">${esc(o.figureId ?? "image")}</text>`,
      );
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="640"><defs><marker id="ah" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8 z" fill="#8a8f98"/></marker></defs>${out.join("")}</svg>`;
}

const comp = JSON.parse(readFileSync(process.argv[2], "utf8"));
const parts = [
  `<style>body{background:#0b0d12;color:#ddd;font:14px system-ui;margin:20px}svg{border:1px solid #333;margin:6px}h2{margin:24px 0 4px}</style>`,
];
for (const sc of comp.scenes) {
  parts.push(`<h2>${esc(sc.id)} — ${sc.seconds}s, holds ${sc.holds.join(", ")}</h2>`);
  parts.push(`<div>${esc(sc.narration)}</div>`);
  for (const h of sc.holds) parts.push(`<div style="display:inline-block">t=${h}s${frame(sc, h)}</div>`);
}
process.stdout.write(parts.join("\n"));

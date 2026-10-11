/**
 * scale — reported quantities as lengths to scale, no growth.
 */
import { type KindImpl, LAB_H, lab, spread, stepStarts, widthOf } from "../kind.js";
import { tiles } from "../kinds-shared.js";
import { baseCss, LABEL, label, px, r3, SMALL, Tl } from "../kit.js";

interface ScaleData {
  groups: Array<{ label: string; unit: string; items: Array<{ label: string; value: string }> }>;
  tile: boolean;
}

/** place, measure length: reported quantities as lengths to scale. */
export const lengthsForm: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const s = (spec.data as { lengths?: ScaleData }).lengths;
    if (!s) throw new Error("literal: place measure length needs `lengths`");
    const tones = [theme.tones.a, theme.tones.b, theme.tones.c, theme.tones.d];
    const nameW =
      Math.max(...s.groups.flatMap((g) => g.items.map((it) => widthOf(it.label, LABEL, theme)))) +
      48;
    const valW =
      Math.max(
        ...s.groups.flatMap((g) =>
          g.items.map((it) => widthOf(`${it.value} ${g.unit}`, LABEL, theme)),
        ),
      ) + 48;
    const barX = nameW;
    const barW = W - nameW - valW;
    const tileH = 120;
    const caption = lab("place", spec, "caption");
    const tiled = (g: ScaleData["groups"][number]) =>
      s.tile && tiles(g.items.map((it) => Number(it.value))) ? tileH : 0;
    // A row is as tall as the region allows, between a label's height and a generous 150px, and
    // the whole is centred: the lengths are the scene, so they take the frame.
    const fixed =
      s.groups.reduce((a, g) => a + LAB_H + 10 + tiled(g) + 48, 0) + (caption ? LAB_H : 0);
    const items = s.groups.reduce((a, g) => a + g.items.length, 0);
    const rowH = Math.max(64, Math.min(150, (H - fixed) / Math.max(1, items)));
    const barH = Math.min(84, rowH - 24);
    const groupH = (g: ScaleData["groups"][number]) =>
      LAB_H + 10 + g.items.length * rowH + tiled(g) + 48;
    const total = s.groups.reduce((a, g) => a + groupH(g), 0) + (caption ? LAB_H : 0);
    const parts: string[] = [];
    let y = Math.max(0, (H - total) / 2);
    const rowTop = (gy: number, i: number) => gy + LAB_H + 10 + i * rowH;
    const groupY: number[] = [];
    s.groups.forEach((g, gi) => {
      groupY.push(y);
      const vals = g.items.map((it) => Number(it.value));
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      parts.push(label(`g${gi}`, `${g.label} (${g.unit})`, 0, y, LABEL, theme.fg));
      g.items.forEach((it, i) => {
        const yy = rowTop(y, i);
        const len = r3((Number(it.value) / max) * barW);
        const tone = tones[i % tones.length] as string;
        parts.push(
          `<div id="SCENEID-i${gi}-${i}" style="position:absolute;left:0;top:${px(yy)};width:${px(W)};height:${px(rowH)}">${label(`n${gi}-${i}`, it.label, 0, (rowH - 52) / 2, LABEL, theme.fg)}<div style="position:absolute;left:${px(barX)};top:${px((rowH - barH) / 2)};width:${px(len)};height:${px(barH)};background:${tone};border-radius:4px"></div>${label(`v${gi}-${i}`, `${it.value} ${g.unit}`, barX + len + 24, (rowH - 52) / 2, LABEL, theme.fg)}</div>`,
        );
      });
      const n = s.tile ? tiles(vals) : 0;
      if (n) {
        // Copies of the smallest length laid along the largest: how many fit is the ratio.
        const unit = (min / max) * barW;
        const yy = rowTop(y, g.items.length) + 8;
        for (let k = 0; k < n; k++)
          parts.push(
            `<div id="SCENEID-u${gi}-${k}" style="position:absolute;left:${px(barX + k * unit)};top:${px(yy)};width:${px(unit - 6)};height:${px(barH * 0.7)};border:4px solid ${tones[1] as string};box-sizing:border-box;border-radius:4px"></div>`,
          );
        const ratio = `${g.items[vals.indexOf(max)]?.value} ÷ ${g.items[vals.indexOf(min)]?.value} = ${(max / min).toFixed(2)}`;
        parts.push(label(`r${gi}`, ratio, barX, yy + barH * 0.7 + 10, SMALL, theme.muted));
      } else if (g.items.length >= 2 && max > min) {
        // Too close to tile: the smallest length, outlined, is laid OVER the largest — what is
        // left uncovered is the difference, at the same scale.
        const iMin = vals.indexOf(min);
        const len = r3((min / max) * barW);
        parts.push(
          `<div id="SCENEID-o${gi}" style="position:absolute;left:${px(barX)};top:${px(rowTop(y, iMin) + (rowH - barH) / 2)};width:${px(len)};height:${px(barH)};border:5px solid ${theme.fg};box-sizing:border-box;border-radius:4px"></div>`,
          `<div id="SCENEID-d${gi}" style="position:absolute;left:${px(barX + len)};top:${px(rowTop(y, vals.indexOf(max)) + (rowH - barH) / 2 - 10)};width:${px(Math.max(6, barW - len))};height:${px(barH + 20)};border:4px dashed ${theme.fg};box-sizing:border-box;border-radius:4px"></div>`,
        );
      }
      y += groupH(g);
    });
    const markup = `<div id="SCENEID-lit">
${parts.join("\n")}
${caption ? label("cap", caption, 0, y, SMALL, theme.muted) : ""}
</div>`;
    const at = stepStarts(cues, s.groups.length);
    const ends = s.groups.map(
      (_, gi) => cues[gi + 1]?.t0 ?? cues[cues.length - 1]?.t1 ?? (at[gi] as number) + 8,
    );
    const tl = new Tl();
    let lastAt = 1.0;
    s.groups.forEach((g, gi) => {
      // The first group is there as the scene opens: the narration names it at once.
      const t0 = gi === 0 ? 0.1 : (at[gi] as number) + 0.2;
      const end = ends[gi] as number;
      // Every group is on screen from the start, quiet, so the frame is full at every stop;
      // a later group comes forward when it is spoken.
      if (gi === 0) {
        tl.show(`g${gi}`, t0, 0.5);
        for (let i = 0; i < g.items.length; i++) tl.show(`i${gi}-${i}`, t0 + 0.1 + i * 0.3, 0.6);
      } else {
        tl.fromTo(`g${gi}`, { opacity: 0 }, { opacity: 0.35, duration: 0.6 }, 0.6);
        for (let i = 0; i < g.items.length; i++)
          tl.fromTo(`i${gi}-${i}`, { opacity: 0 }, { opacity: 0.35, duration: 0.6 }, 0.7 + i * 0.1);
        tl.fromTo(
          `g${gi}`,
          { opacity: 0.35 },
          { opacity: 1, duration: 0.5, immediateRender: false },
          t0,
        );
        for (let i = 0; i < g.items.length; i++)
          tl.fromTo(
            `i${gi}-${i}`,
            { opacity: 0.35 },
            { opacity: 1, duration: 0.6, ease: "power2.out", immediateRender: false },
            t0 + 0.1 + i * 0.3,
          );
      }
      const vals = g.items.map((it) => Number(it.value));
      const n = s.tile ? tiles(vals) : 0;
      if (n) {
        // Laid one by one over the sentence that says the ratio.
        const ts = spread(Math.max(t0 + 2.0, (at[gi] as number) + 2.4), end, n + 1, 0.5, 1.6);
        for (let k = 0; k < n; k++) tl.show(`u${gi}-${k}`, ts[k] as number, 0.4);
        tl.show(`r${gi}`, ts[n] as number);
        lastAt = ts[n] as number;
      } else if (g.items.length >= 2 && Math.max(...vals) > Math.min(...vals)) {
        const iMin = vals.indexOf(Math.min(...vals));
        const iMax = vals.indexOf(Math.max(...vals));
        const o0 = t0 + 1.6;
        const od = Math.max(1.2, Math.min(2.6, (end - o0) * 0.3));
        tl.show(`o${gi}`, o0 - 0.4, 0.4);
        tl.fromTo(
          `o${gi}`,
          { y: 0 },
          { y: r3((iMax - iMin) * rowH), duration: od, ease: "sine.inOut", immediateRender: false },
          o0,
        );
        tl.show(`d${gi}`, o0 + od + 0.3, 0.6);
        lastAt = o0 + od + 0.9;
      }
    });
    if (caption) tl.show("cap", s.groups.length > 1 ? lastAt + 0.6 : 1.0);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

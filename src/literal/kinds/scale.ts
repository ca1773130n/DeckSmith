/**
 * scale — reported quantities as lengths to scale, no growth.
 */
import { type KindImpl, LAB_H, lab, stepStarts, widthOf } from "../kind.js";
import { tiles } from "../kinds-shared.js";
import { baseCss, LABEL, label, px, r3, SMALL, Tl } from "../kit.js";

interface ScaleData {
  groups: Array<{ label: string; unit: string; items: Array<{ label: string; value: string }> }>;
  tile: boolean;
}

export const scaleKind: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const s = spec.data as ScaleData;
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
    const caption = lab("scale", spec, "caption");
    const tiled = (g: ScaleData["groups"][number]) =>
      s.tile && tiles(g.items.map((it) => Number(it.value))) ? tileH : 0;
    // A row is as tall as the region allows, between a label's height and a roomy 104px.
    const fixed =
      s.groups.reduce((a, g) => a + LAB_H + 10 + tiled(g) + 48, 0) + (caption ? LAB_H : 0);
    const items = s.groups.reduce((a, g) => a + g.items.length, 0);
    const rowH = Math.max(64, Math.min(104, (H - fixed) / Math.max(1, items)));
    const barH = Math.min(60, rowH - 24);
    const groupH = (g: ScaleData["groups"][number]) =>
      LAB_H + 10 + g.items.length * rowH + tiled(g) + 48;
    const total = s.groups.reduce((a, g) => a + groupH(g), 0) + (caption ? LAB_H : 0);
    const parts: string[] = [];
    let y = Math.max(0, (H - total) / 2);
    s.groups.forEach((g, gi) => {
      const vals = g.items.map((it) => Number(it.value));
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      parts.push(label(`g${gi}`, `${g.label} (${g.unit})`, 0, y, LABEL, theme.fg));
      g.items.forEach((it, i) => {
        const yy = y + LAB_H + 10 + i * rowH;
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
        const yy = y + LAB_H + 10 + g.items.length * rowH + 8;
        for (let k = 0; k < n; k++)
          parts.push(
            `<div id="SCENEID-u${gi}-${k}" style="position:absolute;left:${px(barX + k * unit)};top:${px(yy)};width:${px(unit - 6)};height:${px(barH * 0.7)};border:4px solid ${tones[1] as string};box-sizing:border-box;border-radius:4px"></div>`,
          );
        const ratio = `${g.items[vals.indexOf(max)]?.value} ÷ ${g.items[vals.indexOf(min)]?.value} = ${(max / min).toFixed(2)}`;
        parts.push(label(`r${gi}`, ratio, barX, yy + barH * 0.7 + 10, SMALL, theme.muted));
      }
      y += groupH(g);
    });
    const markup = `<div id="SCENEID-lit">
${parts.join("\n")}
${caption ? label("cap", caption, 0, y, SMALL, theme.muted) : ""}
</div>`;
    const at = stepStarts(cues, s.groups.length);
    const tl = new Tl();
    s.groups.forEach((g, gi) => {
      // The first group is there as the scene opens: the narration names it at once.
      const t0 = gi === 0 ? 0.1 : (at[gi] as number) + 0.2;
      tl.show(`g${gi}`, t0, 0.5);
      g.items.forEach((_, i) => {
        tl.show(`i${gi}-${i}`, t0 + 0.1 + i * 0.3, 0.6);
      });
      const n = s.tile ? tiles(g.items.map((it) => Number(it.value))) : 0;
      if (n) {
        const t1 = Math.max(t0 + 2.0, (at[gi] as number) + 2.4);
        for (let k = 0; k < n; k++) tl.show(`u${gi}-${k}`, t1 + k * 0.5, 0.4);
        tl.show(`r${gi}`, t1 + n * 0.5);
      }
    });
    if (caption) tl.show("cap", 1.0);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

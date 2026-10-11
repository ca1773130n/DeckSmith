/**
 * ablation — the experiments a paper did not run, shown as the holes they
 * leave. Every combination of its components (one or two) is a cell: the
 * combinations the source reports carry its result, the rest are visibly empty
 * and say so. Each setting the source fixes is a line with ONE point on it —
 * the only value tested — and further comparisons it proposes are outlined.
 *
 * Nothing here is computed but the layout: the components, the reported
 * results, the settings' values and the proposals are the plan's, held to the
 * source by the truth gate. The empty cells are the point of the scene, not a
 * placeholder: they are what the next experiment would fill.
 */
import { type KindImpl, LAB_H, lab, spread, stepStarts, widthOf, wrap } from "../kind.js";
import { baseCss, LABEL, label, px, r3, SMALL, Tl } from "../kit.js";

export interface AblationData {
  components: string[];
  reported: Array<{ with: string[]; result: string }>;
  settings: Array<{ name: string; value: string }>;
  others: string[];
}

/** Every combination of the components, as the components each one keeps, in grid order. */
export function combinations(components: readonly string[]): string[][] {
  if (components.length < 1 || components.length > 2)
    throw new Error(`literal: ablation draws one or two components, got ${components.length}`);
  const [a, b] = components as [string, string | undefined];
  if (b === undefined) return [[a], []];
  return [[a, b], [a], [b], []];
}

/** The reported result of one combination, or undefined when the source reports none. */
export function resultOf(d: AblationData, keep: readonly string[]): string | undefined {
  const key = [...keep].sort().join("\u0000");
  for (const r of d.reported) {
    for (const c of r.with)
      if (!d.components.includes(c))
        throw new Error(`literal: ablation reports "${c}", which is not one of its components`);
    if ([...r.with].sort().join("\u0000") === key) return r.result;
  }
  return undefined;
}

export const ablationKind: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const K = "ablation";
    const d = spec.data as AblationData;
    const combos = combinations(d.components);
    const on = lab(K, spec, "on");
    const off = lab(K, spec, "off");
    const missing = lab(K, spec, "missing");
    const tested = d.settings.length ? lab(K, spec, "tested") : "";
    if (d.settings.length && !tested)
      throw new Error('literal: ablation draws settings and needs the label slot "tested"');
    const two = d.components.length === 2;
    // Left: the grid of combinations. Right: the settings, one line each. Below: proposals.
    const othersH = d.others.length ? 64 + 26 : 0;
    const gw = Math.round(W * (d.settings.length ? 0.5 : 1));
    const gh = H - othersH;
    const headW = two
      ? Math.max(
          widthOf(`${d.components[0]} ${on}`, SMALL, theme),
          widthOf(`${d.components[0]} ${off}`, SMALL, theme),
        ) + 28
      : 0;
    const cols = two ? 2 : 2;
    const rows = two ? 2 : 1;
    const cw = (gw - headW - 16 * (cols - 1)) / cols;
    // The cells take the grid's height: the holes are the scene.
    const ch = Math.min(340, (gh - LAB_H - 16 * (rows - 1)) / rows);
    const gy = LAB_H;
    const cellXY = (i: number): [number, number] =>
      two
        ? [headW + (i % 2) * (cw + 16), gy + Math.floor(i / 2) * (ch + 16)]
        : [headW + i * (cw + 16), gy];
    // Column heads: the second component on/off (or the only one); row heads: the first.
    const headCol = (c: number) =>
      two ? `${d.components[1]} ${c === 0 ? on : off}` : `${d.components[0]} ${c === 0 ? on : off}`;
    const heads = [0, 1]
      .map((c) => label(`hc${c}`, headCol(c), headW + c * (cw + 16) + 12, 0, SMALL, theme.fg))
      .join("");
    const rowHeads = two
      ? [0, 1]
          .map((r) =>
            label(
              `hr${r}`,
              `${d.components[0]} ${r === 0 ? on : off}`,
              0,
              gy + r * (ch + 16) + ch / 2 - 26,
              SMALL,
              theme.fg,
            ),
          )
          .join("")
      : "";
    const cells = combos
      .map((keep, i) => {
        const [x, y] = cellXY(i);
        const res = resultOf(d, keep);
        const words = wrap(res ?? missing, res ? LABEL : SMALL, cw - 40, theme);
        const lh = res ? 54 : 50;
        const ty = (ch - words.length * lh) / 2;
        const text = words
          .map((t, j) =>
            label(
              `ct${i}-${j}`,
              t,
              20,
              ty + j * lh,
              res ? LABEL : SMALL,
              res ? theme.accent : theme.muted,
            ),
          )
          .join("");
        const style = res
          ? `border:4px solid ${theme.accent};background:${theme.panel}`
          : `border:4px dashed ${theme.muted}`;
        return `<div id="SCENEID-cell${i}" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(cw)};height:${px(ch)};${style};border-radius:12px;box-sizing:border-box">${text}</div>`;
      })
      .join("\n");
    // Settings: a dashed line each — the range nobody tried — with the one value that was.
    const sx = gw + 64;
    const sw = W - sx;
    const sTitle = tested ? wrap(tested, LABEL, sw, theme) : [];
    const sTop = sTitle.length * 54 + 20;
    const sRow = d.settings.length ? Math.min(110, (gh - sTop) / d.settings.length) : 0;
    const settings = d.settings
      .map((st, i) => {
        const y = sTop + i * sRow + sRow / 2 + 14;
        const text = `${st.name} = ${st.value}`;
        const tw = widthOf(text, SMALL, theme);
        const box = `position:absolute;left:${px(sx)};top:0;width:${px(sw)};height:${px(gh)}`;
        const svg = (inner: string) =>
          `<svg width="${r3(sw)}" height="${r3(gh)}" viewBox="0 0 ${r3(sw)} ${r3(gh)}" style="left:0;top:0">${inner}</svg>`;
        return `<div id="SCENEID-s${i}" style="${box}">${svg(`<line x1="0" y1="${r3(y)}" x2="${r3(sw)}" y2="${r3(y)}" stroke="${theme.muted}" stroke-width="3" stroke-dasharray="10 10"/>`)}</div><div id="SCENEID-sp${i}" style="${box}">${svg(`<circle cx="${r3(sw / 2)}" cy="${r3(y)}" r="14" fill="${theme.accent}"/>`)}${label(`st${i}`, text, sw / 2 - tw / 2, y - 64, SMALL, theme.fg)}</div>`;
      })
      .join("\n");
    const titles = sTitle.map((t, i) => label(`sh${i}`, t, sx, i * 54, LABEL, theme.fg)).join("");
    // Proposals: outlined, along the bottom.
    let ox = 0;
    const others = d.others
      .map((t, i) => {
        const w = widthOf(t, SMALL, theme) + 44;
        const x = ox;
        ox += w + 16;
        if (ox - 16 > W)
          throw new Error(
            `literal: ablation's proposals need ${Math.ceil(ox - 16)}px and the scene has ${W}px; shorten them`,
          );
        return `<div id="SCENEID-o${i}" style="position:absolute;left:${px(x)};top:${px(H - 64)};width:${px(w)};height:64px;border:3px dashed ${theme.muted};border-radius:32px;box-sizing:border-box">${label(`ot${i}`, t, 19, (58 - SMALL * 1.15) / 2, SMALL, theme.fg)}</div>`;
      })
      .join("\n");
    const markup = `<div id="SCENEID-lit">
${heads}${rowHeads}
${cells}
${titles}
${settings}
${others}
</div>`;
    // Steps: the grid on the first sentence; then the settings and the proposals, in order, over
    // the sentences that follow — each sentence takes its share, each item its moment in it.
    const items = [
      ...d.settings.map((_, i) => ({ id: `s${i}`, setting: true })),
      ...d.others.map((_, i) => ({ id: `o${i}`, setting: false })),
    ];
    const rest = items.length ? Math.max(1, Math.min(items.length, cues.length - 1)) : 0;
    const at = stepStarts(cues, 1 + rest);
    const end = cues[cues.length - 1]?.t1 ?? (at[rest] as number) + 6;
    const tl = new Tl();
    {
      const t0 = Math.max(0.8, (at[0] as number) + 0.1);
      const t1 = (at[1] as number | undefined) ?? end;
      for (const id of ["hc0", "hc1", ...(two ? ["hr0", "hr1"] : [])])
        tl.show(id, Math.min(0.4, t0), 0.5);
      // The reported combination first, then the holes, one by one.
      const order = combos
        .map((keep, i) => [i, resultOf(d, keep) !== undefined] as const)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([i]) => i);
      spread(t0 + 0.2, t1, order.length, 0.5, 1.8, 1.2).forEach((t, k) => {
        tl.fromTo(
          `cell${order[k]}`,
          { opacity: 0, scale: 0.92, transformOrigin: "50% 50%" },
          { opacity: 1, scale: 1, transformOrigin: "50% 50%", duration: 0.5, ease: "power2.out" },
          t,
        );
      });
    }
    const share = (k: number) =>
      items.filter((_, j) => Math.floor((j * rest) / items.length) === k);
    for (let k = 0; k < rest; k++) {
      const t0 = Math.max(1.2, (at[k + 1] as number) + 0.1);
      const t1 = (at[k + 2] as number | undefined) ?? end;
      const mine = share(k);
      if (k === 0 && d.settings.length)
        for (let i = 0; i < sTitle.length; i++) tl.show(`sh${i}`, t0, 0.5);
      spread(t0 + 0.4, t1, mine.length, 0.5, 3.6, 1.6).forEach((t, j) => {
        const it = mine[j] as (typeof items)[number];
        // A setting in two beats: the range nobody tried, then the one value that was.
        if (it.setting) {
          tl.fromTo(
            it.id,
            { opacity: 0, x: -24 },
            { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" },
            t,
          );
          tl.fromTo(
            `sp${it.id.slice(1)}`,
            { opacity: 0, y: -16 },
            { opacity: 1, y: 0, duration: 0.45, ease: "back.out(1.6)" },
            t + 1.2,
          );
        } else
          tl.fromTo(
            it.id,
            { opacity: 0, scale: 0.9, transformOrigin: "50% 50%" },
            {
              opacity: 1,
              scale: 1,
              transformOrigin: "50% 50%",
              duration: 0.5,
              ease: "back.out(1.6)",
            },
            t,
          );
      });
    }
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

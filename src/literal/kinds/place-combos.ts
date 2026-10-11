/**
 * ablation — the experiments a paper did not run, shown as the holes they
 * leave. Every combination of its components (one or two) is a square of one
 * small grid: the combinations the source reports are filled and their results
 * stand under the grid, large; the rest are visibly empty, and one quiet mark
 * says what an empty square means. Each setting the source fixes is its name and
 * the ONE value tested, as words (no axis: the source states no range), and
 * further comparisons it proposes are outlined.
 *
 * Nothing here is computed but the layout: the components, the reported
 * results, the settings' values and the proposals are the plan's, held to the
 * source by the truth gate. The empty cells are the point of the scene, not a
 * placeholder: they are what the next experiment would fill.
 */
import { drift, type KindImpl, lab, spread, stepStarts, widthOf, wrap } from "../kind.js";
import { baseCss, LABEL, label, px, SMALL, Tl } from "../kit.js";

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

/** place, form combos: the experiments a source did not run, as empty cells. */
export const combosForm: KindImpl = {
  picture: false,
  async layers() {
    return { files: {}, data: {} };
  },
  fragment(_L, { width: W, height: H }, cues, spec, theme) {
    const K = "place";
    const d = (spec.data as { combos?: AblationData }).combos;
    if (!d) throw new Error("literal: place form combos needs `combos`");
    const combos = combinations(d.components);
    const on = lab(K, spec, "on");
    const off = lab(K, spec, "off");
    const missing = lab(K, spec, "missing");
    const tested = d.settings.length ? lab(K, spec, "tested") : "";
    if (d.settings.length && !tested)
      throw new Error('literal: ablation draws settings and needs the label slot "tested"');
    const two = d.components.length === 2;
    const othersH = d.others.length ? 64 + 26 : 0;
    // The settings column is as wide as its words, between 28% and 54% of the scene; the grid
    // and its results take the rest. A fixed 54% left a 2x2 grid with three results 782px of
    // a 1700px scene for two short settings ("λ_l 1.0"), and the squares shrank to 46px.
    const sNeed = d.settings.length
      ? Math.max(
          widthOf(tested, LABEL, theme),
          ...d.settings.map(
            (st) => widthOf(st.name, SMALL, theme) + 32 + widthOf(st.value, LABEL, theme),
          ),
        )
      : 0;
    const gw = d.settings.length
      ? Math.round(W - 64 - Math.min(W * 0.54 - 64, Math.max(W * 0.28, sNeed)))
      : W;
    const gh = H - othersH;
    // Left: the combinations as one small grid of squares — no words in them, the holes are
    // the picture — with ONE quiet mark naming what an empty square means, and under it the
    // reported result, large. (An earlier version wrote "not reported" in three of four
    // cells: repeated empty text, review 2026-10-11.)
    // Heads in two lines — the component, then kept or removed — so a square need only be
    // as wide as the longer word, and the grid can shrink to the height it is given.
    const [ca, cb] = d.components as [string, string | undefined];
    const colName = two ? (cb as string) : ca;
    const headW = two ? Math.max(...[ca, on, off].map((t) => widthOf(t, SMALL, theme))) + 28 : 0;
    const colW = Math.max(...[colName, on, off].map((t) => widthOf(t, SMALL, theme)));
    const rows = two ? 2 : 1;
    const gy = 2 * 48 + 12;
    const holes = combos.filter((k) => resultOf(d, k) === undefined).length;
    const missLines = holes ? wrap(missing, SMALL, gw - 60, theme) : [];
    const missH = holes ? missLines.length * 50 + 28 : 0;
    // The reported results, at the deck's headline size: what the source did measure.
    const BIG = 56;
    const cellMax = Math.round(Math.min(220, (gw - headW - 16) / 2));
    const blocksIn = (w: number) =>
      d.reported.map((r) => ({
        name: wrap(r.with.length ? r.with.join(" + ") : off, SMALL, w, theme),
        value: wrap(r.result, BIG, w, theme),
      }));
    const n = d.reported.length;
    const layoutFor = (beside: boolean) => {
      const rx = beside ? headW + 2 * cellMax + 16 + 64 : 0;
      const rw = gw - rx;
      const stacked = blocksIn(rw);
      const stackedH = stacked.reduce(
        (a, b) => a + b.name.length * 50 + b.value.length * 66 + 20,
        0,
      );
      // Under the grid, the results side by side when each gets 240px and that is shorter than
      // stacking them: stacked, three results took 420px of a 714px scene and left 46px squares.
      const colR = Math.floor((rw - (n - 1) * 32) / Math.max(1, n));
      const row = !beside && n > 1 && colR >= 240 ? blocksIn(colR) : undefined;
      const rowNameH = row ? Math.max(...row.map((b) => b.name.length * 50)) : 0;
      const rowH = row ? rowNameH + Math.max(...row.map((b) => b.value.length * 66)) + 20 : 0;
      const across = row !== undefined && rowH < stackedH;
      const resH = across ? rowH : stackedH;
      const room = gh - gy - (rows - 1) * 16 - missH - (beside ? 0 : 12 + resH);
      const cell = Math.round(Math.min(cellMax, room / rows));
      const ok = cell >= Math.max(72, colW + 8) && !(beside && gy + resH - 20 > gh);
      const blocks = across ? (row as typeof stacked) : stacked;
      return { beside, rx, rw, colR, rowNameH, across, blocks, cell, ok };
    };
    // Beside the grid when there is the width and the results fit its height, else under it.
    const wide = gw - (headW + 2 * cellMax + 16) - 64 >= 360;
    const tries = wide ? [layoutFor(true), layoutFor(false)] : [layoutFor(false)];
    const lay = tries.find((t) => t.ok) ?? (tries[0] as (typeof tries)[number]);
    if (!lay.ok)
      throw new Error(
        `literal: ablation's grid and reported results do not fit ${Math.floor(gh)}px (squares of ${lay.cell}px); shorten the results or the component names`,
      );
    const { beside, rx, rw, colR, rowNameH, across, blocks, cell } = lay;
    const cellXY = (i: number): [number, number] =>
      two
        ? [headW + (i % 2) * (cell + 16), gy + Math.floor(i / 2) * (cell + 16)]
        : [headW + i * (cell + 16), gy];
    const heads = [0, 1]
      .map(
        (c) =>
          `${label(`hc${c}`, colName, headW + c * (cell + 16), 0, SMALL, theme.fg)}${label(`hc${c}b`, c === 0 ? on : off, headW + c * (cell + 16), 48, SMALL, theme.muted)}`,
      )
      .join("");
    const rowHeads = two
      ? [0, 1]
          .map((r) => {
            const y = gy + r * (cell + 16) + cell / 2 - 50;
            return `${label(`hr${r}`, ca, 0, y, SMALL, theme.fg)}${label(`hr${r}b`, r === 0 ? on : off, 0, y + 48, SMALL, theme.muted)}`;
          })
          .join("")
      : "";
    const cells = combos
      .map((keep, i) => {
        const [x, y] = cellXY(i);
        const style =
          resultOf(d, keep) !== undefined
            ? `background:${theme.accent};border:4px solid ${theme.accent}`
            : `border:4px dashed ${theme.muted}`;
        return `<div id="SCENEID-cell${i}" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(cell)};height:${px(cell)};${style};border-radius:10px;box-sizing:border-box"></div>`;
      })
      .join("\n");
    const gridB = gy + rows * cell + (rows - 1) * 16;
    const mY = gridB + 28;
    const mark = holes
      ? `<div id="SCENEID-miss" style="position:absolute;left:0;top:${px(mY)};width:${px(gw)};height:${px(missH - 28)}"><div style="position:absolute;left:0;top:6px;width:40px;height:40px;border:4px dashed ${theme.muted};border-radius:8px;box-sizing:border-box"></div>${missLines
          .map((t, j) => label(`mt${j}`, t, 60, j * 50, SMALL, theme.muted))
          .join("")}</div>`
      : "";
    let ry = beside ? gy : mY + missH + 12 - (holes ? 28 : 0);
    const reported = blocks
      .map(({ name, value }, i) => {
        // Across: one row, the values on one line under the tallest name.
        const nameH = across ? rowNameH : name.length * 50;
        const x = across ? i * (colR + 32) : rx;
        const y = ry;
        if (!across) ry += nameH + value.length * 66 + 20;
        return `<div id="SCENEID-rp${i}" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(across ? colR : rw)};height:${px(nameH + value.length * 66)}">${name
          .map((t, j) => label(`rn${i}-${j}`, t, 0, j * 50, SMALL, theme.muted))
          .join("")}${value
          .map((t, j) => label(`rv${i}-${j}`, t, 0, nameH + j * 66, BIG, theme.accent))
          .join("")}</div>`;
      })
      .join("\n");
    // Right: the settings the source fixed, each a name and the ONE value it was tested at,
    // as words — no axis, which would claim a range the source never states.
    const sx = gw + 64;
    const sw = W - sx;
    const sTitle = tested ? wrap(tested, LABEL, sw, theme) : [];
    const sTop = sTitle.length * 54 + 24;
    const nameW = Math.min(
      sw * 0.45,
      Math.max(0, ...d.settings.map((st) => widthOf(st.name, SMALL, theme))),
    );
    const vx = nameW + 32;
    const rowsOf = d.settings.map((st) => ({
      name: wrap(st.name, SMALL, nameW, theme),
      value: wrap(st.value, LABEL, sw - vx, theme),
    }));
    const need = rowsOf.reduce((a, r) => a + Math.max(r.name.length * 48, r.value.length * 54), 0);
    if (sTop + need > gh)
      throw new Error(
        `literal: ablation's settings need ${Math.ceil(sTop + need)}px and the scene has ${Math.floor(gh)}px; give fewer or shorter ones`,
      );
    const pad = d.settings.length ? Math.min(40, (gh - sTop - need) / d.settings.length) : 0;
    let sy = sTop;
    const settings = rowsOf
      .map((r, i) => {
        const h = Math.max(r.name.length * 48, r.value.length * 54);
        const y = sy;
        sy += h + pad;
        return `<div id="SCENEID-s${i}" style="position:absolute;left:${px(sx)};top:${px(y)};width:${px(sw)};height:${px(h)}">${r.name
          .map((t, j) => label(`sn${i}-${j}`, t, 0, 4 + j * 48, SMALL, theme.muted))
          .join(
            "",
          )}<div id="SCENEID-sv${i}" style="position:absolute;left:0;top:0;width:100%;height:100%">${r.value
          .map((t, j) => label(`sv${i}-${j}`, t, vx, j * 54, LABEL, theme.fg))
          .join("")}</div></div>`;
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
    const markup = `<div id="SCENEID-lit"><div id="SCENEID-acam" style="position:absolute;left:0;top:0;width:100%;height:100%">
${heads}${rowHeads}
${cells}
${mark}
${reported}
${titles}
${settings}
${others}
</div></div>`;
    // Steps: the grid on the first sentence — the reported square, its result, then the holes
    // and what they mean; then the settings and the proposals, in order, over the sentences
    // that follow — each sentence takes its share, each item its moment in it.
    const items = [...d.settings.map((_, i) => `s${i}`), ...d.others.map((_, i) => `o${i}`)];
    const rest = items.length ? Math.max(1, Math.min(items.length, cues.length - 1)) : 0;
    const at = stepStarts(cues, 1 + rest);
    const end = cues[cues.length - 1]?.t1 ?? (at[rest] as number) + 6;
    const tl = new Tl();
    // Once a sentence's items are all there, the camera leans in, or back out, over what is
    // left of it, from the top-left so nothing leaves the region: a list has no picture to
    // move, and r3 of the pure-planner deck stood still here for 6–7s a sentence.
    let lean = 1;
    const tail = (from: number, to: number) => {
      if (to - from < 1.5) return;
      const next = lean === 1 ? 1.03 : 1;
      drift(
        tl,
        "acam",
        from,
        to,
        { x: 0, y: 0, scale: next },
        { x: 0, y: 0, scale: lean },
        "0% 0%",
      );
      lean = next;
    };
    {
      const t0 = Math.max(0.8, (at[0] as number) + 0.1);
      const t1 = (at[1] as number | undefined) ?? end;
      for (const id of [
        "hc0",
        "hc0b",
        "hc1",
        "hc1b",
        ...(two ? ["hr0", "hr0b", "hr1", "hr1b"] : []),
      ])
        tl.show(id, Math.min(0.4, t0), 0.5);
      const order = combos
        .map((keep, i) => [i, resultOf(d, keep) !== undefined] as const)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([i]) => i);
      const ids = [
        `cell${order[0]}`,
        ...d.reported.map((_, i) => `rp${i}`),
        ...order.slice(1).map((i) => `cell${i}`),
        ...(holes ? ["miss"] : []),
      ];
      const times = spread(t0 + 0.2, t1, ids.length, 0.5, 1.8, 1.2);
      tail((times[times.length - 1] as number) + 0.6, t1 - 0.1);
      times.forEach((t, k) => {
        const id = ids[k] as string;
        if (id.startsWith("cell"))
          tl.fromTo(
            id,
            { opacity: 0, scale: 0.85, transformOrigin: "50% 50%" },
            { opacity: 1, scale: 1, transformOrigin: "50% 50%", duration: 0.5, ease: "power2.out" },
            t,
          );
        else tl.show(id, t, 0.6, { from: { y: 12 }, to: { y: 0 } });
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
      const times = spread(t0 + 0.4, t1, mine.length, 0.5, 3.6, 1.6);
      if (times.length) tail((times[times.length - 1] as number) + 1.8, t1 - 0.1);
      times.forEach((t, j) => {
        const id = mine[j] as string;
        // A setting in two beats: what was fixed, then the one value it was tested at.
        if (id.startsWith("s")) {
          tl.fromTo(
            id,
            { opacity: 0, x: -24 },
            { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" },
            t,
          );
          tl.fromTo(`sv${id.slice(1)}`, { opacity: 0 }, { opacity: 1, duration: 0.6 }, t + 1.2);
        } else
          tl.fromTo(
            id,
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

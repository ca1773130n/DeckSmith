/**
 * recap — the earlier scenes' own computed layers, small, in order.
 */
import { even, img, type KindImpl, lab, panel, stepStarts, wrap } from "../kind.js";
import { baseCss, LABEL, label, SMALL, Tl } from "../kit.js";

export const recapKind: KindImpl = {
  picture: false,
  async layers({ spec, earlier }) {
    const ids = (spec.data as { beats: string[] }).beats;
    const files: Record<string, string> = {};
    const names: string[] = [];
    for (const id of ids) {
      const thumb = earlier.get(id)?.layers.files.thumb;
      if (!thumb)
        throw new Error(`literal: the recap names ${id}, which drew no literal scene before it`);
      files[`p${names.length}`] = thumb;
      names.push(id);
    }
    return { files, data: { beats: names } };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const d = L.data as { beats: string[] };
    const f = L.files as Record<string, string>;
    const n = d.beats.length;
    // The summary's last word: what the source reports came of it (its own numbers), after the steps.
    const result = lab("recap", spec, "result");
    const cols = n <= 3 ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / cols);
    const gap = 64;
    const capH = 64;
    // Two rows of tiles take the region's height and the result stands to their right; one row
    // takes its width and the result goes under it. Either way the scene fills its region
    // (r1's 2×2 above a full-width result line left most of the frame empty).
    const beside = rows > 1 && !!result;
    const tileH = (H - rows * capH - (rows - 1) * 32) / rows;
    const tw = even(
      beside
        ? Math.min(tileH * 1.5, (W * 0.62 - (cols - 1) * gap) / cols)
        : Math.min((W - (cols - 1) * gap) / cols, (tileH - (result ? 140 : 0) / rows) * 1.5),
    );
    const th = even(tw / 1.5);
    const gw = cols * tw + (cols - 1) * gap;
    const gh = rows * (th + capH) + (rows - 1) * 32;
    const rx = beside ? gw + gap : 0;
    const resultLines = result ? wrap(result, LABEL, W - rx, theme) : [];
    const ry = beside ? Math.max(0, gh - capH - resultLines.length * 58) : gh + 24;
    const words = lab("recap", spec, "caption")
      .split("→")
      .map((s) => s.trim())
      .filter(Boolean);
    const at = stepStarts(cues, n + (resultLines.length ? 1 : 0));
    // Left-aligned, like the headline above it.
    const pos = (i: number) =>
      [(i % cols) * (tw + gap), Math.floor(i / cols) * (th + capH + 32)] as const;
    const tilesMarkup = d.beats
      .map((_, i) => {
        const [x, y] = pos(i);
        const text = `${i + 1}  ${words[i] ?? ""}`;
        return `${panel(`p${i}`, x, y, tw, th, img(`p${i}-i`, href(f[`p${i}`] as string), 0, 0, tw, th), "lit-dark")}
${label(`w${i}`, text, x, y + th + 10, SMALL, theme.fg)}`;
      })
      .join("\n");
    const resultMarkup = resultLines
      .map((t, i) => label(`r${i}`, t, rx, ry + i * 58, LABEL, theme.accent))
      .join("");
    const markup = `<div id="SCENEID-lit">\n${tilesMarkup}\n${resultMarkup}\n</div>`;
    const tl = new Tl();
    d.beats.forEach((_, i) => {
      const t0 = Math.max(0.2, (at[i] as number) + 0.1);
      tl.show(`p${i}`, t0, 0.7);
      tl.show(`w${i}`, t0 + 0.3);
    });
    for (let i = 0; i < resultLines.length; i++) tl.show(`r${i}`, (at[n] as number) + 0.2, 0.6);
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

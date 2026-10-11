/**
 * recap — the earlier scenes' own computed layers, in order: every one as a tile,
 * the one being spoken also large, then the result the source reports.
 */
import { drift, even, img, type KindImpl, lab, panel, stepStarts, wrap } from "../kind.js";
import { baseCss, LABEL, label, ON_PHOTO, px, SMALL, Tl } from "../kit.js";

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
    const words = lab("recap", spec, "caption")
      .split("→")
      .map((s) => s.trim())
      .filter(Boolean);
    // Every earlier scene as a tile on the left, all there from the start; the one being spoken
    // is ALSO shown large on the right, under a slow close look — the summary told with the
    // pictures, at a size that reads (r1's 440px tiles left half the frame empty). The result
    // takes the large view's place at the end.
    const cols = n <= 2 ? 1 : 2;
    const rows = Math.ceil(n / cols);
    const gap = 28;
    const capH = 56;
    const tw = even(
      Math.min(
        (W * 0.4 - (cols - 1) * gap) / cols,
        ((H - rows * capH - (rows - 1) * gap) / rows) * 1.5,
      ),
    );
    const th = even(tw / 1.5);
    const gw = cols * tw + (cols - 1) * gap;
    const bx = gw + 64;
    const bh = even(Math.min(H, (W - bx) / 1.5));
    const bw = even(bh * 1.5);
    const resultLines = result ? wrap(result, LABEL, bw - 80, theme) : [];
    const ry = (bh - resultLines.length * 58) / 2;
    const at = stepStarts(cues, n + (resultLines.length ? 1 : 0));
    const pos = (i: number) =>
      [(i % cols) * (tw + gap), Math.floor(i / cols) * (th + capH + gap)] as const;
    const text = (i: number) => `${i + 1}  ${words[i] ?? ""}`;
    const tilesMarkup = d.beats
      .map((_, i) => {
        const [x, y] = pos(i);
        return `${panel(`p${i}`, x, y, tw, th, img(`p${i}-i`, href(f[`p${i}`] as string), 0, 0, tw, th), "lit-dark")}
${label(`w${i}`, text(i), x, y + th + 8, SMALL, theme.fg)}`;
      })
      .join("\n");
    const big = d.beats
      .map(
        (_, i) =>
          `<div id="SCENEID-b${i}" style="position:absolute;left:0;top:0;width:${px(bw)};height:${px(bh)}"><div id="SCENEID-b${i}-cam" style="position:absolute;left:0;top:0;width:${px(bw)};height:${px(bh)}">${img(`b${i}-i`, href(f[`p${i}`] as string), 0, 0, bw, bh)}</div></div>`,
      )
      .join("");
    // The large view's caption, one per tile, never two on screen at once.
    const bigWords = d.beats
      .map((_, i) => label(`bw${i}`, text(i), bx + 28, 20, LABEL, "", ON_PHOTO))
      .join("");
    const resultMarkup = resultLines
      .map((t, i) => label(`r${i}`, t, bx + 40, ry + i * 58, LABEL, theme.accent))
      .join("");
    const markup = `<div id="SCENEID-lit">
${tilesMarkup}
${panel("big", bx, 0, bw, bh, big, "lit-dark")}
${bigWords}
${resultMarkup}
</div>`;
    const tl = new Tl();
    const end = cues[cues.length - 1]?.t1 ?? (at[at.length - 1] as number) + 6;
    d.beats.forEach((_, i) => {
      tl.fromTo(`p${i}`, { opacity: 0 }, { opacity: 0.3, duration: 0.6 }, 0.2 + i * 0.1);
      tl.fromTo(`w${i}`, { opacity: 0 }, { opacity: 0.4, duration: 0.6 }, 0.3 + i * 0.1);
      tl.fromTo(`b${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
      tl.fromTo(`bw${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    });
    tl.show("big", 0.2, 0.6);
    const resultAt = resultLines.length ? (at[n] as number) + 0.2 : end;
    d.beats.forEach((_, i) => {
      const t0 = Math.max(0.9, (at[i] as number) + 0.1);
      // The last keeps moving under the result, which is read over it.
      const t1 = i === n - 1 ? end : (at[i + 1] as number) + 0.6;
      tl.fromTo(
        `p${i}`,
        { opacity: 0.3 },
        { opacity: 1, duration: 0.7, ease: "power2.out", immediateRender: false },
        t0,
      );
      tl.fromTo(
        `w${i}`,
        { opacity: 0.4 },
        { opacity: 1, duration: 0.6, immediateRender: false },
        t0 + 0.2,
      );
      // Large, on its sentence, crossfading over the one before; then a slow close look.
      tl.fromTo(
        `b${i}`,
        { opacity: 0 },
        { opacity: 1, duration: 0.8, ease: "sine.inOut", immediateRender: false },
        t0,
      );
      if (i > 0) {
        tl.fromTo(
          `b${i - 1}`,
          { opacity: 1 },
          { opacity: 0, duration: 0.8, ease: "sine.inOut", immediateRender: false },
          t0 + 0.8,
        );
        tl.fromTo(
          `bw${i - 1}`,
          { opacity: 1 },
          { opacity: 0, duration: 0.3, immediateRender: false },
          t0,
        );
      }
      tl.fromTo(
        `bw${i}`,
        { opacity: 0 },
        { opacity: 1, duration: 0.4, immediateRender: false },
        t0 + 0.4,
      );
      drift(tl, `b${i}-cam`, t0, Math.max(t0 + 1, t1 - 0.2), { x: 0, y: 0, scale: 1.15 });
    });
    if (resultLines.length) {
      // The result takes the large view's place: the picture steps back under the source's numbers.
      tl.fromTo(
        "big",
        { opacity: 1 },
        { opacity: 0.18, duration: 0.8, immediateRender: false },
        resultAt,
      );
      tl.fromTo(
        `bw${n - 1}`,
        { opacity: 1 },
        { opacity: 0, duration: 0.4, immediateRender: false },
        resultAt,
      );
      for (let i = 0; i < resultLines.length; i++) tl.show(`r${i}`, resultAt + 0.3 + i * 0.6, 0.6);
    }
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

/**
 * prior-work — earlier approaches shown by what they do, family by family,
 * side by side. A family is shown by what an earlier verb scene of this deck
 * COMPUTED (`from`: that scene's layer, brought back), or, for a family of
 * learned methods, only by the numbers the source reports for its members,
 * each held to the source by the truth gate. A network the build does not have
 * is never drawn working.
 *
 * Each lane carries the family, its members and where the source says it runs
 * out (`gap`), all the plan's words in the deck's language.
 */
import {
  drift,
  even,
  img,
  type KindImpl,
  lab,
  panel,
  REST,
  spread,
  stepStarts,
  wrap,
} from "../kind.js";
import { baseCss, LABEL, label, ON_PHOTO, px, SMALL, Tl } from "../kit.js";

export interface PriorWorkData {
  lanes: Array<{
    family: string;
    members: string;
    numbers: Array<{ label: string; value: string }>;
    from?: string | undefined;
    gap: string;
  }>;
}

/** Whether a lane shows an earlier scene's computed layer. */
export const runsOnPicture = (l: PriorWorkData["lanes"][number]) => !!l.from;

/** Checks a plan's lanes before anything is drawn: the counts and what each lane needs. */
export function checkLanes(d: PriorWorkData): void {
  if (d.lanes.length < 2 || d.lanes.length > 4)
    throw new Error(`literal: prior-work draws two to four lanes, got ${d.lanes.length}`);
  for (const l of d.lanes) {
    if (!l.from && !l.numbers.length)
      throw new Error(
        `literal: prior-work lane "${l.family}" shows neither an earlier scene (\`from\`) nor the source's numbers; a learned method is shown only by what the source reports for it. Drop the lane, or leave \`literal\` null when the source reports nothing for these families`,
      );
    if (l.from && l.numbers.length)
      throw new Error(
        `literal: prior-work lane "${l.family}" shows an earlier scene; its numbers would not be drawn`,
      );
  }
}

export const priorWorkKind: KindImpl = {
  picture: false,
  async layers({ spec, earlier }) {
    const d = spec.data as PriorWorkData;
    checkLanes(d);
    const files: Record<string, string> = {};
    for (const [k, lane] of d.lanes.entries()) {
      if (!lane.from) continue;
      const thumb = earlier.get(lane.from)?.layers.files.thumb;
      if (!thumb)
        throw new Error(
          `literal: prior-work lane "${lane.family}" shows ${lane.from}, which computed no picture before it`,
        );
      files[`l${k}`] = thumb;
      files.thumb ??= thumb;
    }
    return { files, data: {} };
  },
  fragment(L, { width: W, height: H }, cues, spec, theme, href) {
    const K = "prior-work";
    const d = spec.data as PriorWorkData;
    checkLanes(d);
    const f = L.files as Record<string, string>;
    const n = d.lanes.length;
    const gap = 48;
    const cw = Math.floor((W - (n - 1) * gap) / n);
    const lh = 50;
    const fam = d.lanes.map((l) => wrap(l.family, LABEL, cw, theme));
    const mem = d.lanes.map((l) => wrap(l.members, SMALL, cw, theme));
    const gaps = d.lanes.map((l) => wrap(l.gap, SMALL, cw, theme));
    const famH = Math.max(...fam.map((x) => x.length)) * 54;
    const memH = Math.max(...mem.map((x) => x.length)) * lh;
    const gapH = Math.max(...gaps.map((x) => x.length)) * lh;
    const vy = famH + memH + 16;
    // The boxes are 3:2, or taller when a numbers lane needs the room (its pictures, if any,
    // keep their aspect and are cropped at the sides, input and output alike).
    const iw = cw - 48;
    const numbersH = Math.max(
      0,
      ...d.lanes.map((l) =>
        l.numbers.reduce(
          (a, r) =>
            a +
            wrap(r.label, SMALL, iw, theme).length * 48 +
            wrap(r.value, LABEL, iw, theme).length * 54 +
            14,
          70,
        ),
      ),
    );
    // The caption, when there is one, has its own line under the gaps (an early deck drew it
    // over the first lane's gap).
    const captionH = lab(K, spec, "caption") ? 56 : 0;
    const vh = even(Math.min(Math.max(cw / 1.5, numbersH + 24), H - vy - gapH - 24 - captionH));
    if (vh < 160)
      throw new Error(
        `literal: prior-work's pictures would be ${vh}px tall; shorten the members and gaps, or use fewer lanes`,
      );
    const example = lab(K, spec, "example");
    const reported = lab(K, spec, "reported");
    const tagOf = (l: PriorWorkData["lanes"][number]) => (l.from ? example : reported);
    for (const l of d.lanes)
      if (!tagOf(l))
        throw new Error(
          `literal: prior-work lane "${l.family}" needs the label slot "${l.from ? "example" : "reported"}"`,
        );
    const lanes = d.lanes
      .map((lane, k) => {
        const x = k * (cw + gap);
        const words = [
          ...(fam[k] as string[]).map((t, i) =>
            label(`f${k}-${i}`, t, 0, i * 54, LABEL, theme.accent),
          ),
          ...(mem[k] as string[]).map((t, i) =>
            label(`m${k}-${i}`, t, 0, famH + i * lh, SMALL, theme.muted),
          ),
          ...(gaps[k] as string[]).map((t, i) =>
            label(`g${k}-${i}`, t, 0, vy + vh + 18 + i * lh, SMALL, theme.fg),
          ),
        ].join("");
        let visual: string;
        if (runsOnPicture(lane)) {
          // The earlier scene's own layer, swept in while it is said.
          visual = panel(
            `v${k}`,
            0,
            vy,
            cw,
            vh,
            `<div id="SCENEID-v${k}-cam" style="position:absolute;left:0;top:0;width:${px(cw)};height:${px(vh)}"><div id="SCENEID-w${k}" style="position:absolute;left:0;top:0;width:0;height:${px(vh)};overflow:hidden">${img(`v${k}-out`, href(f[`l${k}`] as string), 0, 0, cw, vh, "object-fit:cover")}</div></div>${label(`t${k}`, tagOf(lane), 16, vh - 62, SMALL, "", ON_PHOTO)}`,
            "lit-dark",
          );
        } else {
          // A learned family: no output is drawn, only what the source reports for its members.
          const rows = lane.numbers.map((r) => ({
            label: wrap(r.label, SMALL, iw, theme),
            value: wrap(r.value, LABEL, iw, theme),
          }));
          const hOf = (r: (typeof rows)[number]) => r.label.length * 48 + r.value.length * 54 + 14;
          const need = rows.reduce((a, r) => a + hOf(r), 0);
          if (need > vh - 70)
            throw new Error(
              `literal: prior-work lane "${lane.family}" needs ${Math.ceil(need + 70)}px for its numbers and has ${Math.floor(vh)}px; give fewer or shorter ones`,
            );
          // The box is as tall as its numbers, not the lane's picture height: a box mostly
          // empty around one number read as a placeholder (r3 of the pure-planner deck).
          const gapY = Math.min(36, (vh - 70 - need) / (rows.length + 1));
          const bh = Math.min(vh, 70 + need + gapY * (rows.length + 1));
          let y = 70 + gapY;
          const nums = rows
            .map((r, i) => {
              const h = hOf(r);
              const html = `<div id="SCENEID-n${k}-${i}" style="position:absolute;left:24px;top:${px(y)};width:${px(iw)};height:${px(h)}">${r.label
                .map((t, j) => label(`nl${k}-${i}-${j}`, t, 0, j * 48, SMALL, theme.muted))
                .join(
                  "",
                )}<div id="SCENEID-nv${k}-${i}" style="position:absolute;left:0;top:0;width:100%;height:100%">${r.value
                .map((t, j) =>
                  label(`nv${k}-${i}-${j}`, t, 0, r.label.length * 48 + j * 54, LABEL, theme.fg),
                )
                .join("")}</div></div>`;
              y += h + gapY;
              return html;
            })
            .join("");
          visual = `<div id="SCENEID-v${k}" style="position:absolute;left:0;top:${px(vy)};width:${px(cw)};height:${px(bh)};border:3px solid ${theme.rule};border-radius:6px;box-sizing:border-box">${label(`t${k}`, tagOf(lane), 24, 14, SMALL, theme.muted)}${nums}</div>`;
        }
        return `<div id="SCENEID-lane${k}" style="position:absolute;left:${px(x)};top:0;width:${px(cw)};height:${px(H)}">${words}${visual}</div>`;
      })
      .join("\n");
    const caption = lab(K, spec, "caption");
    const markup = `<div id="SCENEID-lit">
${lanes}
${caption ? label("cap", caption, 0, H - 46, SMALL, theme.muted) : ""}
</div>`;
    const at = stepStarts(cues, n);
    const end = cues[cues.length - 1]?.t1 ?? (at[n - 1] as number) + 7;
    const tl = new Tl();
    // Every lane is there from the start, quiet but legible (0.55: dimmed 40px text at 0.32
    // read at about 2:1 on the dark theme), so the frame is whole; lane by lane, on its
    // sentence, it comes forward and shows what it does: a method that runs sweeps its output
    // across the picture and is then read closely; a learned family's box of numbers appears
    // only then — never an empty frame waiting — and its numbers arrive one by one.
    const IDLE = 0.55;
    for (let k = 0; k < n; k++)
      tl.fromTo(`lane${k}`, { opacity: 0 }, { opacity: IDLE, duration: 0.6 }, 0.2 + k * 0.12);
    d.lanes.forEach((lane, k) => {
      if (!runsOnPicture(lane))
        tl.fromTo(`v${k}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
    });
    if (caption) tl.show("cap", 0.8);
    d.lanes.forEach((lane, k) => {
      const t0 = Math.max(1.0, (at[k] as number) + 0.1);
      const t1 = (at[k + 1] as number | undefined) ?? end;
      tl.fromTo(
        `lane${k}`,
        { opacity: IDLE },
        { opacity: 1, duration: 0.6, ease: "power2.out" },
        t0,
      );
      if (k > 0) tl.fromTo(`lane${k - 1}`, { opacity: 1 }, { opacity: 0.7, duration: 0.6 }, t0);
      if (runsOnPicture(lane)) {
        const sw = Math.max(2.4, Math.min(5, (t1 - t0) * 0.5));
        tl.fromTo(`w${k}`, { width: 0 }, { width: cw, duration: sw, ease: "sine.inOut" }, t0 + 0.5);
        tl.fromTo(`t${k}`, { opacity: 0 }, { opacity: 1, duration: 0.5 }, t0 + 0.5 + sw);
        drift(tl, `v${k}-cam`, t0 + 0.5 + sw, Math.max(t0 + sw + 1.5, t1 - 0.1), {
          x: 0,
          y: 0,
          scale: 1.15,
        });
      } else {
        tl.show(`v${k}`, t0 + 0.2, 0.5);
        lane.numbers.forEach((_, i) => {
          tl.fromTo(`n${k}-${i}`, { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
        });
        // What is measured, then the source's value for it.
        const times = spread(t0 + 0.5, t1, lane.numbers.length, 0.6, 4.5, 1.6);
        times.forEach((t, i) => {
          tl.fromTo(
            `n${k}-${i}`,
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
            t,
          );
          tl.fromTo(`nv${k}-${i}`, { opacity: 0 }, { opacity: 1, duration: 0.5 }, t + 1.2);
        });
        // While the rest of its sentence is spoken, the camera leans in on the numbers (r3 of
        // the pure-planner deck stood still for 8s on a lane of one number).
        const last = (times[times.length - 1] as number) + 1.7;
        drift(tl, `v${k}`, last, t1 - 0.1, { x: 0, y: 0, scale: 1.05 }, REST, "0% 0%");
      }
    });
    return { markup, css: baseCss(theme), script: tl.script };
  },
};

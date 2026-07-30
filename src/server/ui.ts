/**
 * The web page a person actually uses: drop a document, press one button, wait,
 * watch a deck come out.
 *
 * ONE DOCUMENT, NO BUILD STEP. The whole thing — markup, stylesheet, script —
 * is a single string this module returns, and the server writes it straight to
 * the response. That is not minimalism for its own sake: the page must be
 * serveable by a process that has already spent its startup budget on Chrome
 * and ffmpeg, and a bundler in front of it would be one more thing that can be
 * out of date relative to the code it renders. No CDN either, so the page works
 * on the same offline box the renderer does.
 *
 * WHY THE PALETTE IS IMPORTED RATHER THAN WRITTEN. The page is the frame around
 * the deck, and a frame in a second visual language reads as a different
 * product either side of the iframe border. So the light and dark grounds ARE
 * `paper` and `ink`, pulled from src/emit/themes at build time of this string —
 * change a theme's blue and this page follows it. The same argument applies to
 * `FORMATS`: the picker's fallback list is the real table, so a format added to
 * src/types.ts cannot leave a stale tile here.
 *
 * WHAT THE PAGE ASSUMES OF THE SERVER — the HTTP contract, and nothing else:
 *   POST /api/jobs             multipart, field `file` + option fields -> { id }
 *   GET  /api/jobs/:id         the job record (state, stage, steps, log, error, result)
 *   GET  /api/jobs/:id/events  SSE of the same payload — OPTIONAL, see `watch()`
 *   GET  /api/formats          the preset table — OPTIONAL, see FALLBACK_FORMATS
 *   GET  /d/:id/...            the built deck, statically
 * Every optional endpoint degrades to something that still works, because a
 * page that white-screens when one route is missing is a page that cannot be
 * developed against a half-built server.
 */
/**
 * THROUGH `../index.js`, NOT THROUGH THE MODULE THAT DEFINES THEM.
 *
 * `npm run build:server` transpiles `src/server/*.ts` file by file with no
 * `--bundle`, so every import specifier here survives verbatim into
 * `dist/server/`. The library, meanwhile, is bundled to a single `dist/index.js`
 * — there is no `dist/emit/` and no `dist/types.js`. So the honest-looking
 * `from "../emit/themes/index.js"` this file used to carry resolved to a path
 * that does not exist once built, `import("./ui.js")` in http.ts threw
 * ERR_MODULE_NOT_FOUND, its catch swallowed it, and the server served its 5 KB
 * stand-in page instead of this one. Every gate stayed green: tsc resolves
 * against SOURCE, the tests import from source too, and `npm run serve` starts
 * and answers 200. Only opening the page showed it.
 *
 * `../index.js` is the one specifier that exists in both trees, which is why
 * every other file in src/server/ imports from it. Keep it that way.
 */
import {
  type DeckTheme,
  FORMATS,
  type Format,
  LEGIBLE_W,
  MAX_ASPECT,
  MIN_EDGE,
  resolveTheme,
  THEME_NAMES,
  THEMES,
} from "../index.js";
// Sibling module, so this specifier exists under dist/server/ too. The canvas
// bounds are the SERVER's, not this page's — see the note on MAX_PIXELS there.
import { MAX_PIXELS, MAX_SIDE } from "./options.js";

/** `ink` and `paper` by name; `resolveTheme` throws rather than returning undefined. */
const ink = resolveTheme("ink");
const paper = resolveTheme("paper");

/** What the picker needs to draw a tile. The server's /api/formats may send more. */
interface FormatTile {
  id: string;
  width: number;
  height: number;
  /** Whether the built deck is click-through-able; drives the tile's caption. */
  navigable: boolean;
}

/**
 * The formats the page falls back to when /api/formats is missing or fails.
 *
 * Derived, never typed out. `FORMATS` is the only format table in the project,
 * and a second one here would be wrong the first time a format is added.
 */
const FALLBACK_FORMATS: FormatTile[] = Object.values(FORMATS).map((f: Format) => ({
  id: f.id,
  width: f.width,
  height: f.height,
  navigable: f.navigable,
}));

/* ------------------------------------------------------------------ colour */

/**
 * The page's derived colours, worked out here rather than by `color-mix()` in
 * the browser.
 *
 * Two reasons, and the second is the one that matters. A mixed colour is not
 * readable back out of `getComputedStyle` — Chrome hands the `color-mix(...)`
 * expression straight back — so a contrast check run against the live page
 * cannot see what was painted, and every mixed value silently reads as black.
 * A gate that cannot see the thing it gates is worse than no gate. Computing
 * the mix here makes the emitted stylesheet literal hex, which any probe (and
 * any human with a colour picker) can verify. The first reason is smaller: the
 * arithmetic runs once per page instead of once per paint per viewer.
 */
type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16)) as RGB;
}
function toHex(c: RGB): string {
  return `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
/** `t` of `a` over `b`, in plain sRGB — the same space `color-mix(in srgb…)` uses. */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [parseHex(a), parseHex(b)];
  return toHex(x.map((v, i) => v * t + (y[i] as number) * (1 - t)) as RGB);
}
function luminance(c: RGB): number {
  const f = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(parseHex(a)), luminance(parseHex(b))].sort((p, q) => q - p);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
}

/**
 * The lightest step from `from` toward `toward` that clears `target` on EVERY
 * ground in `on`.
 *
 * The themes' `dim` is 4.38:1 against their `panel` — under AA for text at the
 * sizes this page uses it. That is not a bug in the theme: `dim` was chosen
 * against a SLIDE's ground, and a raised panel is a different ground. So rather
 * than hand-pick a hex that a future theme edit would quietly invalidate, walk
 * `dim` toward the foreground until it measurably passes, and stop there — the
 * quietest colour that is still legible, by construction.
 *
 * `on` is a LIST because the same small text lands on more than one surface: a
 * format tile's dimensions sit on `panel` when the tile is idle and on `tint`
 * when it is selected. Tuning against `panel` alone measured 4.64:1 idle and
 * 4.11:1 selected — the failing case being, of course, the tile the user just
 * chose. One ground is never the whole answer.
 */
function readable(from: string, toward: string, on: string[], target = 4.6): string {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(toward, from, t);
    if (on.every((g) => contrast(c, g) >= target)) return c;
  }
  return toward;
}

/**
 * One colour scheme's whole vocabulary: the theme's own tokens plus everything
 * this page derives from them. `ok`/`warn`/`bad` are the theme's tones rather
 * than new hues — a deck and its frame should not disagree about what green is.
 */
function scheme(t: DeckTheme) {
  const base = {
    bg: t.bg,
    fg: t.fg,
    muted: t.muted,
    dim: t.dim,
    rule: t.rule,
    panel: t.panel,
    accent: t.accent,
    ok: t.tones.d,
    warn: t.tones.b,
    bad: t.tones.c,
  };
  const tint = mix(base.accent, base.panel, 0.1);
  return {
    ...base,
    tint,
    sub: readable(base.dim, base.fg, [base.panel, tint]),
    /**
     * What goes ON the accent — the primary button's label.
     *
     * Measured: white on ink's #3d8bfd is 3.33:1, which fails AA on the one
     * control the whole page exists to get pressed. The theme's own ground is
     * 5.85:1 on it and 6.03:1 on paper's blue, so the label is simply the
     * scheme's background colour. Darkening the accent instead would have
     * worked too and was rejected: ink's numbers are frozen, and a button in a
     * slightly-off brand blue is a worse answer than a legible label.
     */
    onAccent: base.bg,
    /* The tile glyph carries the aspect ratio, which makes it a meaningful
       graphic — WCAG 1.4.11's 3:1, not a decorative hairline. Walked up from
       the panel until it clears, so neither scheme is guessed at. */
    glyph: readable(base.panel, base.fg, [base.panel, tint], 3.0),
    glyphLine: readable(base.panel, base.fg, [base.panel, tint], 3.2),
    runRow: mix(base.accent, base.panel, 0.07),
    failBg: mix(base.bad, base.panel, 0.07),
    failRule: mix(base.bad, base.rule, 0.45),
    zipRule: mix(base.accent, base.rule, 0.45),
    /* The drop zone under a dragged file: stronger than a selection tint,
       because "let go here" has to be unmistakable from across the screen. */
    dropOver: mix(base.accent, base.panel, 0.14),
  };
}

const DARK = scheme(ink);
const LIGHT = scheme(paper);

/** `--name:value;` pairs for one scheme, so the two blocks cannot drift apart. */
function vars(s: Record<string, string>): string {
  return Object.entries(s)
    .map(([k, v]) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v};`)
    .join(" ");
}

/** Theme chips draw real swatches, so the choice is visible rather than a word. */
const THEME_CHIPS = THEME_NAMES.map((name) => {
  const t = THEMES[name];
  if (!t) throw new Error(`theme "${name}" is listed but missing`);
  return { name, bg: t.bg, fg: t.fg, accent: t.accent, tone: t.tones.a };
});

/**
 * The page, as one self-contained HTML document.
 *
 * A function rather than a constant so the interpolated tables above are read
 * once per call and a server that hot-reloads a theme picks the change up
 * without a module cache dance. It is a few hundred microseconds of string
 * concatenation against a request that will take two minutes to satisfy.
 */
export function uiPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>DeckSmith</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230b0d10'/%3E%3Crect x='6' y='9' width='6' height='14' rx='1.5' fill='%233d8bfd'/%3E%3Crect x='15' y='9' width='11' height='3' rx='1.5' fill='%23e8eaed'/%3E%3Crect x='15' y='15' width='11' height='2.5' rx='1.25' fill='%239aa7b5'/%3E%3Crect x='15' y='20' width='7' height='2.5' rx='1.25' fill='%239aa7b5'/%3E%3C/svg%3E">
<style>
/* ------------------------------------------------------------- tokens */
/* Dark is the ink theme, light is paper. Not two arbitrary palettes: the page
   is a frame around a deck built from exactly these values. */
/* Every value below is a literal, computed in src/server/ui.ts from the ink and
   paper themes. See the note on scheme() in ui.ts for why none of it is a
   runtime color-mix(). */
:root{
  color-scheme: dark light;
  ${vars(DARK)}
  --lift: rgba(255,255,255,.035);
  --shadow: 0 1px 2px rgba(0,0,0,.45), 0 12px 34px rgba(0,0,0,.30);
}
@media (prefers-color-scheme: light){
  :root{
    ${vars(LIGHT)}
    --lift: rgba(0,0,0,.025);
    --shadow: 0 1px 2px rgba(20,17,13,.06), 0 12px 30px rgba(20,17,13,.07);
  }
}

/* ------------------------------------------------------------- reset */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{
  background:var(--bg); color:var(--fg);
  font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:15px; line-height:1.55;
  -webkit-font-smoothing:antialiased;
  font-feature-settings:"cv05" 1,"ss01" 1;
}
[hidden]{display:none !important}
button,input,select,textarea{font:inherit;color:inherit}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
::selection{background:var(--tint)}

/* Motion is the exception, not the default: everything below is a state
   change of 120-200ms and nothing loops except the one running-step pulse. */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important;scroll-behavior:auto !important}
}

/* ------------------------------------------------------------- shell */
.wrap{max-width:940px;margin:0 auto;padding:52px 24px 96px}

/* A masthead, not a toolbar. At 34px the wordmark no longer sits on a shared
   baseline with its tagline without one of them looking like an afterthought,
   so the pair stacks: title, then the line that explains it. clamp() keeps it
   from crowding a 390px phone, where 34px of a 6-space word is most of the
   width. */
header.top{margin-bottom:40px}
.mark{display:flex;align-items:center;gap:14px;
  font-size:clamp(26px,6.4vw,34px);font-weight:650;letter-spacing:-.032em;line-height:1.1}
.mark svg{display:block;flex:none;width:1em;height:1em}
.tag{color:var(--dim);font-size:15px;margin-top:10px;max-width:44ch}

/* Wider tracking and more air beneath. A micro-label's whole job is to be read
   as a label and not as content, and at .09em it was still reading as small
   text; the space below it is what makes the group under it feel like a group. */
h2.sec{font-size:11.5px;font-weight:650;letter-spacing:.13em;text-transform:uppercase;color:var(--dim);margin:0 0 14px}

/* ------------------------------------------------------------- drop */
.drop{
  position:relative;display:block;width:100%;text-align:center;
  border:1.5px dashed var(--rule); border-radius:20px; background:var(--panel);
  padding:30px 24px; cursor:pointer;
  transition:border-color .18s ease, background-color .18s ease, transform .18s ease;
}
.drop:hover{border-color:var(--dim)}
.drop.over{border-style:solid;border-color:var(--accent);background:var(--drop-over);transform:scale(1.004)}
.drop.over .dropicon{color:var(--accent)}
.dropicon{color:var(--dim);transition:color .18s ease}
.drop b{display:block;margin-top:14px;font-size:16px;font-weight:600;letter-spacing:-.01em}
.drop span{display:block;margin-top:5px;color:var(--muted);font-size:13.5px}
.drop em{color:var(--accent);font-style:normal;text-decoration:underline;text-underline-offset:3px}
.drop small{display:block;margin-top:16px;color:var(--sub);font-size:12px;letter-spacing:.01em}

/* ------------------------------------------------------------- file card */
.file{display:flex;gap:14px;align-items:flex-start;border:1px solid var(--rule);border-radius:16px;background:var(--panel);padding:15px 16px}
.fileicon{flex:none;width:38px;height:38px;border-radius:9px;background:var(--tint);color:var(--accent);display:grid;place-items:center;font-size:11px;font-weight:700;letter-spacing:.04em}
.filebody{min-width:0;flex:1}
.filename{font-weight:600;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.005em}
.filemeta{color:var(--muted);font-size:12.5px;margin-top:2px;font-variant-numeric:tabular-nums}
.zip{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px;list-style:none}
.zip li{font-size:11.5px;color:var(--muted);background:var(--lift);border:1px solid var(--rule);border-radius:6px;padding:2px 7px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zip li.main{color:var(--fg);border-color:var(--zip-rule)}
.zip li.rest{border-style:dashed}
.x{flex:none;background:none;border:1px solid transparent;border-radius:8px;color:var(--dim);width:30px;height:30px;cursor:pointer;line-height:1;font-size:17px;transition:color .15s,background-color .15s}
.x:hover{color:var(--fg);background:var(--lift)}

/* ------------------------------------------------------------- fields */
.opts{margin-top:34px;display:grid;gap:28px}
.row{display:grid;gap:26px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}

.tiles{display:grid;gap:9px;grid-template-columns:repeat(auto-fit,minmax(94px,1fr))}
.tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:16px 8px 13px;border:1px solid var(--rule);border-radius:16px;background:var(--panel);cursor:pointer;transition:border-color .15s,background-color .15s}
.tile input{position:absolute;opacity:0;width:0;height:0}
.tile:hover{border-color:var(--dim)}
.tile:has(input:checked){border-color:var(--accent);background:var(--tint)}
.tile:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.ratio{height:34px;display:grid;place-items:center;margin-bottom:5px}
/* The glyph is the only thing on the tile that carries the SHAPE, so it has to
   survive a light ground: --rule is a hairline colour and disappears as a fill. */
.ratio i{display:block;border-radius:3px;background:var(--glyph);transition:background-color .15s,border-color .15s}
.ratio i.any{background:none;border:1.5px dashed var(--glyph-line)}
.tile:has(input:checked) .ratio i{background:var(--accent)}
.tile:has(input:checked) .ratio i.any{background:none;border-color:var(--accent)}
.tname{font-size:13px;font-weight:600;letter-spacing:-.005em}
.tdim{font-size:10.5px;color:var(--sub);font-variant-numeric:tabular-nums;letter-spacing:.02em;white-space:nowrap}

/* Deck and Video are both 1920x1080; nothing on the tiles can show the
   difference, so one line under them says what the chosen one actually is. */
.fmtnote{margin-top:10px;color:var(--dim);font-size:12.5px;font-variant-numeric:tabular-nums}
.custom{display:flex;align-items:center;gap:8px;margin-top:11px}
.custom input{width:100%;min-width:0;background:var(--panel);border:1px solid var(--rule);border-radius:9px;padding:9px 11px;font-variant-numeric:tabular-nums}
.custom input:focus{border-color:var(--accent);outline:none}
.custom span{color:var(--dim);flex:none}

.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{position:relative;display:flex;align-items:center;gap:8px;border:1px solid var(--rule);border-radius:999px;padding:6px 13px 6px 7px;background:var(--panel);cursor:pointer;font-size:13.5px;transition:border-color .15s,background-color .15s}
.chip input{position:absolute;opacity:0;width:0;height:0}
.chip:hover{border-color:var(--dim)}
.chip:has(input:checked){border-color:var(--accent);background:var(--tint)}
.chip:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.sw{flex:none;width:22px;height:22px;border-radius:999px;border:1px solid var(--rule);display:flex;overflow:hidden}
.sw i{flex:1}

.seg{display:inline-flex;border:1px solid var(--rule);border-radius:12px;background:var(--panel);padding:3px;gap:3px;flex-wrap:wrap}
.seg label{position:relative;padding:5px 12px;border-radius:7px;font-size:13px;cursor:pointer;color:var(--muted);transition:background-color .15s,color .15s}
.seg input{position:absolute;opacity:0;width:0;height:0}
.seg label:hover{color:var(--fg)}
.seg label:has(input:checked){background:var(--tint);color:var(--fg);font-weight:500}
.seg label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:1px}

.slider{display:flex;align-items:center;gap:13px}
.slider input[type=range]{flex:1;min-width:0;accent-color:var(--accent);height:22px}
.num{font-variant-numeric:tabular-nums;font-size:13.5px;color:var(--muted);min-width:74px;text-align:right}

select,.txt{width:100%;background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:11px 13px;font-size:14px}
select:focus,.txt:focus{border-color:var(--accent);outline:none}

.switches{display:grid;gap:9px;align-content:start}
/* 5 + the grid's 9 = the 14px .sec leaves everywhere else. The gap
   applies between every grid item, so the heading's own margin has to be
   the difference or this column's label sits further off than the next. */
.switches h2.sec{margin-bottom:5px}
.sws{display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid var(--rule);border-radius:14px;background:var(--panel);padding:13px 15px;cursor:pointer}
.sws:hover{border-color:var(--dim)}
.sws:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.sws .lbl{font-size:13.5px}
.sws .sub{display:block;color:var(--sub);font-size:11.5px;line-height:1.35}
.track{position:relative;flex:none;width:38px;height:22px;border-radius:999px;background:var(--rule);transition:background-color .16s ease}
.track input{position:absolute;opacity:0;width:0;height:0}
.track::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:999px;background:var(--bg);transition:transform .16s ease}
.track:has(input:checked){background:var(--accent)}
.track:has(input:checked)::after{transform:translateX(16px)}

details.more{border-top:1px solid var(--rule);padding-top:20px}
details.more summary{cursor:pointer;list-style:none;color:var(--muted);font-size:13px;display:inline-flex;align-items:center;gap:7px;border-radius:6px}
details.more summary::-webkit-details-marker{display:none}
details.more summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .16s ease;margin-left:2px}
details.more[open] summary::before{transform:rotate(45deg)}
details.more summary:hover{color:var(--fg)}
details.more .row{margin-top:20px}

/* ------------------------------------------------------------- action */
.action{margin-top:34px;display:flex;flex-direction:column;gap:9px;align-items:stretch}
.go{
  display:flex;align-items:center;justify-content:center;gap:10px;
  background:var(--accent); color:var(--on-accent); border:none; border-radius:14px;
  padding:15px 22px; font-size:15.5px; font-weight:600; letter-spacing:-.01em;
  cursor:pointer; box-shadow:var(--shadow);
  transition:filter .15s ease, transform .12s ease, opacity .15s ease;
}
.go:hover:not(:disabled){filter:brightness(1.08)}
.go:active:not(:disabled){transform:translateY(1px)}
/* A greyed-out ACCENT block still reads as the button you should press. A
   disabled primary must look like furniture, not like a dimmed invitation. */
.go:disabled{background:var(--panel);color:var(--dim);border:1px solid var(--rule);cursor:not-allowed;box-shadow:none}
.hint{text-align:center;color:var(--dim);font-size:12.5px}

.ghost{background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:10px 16px;font-size:13.5px;cursor:pointer;transition:border-color .15s,background-color .15s}
.ghost:hover{border-color:var(--dim);background:var(--lift)}

/* ------------------------------------------------------------- progress */
.stage{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.stage h1{font-size:26px;font-weight:600;letter-spacing:-.025em}
.stage .clock{font-variant-numeric:tabular-nums;font-size:26px;color:var(--muted);letter-spacing:-.02em}
.stage p{color:var(--muted);font-size:13.5px;flex-basis:100%;margin-top:-2px}

.steps{list-style:none;border:1px solid var(--rule);border-radius:14px;background:var(--panel);overflow:hidden}
.steps li{display:flex;align-items:center;gap:13px;padding:13px 16px;border-top:1px solid var(--rule)}
.steps li:first-child{border-top:none}
.steps li .nm{font-size:14px;font-weight:500;text-transform:capitalize}
.steps li .dt{color:var(--sub);font-size:12.5px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.steps li .grow{min-width:0;flex:1}
.steps li .ms{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--sub);flex:none}
.steps li[data-s=pending]{color:var(--sub)}
.steps li[data-s=running]{background:var(--run-row)}
.steps li[data-s=running] .nm{color:var(--fg)}
.steps li[data-s=skipped]{opacity:.45}

.bead{flex:none;width:18px;height:18px;border-radius:999px;border:1.5px solid var(--rule);display:grid;place-items:center;position:relative}
li[data-s=done] .bead{border-color:var(--ok);background:var(--ok)}
li[data-s=done] .bead::after{content:"";width:8px;height:4.5px;border-left:1.6px solid var(--bg);border-bottom:1.6px solid var(--bg);transform:rotate(-45deg) translate(1px,-1px)}
li[data-s=error] .bead{border-color:var(--bad);background:var(--bad)}
li[data-s=error] .bead::after{content:"\\00d7";color:var(--bg);font-size:13px;line-height:1;font-weight:700}
li[data-s=running] .bead{border-color:var(--accent)}
li[data-s=running] .bead::after{content:"";width:7px;height:7px;border-radius:999px;background:var(--accent)}
@media (prefers-reduced-motion: no-preference){
  li[data-s=running] .bead::after{animation:beat 1.25s ease-in-out infinite}
}
@keyframes beat{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.62)}}

.log{margin-top:18px}
.log summary{cursor:pointer;color:var(--muted);font-size:12.5px;list-style:none;border-radius:6px}
.log summary::-webkit-details-marker{display:none}
.log pre{
  margin-top:9px;max-height:190px;overflow:auto;
  border:1px solid var(--rule);border-radius:11px;background:var(--panel);
  padding:12px 14px; color:var(--muted);
  font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;
}
.log pre:empty::after{content:"waiting for output…";color:var(--sub)}

/* ------------------------------------------------------------- result */
.tabs{display:inline-flex;gap:3px;border:1px solid var(--rule);border-radius:10px;background:var(--panel);padding:3px;margin-bottom:14px}
.tabs button{background:none;border:none;border-radius:7px;padding:6px 14px;font-size:13px;color:var(--muted);cursor:pointer;transition:background-color .15s,color .15s}
.tabs button[aria-selected=true]{background:var(--tint);color:var(--fg);font-weight:500}

.viewer{border:1px solid var(--rule);border-radius:14px;background:var(--panel);overflow:hidden;container-type:inline-size}
.chrome{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 8px 8px 14px;border-bottom:1px solid var(--rule)}
.chrome .who{font-size:12px;color:var(--sub);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chrome .btns{display:flex;gap:6px;flex:none}
.iconbtn{display:inline-flex;align-items:center;gap:6px;background:none;border:1px solid transparent;border-radius:8px;color:var(--muted);padding:5px 9px;font-size:12.5px;cursor:pointer;transition:color .15s,background-color .15s,border-color .15s}
.iconbtn:hover{color:var(--fg);background:var(--lift);border-color:var(--rule)}
.iconbtn svg{display:block}
/* HEIGHT, NOT ASPECT-RATIO, BECAUSE THE DECK BRINGS ITS OWN CHROME.
   deck.html draws a subtitle line, a slide counter and a progress bar BELOW the
   composition — a fixed 77px at every frame width, measured. A box sized to the
   composition's ratio alone therefore hands the player a stage that is too short
   and it pillarboxes to compensate: the 1920x1080 deck came out 714px wide in an
   850px frame (16% of the width black) and 219px wide in a 356px frame (39%).
   So the box is the composition's ratio PLUS whatever the deck's own chrome
   turns out to be, measured from the loaded iframe rather than hardcoded, and
   100cqw is the frame's inline size — which is why .viewer is a container.
   --chrome is 0 for the video, which has no chrome of its own. */
.canvas{background:${ink.bg};display:grid;place-items:center;width:100%;height:calc(100cqw / var(--arn, 1.7778) + var(--chrome, 0px))}
.canvas > *{width:100%;height:100%;border:0;display:block;background:${ink.bg}}
.viewer:fullscreen{border:none;border-radius:0;background:#000;display:flex;flex-direction:column}
.viewer:fullscreen .canvas{flex:1;min-height:0;background:#000;aspect-ratio:auto !important;height:auto !important}
.viewer:fullscreen .canvas > *{width:auto;height:auto;max-width:100%;max-height:100%;aspect-ratio:var(--ar)}

.facts{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:16px;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.facts b{color:var(--fg);font-weight:600}
.gets{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.gets a,.gets button{display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:var(--fg);background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:9px 14px;font-size:13.5px;cursor:pointer;transition:border-color .15s,background-color .15s}
.gets a:hover,.gets button:hover{border-color:var(--dim);background:var(--lift)}
.gets .k{color:var(--sub);font-size:11.5px;font-variant-numeric:tabular-nums}

.warns{list-style:none;margin-top:20px;display:grid;gap:7px}
.warns li{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--muted);border-left:2px solid var(--warn);padding:2px 0 2px 12px}

/* ------------------------------------------------------------- error */
.fail{border:1px solid var(--fail-rule);border-radius:14px;background:var(--fail-bg);padding:22px}
.fail .who{display:flex;align-items:center;gap:9px;color:var(--bad);font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase}
.fail h1{font-size:19px;font-weight:600;letter-spacing:-.015em;margin-top:11px;overflow-wrap:break-word}
.fail .hint{text-align:left;color:var(--muted);font-size:14px;margin-top:10px;line-height:1.6;overflow-wrap:break-word}
.fail .acts{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}

.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--fg);color:var(--bg);border-radius:999px;padding:9px 18px;font-size:13px;font-weight:500;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:opacity .18s ease}
.toast.on{opacity:1}

.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ------------------------------------------------------------- narrow */
@media (max-width:560px){
  .wrap{padding:22px 16px 72px}
  header.top{margin-bottom:24px;gap:6px}
  .tag{flex-basis:100%}
  .drop{padding:38px 18px;border-radius:14px}
  .opts{gap:22px}
  .row{gap:20px}
  .stage h1{font-size:22px}
  .stage .clock{font-size:22px}
  .steps li{padding:12px 14px}
  .seg{width:100%}
  .seg label{flex:1;text-align:center}
  .go{padding:16px 20px}
  .gets a,.gets button{flex:1;justify-content:center;padding:12px 14px}
  /* A finger is not a mouse pointer: the viewer's own controls get taller so
     nothing on this page is under the 40px a thumb needs. */
  .tabs button{padding:10px 18px}
  .iconbtn{padding:9px 11px}
  .chip{padding:9px 15px 9px 8px}
  .x{width:38px;height:38px}
  .seg label{padding:9px 12px}
}
</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <div class="mark">
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".28"/>
      <rect x="6" y="9" width="6" height="14" rx="1.5" fill="var(--accent)"/>
      <rect x="15" y="9" width="11" height="3" rx="1.5" fill="currentColor"/>
      <rect x="15" y="15" width="11" height="2.5" rx="1.25" fill="currentColor" opacity=".55"/>
      <rect x="15" y="20" width="7" height="2.5" rx="1.25" fill="currentColor" opacity=".55"/>
    </svg>
    DeckSmith
  </div>
  <p class="tag">A document in. An animated deck out.</p>
</header>

<main>
<!-- ================================================== compose -->
<section id="v-compose" aria-label="Build a deck">
  <!--
    A real form, not a div with a button on it. Enter submits from any field,
    the browser gives the controls their native grouping, and the FormData built
    from it IS the option set — so the fields a person sees and the fields the
    server receives cannot drift apart. The submit handler cancels the native
    post: the upload is a fetch, because the page has to stay on screen for the
    two to four minutes that follow.
  -->
  <form id="compose" method="post" action="/api/jobs" enctype="multipart/form-data">
  <div id="pick">
    <div class="drop" id="drop" role="button" tabindex="0"
         aria-label="Choose a document, or drop one here">
      <svg class="dropicon" width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <b>Drop a document</b>
      <span>or <em>browse your files</em></span>
      <small>.md &middot; .markdown &middot; .txt &middot; .zip with figures</small>
    </div>
    <!-- The drop zone is the labelled control that opens this picker, so the
         input itself is off the tab order: two stops for one action reads as a
         dead key press to anyone driving by keyboard. -->
    <input type="file" id="fileinput" class="sr" tabindex="-1" aria-label="Choose a document"
           accept=".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip">
  </div>

  <div id="chosen" hidden>
    <div class="file">
      <div class="fileicon" id="f-kind">MD</div>
      <div class="filebody">
        <div class="filename" id="f-name">—</div>
        <div class="filemeta" id="f-meta">—</div>
        <ul class="zip" id="f-zip" hidden></ul>
      </div>
      <!-- type=button is load-bearing. A bare <button> inside a form is a
           SUBMIT button, and this one sits above the real one in tree order —
           so Enter in any field would fire this instead, silently clearing the
           file and cancelling the build the user just asked for. -->
      <button class="x" id="f-clear" type="button" aria-label="Remove this file" title="Remove">&times;</button>
    </div>
  </div>

  <div class="opts">
    <div>
      <h2 class="sec" id="lbl-format">Format</h2>
      <div class="tiles" id="formats" role="radiogroup" aria-labelledby="lbl-format"></div>
      <p class="fmtnote" id="fmtnote"></p>
      <div class="custom" id="customsize" hidden>
        <input type="number" id="cw" name="width" min="${MIN_EDGE}" max="${MAX_SIDE}" step="2" value="1920" aria-label="Custom width in pixels" inputmode="numeric">
        <span aria-hidden="true">&times;</span>
        <input type="number" id="ch" name="height" min="${MIN_EDGE}" max="${MAX_SIDE}" step="2" value="1080" aria-label="Custom height in pixels" inputmode="numeric">
        <span>px</span>
      </div>
      <p class="fmtnote" id="sizenote" hidden></p>
    </div>

    <div class="row">
      <div>
        <h2 class="sec" id="lbl-theme">Theme</h2>
        <div class="chips" id="themes" role="radiogroup" aria-labelledby="lbl-theme"></div>
      </div>
      <div>
        <h2 class="sec"><label for="slides">Slides</label></h2>
        <div class="slider">
          <input type="range" id="slides" name="slides" min="3" max="40" value="12" aria-describedby="slidesout">
          <span class="num" id="slidesout">12 slides</span>
        </div>
      </div>
    </div>

    <!-- The three length knobs, and nothing else about length: duration and slide
         count here, narration density beside them. How many words a sentence gets
         and how fast the animation runs are DERIVED from these — see durationPlan
         in src/plan/duration.ts — because a 60-second target over the demo's 37
         narrated stops is four words a stop, not narration. Exposing the derived
         numbers as well would only be a way to disagree with the target. -->
    <div class="row">
      <div>
        <h2 class="sec"><label for="duration">Duration</label></h2>
        <input class="txt" type="number" id="duration" name="duration" min="10" max="1800" step="5"
               placeholder="Automatic &mdash; as long as it needs" aria-describedby="durhint" inputmode="numeric">
        <span class="sub" id="durhint">Seconds. Shortens what is said, then speeds up playback to close the gap.</span>
      </div>
      <div>
        <h2 class="sec" id="lbl-nd">Narration density</h2>
        <div class="seg" id="narrationDensity" role="radiogroup" aria-labelledby="lbl-nd"></div>
        <span class="sub" id="ndhint">high speaks at every reveal &middot; low speaks once a slide</span>
      </div>
    </div>

    <div class="row">
      <div>
        <h2 class="sec"><label for="lang">Language</label></h2>
        <select id="lang" name="lang">
          <option value="en">English</option>
          <option value="ko">한국어 &mdash; Korean</option>
          <option value="ja">日本語 &mdash; Japanese</option>
          <option value="zh">中文 &mdash; Chinese</option>
          <option value="__other">Other&hellip;</option>
        </select>
        <input class="txt txt-other" id="langother" hidden placeholder="BCP-47 tag, e.g. de-DE" aria-label="Language tag" style="margin-top:8px">
      </div>
      <div class="switches">
        <!-- Labelled like every other group, which it needs to be anyway: the
             column beside it opens with a .sec heading, so without one here
             the select started a label's height BELOW the first switch and the
             row read as misaligned rather than as two columns. -->
        <h2 class="sec">Include</h2>
        <label class="sws">
          <span><span class="lbl">Narration</span><span class="sub">Synthesised voice and subtitles &middot; ~25s</span></span>
          <span class="track"><input type="checkbox" id="narrate" name="narrate" checked></span>
        </label>
        <label class="sws">
          <span><span class="lbl">Video</span><span class="sub">Render an mp4 as well &middot; adds ~2 min</span></span>
          <span class="track"><input type="checkbox" id="video" name="video"></span>
        </label>
      </div>
    </div>

    <details class="more">
      <summary>More options</summary>
      <div class="row">
        <div>
          <h2 class="sec" id="lbl-tone">Tone</h2>
          <div class="seg" id="tone" role="radiogroup" aria-labelledby="lbl-tone"></div>
        </div>
        <div>
          <h2 class="sec" id="lbl-density">Density</h2>
          <div class="seg" id="density" role="radiogroup" aria-labelledby="lbl-density"></div>
        </div>
      </div>
      <div class="row">
        <div>
          <h2 class="sec"><label for="speed">Animation speed</label></h2>
          <div class="slider">
            <input type="range" id="speed" name="speed" min="0.25" max="3" step="0.25" value="1" aria-describedby="speedout">
            <span class="num" id="speedout">1&times;</span>
          </div>
          <!-- Demoted rather than deleted: it is still the knob for a deck with no
               target, and it is IGNORED when there is one. Said here, and warned
               about on the job, rather than silently losing. -->
          <span class="sub">Ignored when a duration is set &mdash; the target sets the pace.</span>
        </div>
        <div>
          <h2 class="sec"><label for="voice">Voice</label></h2>
          <input class="txt" id="voice" name="voice" placeholder="Automatic for the language and tone">
        </div>
      </div>
    </details>
  </div>

  <div class="action">
    <button class="go" id="go" type="submit" disabled>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12h14m0 0l-5.5-5.5M19 12l-5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span id="golabel">Generate deck</span>
    </button>
    <p class="hint" id="gohint">Choose a document to begin.</p>
  </div>
  </form>
</section>

<!-- ================================================== running -->
<section id="v-run" hidden aria-label="Building">
  <div class="stage">
    <h1 id="r-stage">Queued</h1>
    <div class="clock" id="r-clock">0:00</div>
    <p id="r-note">This usually takes two to four minutes. You can leave this tab open in the background.</p>
  </div>
  <ol class="steps" id="r-steps"></ol>
  <details class="log" open>
    <summary>Output</summary>
    <pre id="r-log" aria-live="polite" aria-atomic="false"></pre>
  </details>
  <p class="sr" id="r-sr" role="status" aria-live="polite"></p>
</section>

<!-- ================================================== done -->
<section id="v-done" hidden aria-label="Result">
  <div class="stage">
    <h1 id="d-title">Your deck is ready</h1>
    <div class="clock" id="d-clock">0:00</div>
  </div>

  <div class="tabs" id="d-tabs" role="tablist" hidden>
    <button role="tab" id="tab-deck" aria-selected="true" aria-controls="d-viewer">Deck</button>
    <button role="tab" id="tab-video" aria-selected="false" aria-controls="d-viewer">Video</button>
  </div>

  <div class="viewer" id="d-viewer">
    <div class="chrome">
      <div class="who" id="d-who">deck.html</div>
      <div class="btns">
        <button class="iconbtn" id="d-full">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          Full screen
        </button>
        <button class="iconbtn" id="d-open">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0116.5 20h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Open
        </button>
      </div>
    </div>
    <div class="canvas" id="d-canvas"></div>
  </div>

  <div class="facts" id="d-facts"></div>
  <ul class="warns" id="d-warns" hidden></ul>
  <div class="gets" id="d-gets"></div>
  <div class="action" style="margin-top:26px">
    <button class="ghost" id="d-again" style="align-self:flex-start">Make another deck</button>
  </div>
</section>

<!-- ================================================== error -->
<section id="v-error" hidden aria-label="Failed">
  <div class="fail">
    <div class="who">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/></svg>
      <span id="e-where">Failed</span>
    </div>
    <h1 id="e-msg">Something went wrong.</h1>
    <p class="hint" id="e-hint"></p>
    <div class="acts">
      <button class="ghost" id="e-retry">Try again</button>
      <button class="ghost" id="e-reset">Start over</button>
    </div>
  </div>
  <details class="log" id="e-logwrap" hidden>
    <summary>Output</summary>
    <pre id="e-log"></pre>
  </details>
</section>
</main>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
(function(){
"use strict";

/* Server tables, inlined so the page renders correctly before /api/formats
   answers — and refreshed from that endpoint the moment it does. */
var FORMATS = ${JSON.stringify(FALLBACK_FORMATS)};
var THEME_CHIPS = ${JSON.stringify(THEME_CHIPS)};

/* What this server will actually BUILD, not what a number input happens to
   allow. These four were hardcoded here as 240..7680 while the server refused
   anything outside 320..2560 — so the picker's own maximum, 3840x2160, came
   back 400 with a hint this page then threw away. Interpolated from the server's
   own constants and re-read from /api/formats, so there is one table. */
var CANVAS = {
  minSide: ${MIN_EDGE},
  maxSide: ${MAX_SIDE},
  maxPixels: ${MAX_PIXELS},
  maxAspect: ${MAX_ASPECT},
  legibleWidth: ${LEGIBLE_W}
};

/* What each stage typically costs on the demo document. Shown as a muted "~"
   next to a step that has not started, and never as a bar: the point is to set
   an expectation, not to imply knowledge of progress the server has not sent.
   The one thing worse than a slow build is a slow build you think has hung. */
var TYPICAL = { ingest: 3, plan: 60, narrate: 25, build: 8, render: 120 };
var STAGE_WORDS = {
  ingest: "Reading the document",
  plan: "Planning the story",
  narrate: "Recording the narration",
  build: "Building the deck",
  render: "Rendering the video"
};

var $ = function(id){ return document.getElementById(id); };
var on = function(node, ev, fn){ node.addEventListener(ev, fn); };
function el(tag, cls, text){
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/* ------------------------------------------------------------- state */
var file = null;          // the File the user picked
var jobId = null;         // the id the server gave us
var startedAt = 0;        // client clock, for the elapsed readout
var ticker = null;
var stop = null;          // tears down whichever watcher is live
var lastJob = null;       // last payload, for retry and for the error view

/* ------------------------------------------------------------- helpers */
function bytes(n){
  if (n < 1024) return n + " B";
  var u = ["KB","MB","GB"], i = -1, v = n;
  do { v = v / 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + " " + u[i];
}
function clock(ms){
  var s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function shortMs(ms){
  if (!(ms > 0)) return "";
  return ms < 1000 ? Math.round(ms) + "ms" : (ms < 60000
    ? (Math.round(ms / 100) / 10) + "s"
    : Math.floor(ms / 60000) + "m " + Math.round((ms % 60000) / 1000) + "s");
}
function approx(sec){ return sec >= 60 ? "~" + Math.round(sec / 60) + "m" : "~" + sec + "s"; }
function gcd(a, b){ return b ? gcd(b, a % b) : a; }
function ratio(w, h){ var g = gcd(w, h) || 1; return (w / g) + ":" + (h / g); }

var toastTimer = null;
function toast(msg){
  var t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove("on"); }, 1900);
}

function show(which){
  ["v-compose","v-run","v-done","v-error"].forEach(function(id){
    $(id).hidden = (id !== which);
  });
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------- formats */
var chosenFormat = "deck-16x9";

var DESCRIBE = {};

function paintFormats(){
  var box = $("formats");
  box.textContent = "";
  DESCRIBE = { custom: "Any canvas you type. Everything else follows the deck profile." };
  FORMATS.forEach(function(f){
    /* Deck and Video are both 1920x1080, so the pixel count cannot be what
       tells them apart — what differs is whether a person clicks through it or
       watches it play. The tile carries the shape; this sentence carries the
       rest, under whichever tile is chosen. */
    var how = f.navigable ? "you click through it" : "it plays start to finish";
    DESCRIBE[f.id] = f.width + "\\u00d7" + f.height + " \\u00b7 " + how;
    box.appendChild(tile(f.id, label(f), ratio(f.width, f.height),
      label(f) + " \\u2014 " + DESCRIBE[f.id], f.width / f.height));
  });
  box.appendChild(tile("custom", "Custom", "any size", "Custom \\u2014 " + DESCRIBE.custom, 0));
  select(chosenFormat);
}
function label(f){
  var n = f.id.split("-")[0];
  return n.charAt(0).toUpperCase() + n.slice(1);
}
function tile(id, name, dim, full, num){
  var l = el("label", "tile");
  l.title = full;
  var input = document.createElement("input");
  input.type = "radio"; input.name = "format"; input.value = id;
  input.setAttribute("aria-label", full);
  var box = el("span", "ratio");
  // An <i>, because the ".ratio i" rule below styles the element, not a class.
  var i = el("i");
  if (num > 0) {
    /* Drawn at the format's TRUE ratio — a 9:16 tile that looks square teaches
       the wrong thing about the output. */
    i.style.aspectRatio = String(num);
    if (num >= 1) i.style.width = "44px"; else i.style.height = "32px";
  } else {
    i.className = "any";
    i.style.width = "38px";
    i.style.height = "28px";
  }
  box.appendChild(i);
  l.appendChild(input);
  l.appendChild(box);
  l.appendChild(el("span", "tname", name));
  l.appendChild(el("span", "tdim", dim));
  on(input, "change", function(){ if (input.checked) select(id); });
  return l;
}
function select(id){
  chosenFormat = id;
  var found = false;
  Array.prototype.forEach.call(document.querySelectorAll('input[name=format]'), function(r){
    r.checked = (r.value === id);
    if (r.checked) found = true;
  });
  if (!found) {
    var first = document.querySelector('input[name=format]');
    if (first) { first.checked = true; chosenFormat = first.value; }
  }
  var custom = (chosenFormat === "custom");
  $("customsize").hidden = !custom;
  /* DISABLED, not merely hidden, and that is load-bearing twice over. A
     display:none number input is still constraint-validated, so a stale "50"
     left in the width box after switching back to Deck would block the form
     with a bubble the browser cannot show — the button would simply do
     nothing. Disabling also drops the pair from the FormData, which is exactly
     the "no size unless custom" the contract asks for. */
  $("cw").disabled = !custom;
  $("ch").disabled = !custom;
  $("fmtnote").textContent = DESCRIBE[chosenFormat] || "";
  refreshSize();
}

function currentSize(){
  if (chosenFormat === "custom") {
    return { w: clampPx($("cw").value, 1920), h: clampPx($("ch").value, 1080) };
  }
  var f = FORMATS.filter(function(x){ return x.id === chosenFormat; })[0];
  return f ? { w: f.width, h: f.height } : { w: 1920, h: 1080 };
}
/* Even, because h264 needs it and the server would otherwise round and warn. */
function clampPx(v, dflt){
  var n = Math.round(Number(v));
  if (!isFinite(n) || n < CANVAS.minSide) return dflt;
  n = Math.min(CANVAS.maxSide, n);
  return n % 2 === 0 ? n : n - 1;
}

/**
 * Why a custom canvas would be refused, in the page's own words, or null.
 *
 * The same three rules the server applies, checked here only so the answer
 * arrives while the number is being typed rather than after an upload. The
 * SERVER is still the authority — this never suppresses a request it would have
 * accepted, and its refusals are the ones that get displayed.
 */
function sizeProblem(w, h){
  if (w * h > CANVAS.maxPixels) {
    return (w * h / 1e6).toFixed(1) + " megapixels is over this server's "
      + (CANVAS.maxPixels / 1e6) + " megapixel ceiling.";
  }
  var aspect = Math.max(w / h, h / w);
  if (aspect > CANVAS.maxAspect) {
    return aspect.toFixed(1) + ":1 is too " + (w > h ? "wide" : "tall")
      + " — the scene padding would take most of the frame. Keep it within 1:"
      + CANVAS.maxAspect + " and " + CANVAS.maxAspect + ":1.";
  }
  return null;
}

/** Advisory only, and phrased as such: legal, probably not what was meant. */
function sizeWarning(w, h){
  if (w < CANVAS.legibleWidth) {
    return w + "px wide is under " + CANVAS.legibleWidth
      + "px — this will build, but the type will be too small to read. Open a frame before you ship it.";
  }
  return null;
}

/* Say it under the boxes, live, and disable the button on a hard refusal. */
function refreshSize(){
  var note = $("sizenote");
  if (chosenFormat !== "custom") { note.hidden = true; refreshAction(); return; }
  var s = currentSize();
  var bad = sizeProblem(s.w, s.h);
  var warn = bad ? null : sizeWarning(s.w, s.h);
  note.textContent = bad || warn || (s.w + "\\u00d7" + s.h + " \\u00b7 " + ratio(s.w, s.h));
  note.className = "fmtnote" + (bad ? " bad" : "");
  note.hidden = false;
  refreshAction();
}

/* The preset a custom size borrows its behaviour from. A custom canvas still
   has to be one of the pipeline's profiles, and the only bit that matters
   downstream is whether the deck is click-through-able — so a custom deck is a
   deck unless the user asked for a video. Stated here because it is the one
   place this page decides something the contract did not. */
function basePreset(){
  if (chosenFormat !== "custom") return chosenFormat;
  return $("video").checked ? "video-16x9" : "deck-16x9";
}

/* ------------------------------------------------------------- themes/segs */
function paintThemes(){
  var box = $("themes");
  THEME_CHIPS.forEach(function(t, idx){
    var l = el("label", "chip");
    var input = document.createElement("input");
    input.type = "radio"; input.name = "theme"; input.value = t.name;
    input.checked = (t.name === "ink");
    var sw = el("span", "sw");
    [t.bg, t.accent, t.tone].forEach(function(c){
      var i = el("i"); i.style.background = c; sw.appendChild(i);
    });
    l.appendChild(input); l.appendChild(sw); l.appendChild(el("span", null, t.name));
    box.appendChild(l);
    if (idx === 0 && !THEME_CHIPS.some(function(x){ return x.name === "ink"; })) input.checked = true;
  });
}
function paintSeg(id, values, dflt){
  var box = $(id);
  values.forEach(function(v){
    var l = el("label");
    var input = document.createElement("input");
    input.type = "radio"; input.name = id; input.value = v;
    input.checked = (v === dflt);
    l.appendChild(input); l.appendChild(el("span", null, v));
    box.appendChild(l);
  });
}

/* ------------------------------------------------------------- the file */
var ACCEPT = /\\.(md|markdown|txt|zip)$/i;

function setFile(f){
  if (!f) return;
  if (!ACCEPT.test(f.name)) {
    toast("Needs a .md, .markdown, .txt or .zip file");
    return;
  }
  file = f;
  var isZip = /\\.zip$/i.test(f.name);
  $("f-kind").textContent = isZip ? "ZIP" : (f.name.split(".").pop() || "MD").toUpperCase().slice(0, 4);
  $("f-name").textContent = f.name;
  $("f-meta").textContent = bytes(f.size);
  $("f-zip").hidden = true;
  $("f-zip").textContent = "";
  $("pick").hidden = true;
  $("chosen").hidden = false;
  refreshAction();
  if (isZip) peekZip(f);
}

function clearFile(){
  file = null;
  $("fileinput").value = "";
  $("chosen").hidden = true;
  $("pick").hidden = false;
  refreshAction();
  $("drop").focus();
}

/**
 * Name the entries in a zip without unzipping it.
 *
 * A zip's central directory sits at the END of the file, so this reads at most
 * the last 96KB plus the directory itself — a 200MB archive costs two small
 * range reads, which is what makes it cheap enough to do on every pick. Zip64
 * and encrypted archives are simply not described; the card still shows the
 * name and the size, which is the part that must never fail.
 */
function peekZip(f){
  var tailLen = Math.min(f.size, 96 * 1024);
  f.slice(f.size - tailLen).arrayBuffer().then(function(buf){
    var tail = new DataView(buf);
    var eocd = -1;
    for (var i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return;
    var count = tail.getUint16(eocd + 10, true);
    var size = tail.getUint32(eocd + 12, true);
    var offset = tail.getUint32(eocd + 16, true);
    if (offset === 0xffffffff || size === 0xffffffff) return;   // zip64, not our business
    return f.slice(offset, offset + size).arrayBuffer().then(function(cd){
      return { view: new DataView(cd), bytes: new Uint8Array(cd), count: count };
    });
  }).then(function(cd){
    if (!cd) return;
    var names = [], p = 0, dec = new TextDecoder("utf-8");
    while (p + 46 <= cd.view.byteLength && cd.view.getUint32(p, true) === 0x02014b50) {
      var nlen = cd.view.getUint16(p + 28, true);
      var elen = cd.view.getUint16(p + 30, true);
      var clen = cd.view.getUint16(p + 32, true);
      var name = dec.decode(cd.bytes.subarray(p + 46, p + 46 + nlen));
      if (name.charAt(name.length - 1) !== "/" && name.indexOf("__MACOSX/") !== 0) names.push(name);
      p += 46 + nlen + elen + clen;
    }
    if (!names.length) return;
    paintZip(names);
  }).catch(function(){ /* an unreadable zip is the server's problem to report */ });
}

function paintZip(names){
  var docs = names.filter(function(n){ return /\\.(md|markdown|txt)$/i.test(n); });
  var imgs = names.filter(function(n){ return /\\.(png|jpe?g|gif|svg|webp|pdf)$/i.test(n); });
  var ul = $("f-zip");
  ul.textContent = "";
  docs.slice(0, 2).forEach(function(n){
    ul.appendChild(el("li", "main", n.split("/").pop()));
  });
  if (imgs.length) ul.appendChild(el("li", "rest", imgs.length + (imgs.length === 1 ? " figure" : " figures")));
  var others = names.length - docs.length - imgs.length;
  if (others > 0) ul.appendChild(el("li", "rest", others + " other" + (others === 1 ? "" : "s")));
  ul.hidden = false;
  $("f-meta").textContent = bytes(file.size) + " \\u00b7 " + names.length + " file" + (names.length === 1 ? "" : "s");
  if (!docs.length) {
    ul.appendChild(el("li", "rest", "no markdown found"));
  }
}

/* ------------------------------------------------------------- action state */
function refreshAction(){
  var s = currentSize();
  var ready = !!file && !sizeProblem(s.w, s.h);
  $("go").disabled = !ready;
  $("golabel").textContent = $("video").checked ? "Generate deck and video" : "Generate deck";
  var est = $("video").checked ? "about four minutes" : "about two minutes";
  $("gohint").textContent = ready
    ? "Takes " + est + ". Keep this tab open."
    : "Choose a document to begin.";
}

/* ------------------------------------------------------------- submit */
/**
 * Build the multipart body from the form, then fix up the four things the
 * browser's own serialisation gets wrong for this contract.
 *
 * Reading the form rather than listing the fields again is what stops a control
 * being added to the markup and quietly never reaching the server.
 */
function submit(){
  if (!file) return;
  var size = currentSize();
  var fd = new FormData($("compose"));

  // 1. The file. Deliberately not a named input: a DROPPED file never lands in
  //    <input type=file>, so there is exactly one source of truth for it.
  fd.append("file", file, file.name);

  // 2. Format. "custom" is this page's word, not the API's — it means a preset
  //    plus an explicit canvas. The size pair is absent for every other format
  //    because select() disables the inputs; here it is only re-stated so an
  //    EMPTY box (which passes validation) becomes a number rather than "".
  fd.set("format", basePreset());
  if (chosenFormat === "custom") {
    fd.set("width", String(size.w));
    fd.set("height", String(size.h));
  }

  // 3. Checkboxes. An unticked box is ABSENT from a form, which the server
  //    cannot tell from "the user said nothing" — so both are stated outright.
  fd.set("narrate", $("narrate").checked ? "true" : "false");
  fd.set("video", $("video").checked ? "true" : "false");

  // 4. Language may come from the free-text box behind "Other…", and an empty
  //    voice means "pick one", which is the server's default, not a value.
  fd.set("lang", langValue());
  if (!$("voice").value.trim()) fd.delete("voice");

  lastSize = size;
  startedAt = Date.now();
  jobId = null;
  lastJob = null;
  paintSteps(plannedSteps(), null);
  $("r-stage").textContent = "Uploading";
  $("r-log").textContent = "";
  $("r-clock").textContent = "0:00";
  show("v-run");
  tick(true);

  fetch("/api/jobs", { method: "POST", body: fd })
    .then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(body){
        /* CARRY THE SERVER'S OWN HINT. Every refusal from /api/jobs arrives as
           {message, hint} and the hint is the half that says what to do about
           it — "Canvases run 64-5656px a side", "Export the document to markdown
           first". This used to throw a bare Error and then attach a fixed hint
           of its own ("check that the server is running"), which was not merely
           less useful but WRONG: the server had just answered, in detail. */
        if (!res.ok) {
          var e = (body && body.error) || {};
          throw Object.assign(new Error(e.message || "The server refused the upload (HTTP " + res.status + ")."),
            { hint: e.hint || "", where: "upload" });
        }
        if (!body || !body.id) throw new Error("The server accepted the upload but did not return a job id.");
        return body.id;
      });
    })
    .then(function(id){ jobId = id; $("r-stage").textContent = "Queued"; watch(id); })
    .catch(function(err){
      /* A hint only when we actually have one. The fallback below is for the
         case this really is — fetch itself rejected, so nothing answered. */
      fail({ message: err && err.message ? err.message : String(err),
             hint: (err && err.hint) ||
               "Check that the DeckSmith server is running and reachable, then try again." }, "upload");
    });
}

var lastSize = { w: 1920, h: 1080 };

function langValue(){
  var v = $("lang").value;
  if (v !== "__other") return v;
  return $("langother").value.trim() || "en";
}

/** The steps we expect, used only until the server sends its own list. */
function plannedSteps(){
  var names = ["ingest", "plan"];
  if ($("narrate").checked) names.push("narrate");
  names.push("build");
  if ($("video").checked) names.push("render");
  return names.map(function(n){ return { name: n, state: "pending" }; });
}

/* ------------------------------------------------------------- watching */
/**
 * Follow a job. SSE when the server has it, polling when it does not.
 *
 * The events endpoint is optional in the contract, so this cannot depend on it:
 * a 404 fires onerror and we fall back. The silence watchdog covers the nastier
 * case — a proxy that holds the stream open and buffers every event, which looks
 * exactly like a hung build from here and would otherwise never recover.
 */
function watch(id){
  var closed = false;
  var timer = null, es = null, watchdog = null;

  function teardown(){
    closed = true;
    if (timer) clearTimeout(timer);
    if (watchdog) clearTimeout(watchdog);
    if (es) { try { es.close(); } catch (e) {} }
  }
  stop = teardown;

  /* A 404 is terminal, and treating it as one is the whole difference between an
     error and a hang. The status was ignored here: a 404 body has no state field, so
     apply() did nothing and the timer went round again — for as long as the tab
     stayed open, several requests a second in the console and a progress panel
     frozen mid-stage. That is what "it hangs" looks like from the outside. */
  function gone(){
    closed = true;
    teardown();
    fail({ message: "This job is no longer on the server.",
           hint: "The server keeps its job list in memory, so a restart loses track of a "
               + "run in progress. Choose the file again." }, "upload");
  }

  /* The server kept the upload, so the honest response is an offer rather than an
     apology: one request re-queues the same file with the same settings. */
  function interrupted(job){
    closed = true;
    teardown();
    fail({ message: "The server restarted while this deck was being made.",
           hint: "Your file (" + (job.filename || "the upload") + ") is still here, with the "
               + "settings you chose.",
           retry: id }, "upload");
  }

  function poll(){
    if (closed) return;
    fetch("/api/jobs/" + encodeURIComponent(id), { cache: "no-store" })
      .then(function(r){ if (r.status === 404) { gone(); return null; } return r.json(); })
      .then(function(job){ if (!job || closed) return;
        if (job.state === "interrupted") { interrupted(job); return; }
        apply(job); timer = setTimeout(poll, 1800); })
      .catch(function(){ if (!closed) timer = setTimeout(poll, 3000); });
  }

  function fallback(){
    if (closed || !es) return;
    try { es.close(); } catch (e) {}
    es = null;
    poll();
  }

  /* One immediate read regardless of transport, so the first paint does not
     wait on an SSE handshake. */
  fetch("/api/jobs/" + encodeURIComponent(id), { cache: "no-store" })
    .then(function(r){ if (r.status === 404) { gone(); return null; } return r.json(); })
    .then(function(job){ if (!job) return;
      if (job.state === "interrupted") { interrupted(job); return; }
      apply(job); })
    .catch(function(){});

  if (typeof EventSource === "function") {
    try { es = new EventSource("/api/jobs/" + encodeURIComponent(id) + "/events"); } catch (e) { es = null; }
  }
  if (es) {
    watchdog = setTimeout(fallback, 12000);
    es.onmessage = function(ev){
      clearTimeout(watchdog);
      watchdog = setTimeout(fallback, 45000);
      try { apply(JSON.parse(ev.data)); } catch (e) {}
    };
    es.onerror = fallback;
  } else {
    timer = setTimeout(poll, 1500);
  }
}

/* The server may spell a step's state any number of ways; normalise once. */
function stateOf(s){
  var v = String(s || "pending").toLowerCase();
  if (v === "ok" || v === "complete" || v === "completed" || v === "success") return "done";
  if (v === "active" || v === "started" || v === "busy") return "running";
  if (v === "failed" || v === "err") return "error";
  if (v === "skip" || v === "skipped") return "skipped";
  if (v === "done" || v === "running" || v === "error") return v;
  return "pending";
}

function apply(job){
  if (!job || typeof job !== "object") return;
  lastJob = job;

  var steps = Array.isArray(job.steps) && job.steps.length ? job.steps : plannedSteps();
  paintSteps(steps, job.stage);

  /* QUEUED IS NOT A STAGE, AND IT IS THE ONE STATE WITH NOTHING TO SHOW. The
     server runs one job at a time and sends queuePosition for exactly this
     moment; without it a wait behind three other papers is indistinguishable
     from a hang, and the step list is all "pending" the whole time. */
  var stage = job.stage && STAGE_WORDS[job.stage] ? STAGE_WORDS[job.stage] : null;
  var queued = job.state === "queued";
  /* queuePosition is 1 for the first job WAITING, and a running job has none
     — so the number is exactly how many jobs are ahead of this one. */
  var ahead = typeof job.queuePosition === "number" ? job.queuePosition : 0;
  $("r-stage").textContent = queued
    ? (ahead > 0 ? "Queued \\u00b7 " + ahead + (ahead === 1 ? " job" : " jobs") + " ahead" : "Queued")
    : (stage || "Working");

  if (Array.isArray(job.log)) {
    var pre = $("r-log");
    var pinned = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
    var text = job.log.slice(-300).join("\\n");
    if (text !== pre.textContent) {
      pre.textContent = text;
      if (pinned) pre.scrollTop = pre.scrollHeight;
    }
  }

  /* Elapsed prefers the server's own clock: a reload mid-build must not restart
     the timer at zero, which would read as "it started over". */
  var earliest = firstStart(steps);
  if (earliest && earliest < startedAt) startedAt = earliest;

  if (job.state === "error") { fail(job.error, job.stage); return; }
  if (job.state === "done") { finish(job); return; }
}

function firstStart(steps){
  var best = 0;
  steps.forEach(function(s){
    var t = typeof s.startedAt === "number" ? s.startedAt : Date.parse(s.startedAt || "");
    if (t && (!best || t < best)) best = t;
  });
  return best || 0;
}

function paintSteps(steps, stage){
  var ol = $("r-steps");
  ol.textContent = "";
  steps.forEach(function(s){
    var st = stateOf(s.state);
    if (st === "pending" && stage && s.name === stage) st = "running";
    var li = el("li");
    li.setAttribute("data-s", st);
    li.appendChild(el("span", "bead"));
    var grow = el("div", "grow");
    grow.appendChild(el("div", "nm", s.name));
    var detail = s.detail || (st === "pending" && TYPICAL[s.name] ? "typically " + approx(TYPICAL[s.name]) : "");
    if (detail) grow.appendChild(el("div", "dt", detail));
    li.appendChild(grow);
    var ms = shortMs(s.ms);
    if (ms) li.appendChild(el("span", "ms", ms));
    ol.appendChild(li);
  });
  var running = steps.filter(function(s){ return stateOf(s.state) === "running"; })[0];
  $("r-sr").textContent = running ? (STAGE_WORDS[running.name] || running.name) : "";
}

function tick(start){
  if (ticker) clearInterval(ticker);
  if (!start) return;
  ticker = setInterval(function(){
    $("r-clock").textContent = clock(Date.now() - startedAt);
  }, 1000);
}

/* ------------------------------------------------------------- done */
function finish(job){
  if (stop) stop();
  tick(false);
  var r = job.result || {};
  $("d-clock").textContent = clock(Date.now() - startedAt);

  var ar = lastSize.w + " / " + lastSize.h;
  var canvas = $("d-canvas");
  var viewer = $("d-viewer");
  viewer.style.setProperty("--ar", ar);
  // --arn is the same ratio as a bare number, which is what the height calc in
  // .canvas divides by; --ar stays for the fullscreen rule's aspect-ratio.
  viewer.style.setProperty("--arn", String(lastSize.w / lastSize.h));

  var hasVideo = !!r.videoUrl;
  $("d-title").textContent = hasVideo && r.deckUrl
    ? "Your deck and video are ready"
    : (hasVideo ? "Your video is ready" : "Your deck is ready");
  $("d-tabs").hidden = !hasVideo || !r.deckUrl;
  $("tab-deck").setAttribute("aria-selected", "true");
  $("tab-video").setAttribute("aria-selected", "false");
  mount(r.deckUrl ? "deck" : "video", r);

  var facts = $("d-facts");
  facts.textContent = "";
  addFact(facts, r.slides, "slides");
  if (r.duration) addFact(facts, clock(Number(r.duration) * 1000), "long");
  addFact(facts, lastSize.w + "\\u00d7" + lastSize.h, ratio(lastSize.w, lastSize.h));

  var gets = $("d-gets");
  gets.textContent = "";
  if (r.videoUrl) gets.appendChild(link(r.videoUrl, "Download mp4"));
  if (r.srtUrl) gets.appendChild(link(r.srtUrl, "Subtitles .srt"));
  if (r.packUrl) gets.appendChild(link(r.packUrl, "Deck pack .deck"));
  if (r.deckUrl) {
    var copy = el("button", null, "Copy link");
    on(copy, "click", function(){
      var url = new URL(r.deckUrl, location.href).href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function(){ toast("Link copied"); },
          function(){ prompt("Copy this link:", url); });
      } else { prompt("Copy this link:", url); }
    });
    gets.appendChild(copy);
  }

  var warns = $("d-warns");
  warns.textContent = "";
  var list = Array.isArray(r.warnings) ? r.warnings : [];
  list.forEach(function(w){
    warns.appendChild(el("li", null, typeof w === "string" ? w : (w && w.message) || JSON.stringify(w)));
  });
  warns.hidden = list.length === 0;

  show("v-done");
}

function addFact(box, value, word){
  if (value === undefined || value === null || value === "") return;
  var span = el("span");
  span.appendChild(el("b", null, value));
  span.appendChild(document.createTextNode(" " + word));
  box.appendChild(span);
}
function link(href, text){
  var a = el("a", null, text);
  a.href = href;
  a.setAttribute("download", "");
  return a;
}

/**
 * SRT IS NOT A FORMAT THE TRACK ELEMENT READS.
 *
 * Pointing a subtitles track straight at video.srt looks right and does
 * nothing: the element only parses WebVTT, so Chrome sets readyState 3 (ERROR)
 * and the cue list stays empty — measured, with the captions button never
 * appearing at all. The two formats differ by a header line and a comma, so the
 * conversion happens here rather than adding a second subtitle file to the
 * pipeline's output contract.
 */
function vttFrom(srt){
  return "WEBVTT\\n\\n" + String(srt)
    .replace(/\\r\\n/g, "\\n")
    .replace(/(\\d\\d:\\d\\d:\\d\\d),(\\d\\d\\d)/g, "$1.$2");
}

var mounted = { kind: null, result: null };
function mount(kind, r){
  mounted = { kind: kind, result: r };
  var canvas = $("d-canvas");
  var viewer = $("d-viewer");
  canvas.textContent = "";
  if (kind === "video" && r.videoUrl) {
    // The video is the composition and nothing else; no chrome to make room for.
    viewer.style.setProperty("--chrome", "0px");
    var v = document.createElement("video");
    v.src = r.videoUrl; v.controls = true; v.playsInline = true; v.preload = "metadata";
    if (r.srtUrl) {
      var t = document.createElement("track");
      // Deliberately not defaulted on: a slide often carries its own line of
      // text along the bottom of the frame, and a caption forced on lands right
      // above it. The track being loadable is what was missing; whether it shows
      // is the viewer's call, through the player's own captions control.
      t.kind = "subtitles"; t.srclang = "en"; t.label = "Subtitles";
      // A blob, not the .srt URL — see vttFrom. Failure is silent and costs only
      // the captions: a video with no usable track still plays.
      fetch(r.srtUrl).then(function(res){ return res.text(); }).then(function(srt){
        t.src = URL.createObjectURL(new Blob([vttFrom(srt)], { type: "text/vtt" }));
      }, function(){});
      v.appendChild(t);
    }
    canvas.appendChild(v);
    $("d-who").textContent = String(r.videoUrl).split("/").pop() || "video.mp4";
  } else if (r.deckUrl) {
    var f = document.createElement("iframe");
    f.src = r.deckUrl;
    f.setAttribute("allow", "fullscreen; autoplay");
    f.setAttribute("allowfullscreen", "");
    f.title = "The built deck";
    // Measured, not assumed: the deck's chrome is whatever the player it ships
    // with draws below the stage, and hardcoding today's 77px would pillarbox
    // again the day that number moves. Same-origin, so this is readable; if it
    // ever is not, --chrome stays 0 and the deck is no worse than it was.
    f.addEventListener("load", function(){
      var extra = 0;
      try {
        var stage = f.contentDocument.querySelector("hyperframes-player");
        if (stage) extra = Math.max(0, Math.round(f.clientHeight - stage.getBoundingClientRect().height));
      } catch (e) { extra = 0; }
      viewer.style.setProperty("--chrome", extra + "px");
    });
    canvas.appendChild(f);
    $("d-who").textContent = String(r.deckUrl).replace(/^https?:\\/\\/[^/]+/, "");
  }
}

/* ------------------------------------------------------------- error */
function fail(err, where){
  if (stop) stop();
  tick(false);
  var e = err || {};
  $("e-where").textContent = where ? ("Failed during " + where) : "Failed";
  $("e-msg").textContent = e.message || "The build stopped without saying why.";
  $("e-hint").textContent = e.hint || "";
  $("e-hint").hidden = !e.hint;
  var log = lastJob && Array.isArray(lastJob.log) ? lastJob.log : [];
  $("e-log").textContent = log.slice(-300).join("\\n");
  $("e-logwrap").hidden = log.length === 0;
  /* An error with a retained upload is recoverable in one click, so it gets a
     button rather than only an explanation. Built here rather than in the markup
     because it exists for exactly one failure shape. */
  var old = $("e-retry");
  if (old) old.remove();
  if (e.retry) {
    var b = document.createElement("button");
    b.className = "go"; b.id = "e-retry"; b.type = "button"; b.textContent = "Run it again";
    b.onclick = function(){
      b.disabled = true; b.textContent = "Starting\u2026";
      fetch("/api/jobs/" + encodeURIComponent(e.retry) + "/retry", { method: "POST" })
        .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(o){
          if (!o.ok || !o.j || !o.j.id) throw new Error((o.j && o.j.error && o.j.error.message) || "Retry failed.");
          jobId = o.j.id;
          show("v-run");
          $("r-stage").textContent = "Queued";
          watch(o.j.id);
        })
        .catch(function(err){
          b.disabled = false; b.textContent = "Run it again";
          $("e-hint").textContent = err.message;
        });
    };
    $("e-hint").insertAdjacentElement("afterend", b);
  }
  show("v-error");
}

/* ------------------------------------------------------------- wiring */
paintFormats();
paintThemes();
paintSeg("tone", ["plain", "academic", "conversational", "punchy"], "plain");
paintSeg("density", ["sparse", "normal", "dense"], "normal");
paintSeg("narrationDensity", ["high", "medium", "low"], "high");

/* Refresh the picker from the server when it can tell us; the inlined table is
   only a floor. Shape-checked because a stray 200 with an HTML body would
   otherwise wipe the picker. */
fetch("/api/formats", { cache: "no-store" })
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(list){
    var arr = Array.isArray(list) ? list : (list && Array.isArray(list.formats) ? list.formats : null);
    if (!arr) return;
    var ok = arr.filter(function(f){ return f && f.id && f.width > 0 && f.height > 0; });
    if (!ok.length) return;
    FORMATS = ok;
    /* The canvas bounds travel with the format table. Taken field by field, so a
       server that sends only some of them keeps the interpolated rest. */
    var c = list && list.canvas;
    if (c) {
      ["minSide","maxSide","maxPixels","maxAspect","legibleWidth"].forEach(function(k){
        if (typeof c[k] === "number" && c[k] > 0) CANVAS[k] = c[k];
      });
      $("cw").min = $("ch").min = String(CANVAS.minSide);
      $("cw").max = $("ch").max = String(CANVAS.maxSide);
    }
    paintFormats();
  })
  .catch(function(){});

var drop = $("drop"), input = $("fileinput");
on(drop, "click", function(){ input.click(); });
on(drop, "keydown", function(e){
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
});
on(input, "change", function(){ setFile(input.files && input.files[0]); });
on($("f-clear"), "click", clearFile);

/* Drag state is counted, not toggled: dragleave fires when the pointer crosses
   onto a CHILD of the drop zone, and a plain toggle flickers the whole time the
   file is being moved around inside it. */
var depth = 0;
["dragenter","dragover"].forEach(function(ev){
  on(window, ev, function(e){
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (ev === "dragenter") depth++;
    if (!$("pick").hidden || ev === "dragenter") drop.classList.add("over");
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
});
on(window, "dragleave", function(e){ if (hasFiles(e) && --depth <= 0) { depth = 0; drop.classList.remove("over"); } });
on(window, "drop", function(e){
  if (!hasFiles(e)) return;
  e.preventDefault();
  depth = 0;
  drop.classList.remove("over");
  setFile(e.dataTransfer.files[0]);
});
function hasFiles(e){
  var dt = e.dataTransfer;
  if (!dt) return false;
  if (dt.types && Array.prototype.indexOf.call(dt.types, "Files") >= 0) return true;
  return !!(dt.files && dt.files.length);
}

on($("cw"), "input", refreshSize);
on($("ch"), "input", refreshSize);
on($("slides"), "input", function(){ $("slidesout").textContent = $("slides").value + " slides"; });
on($("speed"), "input", function(){ $("speedout").textContent = $("speed").value + "\\u00d7"; });
on($("lang"), "change", function(){
  var other = $("lang").value === "__other";
  $("langother").hidden = !other;
  if (other) $("langother").focus();
});
on($("narrate"), "change", function(){
  /* A video with no voice is legal, so this only nudges: silence is almost
     never what someone meant by "render me a video". */
  if (!$("narrate").checked && $("video").checked) toast("The video will have no narration");
  refreshAction();
});
on($("video"), "change", refreshAction);
/* The form, not the button: this also catches Enter pressed in the custom-size
   or voice field, which is what a person expects a form to do. */
on($("compose"), "submit", function(e){ e.preventDefault(); submit(); });

on($("tab-deck"), "click", function(){ pickTab("deck"); });
on($("tab-video"), "click", function(){ pickTab("video"); });
function pickTab(kind){
  $("tab-deck").setAttribute("aria-selected", String(kind === "deck"));
  $("tab-video").setAttribute("aria-selected", String(kind === "video"));
  mount(kind, mounted.result || {});
}

on($("d-full"), "click", function(){
  var v = $("d-viewer");
  if (document.fullscreenElement) document.exitFullscreen();
  else if (v.requestFullscreen) v.requestFullscreen().catch(function(){ toast("Full screen was blocked"); });
  else toast("This browser will not go full screen");
});
on($("d-open"), "click", function(){
  var r = mounted.result || {};
  var url = mounted.kind === "video" ? r.videoUrl : r.deckUrl;
  if (url) window.open(url, "_blank", "noopener");
});
on($("d-again"), "click", function(){ clearFile(); show("v-compose"); });
on($("e-reset"), "click", function(){ clearFile(); show("v-compose"); });
on($("e-retry"), "click", function(){ if (file) submit(); else show("v-compose"); });

/* Leaving mid-build loses the job, so say so. Only while one is live. */
on(window, "beforeunload", function(e){
  if (!$("v-run").hidden && jobId) { e.preventDefault(); e.returnValue = ""; }
});

refreshAction();
})();
</script>
</body>
</html>`;
}

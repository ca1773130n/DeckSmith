/**
 * A self-hosted `@font-face` bundle, subset to exactly the glyphs a deck uses.
 *
 * HyperFrames auto-resolves fonts from a fixed allowlist. Inter is on it; no CJK
 * family is, and a family it cannot resolve falls back to a generic face without
 * failing anything (EXPERIMENT-002). Google's `&text=` dynamic subsetting turns
 * shipping our own from a ~120-file unicode-range pull into one 39 KB woff2.
 *
 * The allowlist only acts inside a render, so a Latin deck ships its Inter too —
 * from a package rather than this file: see `vendorInter` in src/build/files.ts.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FontBundle {
  /** Belongs at the head of the theme's font stack. */
  family: string;
  /** `@font-face` CSS with every `url()` rewritten to a bare name in `dir`. */
  css: string;
  /** The woff2 basenames written into `dir`, beside `fonts.css`. */
  files: string[];
}

/**
 * The serif companion to `familyFor`: what a v2 pack whose type spec sets a role
 * in a serif draws that role's CJK in. Without it every CJK deck set its
 * headlines in Noto Sans whatever the pack said, so the font change that makes
 * a serif pack a serif pack disappeared for three languages out of four
 * (review, 2026-10-08).
 */
export function serifFamilyFor(lang: string): string | null {
  return familyFor(lang)?.replace("Noto Sans", "Noto Serif") ?? null;
}

/** The CJK family a language needs subset, or null: the deck ships Inter (`vendorInter`). */
export function familyFor(lang: string): string | null {
  const tag = lang.toLowerCase();
  if (tag.startsWith("ko")) return "Noto Sans KR";
  if (tag.startsWith("ja")) return "Noto Sans JP";
  if (tag.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(tag) ? "Noto Sans TC" : "Noto Sans SC";
  return null;
}

// woff2 is only served to a modern desktop UA; anything else gets ttf.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

/**
 * Write `dir/fonts.css` plus its woff2 for `lang`, covering `glyphs`. Returns
 * null for languages the renderer already resolves, which needs no bundle.
 */
export async function bundleFont(
  lang: string,
  glyphs: string,
  dir: string,
  opts: { serif?: boolean } = {},
): Promise<FontBundle | null> {
  const family = familyFor(lang);
  if (!family) return null;
  // The serif rides in the same request, so one stylesheet declares both.
  const serif = opts.serif ? serifFamilyFor(lang) : null;
  const families = serif ? [family, serif] : [family];

  // Sorted and deduplicated: the request must not depend on the order text
  // happened to appear in, or two runs of one deck fetch two different subsets.
  const text = [...new Set(glyphs)]
    .filter((c) => c > " ")
    .sort()
    .join("");
  const stamp = `/* decksmith ${createHash("sha256")
    .update(`${families.join("+")}\n${text}`)
    .digest("hex")
    .slice(0, 16)} */`;

  await mkdir(dir, { recursive: true });
  const cssPath = join(dir, "fonts.css");
  const cached = await readFile(cssPath, "utf8").catch(() => "");
  if (cached.startsWith(stamp)) {
    // A bundle cut before the faces carried Inter's metrics is otherwise
    // reused as it is, by every rebuild of a deck that gains no new glyph. The
    // file is rewritten too: a build that cannot refresh LINKS it instead.
    const css = withInterMetrics(cached);
    if (css !== cached) await writeFile(cssPath, css);
    return { family, css, files: localNames(css) };
  }

  const res = await fetch(
    `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.replaceAll(" ", "+")}:wght@400;500;700`).join("&")}` +
      `&text=${encodeURIComponent(text)}&display=block`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) throw new Error(`google fonts: HTTP ${res.status}`);
  let css = await res.text();

  // Dynamic subsets come back as extensionless `/l/font?kit=…` URLs rather than
  // the usual `/s/…/x.woff2`, so match any https url inside src(), not ".woff2".
  // Deduplicating matters: all three weight rules cite the same variable font,
  // so the Set is the difference between one 6 KB file and three copies of it.
  const remote = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1] ?? ""))];
  const slug = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  const files: string[] = [];
  for (const [i, url] of remote.entries()) {
    const font = await fetch(url);
    if (!font.ok) throw new Error(`${url}: HTTP ${font.status}`);
    const name = `${slug}-${i}.woff2`;
    await writeFile(join(dir, name), Buffer.from(await font.arrayBuffer()));
    css = css.replaceAll(url, name);
    files.push(name);
  }

  css = withInterMetrics(`${stamp}\n${css}`);
  await writeFile(cssPath, css);
  return { family, css, files };
}

/**
 * Inter's vertical metrics as `@font-face` descriptors: ascent 0.969em,
 * descent 0.241em, no line gap.
 *
 * Every vertical number in the emitters (line boxes, the SVG label `dy`, the
 * centring of a tspan block) and every box the gates measure was tuned on Inter.
 * `src/build/files.ts` declares a v2 pack's Latin faces with these for that
 * reason, and the CJK bundle needs them for the same one. Noto Sans SC as Google
 * serves it is 1.160 / 0.288 (hhea, read from the woff2), so its line box is
 * 1.448em where the emitters budget 1.21. MEASURED in Chrome on a zh-Hans deck
 * (HypePaper, v0.9.2, 2026-10-11): a 56px split-compare heading spanned 65px
 * above its baseline and overran the top of its svg by 11px. Every verify
 * reports that as `container_overflow` on `#sN-sideI`; HypePaper's build also
 * reported it as `text_box_overflow` on `#sN-labI`, failed on it, and a later
 * verify of the same deck did not. The ink was never cut, because a Han glyph's
 * ink sits inside 0.88em. Only the box was wrong.
 *
 * Advances are untouched, so the width tables in `src/emit/svg.ts` still apply.
 */
export const INTER_METRICS =
  "ascent-override: 96.875%;\n  descent-override: 24.1211%;\n  line-gap-override: 0%";

/** Declare every `@font-face` in `css` with `INTER_METRICS`. Idempotent. */
export function withInterMetrics(css: string): string {
  return css.replace(
    /@font-face\s*\{(?![^}]*ascent-override)/g,
    `@font-face {\n  ${INTER_METRICS};`,
  );
}

function localNames(css: string): string[] {
  return [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] ?? "");
}

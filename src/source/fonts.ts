/**
 * A self-hosted `@font-face` bundle, subset to exactly the glyphs a deck uses.
 *
 * HyperFrames auto-resolves fonts from a fixed allowlist. Inter is on it; no CJK
 * family is, and a family it cannot resolve falls back to a generic face without
 * failing anything (EXPERIMENT-002). Google's `&text=` dynamic subsetting turns
 * shipping our own from a ~120-file unicode-range pull into one 39 KB woff2.
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

/** The family a language needs shipped, or null when the renderer supplies one. */
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
): Promise<FontBundle | null> {
  const family = familyFor(lang);
  if (!family) return null;

  // Sorted and deduplicated: the request must not depend on the order text
  // happened to appear in, or two runs of one deck fetch two different subsets.
  const text = [...new Set(glyphs)]
    .filter((c) => c > " ")
    .sort()
    .join("");
  const stamp = `/* decksmith ${createHash("sha256").update(`${family}\n${text}`).digest("hex").slice(0, 16)} */`;

  await mkdir(dir, { recursive: true });
  const cssPath = join(dir, "fonts.css");
  const cached = await readFile(cssPath, "utf8").catch(() => "");
  if (cached.startsWith(stamp)) return { family, css: cached, files: localNames(cached) };

  const res = await fetch(
    `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}:wght@400;500;700` +
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

  css = `${stamp}\n${css}`;
  await writeFile(cssPath, css);
  return { family, css, files };
}

function localNames(css: string): string[] {
  return [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] ?? "");
}

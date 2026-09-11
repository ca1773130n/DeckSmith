/**
 * A URL becomes a markdown document plus a directory of local assets.
 *
 * That output shape is the whole point of this file. Everything downstream of
 * ingest — `parseMarkdown`, `fetchFigures`, the planner, the emitters — already
 * knows how to read a markdown document with local images beside it, and none of
 * it learns that a web page exists. A harvest that returned a `Source` directly
 * would have had to reimplement figure ids, section ids, mentions and captions,
 * all of which src/source/markdown.ts already assigns in a way a stored plan's
 * `evidence` depends on staying stable.
 *
 * WHY A REAL BROWSER, AND WHY IT IS NOT ALLOWED TO FETCH ANYTHING.
 *
 * A browser is required rather than optional: real pages are broken HTML that
 * only a real parser normalises, and inline scripts assemble a measurable amount
 * of what a reader sees. But a browser pointed at a stranger's URL is an open
 * proxy — the page says `<img src="http://169.254.169.254/latest/meta-data/">`
 * and the browser fetches it from inside whatever network this process runs in,
 * with none of src/net/fetch.ts's guard in the way. So:
 *
 *  - The page's OWN bytes come through `fetchGuarded`, so the top-level URL is
 *    guarded like every other URL this project fetches.
 *  - Those bytes go into the page with `setContent`, and request interception
 *    ABORTS EVERY REQUEST the page makes. The browser makes zero requests of its
 *    own. test/harvest.test.ts proves it by serving the page's subresources from
 *    a second server and asserting that server was never hit.
 *
 * THE TENSION THAT CREATES, AND HOW IT IS RESOLVED. With every subresource
 * aborted, no image ever decodes, so `naturalWidth` is 0 and the DOM cannot say
 * how big anything is — and intrinsic size is load-bearing downstream, because
 * layout frames a 4.35-wide strip and a 1.42 portrait differently. So the DOM is
 * asked only for URLs and structure, and every asset is then fetched HERE,
 * through the same guard, and measured with `imageSize` off its own bytes. That
 * is strictly better than believing the DOM anyway: `imageSize` reads the file,
 * `naturalWidth` reads whatever the page's CSS did to the element.
 *
 * The other half of that trade is honest too: with third-party bundles blocked,
 * a page that builds its entire body from an external script harvests to almost
 * nothing. That is the correct failure. A deck missing its figures is fixable by
 * saving the page and ingesting the file; an SSRF is not fixable at all.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fetchGuarded } from "../net/fetch.js";
import { policyFor } from "../pack/media.js";
import { chromePath } from "../render/capture.js";
import { type Figure, figureSchema, type Source } from "../types.js";
import { type ImageFormat, imageSize, sniffFormat } from "./assets.js";
import { CONTENT_MARKER, type ContentPick, readContentRegion } from "./readability.js";
import { transcode } from "./transcode.js";

export interface HarvestOptions {
  /** Cap on the page's own HTML. Generous: a real article ships megabytes of it. */
  maxBytes?: number;
  /** Cap on one asset, matching what `fetchFigures` allows a figure to be. */
  maxAssetBytes?: number;
  /** Whole-call budget for each fetch, and for the browser's own steps. */
  timeoutMs?: number;
  /** How many assets are downloaded before the rest are named in `warnings`. */
  maxAssets?: number;
  /**
   * How many VIDEOS are downloaded, counted separately from `maxAssets`.
   *
   * Separate because the two are different sizes of mistake. A page with forty
   * images costs a few megabytes; a page with forty videos costs a gigabyte and
   * an hour, and one of them was probably an advertisement. A clip earns its
   * place by being the thing a beat is planned around, and a deck does not have
   * room for four of those, let alone forty.
   */
  maxClips?: number;
  /**
   * Seconds of a downloaded clip that are kept. Longer is TRUNCATED, and the
   * trim is warned about rather than performed quietly.
   *
   * A cap on SECONDS rather than on bytes because seconds are what the render
   * spends: hyperframes pre-decodes a clip to one still per output frame before
   * capture begins, so a five-minute video inside a four-minute deck is four
   * minutes of full-size stills written to disk for a beat that can be sixty
   * seconds at most (`beatSchema` in src/types.ts caps it there). The default
   * lives in ./transcode.ts beside the rest of the encode.
   *
   * Ignored when `transcode` is false: trimming is something ffmpeg does, and
   * there is no ffmpeg in that path to do it.
   */
  maxClipSeconds?: number;
  /**
   * Whether a downloaded clip is re-encoded to a slide-sized VP9 webm at all.
   * True unless stated, and stating `false` ships the page's own file.
   *
   * The reason to turn it off is that the encode is the one part of a harvest
   * that costs CPU rather than network: a caller re-ingesting the same page ten
   * times while tuning a plan pays for it ten times, and the deck it is looking
   * at does not care. The reason to leave it on is everything ./transcode.ts
   * says — the bytes shipped, and the stills the render writes.
   */
  transcode?: boolean;
  /**
   * Total bytes across every asset this harvest downloads.
   *
   * `maxAssetBytes` bounds ONE file; nothing bounded the sum, so forty assets
   * one byte under the per-file cap was a legal harvest of 1.2 GB. Charged from
   * what actually arrived, and only for a fetch that succeeded — the counter
   * that charges before the check is how a refused figure still costs the
   * budget it was refused for (`guardFigures` in src/server/pipeline.ts does
   * exactly that, deliberately not copied here).
   */
  maxTotalBytes?: number;
  /**
   * Wall clock for the whole harvest, checked BEFORE each fetch is started.
   *
   * BE HONEST ABOUT WHAT THIS BOUNDS: it stops the NEXT fetch, never one already
   * in flight, so the real ceiling is this plus one `timeoutMs`. Bounding it
   * exactly would mean an abort signal threaded through `fetchGuarded`, and a
   * harvest that overruns by twenty seconds is not the failure this is for — a
   * page whose forty images each take fifteen seconds is.
   */
  maxWallMs?: number;
  /**
   * How the markdown SPELLS its asset references. Absolute paths by default,
   * which is what a caller reading the document in place needs.
   *
   * `"relative"` writes the bare filename instead, for a caller that is about to
   * move the directory somewhere this process cannot see — the MCP zips the
   * harvest and hands it to the server, where an absolute path out of this
   * machine's temp directory is refused by `guardFigures` and the figure is
   * dropped. `assets` stays absolute either way: it names files on THIS disk.
   */
  refs?: "absolute" | "relative";
  /**
   * TEST SEAM, passed straight through to `fetchGuarded`, where it is documented.
   *
   * It is the only way to point this at a `node:http` server on loopback, which
   * is what test/harvest.test.ts needs to drive the real code path — including
   * the interception proof, which requires a second server this process can see
   * the request count of. It relaxes nothing else: the private ranges, the
   * schemes, the caps and the timeout all still apply. Nothing in src passes it.
   */
  allowLoopback?: boolean;
}

export interface Harvested {
  /** The document, in the dialect src/source/markdown.ts reads. */
  markdown: string;
  /**
   * Absolute paths of every file the MARKDOWN references, in document order. A
   * clip's video is written into `dir` too and is deliberately not one of them:
   * the markdown cannot reference it, and a caller shipping the document
   * elsewhere (the MCP zips this list) would otherwise carry megabytes nothing
   * in the document points at. It is named in `clips` instead.
   */
  assets: string[];
  /**
   * The videos, which the markdown CANNOT carry — see `HarvestedClip`. Hand
   * these to `attachClips` with the parsed source to get them back.
   */
  clips: HarvestedClip[];
  /** Everything left out, and why. One dead image is not a failed harvest. */
  warnings: string[];
  /** The page's title, also emitted as the document's opening `#` heading. */
  title: string;
}

/**
 * One video, carried BESIDE the markdown because the dialect has no word for it.
 *
 * `parseMarkdown` produces figures out of images and nothing else, so a clip —
 * `kind: "clip"`, a poster, a duration, and either a file or a page to watch it
 * on — cannot be spelled in the document at all. Rather than invent a dialect
 * extension that only this module writes and only `parseMarkdown` would have to
 * learn, the clip travels alongside and `attachClips` puts it back afterwards.
 *
 * `poster` is also the JOIN: when there is one, the markdown references it as an
 * ordinary image, so `parseMarkdown` gives that figure the id, the section and
 * the sentence that mentions it — everything the planner uses to decide where a
 * picture belongs — and `attachClips` upgrades that same figure in place. A clip
 * with no poster has nothing to join to and is appended as a new figure, which
 * costs it exactly those three facts.
 */
export interface HarvestedClip {
  /** Absolute path of the downloaded video, or "" for one we hold no file for. */
  file: string;
  /** Absolute path of the still, or "" when the page offered none. */
  poster: string;
  /** Where a viewer watches it, when there is no file. "" when there is one. */
  href: string;
  /**
   * The VIDEO's own pixels when we hold the file, and the poster's when we do
   * not. types.ts says this box is the video's rather than the still's, and it
   * is right — every annotation downstream is a fraction of it. A clip we could
   * not download has no other box to offer, and the deck shows the still.
   */
  width: number;
  height: number;
  /** Measured off the container, never guessed. Absent for a link-only clip. */
  seconds?: number;
  /** The figcaption, link text or iframe title the page gave it. */
  caption: string;
}

/**
 * One block of the page, as the DOM walker sees it and as `toMarkdown` writes it.
 *
 * `src`, `poster` and `href` hold the PAGE's URLs when `readDom` returns them and
 * LOCAL absolute paths once `localise` has rewritten them. One type rather than
 * two because the two differ in nothing but that, and a second near-identical
 * union is the kind of thing that grows a third.
 */
export type Block =
  | { kind: "heading"; depth: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "image"; src: string; alt: string; caption: string }
  | { kind: "video"; src: string; poster: string; href: string; caption: string };

/** What `readDom` hands back across the page boundary. */
interface Seen {
  title: string;
  /** The document's own `<base href>`, which relative URLs resolve against. */
  base: string;
  /**
   * The page's own `og:image`, kept for ONE purpose: the poster of a player-page
   * video that declares none. It is the picture the page itself nominates to
   * represent it, which is the only honest still available for a video whose
   * bytes we are never going to hold.
   */
  ogImage: string;
  blocks: Block[];
}

const HTML_MAX_BYTES = 8 * 1024 * 1024;
const ASSET_MAX_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_ASSETS = 40;
const MAX_CLIPS = 4;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_WALL_MS = 180_000;

/**
 * Below this, in either direction, an image is furniture rather than a figure.
 *
 * Every page carries spacers, tracking pixels, share icons and avatars, and each
 * one that survives becomes a `Figure` the planner can cite and an emitter will
 * put on a slide at 1920x1080. 64 is small enough to keep a genuine inline
 * diagram and large enough that nothing decorative gets through.
 */
const MIN_FIGURE_PX = 64;

/** Only text/html. A URL that answers with something else is not a page. */
const HTML_TYPES = /^text\/html$|^application\/xhtml\+xml$/;

export async function harvest(
  url: string,
  dir: string,
  opts: HarvestOptions = {},
): Promise<Harvested> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const warnings: string[] = [];
  const assets = resolve(dir);
  await mkdir(assets, { recursive: true });

  const page = await fetchGuarded(url, {
    maxBytes: opts.maxBytes ?? HTML_MAX_BYTES,
    timeoutMs,
    accept: HTML_TYPES,
    ...(opts.allowLoopback === true ? { allowLoopback: true } : {}),
  });
  const html = decodeHtml(page.bytes, page.contentType, url, warnings);

  const { seen, pick } = await readInBrowser(html, timeoutMs);
  // WHICH PASS CHOSE THE ARTICLE, SAID OUT LOUD. A harvest that read the page's
  // comment thread instead of its argument produces a source that parses, plans
  // and builds — the failure is a deck about the wrong text, and no gate in this
  // project can see it. So the one place it is visible is here, beside the
  // section count the CLI prints from the parse.
  if (!pick.marked) {
    warnings.push(
      `the article could not be scored out of this page — ${pick.reason}. The densest ` +
        "container was taken instead: read the section count below, and if it is the whole " +
        "page rather than the piece, save the article and ingest the file.",
    );
  } else if (pick.mediaDropped > 0) {
    // Counted rather than discovered, because this is exactly how a clip goes
    // missing without a trace: the region is chosen, a `<video>` outside it goes
    // with the chrome, and the deck simply has one fewer figure than the page.
    // A related-videos rail SHOULD be lost here — which is why it is a warning
    // naming the number, not a refusal.
    warnings.push(
      `${pick.mediaDropped} video or embed(s) sat outside the article region and were ` +
        "dropped with the page's chrome. If one of them was the video the piece is about, " +
        "ingest the saved page instead, where the region is the whole document.",
    );
  }
  // Relative URLs resolve against the document's `<base>` if it declares one,
  // and otherwise against the URL the bytes CAME FROM — `page.url`, after
  // redirects, not the URL that was asked for. A page that 302s from a share
  // link to an article path has moved every relative image with it.
  const base = absolute(seen.base, page.url) ?? page.url;

  const local = await localise(seen, base, assets, opts, timeoutMs, warnings);
  return {
    markdown: toMarkdown(titled(seen.title, local.blocks)),
    assets: local.assets,
    clips: local.clips,
    warnings,
    title: seen.title,
  };
}

/**
 * The document opens with its own title, because `parseMarkdown` reads the title
 * off the first heading and a page's `<h1>` is often inside a `<header>` this
 * walker never reached. Skipped when the content already opens with that exact
 * heading, so a well-formed article is not given two of them.
 */
function titled(title: string, blocks: readonly Block[]): Block[] {
  const first = blocks[0];
  const already =
    first?.kind === "heading" && first.depth === 1 && first.text.trim() === title.trim();
  return title && !already ? [{ kind: "heading", depth: 1, text: title }, ...blocks] : [...blocks];
}

/* ------------------------------------------------------------------- Bytes */

/**
 * The page's text, decoded with the charset it declares.
 *
 * Not `bytes.toString("utf8")`: a page served as ISO-8859-1 or Shift_JIS decodes
 * to mojibake that way, and mojibake in a heading survives every gate in this
 * project and lands in a rendered slide. The header wins over the `<meta>`
 * because the header is what a browser obeys; the meta is read from the first
 * 4 KB as latin1, which is safe for every encoding that matters here because the
 * declaration itself is ASCII.
 */
function decodeHtml(bytes: Buffer, contentType: string, url: string, warnings: string[]): string {
  const declared = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  const head = bytes.toString("latin1", 0, Math.min(bytes.length, 4096));
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  const label = declared ?? meta;
  if (label === undefined) return bytes.toString("utf8");
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    warnings.push(
      `${url} declares charset "${label}", which this Node cannot decode; read as UTF-8 instead. ` +
        "Non-ASCII text may be wrong — serve the page as UTF-8, or save it and ingest the file.",
    );
    return bytes.toString("utf8");
  }
}

/* ----------------------------------------------------------------- Browser */

/**
 * Put `html` in a real browser and read the DOM out of it, fetching nothing.
 *
 * `setContent` rather than `goto`: `goto` would have the browser make the
 * top-level request itself, which is the request `fetchGuarded` exists to guard.
 * The interception handler is installed BEFORE the content, so there is no
 * window in which a subresource escapes.
 *
 * `domcontentloaded` rather than `load`: everything `load` would additionally
 * wait for is a subresource that has already been aborted, so it buys nothing
 * and costs a timeout on any page whose abort races the lifecycle event.
 *
 * AND THE RESOLVER IS BLOCKED, because the sentence above turned out to be a
 * claim about timing rather than a guarantee. Interception is per-tab and takes
 * effect through the DevTools protocol; on Chrome 152 under load, the open-proxy
 * test in `test/harvest.test.ts` leaked a subresource to the second server twice
 * in five full-suite runs, and never once on 145 in six. Same code, different
 * browser, so the window the note denied is real and only ever happened to be
 * too narrow to see.
 *
 * `--host-resolver-rules=MAP * ~NOTFOUND` makes the property structural instead:
 * this browser cannot resolve a name at all, so a request that escapes
 * interception reaches nothing. Nothing legitimate is lost, because the browser
 * is never supposed to make a request — `fetchGuarded` does the fetching in
 * node and `setContent` hands over the bytes. Interception stays as the first
 * line and to keep the abort semantics; this is the floor under it.
 *
 * TWO EVALUATES, IN THIS ORDER, AND THEY ARE NOT INTERCHANGEABLE. The first
 * strips the page's chrome and marks the region it scored as the article; the
 * second walks whatever it finds. Running the walk first would walk the
 * unstripped page and mark nothing, which is the old behaviour with an extra
 * round trip. They are two functions rather than one because `readContentRegion`
 * mutates the document and `readDom` only reads it, and a pass that can decline
 * has to be able to put the document back before the reader ever sees it.
 */
async function readInBrowser(
  html: string,
  timeoutMs: number,
): Promise<{ seen: Seen; pick: ContentPick }> {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: await chromePath("read the page with"),
    headless: true,
    // Chrome's own background traffic — variations, safe browsing, first-run
    // pings — never goes through page interception, so it is switched off here
    // rather than assumed absent. It is not an SSRF path, but "the browser makes
    // no requests" should be true of the whole process, not just of the tab.
    args: [
      "--disable-background-networking",
      "--disable-extensions",
      "--no-default-browser-check",
      "--no-first-run",
      // The floor under interception — see the note above. Not a hardening
      // nicety: without it the open-proxy property holds only as fast as CDP
      // happens to be that run.
      "--host-resolver-rules=MAP * ~NOTFOUND",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      // Aborting a request that has already been handled rejects; nothing here
      // handles one twice, but a rejection from an event handler is unhandled.
      request.abort().catch(() => {});
    });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const pick = await page.evaluate(readContentRegion);
    // PASSED AS AN ARGUMENT RATHER THAN SPELLED A SECOND TIME. `readDom` may not
    // close over a module constant — it is serialised and evaluated in the page,
    // where `CONTENT_MARKER` does not exist — and the obvious fix, writing the
    // attribute's name out again inside it, is two spellings of one contract that
    // fail as a wrong answer rather than as an error. `evaluate` clones its
    // arguments across the boundary, so the constant itself travels.
    return { seen: await page.evaluate(readDom, CONTENT_MARKER), pick };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * The DOM walk, RUN INSIDE THE PAGE.
 *
 * Serialised by puppeteer and evaluated in the browser, so it may not close over
 * anything in this module — every helper and every constant it uses is declared
 * inside it. That is why this one function is longer than anything else here.
 *
 * Its output is deliberately flat. The markdown dialect downstream is itself a
 * flat stream of blocks, and a tree would have to be flattened by something.
 *
 * `marker` is `CONTENT_MARKER`, handed across the boundary because this function
 * cannot reach it — see the call site.
 */
function readDom(marker: string): Seen {
  /** Boilerplate, chrome, and things with no text. `header` is NOT here: inside
   * an `<article>` it usually holds that article's own title and byline. */
  const SKIP = new Set([
    "nav",
    "aside",
    "footer",
    "script",
    "style",
    "noscript",
    "form",
    "svg",
    "canvas",
    "template",
    "button",
    "select",
    "textarea",
  ]);

  /** Tags that end a paragraph rather than flatten into it. */
  const BLOCKY = new Set([
    "p",
    "div",
    "section",
    "article",
    "main",
    "ul",
    "ol",
    "table",
    "figure",
    "blockquote",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ]);

  /**
   * The players whose page IS the video — the file is behind a manifest, DRM or
   * terms, so the only honest thing to record is where a viewer goes to watch
   * it. A short list of what actually appears, expected to grow.
   */
  const PLAYER =
    /(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/|(?:player\.)?vimeo\.com\/|dailymotion\.com\/video\/|\.(?:mp4|webm|m4v|mov)(?:[?#]|$))/i;

  function words(node: Node | null): string {
    return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function skipped(el: Element): boolean {
    return (
      SKIP.has(el.tagName.toLowerCase()) ||
      el.hasAttribute("hidden") ||
      el.getAttribute("aria-hidden") === "true"
    );
  }

  /**
   * The biggest source the tag offers.
   *
   * A lazy-loading page puts a 20-byte placeholder in `src` and the real image
   * in `srcset` or `data-src`, so reading `src` first harvests the placeholder —
   * which then measures at 1x1 and gets dropped as furniture, losing the figure
   * silently. Widest `w` descriptor wins; with no descriptors the last candidate
   * does, which is the convention.
   */
  function pickSrc(el: Element): string {
    const candidates = (el.getAttribute("srcset") ?? "")
      .split(",")
      .map((part) => part.trim().split(/\s+/))
      .filter((bits) => (bits[0] ?? "") !== "")
      .map((bits) => ({ url: bits[0] ?? "", w: Number.parseInt(bits[1] ?? "", 10) || 0 }));
    let widest = candidates[0];
    for (const candidate of candidates) if (candidate.w >= (widest?.w ?? -1)) widest = candidate;
    return widest?.url ?? el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
  }

  function imageOf(el: Element, caption: string): Block | undefined {
    const src = pickSrc(el);
    if (!src) return undefined;
    return { kind: "image", src, alt: words(el.getAttributeNode("alt")), caption };
  }

  function videoOf(el: Element, caption: string): Block {
    const source = el.querySelector("source");
    return {
      kind: "video",
      src: el.getAttribute("src") ?? source?.getAttribute("src") ?? "",
      poster: el.getAttribute("poster") ?? "",
      href: "",
      caption,
    };
  }

  /** `<figure>` is the one place a page states a caption as such. Take it. */
  function figureOf(el: Element, out: Block[]): void {
    const caption = words(el.querySelector("figcaption"));
    const video = el.querySelector("video");
    if (video) {
      out.push(videoOf(video, caption));
      return;
    }
    const image = el.querySelector("img");
    const block = image ? imageOf(image, caption) : undefined;
    if (block) {
      out.push(block);
      return;
    }
    const text = words(el);
    if (text) out.push({ kind: "paragraph", text });
  }

  /**
   * A paragraph, BROKEN AROUND EVERY IMAGE IT HOLDS.
   *
   * This is the dialect rule that would otherwise lose figures silently:
   * `parseMarkdown` lifts a figure only from a paragraph whose children are ALL
   * images, so an image inside a sentence is discarded and the deck comes out
   * text-only with every gate green. So the sentence before the image is flushed
   * as its own paragraph, the image becomes a paragraph of its own, and the rest
   * of the sentence follows it.
   */
  function paragraphOf(el: Element, out: Block[]): void {
    const solid = [...el.childNodes].filter(
      (n) => n.nodeType !== Node.TEXT_NODE || (n.textContent ?? "").trim() !== "",
    );
    const only = solid.length === 1 ? solid[0] : undefined;
    if (only instanceof HTMLAnchorElement && PLAYER.test(only.getAttribute("href") ?? "")) {
      const href = only.getAttribute("href") ?? "";
      out.push({ kind: "video", src: "", poster: "", href, caption: words(only) });
      return;
    }

    let buffer = "";
    const flush = () => {
      const text = buffer.replace(/\s+/g, " ").trim();
      if (text) out.push({ kind: "paragraph", text });
      buffer = "";
    };
    const scan = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.textContent ?? "";
        return;
      }
      if (!(node instanceof Element)) return;
      if (skipped(node)) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        buffer += " ";
        return;
      }
      if (tag === "img" || tag === "video" || BLOCKY.has(tag)) {
        flush();
        block(node, out);
        return;
      }
      for (const kid of node.childNodes) scan(kid);
    };
    for (const kid of el.childNodes) scan(kid);
    flush();
  }

  function listOf(el: Element): Block {
    return {
      kind: "list",
      ordered: el.tagName === "OL",
      // A nested list flattens into its parent item, exactly as `blockText` in
      // src/source/markdown.ts already flattens one on the way back out.
      items: [...el.children]
        .filter((li) => li.tagName === "LI")
        .map(words)
        .filter((text) => text !== ""),
    };
  }

  /** The first row is the header, whether or not the page spelled it `<th>`. */
  function tableOf(el: Element): Block | undefined {
    const rows = [...el.querySelectorAll("tr")].map((tr) =>
      [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH").map(words),
    );
    const [head, ...body] = rows;
    return head ? { kind: "table", columns: head, rows: body } : undefined;
  }

  /** One element, dispatched. Anything unrecognised is a container: descend. */
  function block(el: Element, out: Block[]): void {
    if (skipped(el)) return;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = words(el);
      if (text) out.push({ kind: "heading", depth: Number(tag[1]), text });
      return;
    }
    if (tag === "p" || tag === "blockquote") {
      paragraphOf(el, out);
      return;
    }
    if (tag === "ul" || tag === "ol") {
      const list = listOf(el);
      if (list.kind === "list" && list.items.length > 0) out.push(list);
      return;
    }
    if (tag === "table") {
      const table = tableOf(el);
      if (table) out.push(table);
      return;
    }
    if (tag === "figure") {
      figureOf(el, out);
      return;
    }
    if (tag === "img") {
      const image = imageOf(el, "");
      if (image) out.push(image);
      return;
    }
    if (tag === "video") {
      out.push(videoOf(el, ""));
      return;
    }
    if (tag === "iframe") {
      // An embed is a player page wearing a frame. Anything else in an iframe is
      // an advertisement or a widget, and is not this document's content.
      const href = el.getAttribute("src") ?? "";
      if (PLAYER.test(href)) {
        out.push({
          kind: "video",
          src: "",
          poster: "",
          href,
          caption: words(el.getAttributeNode("title")),
        });
      }
      return;
    }
    if (tag === "pre") {
      const text = (el.textContent ?? "").replace(/\s+$/, "");
      if (text) out.push({ kind: "code", text });
      return;
    }
    // A `<div>` holding text of its own is a paragraph that forgot to say so,
    // and pages full of them are common. One holding only elements is a wrapper.
    const direct = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (direct) {
      paragraphOf(el, out);
      return;
    }
    walk(el, out);
  }

  function walk(el: Element, out: Block[]): void {
    for (const kid of el.children) block(kid, out);
  }

  /**
   * How much of a document an element holds: the text in its blocks, less the
   * text in its links, because a sidebar of headlines is all link and a
   * paragraph is none.
   */
  function score(el: Element): number {
    let text = 0;
    for (const p of el.querySelectorAll("p, li, td, h1, h2, h3, h4, h5, h6")) {
      text += (p.textContent ?? "").trim().length;
    }
    let links = 0;
    for (const a of el.querySelectorAll("a")) links += (a.textContent ?? "").trim().length;
    return text - links;
  }

  /**
   * The content region — THE SCORER'S ANSWER, AND THREE RULES FOR WHEN IT HAS
   * NONE.
   *
   * `readContentRegion` (src/source/readability.ts) ran against this document a
   * moment ago: it stripped the page's chrome, scored every candidate the way
   * Readability does, and put `marker` on the region it chose. So the first
   * question is whether it chose one, and the answer is an attribute rather than
   * a return value because an `Element` cannot cross the `page.evaluate`
   * boundary.
   *
   * THE THREE RULES BELOW ARE STILL LOAD-BEARING, not vestigial. The pass
   * declines whenever it is not sure — a region under its text floor, a document
   * with no body, a throw inside the page — and when it declines it restores
   * every node it removed, so what these see is the document they always saw.
   * `<main>` and `<article>` are what a page says about itself and are believed
   * when they hold anything; failing those, the DEEPEST element carrying the
   * maximal score wins, which is the tightest wrapper around the body text.
   * `querySelectorAll` is in document order, so ancestors are seen before their
   * descendants and `>=` keeps the deeper of a tie.
   */
  function pickRoot(): Element {
    const marked = document.querySelector(`[${marker}]`);
    if (marked) return marked;
    const main = document.querySelector("main");
    if (main && score(main) > 0) return main;
    const article = document.querySelector("article");
    if (article && score(article) > 0) return article;
    let best: Element = document.body;
    let top = score(document.body);
    for (const el of document.body.querySelectorAll("div, section, td")) {
      const here = score(el);
      if (here >= top) {
        top = here;
        best = el;
      }
    }
    return best;
  }

  const root = pickRoot();
  const blocks: Block[] = [];
  walk(root, blocks);
  // The `<h1>` inside the content is the article's own title; `document.title`
  // is that plus whatever the site appends to every tab. Prefer the former.
  const heading = words(root.querySelector("h1")) || words(document.querySelector("h1"));
  // `property` is what the Open Graph spec says and what every social scraper
  // reads; `name` is what a page written against a validator that only knows
  // HTML5 meta emits. Both spellings are ordinary, so both are read.
  const og =
    document.querySelector('meta[property="og:image"], meta[name="og:image"]') ??
    document.querySelector('meta[property="og:image:url"], meta[name="twitter:image"]');
  return {
    title: heading || (document.title ?? "").replace(/\s+/g, " ").trim(),
    base: document.querySelector("base[href]")?.getAttribute("href") ?? "",
    ogImage: og?.getAttribute("content") ?? "",
    blocks,
  };
}

/* ---------------------------------------------------------------- Localise */

/**
 * Fetch every asset the blocks name, measure it, write it into `dir`, and
 * rewrite the block to point at the file.
 *
 * A dead image is a warning, not a failed harvest — the same posture
 * `fetchFigures` takes for the same reason: a page with eleven images and one
 * dead CDN link is still the deck someone asked for.
 *
 * ONE AT A TIME, deliberately. src/net/fetch.ts says out loud that it bounds
 * nothing about concurrency and that the caller owns that, and forty parallel
 * requests at a stranger's host — chosen by the same document that chose the
 * URLs — is a thing this process should not be able to be pointed at. The cost
 * is wall-clock on a figure-heavy page, which an ingest can afford.
 *
 * THE BUDGET, AND WHAT ENFORCES IT: this function, and nothing else. No gate
 * downstream can tell a deck harvested inside its caps from one harvested
 * outside them, so a cap the caller raises is a cap that is gone — which is why
 * every refusal below names the option that raises it rather than only stating
 * the number it hit. Counts and bytes are charged from what ARRIVED, after a
 * fetch succeeded: charging first is how a refused asset comes to cost the
 * budget it was refused for (the remote-figure counter in
 * src/server/pipeline.ts does exactly that, and is deliberately not copied).
 */
async function localise(
  seen: Seen,
  base: string,
  dir: string,
  opts: HarvestOptions,
  timeoutMs: number,
  warnings: string[],
): Promise<{ blocks: Block[]; assets: string[]; clips: HarvestedClip[] }> {
  const maxAssets = opts.maxAssets ?? MAX_ASSETS;
  const maxClips = opts.maxClips ?? MAX_CLIPS;
  const maxBytes = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const wallMs = opts.maxWallMs ?? MAX_WALL_MS;
  const deadline = Date.now() + wallMs;
  const out: Block[] = [];
  const assets: string[] = [];
  const clips: HarvestedClip[] = [];
  let spent = 0;
  /** URL to the file written for it, or null for one already tried and refused. */
  const done = new Map<string, Got | null>();

  /** How the markdown spells a file — see `HarvestOptions.refs`. */
  const ref = (got: Got): string => (opts.refs === "relative" ? basename(got.path) : got.path);

  /** The cap that stops the NEXT download, in the words that raise it. */
  const overdrawn = (): string | null => {
    if (Date.now() >= deadline) {
      return `the harvest has used its ${Math.round(wallMs / 1000)}s budget — raise maxWallMs`;
    }
    if (spent >= maxBytes) {
      return `the harvest has downloaded ${mb(spent)} of its ${mb(maxBytes)} — raise maxTotalBytes`;
    }
    return null;
  };

  /**
   * One guarded fetch, charged to the byte budget by what actually arrived.
   *
   * Charged even when the caller then rejects the file as too small or
   * unreadable: those bytes crossed the wire and the budget is about what this
   * process pulls, not about what it keeps. What is never charged is a download
   * that did not happen — see the header.
   */
  const bytesOf = async (url: string): Promise<Buffer> => {
    const got = await fetchGuarded(url, {
      maxBytes: opts.maxAssetBytes ?? ASSET_MAX_BYTES,
      timeoutMs,
      ...(opts.allowLoopback === true ? { allowLoopback: true } : {}),
    });
    spent += got.bytes.length;
    return got.bytes;
  };

  const grab = async (raw: string, what: string): Promise<Got | null> => {
    const url = absolute(raw, base);
    if (url === null) {
      warnings.push(
        `${what} was left out: "${raw.slice(0, 120)}" is not an http(s) URL. ` +
          "Only web URLs are fetched; a data: or blob: source has to be saved by hand.",
      );
      return null;
    }
    const already = done.get(url);
    if (already !== undefined) return already;
    if (assets.length >= maxAssets) {
      done.set(url, null);
      warnings.push(
        `${what} was left out: ${url} — already at ${maxAssets} assets. ` +
          "Raise maxAssets if the page really has that many figures.",
      );
      return null;
    }
    const capped = overdrawn();
    if (capped !== null) {
      done.set(url, null);
      warnings.push(`${what} was left out: ${url} — ${capped} if the page is worth the wait.`);
      return null;
    }

    let got: Got | null = null;
    try {
      const bytes = await bytesOf(url);
      const size = imageSize(bytes);
      if (size.width < MIN_FIGURE_PX || size.height < MIN_FIGURE_PX) {
        throw new Error(
          `it is ${size.width}x${size.height}, under ${MIN_FIGURE_PX}px — ` +
            "spacers, icons and tracking pixels look like this, and a slide cannot use one",
        );
      }
      const path = join(dir, assetName(url, extFor(sniffFormat(bytes))));
      await writeFile(path, bytes);
      assets.push(path);
      got = { path, width: size.width, height: size.height };
    } catch (err) {
      got = null;
      warnings.push(`${what} was left out: ${url} — ${why(err)}`);
    }
    done.set(url, got);
    return got;
  };

  /**
   * The page's file, re-encoded to something a deck can afford — or the page's
   * file, and a sentence saying why it was not.
   *
   * THE BOX IS NOT SIZED FROM THE FORMAT, BECAUSE THERE IS NO FORMAT HERE.
   * `harvest` runs at ingest and a format is chosen at build: `source.json` is
   * built into `deck-16x9` and `short-9x16` from the same file, by three callers
   * (the CLI, the MCP and the server) none of which knows which. Sizing to the
   * format a caller happens to build first would make the clip wrong for the
   * second, and re-ingesting per format costs the download again. So the target
   * is ./transcode.ts's own default — one edge for both directions, set above
   * the largest plate any format offers — and it is stated there rather than
   * argued twice.
   *
   * WHAT IS RETURNED IS MEASURED OFF WHAT IS ON DISK, either way. `types.ts:48`
   * says a clip figure's box is the VIDEO's own and that every fit, crop and
   * leader-line fraction downstream is a fraction of it, so the numbers here
   * have to be the shipped file's rather than the page's.
   */
  const shrink = async (
    url: string,
    path: string,
    measured: Measured,
    what: string,
  ): Promise<Held> => {
    if (opts.transcode === false) return { path, ...measured };
    // NOT `assetName(url, ".webm")`: a page that served a webm would name the
    // output exactly what the input is called, and ffmpeg would be reading the
    // file it is writing. The suffix says what the file is, and `basename` is
    // what `attachClips` carries into the deck, so it stays legible there.
    const out = join(dir, assetName(url, ".vp9.webm"));
    let small: Awaited<ReturnType<typeof transcode>>;
    try {
      small = await transcode(path, out, {
        ...(opts.maxClipSeconds === undefined ? {} : { maxSeconds: opts.maxClipSeconds }),
      });
    } catch (err) {
      // `transcode` throws for one thing only — an input it cannot measure —
      // and these bytes were measured three lines above with the same function,
      // so this is unreachable as written. It is caught anyway because the
      // alternative is a clip we successfully downloaded being reported as a
      // failed download by the handler above, and losing a held clip to a
      // failed OPTIMISATION is the wrong trade in every case.
      warnings.push(`${what} was shipped as the page served it: ${why(err)}`);
      return { path, ...measured };
    }
    for (const w of small.warnings) warnings.push(`${what} — ${w}`);
    if (small.transcoded) {
      // THE ENCODE CAN MAKE THE FILE BIGGER, AND IT IS NOT A BUG — MEASURED,
      // 2026-09-08, on en.wikipedia.org/wiki/Slow_motion: a 1920x1080 70.5s
      // Wikimedia VP9 arrived at 1.42 MB and came back 1280x720, 60s, and
      // 6.32 MB. Wikimedia encodes once, slowly, offline; this encodes in a
      // second at `-cpu-used 4` because it runs inside somebody's ingest. On the
      // same page two other clips halved. So the shrink is in PIXELS, which is
      // what the render spends — 1280x720 stills instead of 1920x1080 ones, and
      // 60 seconds of them instead of 70 — and the bytes are a usual consequence
      // rather than a promised one.
      //
      // Reported instead of quietly reversed. Keeping whichever file is smaller
      // would hand the deck back its 1920x1080 70s original and undo the saving
      // that was the point, and it would do it silently.
      const [before, after] = await Promise.all([sizeOf(path), sizeOf(small.path)]);
      if (before > 0 && after > before) {
        warnings.push(
          `${what} — ${basename(small.path)} came back LARGER than the page's own file ` +
            `(${mb(before)} → ${mb(after)}) at ${small.width}x${small.height}. The encode is ` +
            "sized for the render, which pre-decodes every clip to one still per output " +
            "frame, so it still costs less to render; pass --no-transcode if the deck's " +
            "size is what matters here.",
        );
      }
      // The original is bytes nothing points at any more. It matters because the
      // MCP zips this directory and the server ships it: a 32 MB source kept
      // beside its 2 MB replacement is 32 MB carried for nothing.
      await rm(path, { force: true });
    }
    return {
      path: small.path,
      width: small.width,
      height: small.height,
      ...(small.seconds === undefined ? {} : { seconds: small.seconds }),
    };
  };

  /**
   * The video's own bytes, measured off its container before anything is kept.
   *
   * Measured BEFORE the write for the reason `localize` in src/source/assets.ts
   * gives about images: a URL can answer with an HTML interstitial, a login wall
   * or half a file, and there is no reason to leave any of that in the directory
   * under a video's name. A clip that cannot be measured is not a clip — the
   * schema wants a box in real pixels, and a guessed one puts every annotation
   * downstream in the wrong place — so it falls back to being a link.
   *
   * The video is NOT counted in `assets` and does not spell itself into the
   * markdown: the dialect has no way to say `kind: "clip"`, which is the whole
   * reason `HarvestedClip` exists.
   */
  const grabVideo = async (url: string, what: string): Promise<Held | null> => {
    if (clips.length >= maxClips) {
      warnings.push(
        maxClips === 0
          ? `${what} is a link only: this harvest downloads no videos at all (maxClips is 0).`
          : `${what} is a link only: already holding ${maxClips} clips. ` +
              "Raise maxClips if the page really is that many videos.",
      );
      return null;
    }
    const capped = overdrawn();
    if (capped !== null) {
      warnings.push(`${what} is a link only: ${capped} if the video is worth the wait.`);
      return null;
    }
    try {
      const bytes = await bytesOf(url);
      const measured = videoSize(bytes);
      const path = join(dir, assetName(url, `.${measured.container}`));
      await writeFile(path, bytes);
      return await shrink(url, path, measured, what);
    } catch (err) {
      warnings.push(`${what} was not downloaded: ${url} — ${why(err)}`);
      return null;
    }
  };

  /**
   * The still, honestly sourced: the tag's own `poster`, and failing that the
   * PAGE's `og:image` — once, and only for a video we hold no file for.
   *
   * Once, because og:image is a property of the page rather than of any video on
   * it. Handing the same still to a second clip would put one picture under two
   * figures, and the planner cites figures as evidence: two ids, two captions,
   * one image, and nothing downstream can see they are the same picture.
   *
   * And only when `needed`, because the two cases want it differently. A clip we
   * hold plays its own frames and is complete without a still; one we do not is
   * nothing but its still. Spending the page's single og:image on the video that
   * did not need it is how the one that did ends up as a line of prose.
   */
  let ogSpent = false;
  const stillFor = async (poster: string, named: string, needed: boolean): Promise<Got | null> => {
    if (poster) return grab(poster, `the poster of ${named}`);
    if (needed && seen.ogImage && !ogSpent) {
      ogSpent = true;
      return grab(seen.ogImage, `the page's og:image, taken as the still of ${named}`);
    }
    return null;
  };

  for (const item of seen.blocks) {
    if (item.kind === "image") {
      const named = item.caption || item.alt;
      const got = await grab(item.src, named ? `the image "${named}"` : "an image");
      if (got) out.push({ ...item, src: ref(got) });
      continue;
    }
    if (item.kind === "video") {
      const named = item.caption ? `the video "${item.caption}"` : "a video";
      // Where the bytes would come from, and where a viewer would go. A
      // `<video src>` is both; an `<iframe>` or a bare link is only the second.
      const file = absolute(item.src, base);
      const page = absolute(item.href, base);
      const subject = file ?? page;
      const watch = page ?? file;

      // THE POLICY IS THE ONE src/pack/media.ts ALREADY OWNS, asked rather than
      // restated. `embed` means the URL is a player page: the bytes sit behind a
      // manifest, DRM or terms, and downloading what a YouTube or Vimeo link
      // stands for is both wrong and usually against that site's terms — so the
      // still and the link are all this ever takes from one. `bake` means the
      // URL's own shape says it is a file we may hold. `link` is everything
      // else, and an unrecognised shape is NOT downloaded, because what arrives
      // is as likely to be an interstitial as a video — the same trade
      // `policyFor` documents for a pack.
      const policy = subject === null ? null : policyFor(subject, "bake");
      // The file first, because whether we hold it decides whether this video
      // may spend the page's one og:image — see `stillFor`.
      const held = policy === "bake" && subject !== null ? await grabVideo(subject, named) : null;
      const still = await stillFor(item.poster, named, held === null);

      if (held !== null) {
        clips.push({
          file: held.path,
          poster: still?.path ?? "",
          href: "",
          width: held.width,
          height: held.height,
          ...(held.seconds === undefined ? {} : { seconds: held.seconds }),
          caption: item.caption,
        });
        // No autolink: the deck holds the file, so the prose does not have to
        // send anyone to the page to watch it.
        out.push({ ...item, src: "", poster: still ? ref(still) : "", href: "" });
        continue;
      }

      if (still !== null && watch !== null) {
        clips.push({
          file: "",
          poster: still.path,
          href: watch,
          width: still.width,
          height: still.height,
          caption: item.caption,
        });
        // Said out loud rather than swallowed: the deck shows one frame where
        // the page had a video, and `renderSource` will tell the planner so.
        warnings.push(
          `${named} is a link only: ${unheld(policy)}. The still is what the deck shows, and a viewer goes to ${watch}.`,
        );
        out.push({ ...item, src: "", poster: ref(still), href: watch });
        continue;
      }

      if (still !== null) {
        // A still with nothing behind it: a `<video poster>` whose source the
        // page never named. The picture is real and downloaded, so it stays as
        // an ordinary figure — there is no clip because there is nothing to
        // watch, and dropping it would throw away an image we already hold.
        warnings.push(
          `${named} is a still only: the page names no source for it, so there is nothing to play.`,
        );
        out.push({ ...item, src: "", poster: ref(still), href: "" });
        continue;
      }

      if (watch === null) {
        warnings.push(`${named} was left out: it names neither a poster image nor a URL.`);
        continue;
      }
      // A URL and no picture at all. The prose keeps the link — that is the only
      // trace of it a reader gets — and the deck gets a line of text where the
      // page had a video.
      warnings.push(
        `${named} is a link only and the page gave it no still: no poster attribute, ` +
          "no og:image left to spend. Save a frame by hand and add it to source.json as a clip figure.",
      );
      out.push({ ...item, src: "", poster: "", href: watch });
      continue;
    }
    out.push(item);
  }
  return { blocks: out, assets, clips };
}

/** A file written into the harvest directory, and the box it measured. */
interface Got {
  path: string;
  width: number;
  height: number;
}

/** The same, for a video, plus what its container said about its length. */
interface Held extends Got {
  seconds?: number;
}

/** Why a video is a link rather than a file, in the words of the policy that said so. */
function unheld(policy: ReturnType<typeof policyFor> | null): string {
  if (policy === "embed") return "it is a player page, which is never downloaded";
  if (policy === "link") {
    return "its URL does not end in a video extension, so what came back could as easily be a page";
  }
  return "the file could not be held";
}

/** A file's size, or 0 for one that is not there — this is used to compare, not to decide. */
async function sizeOf(path: string): Promise<number> {
  return await stat(path).then(
    (s) => s.size,
    () => 0,
  );
}

/** Megabytes, for a message a person reads while deciding whether to raise a cap. */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** An absolute http(s) URL, or null for anything this must not fetch. */
function absolute(raw: string, base: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A readable, stable name for the file on disk.
 *
 * The URL's own basename so the directory can be read by a human, plus a hash of
 * the whole URL so two `hero.png` from two hosts do not collide. The extension
 * is passed in rather than derived here because both callers take it from the
 * BYTES — `sniffFormat` for an image, the container for a video — for the reason
 * `assetExt` in src/source/assets.ts gives: a CDN serving AVIF from a path
 * ending `.jpg` is ordinary, and so is an `.mp4` that is really a login page.
 */
function assetName(url: string, ext: string): string {
  const last = new URL(url).pathname.split("/").pop() ?? "";
  const stem =
    last
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "figure";
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 8);
  return `${stem}-${hash}${ext}`;
}

/**
 * JPEG is the one format whose conventional extension is not its name, so this
 * is a special case rather than a second copy of `EXT` in src/source/assets.ts —
 * which is not exported, and which names what the DECK's assets are called.
 * These files are an intermediate: `fetchFigures` reads them back and renames
 * them from their own bytes, so this only has to be readable and stable.
 */
function extFor(format: ImageFormat | undefined): string {
  if (format === undefined) return ".img";
  return format === "jpeg" ? ".jpg" : `.${format}`;
}

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------- Video */

/** What a container declares about the picture inside it. */
export interface Measured {
  width: number;
  height: number;
  /** Absent when the container declares no usable duration — a live capture does. */
  seconds?: number;
}

/**
 * The two containers a browser will actually play, told apart by first bytes.
 *
 * The same question `sniffFormat` answers for images and for the same reason:
 * what a file IS comes from the file, because everything the URL said about it
 * was written by the stranger whose page we are reading. Deliberately narrow —
 * `.mkv` and `.avi` are not on `FILE_EXT` in src/pack/media.ts, so a URL naming
 * one is never downloaded, and admitting a container the deck cannot play would
 * measure fine and then render a black rectangle.
 */
function sniffVideo(b: Buffer): "mp4" | "webm" | undefined {
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") return "mp4";
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return "webm";
  return undefined;
}

/**
 * A video's display box and its length, read out of its own header.
 *
 * WHY NOT `ffprobe`, WHICH WOULD BE FOUR LINES. Because it would make ingest —
 * the one verb that has to work on a laptop with a browser and nothing else —
 * depend on a binary this project otherwise needs only to RENDER. A machine
 * without ffmpeg would then harvest a page and silently come back with the video
 * demoted to a link, which is the shape of failure this file exists to avoid. A
 * width, a height and a duration are four integers in a header; reading them is
 * cheaper than the dependency, and it is the same trade `imageSize` already
 * makes for PNG, JPEG, WebP and AVIF.
 *
 * Exported because it is pure, and because the half of test/harvest.test.ts that
 * runs on CI has no browser — measuring a hand-built header is testable there
 * and driving a real page is not.
 */
export function videoSize(b: Buffer): Measured & { container: "mp4" | "webm" } {
  const container = sniffVideo(b);
  if (container === undefined) {
    throw new Error(
      "its first bytes are neither an ISO base media (mp4) header nor an EBML (webm) one, " +
        "so it is not a video this can measure — which is what an interstitial or a login page looks like",
    );
  }
  const measured = container === "mp4" ? mp4Size(b) : webmSize(b);
  if (measured.width < MIN_FIGURE_PX || measured.height < MIN_FIGURE_PX) {
    throw new Error(
      `it measures ${measured.width}x${measured.height}, under ${MIN_FIGURE_PX}px — a slide cannot use one`,
    );
  }
  return { ...measured, container };
}

/** One ISO base media box: its four-character type, where its body starts, where it ends. */
interface Box {
  type: string;
  body: number;
  end: number;
}

/**
 * The boxes lying end to end in `[from, to)`.
 *
 * Stops at the first header that does not add up rather than resynchronising:
 * the sizes come from a stranger's file, and a walk that guesses its way past a
 * lie reads the rest of the file at an offset of its own invention.
 */
function boxes(b: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = b.readUInt32BE(at);
    const type = b.toString("latin1", at + 4, at + 8);
    let body = at + 8;
    if (size === 1) {
      if (body + 8 > to) return out;
      size = Number(b.readBigUInt64BE(body));
      body += 8;
    } else if (size === 0) {
      size = to - at; // "to the end of the file", which only the last box may say
    }
    const end = at + size;
    if (size < body - at || end > to) return out;
    out.push({ type, body, end });
    at = end;
  }
  return out;
}

/** `moov` → `mvhd` for the clock, and the first `trak` whose `tkhd` has a picture in it. */
function mp4Size(b: Buffer): Measured {
  const moov = boxes(b, 0, b.length).find((box) => box.type === "moov");
  if (moov === undefined) {
    throw new Error(
      "it has no moov box — the file is truncated, or it is a fragmented stream whose header never arrived",
    );
  }
  let seconds: number | undefined;
  let size: { width: number; height: number } | undefined;
  for (const box of boxes(b, moov.body, moov.end)) {
    if (box.type === "mvhd") seconds = mvhdSeconds(b, box.body);
    if (box.type !== "trak") continue;
    for (const inner of boxes(b, box.body, box.end)) {
      // The FIRST track that declares a picture. A sound track's `tkhd` carries
      // zeroes here, which is how a video with a music track in it stops
      // measuring 0x0 and being dropped as unmeasurable.
      if (inner.type === "tkhd" && size === undefined) size = tkhdSize(b, inner.body);
    }
  }
  if (size === undefined) {
    throw new Error(
      "no track in it declares a width and a height, so there is no picture to place",
    );
  }
  return { ...size, ...(seconds === undefined ? {} : { seconds }) };
}

/**
 * `tkhd`'s width and height, 16.16 fixed point, AFTER the display matrix.
 *
 * The matrix is not decoration. A phone records portrait video as a landscape
 * track plus a 90° rotation, so the numbers in the header are the wrong way
 * round for the picture anybody sees — and layout frames a 1.78 strip and a 0.56
 * portrait completely differently, which is the failure `imageSize` exists to
 * prevent for stills. A quarter turn is the case where the diagonal is zero;
 * every other transform in the wild is a translation this does not care about.
 *
 * The offsets are the box layout, and the two versions differ only in whether
 * the times are 32 or 64 bits: v0 is 4 flags + 20 times + 8 reserved + 8
 * layer/group/volume + 36 matrix, v1 the same with 12 more bytes of times.
 */
function tkhdSize(b: Buffer, body: number): { width: number; height: number } | undefined {
  const matrix = body + (b[body] === 1 ? 52 : 40);
  const at = matrix + 36;
  if (at + 8 > b.length) return undefined;
  const width = Math.round(b.readUInt32BE(at) / 65536);
  const height = Math.round(b.readUInt32BE(at + 4) / 65536);
  if (width <= 0 || height <= 0) return undefined;
  const quarterTurn = b.readInt32BE(matrix) === 0 && b.readInt32BE(matrix + 16) === 0;
  return quarterTurn ? { width: height, height: width } : { width, height };
}

/** `mvhd`'s duration over its timescale. Undefined for the 32-bit "unknown". */
function mvhdSeconds(b: Buffer, body: number): number | undefined {
  const long = b[body] === 1;
  const at = body + (long ? 20 : 12);
  if (at + (long ? 12 : 8) > b.length) return undefined;
  const timescale = b.readUInt32BE(at);
  const ticks = long ? Number(b.readBigUInt64BE(at + 4)) : b.readUInt32BE(at + 4);
  if (timescale <= 0 || ticks <= 0 || ticks === 0xffffffff) return undefined;
  return sane(ticks / timescale);
}

/* The EBML ids webm spells the same four facts with. */
const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TRACKS = 0x1654ae6b;
const EBML_TRACK_ENTRY = 0xae;
const EBML_VIDEO = 0xe0;
const EBML_PIXEL_WIDTH = 0xb0;
const EBML_PIXEL_HEIGHT = 0xba;
const EBML_DISPLAY_WIDTH = 0x54b0;
const EBML_DISPLAY_HEIGHT = 0x54ba;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;

/**
 * PixelWidth/PixelHeight off the first video track, and Duration off Info.
 *
 * DisplayWidth wins where it is stated, and that is the anamorphic case: a track
 * stored 1440 wide and displayed at 1920 is a 4:3 rectangle downstream unless
 * the display size is honoured, and every fraction in an archetype is taken
 * against that rectangle.
 *
 * Descends only the five master elements it needs. An element whose size is the
 * all-ones "unknown" — which a live capture writes — is read to the end of its
 * parent, which is what a player does with one.
 */
function webmSize(b: Buffer): Measured {
  let pixel = { width: 0, height: 0 };
  let display = { width: 0, height: 0 };
  let scale = 1_000_000; // nanoseconds per tick, and webm's own default
  let ticks: number | undefined;
  const masters = new Set([EBML_SEGMENT, EBML_INFO, EBML_TRACKS, EBML_TRACK_ENTRY, EBML_VIDEO]);

  const scan = (from: number, to: number, depth: number): void => {
    let at = from;
    while (at < to) {
      const el = ebml(b, at, to);
      if (el === undefined || el.end <= at) return;
      if (masters.has(el.id)) {
        if (depth < 6) scan(el.body, el.end, depth + 1);
      } else if (el.id === EBML_PIXEL_WIDTH && pixel.width === 0) {
        pixel = { ...pixel, width: uint(b, el) };
      } else if (el.id === EBML_PIXEL_HEIGHT && pixel.height === 0) {
        pixel = { ...pixel, height: uint(b, el) };
      } else if (el.id === EBML_DISPLAY_WIDTH && display.width === 0) {
        display = { ...display, width: uint(b, el) };
      } else if (el.id === EBML_DISPLAY_HEIGHT && display.height === 0) {
        display = { ...display, height: uint(b, el) };
      } else if (el.id === EBML_TIMECODE_SCALE) {
        scale = uint(b, el) || scale;
      } else if (el.id === EBML_DURATION) {
        ticks = float(b, el);
      }
      at = el.end;
    }
  };
  scan(0, b.length, 0);

  const width = display.width || pixel.width;
  const height = display.height || pixel.height;
  if (width <= 0 || height <= 0) {
    throw new Error(
      "no track in it declares PixelWidth and PixelHeight, so there is no picture to place",
    );
  }
  const seconds = ticks === undefined ? undefined : sane((ticks * scale) / 1e9);
  return { width, height, ...(seconds === undefined ? {} : { seconds }) };
}

/** One EBML element: its id, where its body starts, where it ends. */
interface Ebml {
  id: number;
  body: number;
  end: number;
}

/**
 * An EBML element header: a variable-length id, then a variable-length size.
 *
 * Both are self-describing — the count of leading zero bits in the first byte
 * says how many bytes follow. The id keeps its marker bit (that is the spelling
 * every id is written as); the size loses it, and a size whose every value bit
 * is set means "unknown", which resolves to the end of the enclosing element.
 */
function ebml(b: Buffer, at: number, to: number): Ebml | undefined {
  const idLen = vintLen(b[at]);
  if (idLen === 0 || at + idLen > to) return undefined;
  let id = 0;
  for (let i = 0; i < idLen; i += 1) id = id * 256 + (b[at + i] ?? 0);

  let p = at + idLen;
  const sizeLen = vintLen(b[p]);
  if (sizeLen === 0 || p + sizeLen > to) return undefined;
  const first = b[p] ?? 0;
  const mask = 0xff >> sizeLen;
  let size = first & mask;
  let unknown = size === mask;
  for (let i = 1; i < sizeLen; i += 1) {
    const byte = b[p + i] ?? 0;
    size = size * 256 + byte;
    unknown = unknown && byte === 0xff;
  }
  p += sizeLen;
  return { id, body: p, end: unknown ? to : Math.min(p + size, to) };
}

/** How many bytes the vint starting with this byte occupies. 0 when it is not one. */
function vintLen(first: number | undefined): number {
  if (first === undefined || first === 0) return 0;
  let len = 1;
  for (let mask = 0x80; (first & mask) === 0; mask >>= 1) len += 1;
  return len;
}

/** An EBML unsigned integer, which is however many bytes its size said. */
function uint(b: Buffer, el: Ebml): number {
  let value = 0;
  for (let at = el.body; at < el.end && at - el.body < 8; at += 1)
    value = value * 256 + (b[at] ?? 0);
  return value;
}

/** An EBML float, which the spec allows to be 4 bytes, 8 bytes, or absent. */
function float(b: Buffer, el: Ebml): number | undefined {
  const width = el.end - el.body;
  if (width === 4) return b.readFloatBE(el.body);
  if (width === 8) return b.readDoubleBE(el.body);
  return undefined;
}

/** A duration worth writing down: positive, finite, and shorter than a day. */
function sane(seconds: number): number | undefined {
  return Number.isFinite(seconds) && seconds > 0 && seconds < 86_400 ? seconds : undefined;
}

/* ------------------------------------------------------------------- Clips */

/**
 * Put the harvest's clips back into the parsed source, and their files beside it.
 *
 * CALL THIS BEFORE `fetchFigures`, not after. `fetchFigures` passes a clip
 * through untouched — it says so in as many words, because a clip carries the
 * video's dimensions rather than an image's and its first bytes are an `ftyp`
 * box the image sniffer is right to refuse — so a clip that arrives after it has
 * run is a figure nothing ever localises, whose `src` is an absolute path into a
 * temp directory that will not exist on the machine that opens the deck.
 *
 * WHERE A CLIP LANDS. One with a poster REPLACES the figure `parseMarkdown` made
 * out of that poster, keeping its id, its section and the sentence that mentions
 * it — the three facts the planner uses to decide which point a picture belongs
 * to, and the reason the poster is written into the markdown at all. One without
 * a poster has nothing to replace and is appended, which costs it exactly those
 * three facts and is why a page that gives its videos posters harvests better.
 */
export async function attachClips(
  source: Source,
  clips: readonly HarvestedClip[],
  dir: string,
): Promise<Source> {
  if (clips.length === 0) return source;
  const assets = resolve(dir);
  await mkdir(assets, { recursive: true });
  const figures: Figure[] = [...source.figures];

  for (const clip of clips) {
    const src = clip.file ? await adopt(clip.file, assets) : undefined;
    const poster = clip.poster ? await adopt(clip.poster, assets) : undefined;
    if (src === undefined && poster === undefined) continue; // harvest never emits one
    // The markdown may spell the poster absolutely or as a bare filename — see
    // `HarvestOptions.refs` — and both are the same file.
    const at =
      clip.poster === ""
        ? -1
        : figures.findIndex((f) => f.src === clip.poster || f.src === basename(clip.poster));
    const kept = at === -1 ? undefined : figures[at];
    const figure = figureSchema.parse({
      id: kept?.id ?? freeId(figures),
      kind: "clip",
      // The file when we hold it, and the still when we do not: `claim-figure`
      // draws `poster` for a clip that carries an `href` and plays `src` for one
      // that does not, and `src` is required either way.
      src: src ?? poster,
      caption: kept?.caption || clip.caption,
      width: clip.width,
      height: clip.height,
      ...(kept?.sectionId === undefined ? {} : { sectionId: kept.sectionId }),
      ...(kept?.mention === undefined ? {} : { mention: kept.mention }),
      ...(poster === undefined ? {} : { poster }),
      ...(clip.seconds === undefined ? {} : { seconds: clip.seconds }),
      ...(clip.href === "" ? {} : { href: clip.href }),
    });
    if (at === -1) figures.push(figure);
    else figures[at] = figure;
  }
  return { ...source, figures };
}

/** Copy a harvested file into the deck's asset directory, keeping its name. */
async function adopt(file: string, dir: string): Promise<string> {
  const name = basename(file);
  await copyFile(file, join(dir, name));
  return name;
}

/**
 * An id no figure in this source already has.
 *
 * `parseMarkdown` numbers figures `fig1`, `fig2`, … in document order, so the
 * next number is normally free — but a clip appended after another clip is not
 * covered by "normally", and a duplicate id would give two figures one identity
 * in every reference a storyboard makes.
 */
function freeId(figures: readonly Figure[]): string {
  const taken = new Set(figures.map((f) => f.id));
  let n = figures.length + 1;
  while (taken.has(`fig${n}`)) n += 1;
  return `fig${n}`;
}

/* ---------------------------------------------------------------- Markdown */

/**
 * Blocks become THIS PROJECT'S markdown dialect, which is narrower than markdown.
 *
 * Three rules from src/source/markdown.ts, each of which loses content silently
 * when broken — no error, no gate, just a text-only deck:
 *
 *  - A figure is lifted only from a paragraph whose children are ALL images
 *    (`onlyImages`, around :82 and :158). So an image is always alone in its
 *    paragraph; `readDom` has already broken sentences around inline ones.
 *  - A caption is read only from a FOLLOWING paragraph that is a single run of
 *    emphasis (`captionOf`, :166). So a caption is `*text*` on its own, directly
 *    after the image, with every `*` inside it escaped.
 *  - Raw HTML returns the empty string in BOTH walkers (:243 and :264). So
 *    nothing here emits raw HTML, ever — not a `<figure>`, not a `<br>`, not an
 *    HTML comment.
 *
 * Exported because test/harvest.test.ts runs `parseMarkdown` back over its output
 * and asserts the figures survive, and that test must run on a machine with no
 * browser — which is every CI runner this project has.
 */
export function toMarkdown(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const item of blocks) {
    switch (item.kind) {
      case "heading":
        out.push(`${"#".repeat(Math.min(Math.max(item.depth, 1), 6))} ${inline(item.text)}`);
        break;
      case "paragraph":
        out.push(inline(item.text));
        break;
      case "code":
        out.push(fenced(item.text));
        break;
      case "list":
        out.push(
          item.items.map((li, n) => `${item.ordered ? `${n + 1}.` : "-"} ${inline(li)}`).join("\n"),
        );
        break;
      case "table":
        out.push(pipes(item.columns, item.rows));
        break;
      case "image":
        out.push(`![${inline(item.alt)}](${destination(item.src)})`);
        if (item.caption || item.alt) out.push(`*${inline(item.caption || item.alt)}*`);
        break;
      case "video": {
        if (item.poster) {
          out.push(`![${inline(item.caption)}](${destination(item.poster)})`);
          if (item.caption) out.push(`*${inline(item.caption)}*`);
        } else if (item.caption) {
          // No poster, so there is no image for an emphasis paragraph to caption
          // — and an emphasis paragraph with no image in front of it is read as
          // prose in italics, not as a caption. Plain prose says the same thing
          // without inviting `captionOf` to attach it to whatever came before.
          out.push(inline(item.caption));
        }
        // An autolink, because a `[label](url)` loses the URL: `textOf` in
        // markdown.ts reads a link's children and drops its destination, so the
        // page a viewer has to go to would vanish out of the prose. `<url>`
        // keeps the URL as the link's own text, which survives that walk.
        const link = item.href || item.src;
        if (/^https?:/i.test(link)) out.push(`Video: <${link}>`);
        break;
      }
    }
  }
  return `${out.filter((block) => block !== "").join("\n\n")}\n`;
}

/**
 * Text that will come back out of `parseMarkdown` unchanged.
 *
 * The escapes that matter are not decoration. `*` is escaped because a paragraph
 * that happens to be one run of emphasis is read as the CAPTION of whatever
 * image precedes it — so an italic pull-quote after a figure would replace that
 * figure's caption. `<` is escaped because remark would read `<div>` as raw
 * html, and raw html is the empty string in both of markdown.ts's walkers. The
 * line-leading markers turn a sentence into a heading or a list item.
 */
function inline(text: string): string {
  return (
    text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/([\\`*_[\]<>])/g, "\\$1")
      .replace(/^(#{1,6}\s|[-+]\s)/, "\\$&")
      // `\1.` is not an escape — CommonMark only escapes ASCII punctuation, so the
      // backslash would survive into the text. Escape the dot instead.
      .replace(/^(\d{1,9})([.)]\s)/, "$1\\$2")
  );
}

/**
 * A link destination. Pointy brackets whenever the path holds a space or a
 * bracket, which is how CommonMark says to write one and what remark gives back
 * verbatim — an asset directory under `~/My Documents` would otherwise produce a
 * markdown image whose src stops at the first space.
 */
function destination(path: string): string {
  if (/[<>]/.test(path)) {
    throw new Error(
      `cannot reference ${path} from markdown: a path containing < or > has no ` +
        "spelling as a link destination. Harvest into a directory without them.",
    );
  }
  return /[\s()]/.test(path) ? `<${path}>` : path;
}

/** A GFM table, padded to one width so every row parses. */
function pipes(columns: readonly string[], rows: readonly string[][]): string {
  const width = Math.max(columns.length, ...rows.map((r) => r.length), 1);
  const cells = (row: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => inline(row[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  const rule = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  return [cells(columns), rule, ...rows.map(cells)].join("\n");
}

/** A fence longer than the longest run of backticks the code itself contains. */
function fenced(code: string): string {
  const runs = [...code.matchAll(/`+/g)].map((m) => m[0].length + 1);
  const fence = "`".repeat(Math.max(3, ...runs));
  return `${fence}\n${code}\n${fence}`;
}

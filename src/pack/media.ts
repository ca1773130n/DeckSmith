/**
 * How each external asset travels inside a `.deck`.
 *
 * Three outcomes, and only one of them touches the network: `bake` pulls the
 * bytes in so the pack works offline and forever, `link` keeps the URL so the
 * pack stays small and the asset stays current, and `embed` is for URLs that are
 * not files at all — a YouTube or Vimeo link is a player page, and downloading
 * what sits behind it would be both technically wrong and, usually, against its
 * terms.
 *
 * The caller chooses between bake and link. It does not get to choose `embed`,
 * and it does not get to override it: that one is a property of the URL.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { z } from "zod";
import type { mediaSchema } from "../types.js";
import type { PackFiles } from "./pack.js";

export type Media = z.infer<typeof mediaSchema>;

/** What the caller asks for, before the URL gets a say. */
export interface AssetRequest {
  id: string;
  /** An http(s) URL, a `data:` URL, or a local path. */
  url: string;
  /** The caller's choice. Ignored for player URLs, which are always embedded. */
  prefer: "bake" | "link";
  mime?: string;
}

/**
 * Injected so tests never reach the network, and so a caller can supply its own
 * cache. `mime` is whatever the transport knows — a sniffed type is better than
 * a guessed extension.
 */
export type Fetcher = (url: string) => Promise<{ bytes: Uint8Array; mime?: string }>;

export interface MediaPlan {
  media: Media[];
  /** Paths under `media/`, ready to hand to `writePack`. */
  files: PackFiles;
  bakedCount: number;
  /**
   * Baking everything on a figure-heavy paper is the difference between a 2MB
   * pack and a 200MB one, so the total is reported rather than discovered.
   */
  bakedBytes: number;
  /** Ids the caller wanted baked that travel as link or embed instead. */
  demoted: string[];
  /** Ids the caller wanted linked that had to be baked — see `policyFor`. */
  promoted: string[];
}

/**
 * Hosts that serve a player, not a file. Deliberately short: every entry here is
 * a site whose whole product is the embed, so guessing wrong is not possible.
 * Anything not listed falls through to the shape test below, which errs towards
 * `link`.
 */
const PLAYERS = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "dailymotion.com",
  "dai.ly",
  "twitch.tv",
  "loom.com",
  "wistia.com",
  "wistia.net",
  "streamable.com",
  "bilibili.com",
  "soundcloud.com",
  "tiktok.com",
];

/** Extensions we are willing to believe name a file rather than a page. */
const FILE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".opus",
  ".pdf",
]);

/** A player URL is one whose host is in the list, or a subdomain of one. */
export function isEmbed(url: string): boolean {
  const host = hostOf(url);
  return host !== null && PLAYERS.some((p) => host === p || host.endsWith(`.${p}`));
}

/**
 * AN EMBED URL IS NOT A WATCH URL, and nothing else in this project converts
 * one into the other.
 *
 * `isEmbed` above answers "are these bytes ours to download" — they are not.
 * This answers the question a PRESENTED deck asks next: then what may I put in
 * a frame? The two are different documents. `youtube.com/watch?v=ID` inside an
 * iframe is refused by YouTube's own `X-Frame-Options`; `vimeo.com/ID` is a page
 * with a header, a comment thread and no player API. Only a per-host rule turns
 * the first into the second.
 *
 * A HOST WITH NO RULE GETS `undefined`, NOT A GUESS. A path we invented 404s
 * inside a frame, which paints a black rectangle with no console error, no
 * failed gate, and nothing for a viewer to click — the exact shape of silent
 * failure this project keeps finding. A poster and a link are a worse deck than
 * a working embed and a much better deck than an empty box.
 *
 * NOT CONVERTED, AND EACH FOR ITS OWN REASON. Twitch requires a `parent=` query
 * naming the page that frames it, which a built deck cannot know — it is a file
 * that gets served from whatever host the presenter has. Wistia's embed lives
 * under a per-account subdomain that the share URL does not carry. Bilibili's
 * player takes `aid`/`bvid`/`cid` as query parameters rather than a path.
 * SoundCloud's widget takes an API resource URL, and is audio besides. TikTok
 * and Streamable have embed forms this rule has not been verified against, and
 * an unverified rule is the guess the paragraph above refuses.
 */
interface Embeddable {
  /** Scheme and host the frame is served from — what `frame-src` has to allow. */
  origin: string;
  /** The embeddable URL for this page, or undefined when it is not a video page. */
  embed: (u: URL) => string | undefined;
}

/** Path segments, empties dropped: `/video/x7t/` -> `["video", "x7t"]`. */
function segments(u: URL): string[] {
  return u.pathname.split("/").filter(Boolean);
}

/**
 * An id we are willing to interpolate into a URL. Every host below names a video
 * with an opaque token, so anything outside this alphabet is either a page that
 * is not a video or a string trying to write a different URL than the rule
 * intends.
 */
function token(raw: string | null | undefined): string | undefined {
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : undefined;
}

/**
 * `youtube-nocookie.com`, which is the same player on a host that defers
 * YouTube's tracking cookies until the viewer actually presses play. A deck is
 * opened on somebody else's laptop, and a slide nobody played should not have
 * written an ad profile for them.
 */
const YOUTUBE_EMBED = "https://www.youtube-nocookie.com";
const youtube = (id: string | undefined) =>
  id === undefined ? undefined : `${YOUTUBE_EMBED}/embed/${id}`;

const YOUTUBE: Embeddable = {
  origin: YOUTUBE_EMBED,
  embed: (u) => {
    const seg = segments(u);
    const path = seg[0];
    return youtube(
      token(
        path === "watch"
          ? u.searchParams.get("v")
          : path === "embed" || path === "shorts" || path === "live" || path === "v"
            ? seg[1]
            : undefined,
      ),
    );
  },
};

/** `youtu.be/ID` — the whole path is the id, and it is the shape a share button gives. */
const YOUTU_BE: Embeddable = {
  origin: YOUTUBE_EMBED,
  embed: (u) => youtube(token(segments(u)[0])),
};

const VIMEO_EMBED = "https://player.vimeo.com";

const VIMEO: Embeddable = {
  origin: VIMEO_EMBED,
  embed: (u) => {
    const seg = segments(u);
    // `player.vimeo.com/video/ID` is already the player; `vimeo.com/ID` is the
    // page around it. Both end in the same numeric id. A path that is not a
    // number is a channel, a group or a user profile, so it is not converted.
    const [head, next] = seg[0] === "video" ? [seg[1], seg[2]] : [seg[0], seg[1]];
    if (head === undefined || !/^\d+$/.test(head)) return undefined;
    // AN UNLISTED VIDEO IS `vimeo.com/ID/HASH`, AND THE HASH IS NOT DECORATION:
    // dropped, the player answers "we can't find that page" — a private video
    // that plays from the paper's own page and not from the deck. It travels as
    // `h` on the embed.
    const hash = token(next ?? u.searchParams.get("h"));
    // `dnt=1` is Vimeo's own do-not-track parameter, taken for the same reason
    // the nocookie host is above: this is the privacy-preserving variant the
    // host offers, and the viewer did not ask to be measured by reading a slide.
    return `${VIMEO_EMBED}/video/${head}?${hash ? `h=${hash}&` : ""}dnt=1`;
  },
};

const DAILYMOTION_EMBED = "https://www.dailymotion.com";
const dailymotion = (id: string | undefined) =>
  id === undefined ? undefined : `${DAILYMOTION_EMBED}/embed/video/${id}`;

const DAILYMOTION: Embeddable = {
  origin: DAILYMOTION_EMBED,
  embed: (u) => {
    const seg = segments(u);
    return dailymotion(
      token(seg[0] === "video" ? seg[1] : seg[0] === "embed" ? seg[2] : undefined),
    );
  },
};

/** `dai.ly/ID` is Dailymotion's own shortener, and the id is the whole path. */
const DAI_LY: Embeddable = {
  origin: DAILYMOTION_EMBED,
  embed: (u) => dailymotion(token(segments(u)[0])),
};

const LOOM: Embeddable = {
  origin: "https://www.loom.com",
  embed: (u) => {
    const seg = segments(u);
    const id = token(seg[0] === "share" || seg[0] === "embed" ? seg[1] : undefined);
    return id === undefined ? undefined : `https://www.loom.com/embed/${id}`;
  },
};

/** Keyed by the same hosts `PLAYERS` lists, so a rule can only exist for a player page. */
const EMBEDS: Record<string, Embeddable> = {
  "youtube.com": YOUTUBE,
  "youtube-nocookie.com": YOUTUBE,
  "youtu.be": YOUTU_BE,
  "vimeo.com": VIMEO,
  "dailymotion.com": DAILYMOTION,
  "dai.ly": DAI_LY,
  "loom.com": LOOM,
};

/**
 * Every origin an embed can come from, deduped.
 *
 * DERIVED FROM THE RULES ABOVE RATHER THAN RESTATED BESIDE THEM, because the
 * served deck's `frame-src` names exactly this list (src/server/http.ts): a host
 * added here and forgotten there is a frame the browser refuses, and CSP refuses
 * it the way CSP refuses everything — an empty rectangle and a line in a console
 * nobody has open.
 */
export const EMBED_ORIGINS: readonly string[] = [
  ...new Set(Object.values(EMBEDS).map((e) => e.origin)),
];

/** The embeddable form of a player page, or undefined when we cannot say. */
export function embedUrl(url: string): string | undefined {
  const host = hostOf(url);
  if (host === null) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  // `hostOf` also answers for `ftp:` and other schemes; a frame src has to be
  // one a browser will fetch.
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const rule = Object.entries(EMBEDS).find(([h]) => host === h || host.endsWith(`.${h}`))?.[1];
  return rule?.embed(u);
}

/**
 * The final policy for one asset.
 *
 * Baking requires confidence that the URL points at a file. A local path or a
 * `data:` URL is one by construction; a remote URL has to end in an extension we
 * recognise. Without that we would happily bake an HTML error page under a
 * `.jpg`-shaped id, so an unrecognised shape stays a `link` even when the caller
 * asked to bake it.
 *
 * A local path is baked even under `--link`, and that is not the caller being
 * overridden for its own good — it is that there is no link to keep. `ingest`
 * downloads every figure and rewrites `src` to the local copy, so by pack time
 * the original URL is gone and "link" could only record this machine's
 * filesystem layout. That packs clean, unpacks clean, and rebuilds into a deck
 * whose <img>s point at nothing; the lint gate calls it missing_local_asset on
 * the recipient's machine, which is the worst possible place to find out.
 */
export function policyFor(url: string, prefer: "bake" | "link"): Media["policy"] {
  if (isEmbed(url)) return "embed";
  const host = hostOf(url);
  if (host === null || /^data:/i.test(url)) return "bake"; // local path or inline bytes
  if (prefer === "link") return "link";
  return FILE_EXT.has(extOf(url)) ? "bake" : "link";
}

/** Resolve every asset, fetching only the ones that end up baked. */
export async function planMedia(
  assets: AssetRequest[],
  fetcher: Fetcher = fetchAsset,
): Promise<MediaPlan> {
  const plan: MediaPlan = {
    media: [],
    files: {},
    bakedCount: 0,
    bakedBytes: 0,
    demoted: [],
    promoted: [],
  };
  for (const asset of assets) {
    const policy = policyFor(asset.url, asset.prefer);
    if (policy !== "bake") {
      if (asset.prefer === "bake") plan.demoted.push(asset.id);
      plan.media.push({ id: asset.id, policy, url: asset.url, mime: asset.mime });
      continue;
    }
    if (asset.prefer === "link") plan.promoted.push(asset.id);
    // A failed fetch throws rather than quietly downgrading to `link`: the
    // caller asked for a self-contained pack and would not otherwise learn it
    // did not get one.
    const got = await fetcher(asset.url);
    const mime = clean(got.mime) ?? asset.mime;
    if (mime === "text/html") {
      // The shape test was fooled — a redirect to a login or interstitial page.
      // Keeping the URL is right; storing the page would not be.
      plan.demoted.push(asset.id);
      plan.media.push({ id: asset.id, policy: "link", url: asset.url, mime });
      continue;
    }
    const path = `media/${bakedName(asset.id, asset.url, mime)}`;
    plan.files[path] = got.bytes;
    plan.bakedCount += 1;
    plan.bakedBytes += got.bytes.length;
    plan.media.push({ id: asset.id, policy: "bake", path, mime, bytes: got.bytes.length });
  }
  return plan;
}

/** One line a CLI can print, because a user should know which pack they got. */
export function mediaSummary(plan: MediaPlan): string {
  const linked = plan.media.filter((m) => m.policy === "link").length;
  const embedded = plan.media.filter((m) => m.policy === "embed").length;
  const parts = [`${plan.bakedCount} baked (${size(plan.bakedBytes)})`];
  if (linked) parts.push(`${linked} linked`);
  if (embedded) parts.push(`${embedded} embedded`);
  if (plan.demoted.length) parts.push(`${plan.demoted.length} not bakeable`);
  return parts.join(", ");
}

/**
 * The URL hash is what makes the name correct under a stable id: two revisions
 * of the same figure cannot collide, and the same input always produces the same
 * pack. The id is only there so the archive stays readable.
 */
function bakedName(id: string, url: string, mime?: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "asset";
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 8);
  return `${slug}-${hash}${extOf(url) || extFor(mime)}`;
}

function extOf(url: string): string {
  const path = hostOf(url) === null ? url : new URL(url).pathname;
  const ext = extname(path).toLowerCase();
  return FILE_EXT.has(ext) ? ext : "";
}

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "application/pdf": ".pdf",
};

function extFor(mime?: string): string {
  return (mime && MIME_EXT[mime]) ?? ".bin";
}

/** Host of an absolute URL, or null when the string is a local path. */
function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "file:" || u.protocol === "data:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function clean(mime?: string): string | undefined {
  return mime?.split(";")[0]?.trim().toLowerCase() || undefined;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

async function fetchAsset(url: string): Promise<{ bytes: Uint8Array; mime?: string }> {
  if (/^(https?|data):/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get("content-type") ?? undefined,
    };
  }
  return { bytes: new Uint8Array(await readFile(url)) };
}

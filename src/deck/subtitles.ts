/**
 * The narration island, and the two questions the presented deck asks of it.
 *
 * A narrated deck carries a second JSON island beside the slideshow one: same
 * page, same shape of thing, different reader. It is separate rather than folded
 * into the slideshow manifest because that manifest is HyperFrames' format, not
 * ours — adding a key to it is a bet on a schema someone else owns.
 *
 * Everything here is pure, and deliberately so. Playback is untestable without a
 * browser; "which cue is on screen at t" and "which segment belongs to this
 * stop" are the parts that can actually be wrong, so they live apart from the
 * audio element and are tested directly.
 *
 * Read defensively throughout. A deck built before narration existed has no
 * island at all, and a deck built by a newer emitter may carry fields this
 * reader has never heard of; neither may do anything worse than fall silent.
 */

/** Selector for the island. Not `+json` alone — the slideshow one is that too. */
export const NARRATION_ISLAND = 'script[type="application/decksmith-narration+json"]';

/** One subtitle line, in seconds from the start of its own segment's audio. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/**
 * What is spoken at one stop.
 *
 * `stop` matches `Stop.fragment`: 0 is the slide's landing, 1..n its reveals.
 * The contract's `seconds` is not read here — the audio element's own clock is
 * the authority, and a measured number we then ignore is a number that can drift
 * out of agreement with the file without anything noticing.
 */
export interface Segment {
  stop: number;
  /** Resolved against `Narration.dir`; see `audioSrc`. */
  audio: string;
  cues: Cue[];
}

export interface Narration {
  voice: string;
  /** Directory the segment paths hang off, relative to the deck page. May be "". */
  dir: string;
  /** Keyed by scene id — `s1`, `s2` — the same ids the slideshow island carries. */
  scenes: Record<string, Segment[]>;
}

/* ------------------------------------------------------------------ Reading */

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function toCue(v: unknown): Cue | null {
  const raw = v as Partial<Cue> | null;
  const start = num(raw?.start);
  const end = num(raw?.end);
  if (start === undefined || end === undefined || end < start) return null;
  return { start, end, text: typeof raw?.text === "string" ? raw.text : "" };
}

/**
 * The longest cue we will put on screen at once: two lines of about 42
 * characters, which is broadcast practice and roughly what the band's width
 * gives at its clamped font size.
 *
 * edge-tts emits one cue per SENTENCE, and a long sentence produces a long cue —
 * 121 characters on a single wrapped block was measured on the demo deck. That
 * is three lines, and three lines is a band tall enough to cover the bottom of
 * the slide however much room the composition reserves. Capping here rather than
 * at synthesis time means a deck built before this existed is fixed by reloading
 * it, without re-narrating anything.
 */
export const CUE_MAX_CHARS = 84;

/**
 * Greedy word packing, one line at a time, breaking only at spaces. A word
 * longer than `width` becomes its own line rather than being broken mid-word.
 */
function pack(words: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * One cue, wrapped to at most `max` characters a piece, with the original
 * duration divided between the pieces in proportion to their length.
 *
 * Proportional rather than equal because the reading time a chunk needs tracks
 * its length, and because the speech under it does too — the split lands close
 * to where the voice actually is. A word longer than `max` becomes its own
 * piece rather than being broken mid-word.
 *
 * EVEN, not greedy. Packing straight to `max` fills the first piece and dumps
 * whatever is left into the last one, and the duration split is proportional,
 * so a 90-character cue came out as an 84-character caption followed by a
 * SINGLE WORD on screen for 0.3 seconds. Six of the demo deck's forty-nine cues
 * flashed a one-word caption that way — under every broadcast minimum, and
 * clearly wrong the moment anyone watched the video. So the piece COUNT is
 * decided first, from `max`, and then the narrowest width that still fits in
 * that many pieces does the packing: same number of captions, no orphan.
 */
export function splitCue(cue: Cue, max = CUE_MAX_CHARS): Cue[] {
  if (cue.text.length <= max) return [cue];

  const words = cue.text.split(/\s+/).filter(Boolean);
  const count = pack(words, max).length;
  let width = max;
  for (let w = Math.ceil(cue.text.length / count); w < max; w++) {
    if (pack(words, w).length <= count) {
      width = w;
      break;
    }
  }
  const chunks = pack(words, width);
  if (chunks.length < 2) return [cue];

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const span = cue.end - cue.start;
  let at = cue.start;
  return chunks.map((text, i) => {
    // The last piece takes the exact original end, so rounding never leaves a
    // sliver of silence where the segment's final subtitle should still be up.
    const end = i === chunks.length - 1 ? cue.end : at + (span * text.length) / total;
    const piece = { start: at, end, text };
    at = end;
    return piece;
  });
}

function toSegment(v: unknown): Segment | null {
  const raw = v as Partial<Segment> | null;
  const stop = num(raw?.stop);
  if (stop === undefined || stop < 0 || !raw?.audio || typeof raw.audio !== "string") return null;
  const cues = Array.isArray(raw.cues)
    ? raw.cues.map(toCue).filter((c): c is Cue => c !== null)
    : [];
  // Sorted, because `activeCue` returns the first match and edge-tts has been
  // seen to emit a trailing cue that overlaps the one before it by a frame.
  cues.sort((a, b) => a.start - b.start);
  return { stop, audio: raw.audio, cues: cues.flatMap((c) => splitCue(c)) };
}

/**
 * Parse the island's text. Anything malformed reads as "no narration", which is
 * the deck we shipped yesterday and is always a safe answer.
 */
export function parseNarration(text: string | null | undefined): Narration | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = parsed as { voice?: unknown; dir?: unknown; scenes?: unknown } | null;
  const scenesRaw = raw?.scenes;
  if (!scenesRaw || typeof scenesRaw !== "object" || Array.isArray(scenesRaw)) return null;

  const scenes: Record<string, Segment[]> = {};
  for (const [sceneId, list] of Object.entries(scenesRaw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const segments = list.map(toSegment).filter((s): s is Segment => s !== null);
    if (segments.length > 0) scenes[sceneId] = segments;
  }
  if (Object.keys(scenes).length === 0) return null;

  return {
    voice: typeof raw?.voice === "string" ? raw.voice : "",
    dir: typeof raw?.dir === "string" ? raw.dir : "",
    scenes,
  };
}

/* ------------------------------------------------------------------ Lookups */

/**
 * The cue on screen at `t`, or null in a gap.
 *
 * Half-open: `[start, end)`. A cue ending exactly where the next begins must
 * hand over cleanly, and closing both ends would put two lines on screen for one
 * frame at every sentence boundary — which is every boundary edge-tts emits.
 */
export function activeCue(cues: readonly Cue[], t: number): Cue | null {
  for (const cue of cues) {
    if (t < cue.start) return null; // sorted, so nothing later can match either
    if (t < cue.end) return cue;
  }
  return null;
}

/** The segment spoken at one stop, or null where the deck is silent. */
export function segmentFor(
  narration: Narration | null,
  sceneId: string,
  stop: number,
): Segment | null {
  return narration?.scenes[sceneId]?.find((s) => s.stop === stop) ?? null;
}

/**
 * Where the segment's audio actually lives, relative to the deck page.
 *
 * `dir` is a convenience so the emitter can write bare filenames; a segment path
 * that is already absolute or already a URL is left exactly as it is, because
 * prefixing one would break a deck whose audio is hosted rather than baked.
 */
export function audioSrc(narration: Narration, segment: Segment): string {
  const dir = narration.dir.replace(/\/+$/, "");
  if (dir === "" || /^[a-z][a-z0-9+.-]*:|^\.{0,2}\//i.test(segment.audio)) return segment.audio;
  return `${dir}/${segment.audio}`;
}

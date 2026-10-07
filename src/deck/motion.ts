/**
 * The deck player's half of v2 motion: what moves between stops and during them.
 *
 * Two things a presented deck never showed before, both only for a deck whose
 * page carries the `application/decksmith-motion+json` island — a `design: v2`
 * build. A classic deck has no island and every function here answers "nothing
 * to do", so it presents exactly as it did.
 *
 * 1. THE SEAM. A step to the next slide plays only when the span is short
 *    (`MAX_SPAN` in runtime.ts). From a narrated slide's last stop it never is —
 *    the voice made the scene long — so every slide change CUT to the next
 *    slide's first stop, already built: the seam and the whole entrance were
 *    never seen in deck.html, only in the mp4. `seamLead` says where to cut TO
 *    instead: the next slide's own start, so the glide that follows plays the
 *    handoff and the entrance, one to two seconds, as the video does.
 *
 * 2. THE HOLD. At a stop the deck seeks once and holds still while the audio
 *    plays, so emphasis written into the scene's quiet stretch (`emphasize` in
 *    src/emit/motion.ts) would never run. `holdTime` maps the audio clock onto
 *    that stretch — `from + audio.currentTime`, clamped to it — so a part pulses
 *    on the word it pulses on in the video. Still SEEK, NOT PLAY (invariant 1):
 *    the runtime seeks to a time derived from the audio element's clock, the way
 *    captions already follow it, and nothing runs a timeline on its own.
 *
 * Reduced motion turns both off at the call site in runtime.ts: the step cuts and
 * the hold holds, which is what the deck did for everyone before.
 */
import type { SlideSpec, Stop } from "./runtime.js";

export const MOTION_ISLAND = 'script[type="application/decksmith-motion+json"]';

/** One narrated stop's quiet stretch, absolute composition seconds. */
export interface HoldSpan {
  stop: number;
  /** The stop's own time — where the deck lands. */
  at: number;
  /** Where the stop's sentence starts on the composition clock. */
  from: number;
  /** The last time this stop may show before the next stop's reveal begins. */
  to: number;
}

export interface Motion {
  /** Glide through seams on slide changes. */
  seams: boolean;
  /** Keyed by scene id. */
  holds: Record<string, HoldSpan[]>;
}

/**
 * The island, or null. Defensive in the way `parseNarration` is: this ships
 * inside decks that outlive the code that wrote them, so a malformed entry is
 * dropped rather than allowed to break the player.
 */
export function parseMotion(json: string | null | undefined): Motion | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { seams?: unknown; holds?: unknown };
    const holds: Record<string, HoldSpan[]> = {};
    if (raw.holds && typeof raw.holds === "object") {
      for (const [sid, list] of Object.entries(raw.holds as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        const ok = list.filter(
          (h): h is HoldSpan =>
            typeof h === "object" &&
            h !== null &&
            [h.at, h.from, h.to].every((n) => typeof n === "number" && Number.isFinite(n)) &&
            h.to > h.at,
        );
        if (ok.length) holds[sid] = ok;
      }
    }
    return { seams: raw.seams === true, holds };
  } catch {
    return null;
  }
}

/** The stretch belonging to this stop, matched by time (fragments are 3dp). */
export function spanFor(motion: Motion, stop: Stop): HoldSpan | undefined {
  return motion.holds[stop.sceneId]?.find((h) => Math.abs(h.at - stop.t) < 0.002);
}

/** Composition time to show `seconds` into this stop's audio. */
export function holdTime(span: HoldSpan, seconds: number): number {
  const t = span.from + Math.max(0, seconds);
  return Math.min(span.to, Math.max(span.at, t));
}

/** Longest entrance a seam glide will play — a slide's first stop is rarely past 2.5s. */
export const MAX_SEAM_SPAN = 4;

/**
 * Where a forward step onto the next slide should start its glide, or null for
 * "decide as before". Only a step from the previous slide onto this slide's
 * FIRST stop, only when the ordinary policy would have cut (the span is longer
 * than `maxSpan`), and only when the entrance itself is short enough to watch.
 */
export function seamLead(
  from: number,
  prev: Stop | undefined,
  next: Stop,
  slides: readonly SlideSpec[],
  maxSpan: number,
): number | null {
  if (!prev || next.fragment !== 0 || next.slide !== prev.slide + 1) return null;
  if (next.t - from <= maxSpan) return null;
  const start = slides.find((s) => s.sceneId === next.sceneId)?.startTime;
  if (typeof start !== "number" || !Number.isFinite(start)) return null;
  if (start <= from || next.t - start > MAX_SEAM_SPAN || next.t <= start) return null;
  return start;
}

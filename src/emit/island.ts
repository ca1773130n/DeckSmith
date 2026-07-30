/**
 * The slideshow island — the deck's navigation map.
 *
 * Fragment times are ABSOLUTE positions on the deck timeline, not offsets into a
 * slide, which is easy to get subtly wrong and produces a deck that lints clean
 * and navigates to the wrong place. A fragment outside its slide's window fails
 * `hyperframes lint`, so the conversion is checked here rather than at the gate.
 */

export interface SlideInput {
  /** The scene's composition id, e.g. `"s3"`. */
  sid: string;
  start: number;
  duration: number;
  /** Presenter note, already plain text. */
  notes: string;
  /** Hold points in seconds from the scene's start. */
  holds: number[];
}

export function emitIsland(slides: SlideInput[]): string {
  const manifest = {
    slides: slides.map((s) => {
      // ROUNDED FIRST, then added to. `start` is a sum of already-rounded scene
      // lengths, so it can carry a float tail; the scene div publishes `round`
      // of it, and `planTiming` reads that back and recomputes each fragment as
      // `round(publishedStart + hold)`. Adding the UNROUNDED start here made the
      // two disagree by exactly 0.001 whenever the tail crossed a boundary, which
      // it does as soon as the speed is not a round number: at `--speed 0.417`
      // the demo's s5 gave 87.200 here and 87.199 there, `assertHoldsAgree`
      // threw, no timing.json was written and `render` refused — while `build`
      // still reported PASS on every gate. Doing the rounding in one place makes
      // them agree by construction rather than by coincidence.
      const start = round(s.start);
      const end = round(s.start + s.duration);
      const fragments = s.holds.map((h) => round(start + h));
      for (const f of fragments) {
        // Half-open: a fragment landing exactly on `end` belongs to the next slide.
        if (f < start || f >= end) {
          throw new Error(
            `${s.sid}: fragment ${f}s is outside its slide window [${start}, ${end})`,
          );
        }
      }
      // `startTime`/`endTime` are redundant inside the composition, where the
      // scene divs carry the same numbers — but the navigable wrapper page holds
      // the island with the scenes behind the player's iframe, where they are the
      // only placement available. Emitting them always keeps one code path.
      const placed = { sceneId: s.sid, startTime: start, endTime: end };
      return fragments.length > 0
        ? { ...placed, notes: s.notes, fragments }
        : { ...placed, notes: s.notes };
    }),
    slideSequences: [],
  };

  // A `</script>` inside a presenter note would close the island early. Escaping
  // `<` is sufficient and leaves the JSON valid — the parser reads < back.
  const json = JSON.stringify(manifest, null, 2).replace(/</g, "\\u003c");
  return `    <script type="application/hyperframes-slideshow+json">
${json}
    </script>`;
}

/** Float drift in a sum must never change the emitted bytes — renders are byte-compared. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

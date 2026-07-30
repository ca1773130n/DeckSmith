import {makeScene2D, Rect, Txt, Layout} from '@motion-canvas/2d';
import {all, createRef, waitFor, easeInOutCubic} from '@motion-canvas/core';

/**
 * A stand-in for DeckSmith's heaviest archetypes (data-table / grid): ~200
 * animated nodes, 30s long. Used to find out whether Motion Canvas's
 * replay-based seek costs real wall time once a scene has real content, or
 * whether the O(frames) advance is cheap enough not to matter.
 */
const ROWS = 14;
const COLS = 14;

export default makeScene2D(function* (view) {
  view.fill('#0b0d10');

  const cells: ReturnType<typeof createRef<Rect>>[] = [];
  const grid = createRef<Layout>();

  view.add(
    <Layout ref={grid} layout={false}>
      {Array.from({length: ROWS * COLS}, (_, i) => {
        const ref = createRef<Rect>();
        cells.push(ref);
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        return (
          <Rect
            ref={ref}
            width={90}
            height={60}
            x={(c - COLS / 2) * 100}
            y={(r - ROWS / 2) * 70}
            fill="#1b2028"
            radius={6}
            opacity={0}
          >
            <Txt text={`${r}·${c}`} fill="#8a94a6" fontSize={24} fontFamily="Helvetica" />
          </Rect>
        );
      })}
    </Layout>,
  );

  // Stagger every cell in — 196 concurrent tweens.
  yield* all(...cells.map((ref, i) => ref().opacity(1, 0.4 + (i % 17) * 0.05)));
  yield* waitFor(2);

  // Highlight sweeps: keeps all nodes changing for the rest of the scene.
  for (let pass = 0; pass < 4; pass++) {
    yield* all(
      ...cells.map((ref, i) =>
        ref().fill(i % (pass + 2) === 0 ? '#4c8dff' : '#1b2028', 1.2, easeInOutCubic),
      ),
    );
    yield* all(...cells.map(ref => ref().scale(1 + Math.sin(pass) * 0.05, 1.0)));
    yield* waitFor(1);
  }

  yield* all(...cells.map(ref => ref().opacity(0.4, 2)));
  yield* waitFor(3);
});

import {makeScene2D, Circle, Rect, Txt, Line} from '@motion-canvas/2d';
import {all, createRef, waitFor, easeInOutCubic} from '@motion-canvas/core';

/**
 * A stand-in for a DeckSmith "claim-figure" beat: a title, a rule, a figure
 * that assembles, and a callout. Deliberately ~20s long so that the cost of
 * seeking to a late timestamp is measurable rather than noise.
 */
export default makeScene2D(function* (view) {
  const title = createRef<Txt>();
  const rule = createRef<Rect>();
  const dot = createRef<Circle>();
  const box = createRef<Rect>();
  const link = createRef<Line>();
  const note = createRef<Txt>();

  view.fill('#0b0d10');

  view.add(
    <>
      <Txt
        ref={title}
        text="Attention is a soft lookup"
        fill="#e8eaed"
        fontSize={72}
        fontFamily="Helvetica"
        y={-360}
        opacity={0}
      />
      <Rect ref={rule} width={0} height={4} fill="#4c8dff" y={-290} />
      <Circle ref={dot} size={0} fill="#4c8dff" x={-420} y={40} />
      <Rect ref={box} width={0} height={220} fill="#1b2028" x={220} y={40} radius={12} />
      <Line
        ref={link}
        points={[[-360, 40], [100, 40]]}
        stroke="#8a94a6"
        lineWidth={6}
        end={0}
        endArrow
      />
      <Txt
        ref={note}
        text="query · key · value"
        fill="#8a94a6"
        fontSize={44}
        fontFamily="Helvetica"
        y={300}
        opacity={0}
      />
    </>,
  );

  // beat 1
  yield* title().opacity(1, 0.8);
  yield* rule().width(900, 0.6, easeInOutCubic);
  yield* waitFor(1.5);

  // beat 2
  yield* dot().size(120, 0.7);
  yield* waitFor(1.5);

  // beat 3
  yield* all(box().width(420, 0.8, easeInOutCubic), link().end(1, 0.8));
  yield* waitFor(2);

  // beat 4
  yield* note().opacity(1, 0.6);
  yield* waitFor(2);

  // a long tail so late seeks have real work to replay
  yield* all(
    dot().position.x(-200, 3),
    box().position.x(400, 3),
    title().fontSize(84, 3),
  );
  yield* waitFor(4);
  yield* all(note().opacity(0.3, 1.5), rule().width(400, 1.5));
  yield* waitFor(2);
});

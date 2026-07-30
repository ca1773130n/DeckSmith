/**
 * The one library family whose SHAPE matches DeckSmith's actual problem.
 *
 * ELK/dagre/Graphviz answer "given fixed node sizes, how big a canvas?".
 * DeckSmith asks the dual: "given a fixed 1920x1080 frame, what sizes?".
 * That is a constrained optimisation, and Cassowary (kiwi.js) is the solver for
 * it — priorities let you say "spend gap before you spend type size", which is
 * exactly the sentence `fitBoxes`'s doc comment already contains.
 *
 * So: can kiwi express fitBoxes, and does it reproduce fitBoxes's answer?
 */
import * as kiwi from "@lume/kiwi";
import { fitBoxes, MIN_FONT, textWidth } from "./ds-svg.mjs";

const W = 1696;
const PREF_SIZE = 46;
const PREF_GAP = 120;
const MIN_GAP = 30;
const PAD_EM = 0.45;

function kiwiFit(labels) {
  const n = labels.length;
  const unit = labels.map((l) => textWidth(l, 1, 600) + 2 * PAD_EM);
  const s = new kiwi.Solver();
  const size = new kiwi.Variable("size");
  const gap = new kiwi.Variable("gap");

  // The type floor is `strong`, not `required`, so an impossible row comes back
  // as a number below the floor instead of an exception — which is what
  // `fitBoxes` reports as `{ ok: false, needed }`. With it `required`, kiwi
  // throws "unsatisfiable constraint" and says nothing about by how much.
  s.addConstraint(new kiwi.Constraint(size, kiwi.Operator.Ge, MIN_FONT, kiwi.Strength.strong));
  s.addConstraint(new kiwi.Constraint(size, kiwi.Operator.Le, PREF_SIZE, kiwi.Strength.required));
  s.addConstraint(new kiwi.Constraint(gap, kiwi.Operator.Ge, MIN_GAP, kiwi.Strength.required));
  s.addConstraint(new kiwi.Constraint(gap, kiwi.Operator.Le, PREF_GAP, kiwi.Strength.required));
  // Boxes take an equal share of whatever the gaps leave, and the widest label
  // must fit its box: `widest * size <= (W - gap*(n-1)) / n`.
  const widest = Math.max(...unit);
  s.addConstraint(
    new kiwi.Constraint(
      new kiwi.Expression([widest * n, size], [n - 1, gap]),
      kiwi.Operator.Le,
      W,
      kiwi.Strength.required,
    ),
  );

  // Soft, in priority order: type size first, then gap. This is the whole
  // policy — "whitespace is cheaper than legibility" — as two lines.
  s.addConstraint(new kiwi.Constraint(size, kiwi.Operator.Eq, PREF_SIZE, kiwi.Strength.strong));
  s.addConstraint(new kiwi.Constraint(gap, kiwi.Operator.Eq, PREF_GAP, kiwi.Strength.medium));
  s.updateVariables();
  const g = gap.value();
  return { size: size.value(), gap: g, boxW: (W - g * (n - 1)) / n };
}

const CASES = [
  ["Encode", "Window", "DQ-CTM", "Decode"],
  ["Encode", "Window Partition", "DQ-CTM", "Cross Attention", "Refine"],
  ["Tokenize", "Embed"],
];

console.log("labels".padEnd(10), "kiwi (size/gap/box)".padEnd(30), "fitBoxes (size/gap/box)");
for (const labels of CASES) {
  const k = kiwiFit(labels);
  const f = fitBoxes({
    labels,
    width: W,
    size: PREF_SIZE,
    gap: PREF_GAP,
    minGap: MIN_GAP,
    padEm: PAD_EM,
    weight: 600,
  });
  console.log(
    `${labels.length} stages`.padEnd(10),
    `${k.size.toFixed(2)} / ${k.gap.toFixed(2)} / ${k.boxW.toFixed(2)}`.padEnd(30),
    `${f.size.toFixed(2)} / ${f.gap.toFixed(2)} / ${f.boxes[0].w.toFixed(2)}   ok=${f.ok}`,
  );
}

console.log(
  "\nkiwi does reproduce the policy, and states it more directly than the three-branch\n" +
    "cascade in fitBoxes. What it cannot do is the part fitBoxes spends most of its lines on:\n" +
    "report !ok with `needed`, and let pipeline.ts retry the whole solve with the labels\n" +
    "balanced onto 2 then 3 lines. Re-wrapping changes `unit`, which is a coefficient, not a\n" +
    "variable — so the retry loop stays outside the solver either way.",
);

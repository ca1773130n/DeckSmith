# Verb looks: one approved layout per literal verb

The founder approved all five on 2026-10-12 ("approve"). Each PNG in
`2026-10-12-verb-looks/` is the reference frame for its verb. Code the look as
that verb's only layout. The planner only fills in content, and the gates check
that the output matches the look.

The HTML files are the mockup sources. They load paper figures from an `a/`
directory, which is not committed. The PNGs are the reference.

| Verb | Paper | What the look is |
| --- | --- | --- |
| operate | C2 (speculative decoding) | The formula large at the top left with its stated inputs as chips. One tile per computed term, each showing its value, joined by the operator. Below: the sum written out, the result very large, and a green chip saying which stated number it matches. |
| evolve | C2, Fig 1 | One row per step: the dimmed tail of the accepted prefix, then this step's changes colour-coded. The current step sits on a panel. On the right: the legend, plus a stated fact about the steps. |
| flow | B (OneVL), Fig 3/18 | The input picture and inputs on the left. The model as a box containing its token row, with counts stated. The outputs stacked on the right, each with a real picture or a quote. Training-only stages are dashed and tagged. Wires leave the box's right edge. |
| place | B, NAVSIM table | One plane filling about 70% of the width, with every dot labelled and its value shown. Methods without an x value become dashed lines. The comparison the paper itself draws is a dashed link with a one-line delta. On the right: the scored scene. |
| region | B, ROADWork Fig 18 | The real frame large on the left with numbered boxes, and badges outside the boxes. On the right: a numbered factor list, then the decision. The legend sits under the picture. |

These rules apply to every look:

- ink theme
- 56px headline, nothing below 40px
- every number grounded
- no growing bars and no counters

Motion when this ships:

- **operate:** tiles reveal left to right, then the sum.
- **evolve:** rows reveal one by one; the panel moves to the current row.
- **flow:** stages reveal along the wires.
- **place:** dots appear, then the comparison link.
- **region:** boxes appear one at a time, in step with their factors.

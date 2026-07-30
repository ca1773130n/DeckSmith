# ThinkSR: compact thought, dense output

Continuous Thought Machines carry a compact internal state and iterate on it.
Super-resolution wants the opposite: a dense spatial field, every pixel
accounted for. This analysis walks what happens when you make the first serve
the second.

## The mismatch

A CTM's thought representation is a small vector that ticks. A ×4
super-resolution head needs a field at the resolution of the output. Bolting
one to the other naively means either a thought so wide it stops being a
thought, or an output so coarse it stops being super-resolution.

![Figure 1 — CTM, a window-wise adaptation, and DQ-CTM compared.](figures/fig-compare.jpg)

## Method

The paper's answer is a persistent dense carrier that the compact thought
process reads from and writes back to. The encoder produces the carrier and a
window operator slices it into the units the thought actually ticks over:

$$\mathbf{F}=\mathcal{E}(\mathbf{I}_{\mathrm{LR}}),\qquad \mathbf{X}=\mathcal{W}(\mathbf{F})$$

Every window shares one DQ-CTM, so the parameter count does not grow with the
number of windows — which is the whole reason the design is affordable.

![Figure 2 — ThinkSR end to end: encoder, windows, shared DQ-CTM ticks, decoder.](figures/fig-arch.jpg)

## Results

On ×4 lightweight super-resolution, averaged over five benchmarks:

| Method | Params | Average |
| --- | --- | --- |
| CARN | 1.592M | 28.970 |
| IMDN | 0.715M | 28.968 |
| RFDN | 0.550M | 29.022 |
| CATANet | 0.535M | 29.482 |
| DQ-CTM-SR | 1.129M | 28.983 |

Competitive with the CNN baselines it set out to match, and behind the recent
lightweight transformers by about half a decibel at twice their parameters.

![Figure 4 — Reconstruction at T=0 through T=4 against bicubic and ground truth.](figures/fig-progress.jpg)

## What the ticks actually buy

The reconstruction improves monotonically across ticks, which is the claim the
architecture rests on. The error maps say where: edges and high-frequency
texture sharpen between T=0 and T=2, and flat regions are already finished at
T=0 and do not change.

![Figure 5 — Absolute-error maps on the same crops, one shared colour scale.](figures/fig-error.jpg)

## What to take away

Thinking is being spent where thinking helps. The result is a method that is
honest about its cost — more ticks, more time — and buys detail rather than
average PSNR. Whether that trade is worth it depends on whether you are
optimising a benchmark column or an image someone will look at.

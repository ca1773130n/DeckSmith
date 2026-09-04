# Re-measuring what CSS 3D costs, because its baseline turned out to be wrong

**Date** 2026-09-04, after the hyperframes bump. Run before starting Gap 2's depth
archetype, because the roadmap attaches a decision to it — "**one decision ships
with it, not after: CSS 3D forfeits the byte-identical render unless `--workers 1`
is pinned**" — and that decision rests on a control this session has already had
to correct once.

## Why re-measure

`.planning/2026-09-04-css-3d-spike.md` reports the plain demo deck at **3120 of
3120 byte-identical** and the 3D case at 167 differing, worst 83.90 dB at frame
1905. The same 3120-of-3120 figure was quoted into an invariant-11 note earlier
today and was wrong there — the control, when finally run, was 3109. Any
conclusion resting on "the plain deck is byte-identical" needed checking.

## Measured

All four rows are the same storyboard, silent, 3120 frames, `drift` default gate
(40 dB PSNR floor), each built and run in this session rather than remembered.

| deck | pin | differing | worst | verdict |
| --- | --- | --- | --- | --- |
| plain | 0.7.90 | 11 | 43.53 dB @ 1161 | PASS |
| plain | 0.8.27 | 166 | 83.90 dB @ 1905 | PASS |
| plain + DrawSVG | 0.8.27 | 167 | 83.90 dB @ 1905 | PASS |
| **deck-wide CSS 3D** | 0.8.27 | **26** | **61.69 dB @ 846** | **PASS** |

The plain deck reproduced exactly across two separate runs at 0.8.27 (166 both
times), so these are not noise-of-the-day numbers.

## What it means

1. **The plain deck is not byte-identical on either pin.** So a 3D transform
   cannot be what costs byte-identity — there was none to lose.
2. **Deck-wide 3D differs in FEWER frames than the plain deck** — 26 against 166 —
   while its worst frame is worse, 61.69 dB against 83.90. Both pass, and 3D keeps
   **21.7 dB of headroom** over the floor that fails a build. Plausibly the
   transform changes how the figure images are rasterised, and those images are
   where the plain deck's 166 differing frames come from; not investigated.
3. **Nothing here shows a depth archetype needs `--workers 1`.** The decision the
   roadmap said must ship with the work does not follow from what is measurable
   today. It should not be inherited into the design unmeasured.

## What this is NOT

**Not a replication of the spike.** The spike transformed one element —
`#s11-f img { transform: rotateY(16deg) rotateX(6deg) }`. This transforms
everything: `perspective: 1400px` on every scene and `rotateY(16deg) rotateX(6deg)`
on every scene's content. That is a strictly heavier use of 3D, which makes the
result stronger for the "3D is affordable" conclusion and useless as a check of
the spike's specific 167-frame number.

**Not a statement about `--workers 1` at 4 workers.** The spike's subpixel figure
(189,237 of 6,220,800 differing at 4 workers) was measured differently again.
`drift` varies the worker count on purpose as part of its own method; what is
reported here is what that gate says.

**Not a layout claim.** The spike's real finding — that perspective compresses
vertical distance non-uniformly, so a rotated archetype must be laid out AFTER the
projection or its labels overprint — is untouched by any of this and remains the
actual work in Gap 2. `svg_text_overprint` caught it then and would catch it again.

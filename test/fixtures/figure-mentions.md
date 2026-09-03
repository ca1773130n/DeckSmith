<!--
Five figures in the five positions a real document puts them in, so the ingest
side of `sectionId` and `mention` is read end to end rather than a sentence at a
time:

  banner.png   before the first heading, named by the sentence after it
  arch.png     inside a section, named by the paragraph that FOLLOWS it
  sweep.png    inside a section, named by the paragraph before it — but NOT the
               paragraph immediately before it, so matching the caption's own
               number is the only way to find the right one. A positional
               fallback lands on the seeds sentence and the test says so.
  error.png    caption with no number in it, so only position is left to go on
  raw.png      opens its section, and nothing anywhere refers to it

Every sentence here is load-bearing. Renumbering a caption, or moving a paragraph
across a heading, changes what `parseMarkdown` records for the figure beside it.
-->

![banner](banner.png)

*Figure 1 — Encoder, thought loop and decoder, end to end.*

Figure 1 is the map for everything the rest of this document says.

# Dense queries for continuous thought

## Method

The loop runs after the encoder rather than around it.

![arch](arch.png)

*Figure 2 — One tick, drawn by the authors.*

Figure 2 shows the compact state above and the dense carrier below.

## Results

Figure 3 is the sweep, and it is why training stopped at four ticks.

Every run below used the same three seeds and the same held-out split.

![sweep](sweep.png)

*Fig. 3 — PSNR-Y against tick count.*

The error concentrates on edges, which the maps below make obvious.

![error](error.png)

*Absolute-error maps on three crops.*

## Appendix

![raw](raw.png)

*Figure 9 — Raw sensor frames, kept for completeness.*

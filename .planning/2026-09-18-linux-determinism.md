# Cross-machine determinism, measured on Linux

Two questions had only ever been measured on one Mac: whether the demo deck's drift
holds on a machine without Inter installed, and whether Latin caption typography is
deterministic anywhere else. Both were measured on a GitHub `ubuntu-latest` runner and
again on the Mac, at the same commit, with the same scripts.

- **Drift within a machine holds on Linux**, with more margin than on the Mac: 7921/7975
  frames byte-identical, worst 106.18 dB (Mac: 7757/7975, worst 83.03 dB). A host with no
  Inter installed does not matter, because the render never uses a system Inter.
- **Frames do not match across machines.** 7 of 7975 frames are byte-identical (the
  first seven, before anything is drawn), and one-a-second samples sit at 23.09–29.45 dB.
  The difference is confined to text. Shapes and figures are identical, horizontal
  layout is identical to the pixel, and some text blocks sit 1px higher on Linux.
- **Captions: the layout is portable, the pixels are not.** Arial on the Mac, Liberation
  Sans on Linux. Band box, line breaks and every cue's width are identical to 0.000px.
  0/62 PNGs match across machines, and 62/62 match run to run on each.
- **Found: the build gates measure a font the render never draws.** The gate page gives
  the deck's `"Inter"` San Francisco on the Mac and DejaVu Sans on Linux. The demo's
  `build` therefore **FAILs on Linux** (`svg_text_overprint` in the line chart) over a
  render in which the labels are clear. It passes on the Mac, and that pass says nothing
  about Inter either.
- **Found: on a stock Ubuntu 24.04 runner, DeckSmith's own Chrome launches fail** ("No
  usable sandbox!"). The gates then degrade to a warning and pass.

Nothing in `src/` changed.

## 1. The two questions, and what produced their numbers

**(a) The demo deck's drift.** EXPERIMENT-007 recorded the demo failing `drift` in PSNR
mode (7350/7395 frames differing, worst 9.20 dB) and blamed Inter: the themes name
`"Inter", system-ui, sans-serif`, the deck ships no `@font-face`, and Inter was not
installed. Commit 0bb18f4 recorded on 2026-09-17, at hyperframes 0.8.35, that the failure
no longer reproduced (7758/7975 byte-identical, worst 83.87 dB), and it left a machine
without the font unmeasured. The deck is the narrated 16:9 demo, 265.81s long with 43
narration segments, built and measured like this:

```sh
node demo/build.mjs
decksmith build demo/storyboard.json --source demo/source.json -o <deck>   # picks up demo/audio/narration.json
decksmith drift <deck>    # psnr mode, 40 dB floor; render 1 at -w 1, render 2 at -w 3
```

`drift` runs `npx hyperframes render <deck> --format png-sequence --no-browser-gpu --quiet
-o <dir> -w <n>` twice and compares every PNG (`src/verify/drift.ts`).

**(b) Latin caption typography.** The EXPERIMENT-010 bullet dates from the import
(2026-07-30), when libass burned the captions. Chrome draws the band now
(`src/render/captions.ts`) with `font-family: "Arial", "Helvetica Neue", Helvetica, Arial,
sans-serif` and no `@font-face`. `render.ts` passes `familyFor(lang) ?? "Arial"`, and
`familyFor` returns null for English, so the face is whatever the host has.

**What Inter actually is at render time.** It is not a system font on either machine.
hyperframes' compiler rewrites the composition before capture (`[Compiler] Injected
deterministic @font-face rules for 1 requested font families`). Inter 400, 700 and 900
come from data embedded in hyperframes' own bundle (`CANONICAL_FONTS.inter`, from
`@fontsource/inter`). Every other face, including the 500 and 600 the deck uses, is
fetched from Google Fonts, subset to the deck's own characters, and cached under
`~/.cache/hyperframes/fonts/inter/` with the woff2 URL's hash as the file name. The render
log says `Fetched 11 font face(s) for "Inter" from Google Fonts`.

**A correction to 0bb18f4.** It says Inter "IS now installed on this machine". On
2026-09-18 it is not. `fc-list : family` lists no Inter, `fc-match Inter` falls back to
NanumGothic, and Chrome, asked over CDP which platform font drew an `"Inter"` run on a page
the compiler never touched, answers `.SF NS`. Whether Inter was installed on 2026-09-17
cannot be checked now. The render never uses a system Inter, so it does not matter there.
It matters a great deal to the gates (§4).

## 2. Method

Both machines ran commit `3e5f90a` (main). The Linux runs checked out the temporary branch
`measure/linux-determinism`: `3e5f90a` plus one workflow file, with the measurement
scripts inlined byte for byte from the files the Mac ran. That branch has been deleted.

| | Mac | Linux |
| --- | --- | --- |
| host | Mac mini, Apple M4, 10 cores, 16 GB, macOS 26.3 | `ubuntu-latest`: Ubuntu 24.04.5, x86_64, 4 cores, 16 GB |
| node | 24.14.0 | 22.23.2 |
| hyperframes | 0.8.43 | 0.8.43 |
| renderer Chrome | chrome-headless-shell 152.0.7977.30 from `~/.cache/hyperframes/chrome` | the same build, fetched by `npx hyperframes browser ensure` |
| capture (plain fixture, logged) | `screenshot` launch, `captureScreenshot`, SwiftShader, `forceScreenshot: true` | identical |
| `compositionHash` (plain fixture) | `8ce630c1faa78d52` | `8ce630c1faa78d52` |
| Inter woff2 in the font cache after rendering | — | 44 files; **all 44 byte-identical** to the Mac's files of the same name |
| ffmpeg, used for PSNR only | 8.1 | 6.1.1 (apt) |
| `fc-match` Arial / Inter / system-ui | Arial / NanumGothic / NanumGothic (Chrome on macOS does not use fontconfig) | Liberation Sans / DejaVu Sans / DejaVu Sans |

`hyperframes browser ensure` fetches the build the render asks for anyway
(`ensureBrowser({ preferManagedChrome: true })`). Do not use `hyperframes browser path` to
find out which Chrome renders: it does not prefer the managed build, and on the Mac it
prints a puppeteer 145 shell while the render uses 152.

**The inputs were identical, and that was checked.** `demo/audio/` is git-ignored, so the
Linux job got the Mac's `narration.json` and empty placeholder mp3s. `build` only copies
the audio, and the composition references none. On the Mac, a deck built with the
placeholders differs from one built with the real mp3s only under `audio/`. Every built
file was then hashed on both machines:

| deck | files | identical across machines |
| --- | --- | --- |
| silent demo (`--no-narration`), 134s | 34 | **34** |
| narrated demo, 265.81s | 34 | **34** |

Every difference below therefore comes from the render or the host, not from the build.

The measurements:

1. **Plain fixture** (`demo/fixtures/plain.storyboard.json`, the image-free deck
   `--identical` exists for): one render without `--quiet` to log the capture mode, then
   `drift(deck, { mode: "identical" })` with every frame kept.
2. **Narrated demo:** `drift(deck, { mode: "psnr" })`, the same library call the CLI makes,
   with `workDir` and `keep` set. That allowed hashing every frame of both renders, writing
   out the per-frame PSNR of render 1 against render 2, and keeping every 30th frame (one a
   second) plus the worst. On the Mac, through the machine's heavy-job gate.
3. **Captions:** `renderCaptions` over the narrated deck's own cues (`framePlan(timing,
   30).cues`, which is 62 after `splitCue`), with `burnStyle` at 1920x1080 and 1080x1920,
   each format drawn twice in separate browser launches. Then the page was reopened and
   CDP was asked which platform font drew each cue, and for each cue's laid-out width and
   line count.
4. **The gates' view of Inter,** added once §4's failure appeared: `openDeck`, the page
   `fidelity` and `overprint` use, seeked into the line chart and asked the same CDP
   question, plus `getComputedTextLength()` for every SVG label.

## 3. Results

### 3.1 Drift within each machine

| deck | Mac | Linux |
| --- | --- | --- |
| plain fixture, `identical` | **210/210** byte-identical, PASS, 18s | **210/210** byte-identical, PASS, 25s |
| narrated demo, `psnr` | **7757/7975** byte-identical, worst **83.03 dB** at frame 1049, PASS, all 15 scenes moved, 814s | **7921/7975** byte-identical, worst **106.18 dB** at frame 5319, PASS, all 15 scenes moved, 1154s |

On the Mac the 218 differing frames are frame 1049 (s3, `pipeline`) and the contiguous
run 5156–5372 (the end of s10, `bar-compare`). Across all 218, PSNR lies between 83.03 and
83.90 dB. That is the 2026-09-17 result at 0.8.35 again, one frame and 0.84 dB apart.

On Linux the 54 differing frames are the contiguous run 5319–5372, inside the Mac's run,
and every one of them is at 106.18 dB. So the one region that is not bit-stable is the
same on both machines, and it is smaller on Linux.

### 3.2 Frames across machines

| | plain fixture | narrated demo |
| --- | --- | --- |
| byte-identical, render 1 (Mac) vs render 1 (Linux), every frame | 7/210 | 7/7975 |
| the same for render 2 | 7/210 | 7/7975 |
| which ones | frames 1–7 | frames 1–7 |
| PSNR, Mac vs Linux, one frame a second | median 29.45 dB, worst 28.46 dB; 203 of 210 below 40 dB | median 26.74 dB, worst 23.09 dB (s15); 265 of 266 below 40 dB |

Before anything is drawn, the frames are identical. After that, no frame is. What
differs was measured on seven frames: plain frames 30, 100 and 184, and narrated frames
151, 2701, 6151 and 7681.

- **0.5–2.2% of pixels differ**, and those that do differ by a lot (max channel delta 255).
- **Only text differs.** The amplified difference images are black everywhere except
  glyphs: plates, strokes, the chart line and the JPEG figure in s15 are identical.
- **Horizontal layout is identical.** Across 15 text regions on those frames, the ink's
  left and right edges agree to the pixel, with one exception one pixel wide (the s12
  headline's right edge, 1516 against 1515). Line breaks agree too. The s12 side note
  wraps to three lines on both machines.
- **Some blocks are 1px higher on Linux.** The eyebrow and headline everywhere, and the
  body of s15. The best alignment is `dy = -1` and it removes most of the difference
  (mean alpha error 7.39 → 0.85 on the plain headline). Other blocks, including the chart
  labels, the footnotes and the s12 note, are at offset 0 and differ only in
  anti-aliasing.

Chrome build, composition, capture mode and font bytes are all equal, so what is left is
how each platform rasterizes a glyph. **This is a hypothesis, not a measurement:** Skia on
macOS rasterizes through CoreText and on Linux through FreeType, and a 1px baseline
difference is the kind of rounding the two disagree on. OS and CPU architecture changed
together, so SwiftShader on ARM against x86 is not excluded by this run. It is only made
unlikely by identical shapes and images.

The frames at 205.0s (s12, after both holds) were opened on both machines. Both show
Inter, clear labels and the same three-line note.

### 3.3 Captions

| | Mac | Linux |
| --- | --- | --- |
| platform font for every glyph, both formats | `Arial` / `Arial-BoldMT` | `Liberation Sans` / `LiberationSans-Bold` |
| run 1 vs run 2 on the same machine | **62/62** PNGs byte-identical, both formats | **62/62**, both formats |
| band box, 16:9 | x=189 y=769, 1542x214 | x=189 y=769, 1542x214 |
| band box, 9:16 | x=105 y=1627, 870x120 | x=105 y=1627, 870x120 |
| lines per cue | 9 one-line, 53 two-line | identical, cue for cue |
| laid-out width per cue | — | **0.000 px** off the Mac on all 62, both formats |
| PNGs identical across machines | — | **0/62**, both formats |
| PSNR per band, Mac vs Linux | — | 18.15–24.15 dB at 16:9 (median 20.25), 18.21–24.20 dB at 9:16 (median 19.91) |

Liberation Sans was designed to be metric-compatible with Arial, and the measurement
agrees to a thousandth of a pixel: same breaks, same box, same position. The outlines
belong to different fonts, so no run of glyph pixels matches. The PSNR is taken over a
band-sized RGBA crop that is mostly glyph edge, so it is not on the same scale as drift's
whole-frame 40 dB floor. The worst pair (cue 55) was stacked and opened. The two captions
read the same, and the letterforms visibly differ (`t`, the apostrophe).

## 4. Found: the gates measure a font the render never draws

`build` runs `fidelity` and `overprint` on a page that `openDeck`
(`src/render/capture.ts`) opens by loading `index.html` directly. hyperframes' compiler is
not in that path, so nothing gives `"Inter"` a face, and each host fills it from its own
fallback. Measured on the line chart (s12) of both built decks:

| | render (hyperframes, both machines) | gate page, Mac | gate page, Linux |
| --- | --- | --- | --- |
| face drawn for the deck's `"Inter"` | Inter, injected | `.SF NS` for every run in s12 | `DejaVu Sans` / `DejaVu Sans Bold` for every run in s12 |
| width of the value label "29.88" | — | 110.08 px | 126.53 px |
| width of the delta label "+0.30" | — | 111.00 px | 132.22 px |

The verdicts follow the host, not the deck:

| `build` at 3e5f90a | Mac | Linux, sandbox available | Linux, stock runner |
| --- | --- | --- | --- |
| narrated demo | PASS: 0 errors, 12 warnings | **FAIL: 1 error**, 12 warnings | PASS: 0 errors, 13 warnings |
| silent demo | PASS: 0 errors, 21 warnings | **FAIL: 1 error**, 21 warnings | not recorded |

The Linux error is `svg_text_overprint`: "#s12 draws chart labels on top of each other: 6
overlapping pair(s) … '29.88' over '+0.30' (10x19px), '30.18' over '+0.30' (10x23px),
'30.18' over '+0.20' (10x27px)". That is true of the DejaVu Sans page: the gate page's own
screenshot shows `30.18+0.20` and `+0.0930.47` touching. It is false of the render, where
the labels stand clear on both machines (§3.2). The Mac's PASS is no better founded,
because it is a verdict about San Francisco. On the Mac the same page wraps s12's side note
in two lines where the render, in Inter, uses three.

This is invariant 9 inside the gate stack rather than inside a deck. `src/emit/svg.ts`
lays the labels out from pinned Inter metrics, and they are then checked in whatever sans
the host happens to have. The same is presumably true of every other gate that runs on
`openDeck` and of the sweep's verdicts. That was not measured.

**The stock-runner column is a second finding.** GitHub's Ubuntu 24.04 image sets
`kernel.apparmor_restrict_unprivileged_userns=1`. DeckSmith's own `puppeteer.launch` calls
(`openDeck`, `renderCaptions`) pass no `--no-sandbox`, so Chrome dies at launch with
`FATAL:zygote_host_impl_linux.cc:129] No usable sandbox!` (run 35243628386). `build` then
reports `fidelity not_measured` as a warning and passes, which is why that column is green.
`render --subtitles burn` would get further before failing: `captionBlocker` checks that a
Chrome exists, not that it launches, and the capture runs first (hyperframes passes
`--no-sandbox`). Every Linux measurement after that run set the sysctl to 0 first.

Neither defect is fixed here. The first needs the gate page to get the faces the render
gets, which is a design change, not a one-line fix. The second is a sandbox decision for
whoever owns Linux support. Both are recorded as open in EXPERIMENT-010.

## 5. What this shows, and what it does not

**Shows**, for this commit, this pin, one Mac and one `ubuntu-latest` runner, one run
each:

- A host without Inter installed renders the demo reproducibly. The render's Inter comes
  from hyperframes' bundle plus a Google Fonts fetch, and that fetch returned
  byte-identical files to both hosts.
- The render is reproducible within a machine and not across machines. Text rasterizes
  differently while everything else, including layout to within a pixel, is identical.
  **Byte-identical output is a per-machine property, and a frame from one machine is not
  a reference for another.** `drift` only ever compares a machine against itself, so it
  is unaffected.
- Burned Latin captions keep their layout across these two machines and change their
  glyph pixels.
- Two gate verdicts depend on the host, and the Linux one is wrong about the render.

**Does not show:**

- **The original 9.20 dB failure.** It is still unexplained. Neither host reproduces it.
- **An offline host.** hyperframes fetches Inter 500/600 at render time, and a failed
  fetch returns no faces unless `failClosedFontFetch` is set (`cli.js`, `fetchGoogleFont`).
  An offline render would draw those weights from something else. Unmeasured.
- **A cold or stale font cache elsewhere.** Both caches held identical bytes today. A
  cache filled before Google changes Inter would not.
- **A Linux without `fonts-liberation`.** `Arial` would then fall to DejaVu Sans, which is
  not metric-compatible, and caption layout would move. This is a hypothesis from
  `fc-match`. The package is on this image because `google-chrome-stable` depends on it.
- **Which of OS and CPU architecture causes the text difference.** They changed together.
- **The mp4.** Only PNG sequences were compared. The retimed, muxed video was not.
- **Variance.** One run per machine. The within-machine counts moved by one frame between
  0.8.35 and 0.8.43 on the Mac, and that is all the variance evidence there is.

## 6. Is a permanent CI job warranted?

**Not for rendering.** A Linux drift job would have reported PASS with more margin than
the Mac. It costs about 19 minutes of rendering plus about a minute of setup per run. It
would have caught nothing here: everything this run found lives outside `drift`, and
cross-machine frame comparison cannot be a gate at 23–29 dB.

**A cheap one would have caught §4**: `decksmith build` of the demo on `ubuntu-latest` with
the userns sysctl lifted, about a minute after `npm ci`. It fails today because of the
defect, so it belongs in CI only once the gate page draws the render's fonts. Until then
it would be red for a known reason, and a gate that is red for a known reason gets
ignored. Adding it is the closing step of that fix, not of this measurement.

A practical note for whoever adds either job: this runner has no ffmpeg, and
`apt-get install ffmpeg` hung for 24 minutes on one of the two jobs in run 35245196110
before it was cancelled and re-run.

## 7. Reproducing

All on `ca1773130n/DeckSmith`:

- 35243628386: the sandbox failure, plus a `tail -2` mistake in the workflow.
- 35243990704: `set -e` stopped the step at the gate FAIL.
- 35245077858: cancelled to add the gate-font probe.
- **35245196110**: the measurement. Its `renders` job was re-run once after the apt hang.

Artifacts `linux-renders` and `linux-captions` are kept for 7 days. The workflow's jobs, in
order: `npm ci`, `npm run build`, install ffmpeg, `npx hyperframes browser ensure`, record
the environment, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, then
`node demo/build.mjs` and both `build`s (silent, and narrated from the Mac's
`narration.json` with placeholder mp3s), hashing every built file. After that, the
`renders` job built the plain fixture, rendered it once without `--quiet`, ran
`drift(..., identical)` on it and `drift(..., psnr)` on the narrated deck through
`measure-drift.mjs`, and listed the font cache with hashes. The `captions` job bundled
`captions-entry.ts` and `gatefonts-entry.ts` against the checkout's own `src/` with
esbuild and ran them. The Mac ran the same scripts from a scratch directory. Nothing was
committed to this repository except this document and the two bullets.

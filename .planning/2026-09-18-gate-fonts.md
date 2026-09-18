# The gates now measure the Inter the video draws

**Every Latin deck now ships Inter beside itself, and so every reader of `index.html`
draws the same face.** Before this, only the render did. The build gates' page, the
presented `deck.html` and any embed drew the host's fallback for the deck's `"Inter"`:
SF on a Mac, DejaVu Sans on Linux. That is why the demo's `build` FAILED on Linux over
chart labels that stand clear in the video (`.planning/2026-09-18-linux-determinism.md`
§4, and the open item in EXPERIMENT-010).

Measured 2026-09-18 on macOS, hyperframes 0.8.43, chrome-headless-shell from the
hyperframes cache, on the silent demo (`node demo/build.mjs`, then `build`).

## 1. Why only the render had Inter

Every theme's stack is `"Inter", system-ui, sans-serif`, and a Latin deck declared no
`@font-face`. HyperFrames' compiler fills that in. `injectDeterministicFontFaces` adds its
embedded `@fontsource/inter` 400/700/900 plus whatever Google Fonts serves for Inter,
fetched over the network at render time. Nothing else that opens `index.html` runs the
compiler:

- `openDeck` (`src/render/capture.ts`) loads `index.html` from disk. Every gate that
  measures a page goes through it, and so does `decksmith frames`.
- `deck.html` hosts `index.html` in `<hyperframes-player>`, which is a browser runtime
  and not the compiler.

## 2. The fix, and why this one

`build` copies `@fontsource-variable/inter`'s seven `wght-normal` subsets into
`assets/fonts/` and inlines their `@font-face` rules, renamed to `'Inter'`, through the
`fontCss` path CJK decks already use (`vendorInter` in `src/build/files.ts`). The
compiler skips any family a document already declares, so the render uses the same files.

Two other fixes were considered and rejected:

- **Run HyperFrames' injector inside `openDeck`.** It is reachable as the public bin
  `hyperframes-localize-fonts`, and it does draw Inter on the gate page. But the bin is
  fail-closed on the Google fetch, so the gates would need network. `deck.html` would
  keep drawing the fallback.
- **Extend `bundleFont`'s Google `&text=` subsetting to Latin.** Every Latin build and
  every test that builds one would then need network, and a deck's metrics would follow
  whatever Google serves that day.

The vendored package is the face `svg.ts`'s `ADVANCE` table was pinned against. The
comparison set "29.88", the s12 headline, its eyebrow and "Wolf Tavern" at 100 px, at
weights 400, 500, 600 and 700:

| | largest width difference |
| --- | --- |
| `@fontsource-variable/inter` 5.3.0 vs Google Fonts Inter v20, latin subset | 0.0000 px |

## 3. What each reader draws now

The gate page as `openDeck` opens it, identified with CDP `CSS.getPlatformFontsForNode`:

| | before | after |
| --- | --- | --- |
| face for s12's headline, eyebrow and chart labels | `.SF NS` | `Inter` |
| width of the "29.88" label | 110.08 px | 112.31 px |
| glyphs by face, every text node, 67 instants 2 s apart | — | Inter 217,451; KaTeX 5,561; `.SF NS` 201 |
| Inter faces in `deck.html`'s composition | 0 | 7 declared, the latin one loaded |

The 201 `.SF NS` glyphs are the "→" in three strings. Google's Inter subsets do not
cover U+2192, so no reader has Inter's arrow. The render draws it in the fallback too.

The render:

| | before | after |
| --- | --- | --- |
| compiler log | `Fetched 11 font face(s) for "Inter" from Google Fonts` | `Embedded local font file: assets/fonts/inter-*.woff2` ×7, no fetch |
| frames compared, before against after | 4020 | |
| byte-identical frames | 13 | |
| worst frame | 44.46 dB (frame 47) | |
| s12 at frame 3190 | 52.82 dB | |

The difference is confined to glyph edges. Read off the compiler's source rather than
measured: before, weights 400 and 700 in the latin range came from HyperFrames' embedded
static `@fontsource/inter`, whose rules it declares last, and 500/600 from Google's
variable face. After, all four come from the one variable face. Both frames were opened side by side,
and the s12 labels stand clear in both.

The Mac's build verdicts did not change: PASS, 0 errors, 21 warnings, before and after.
The only line that differs is the composition's line count, 869 → 870.

## 4. Linux

Measured on GitHub `ubuntu-latest` with the userns sysctl lifted, the same way as
`.planning/2026-09-18-linux-determinism.md`. `fc-match Inter` gives DejaVu Sans and no
Inter is installed. Two temporary branches, each carrying one workflow and the scan
script, were deleted after reading:

| | control: `main` at 3f13cf4 (run 35303092463) | fix: ffadd75 (run 35303189671) |
| --- | --- | --- |
| silent demo `build` | **FAIL**: 1 error, 21 warnings | PASS: 0 errors, 21 warnings |
| the error | `svg_text_overprint` in s12: "29.88" over "+0.30", 6 pairs | — |
| glyphs by face, 67 instants | DejaVu Sans 216,312; KaTeX 5,561 | Inter 217,518; KaTeX 5,561; DejaVu Sans 201 |

The fix's 21 warnings on Linux are line for line the Mac's 21. The 201 DejaVu glyphs are
the same three arrows as the Mac's 201 `.SF NS` ones. Inter's counts differ by 67 between
the machines, which this does not explain.

The control reproduces the failure at hyperframes 0.8.43, so it is not specific to the
0.8.35 pin the earlier measurement used.

The permanent check is the `demo` job in `.github/workflows/ci.yml`. It builds the demo
on Linux through every gate, and it fails if any gate reports `not_measured`, because a
gate that cannot launch Chrome otherwise warns and passes.

## 5. Still open

- **"→" has no Inter glyph anywhere.** Every reader falls back per glyph, so the arrow is
  host-dependent in the gates and in the video alike.
- **A CJK deck's stack still names `"Inter"` second**, behind its Noto bundle, and still
  declares no face for it. Noto covers the deck's own text, so Inter is reached only for
  glyphs the subset missed. Unchanged here.
- **Every Latin deck is about 218 KB larger on disk**, the seven subsets. A page fetches
  only the ranges its text touches, 47 KB for the demo.

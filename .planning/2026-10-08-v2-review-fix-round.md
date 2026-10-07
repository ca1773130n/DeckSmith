# v2 preview: the review fix round

2026-10-08. Branch `preview/design-v2`. Three reviewers (founder lens, engineer, skeptic)
read the first preview. This round addresses their blocker and every major finding, and
most of the minor ones. Nothing is released, and the HypePaper deck worker stays stopped.

## Findings and what was done

| finding | done |
|---|---|
| **Blocker:** the control bar covered foot headlines (12/12 cases at 390x844, 11/12 at 800x450) | `stageGeometry` docks the bar where it covers nothing. In spare letterbox it sits under the slide. When the composition's text-free bottom padding (`PAD_Y` less 16 reference px) holds a 40px target, about 720px of slide or more, it sits over that padding and hides while playing. Otherwise it gets a band of its own beside the captions, and the caption text is padded in past the buttons. A narrow window gets one settings menu. `deck-page.test.ts` checks controls against caption text and against every glyph the slide draws, at six viewports, on the demo with foot and rail headlines. |
| Enter only toggled auto-advance; the voice kept talking, and play restarted the sentence | Pause stops the audio. Play resumes from the same word (`Voice.pause/resume`). A paused deck steps silently. The deck opens paused. |
| Silent stops held up to 8s at any speed | The wait is clamped first and then divided by the rate. A v2 stop with no narration segment holds for its reveal plus `SILENT_HOLD` (1.5s at 1x). |
| Classic runtime changed; intermittent `net::ERR_ABORTED` | The classic voice no longer touches `playbackRate` or reports progress. The abort is `silence()` dropping an in-flight narration fetch. It ran 0 of 10 times in isolation on main and on the branch, and v0.8.0 aborts too whenever the file is slow. The classic suite now keeps that one failure apart, and a slow-fetch test pins it. |
| Packs read as "one template in four colours" | Each pack has component forms. Lists: tick, number, dot, card or rule. Title compositions and bar corners and tracks are set in the skin, which now allows paint-only SVG and outline properties. The Director adds the pack's affinity for placements and variants. Serif roles in CJK decks use Noto Serif KR/JP/SC. Measured in Chrome: Han and kana are 1.0em in both faces, Hangul 0.966 against 0.920, Latin about 7% wider. A serif run is charged accordingly. |
| Korean broke mid-word; a CJK claim was set in sentence-long blocks | Under v2 a Korean composition sets `keep-all` (matching how `wrap` already measures), Japanese and Chinese set strict kinsoku, and CJK eyebrows drop tracking. `words()` sets Han and kana per character with kinsoku attachment. The claim's line counter uses the same atoms, and the stagger is spread to land by the stop. |
| Figure plates as white slabs; 2x upscale; figures shrunk for headlines; a table in the rail | Plates hug their image. Upscale is capped at 1.25x (annotated-figure keeps its classic 1.5x). An arrangement may not shrink the picture below 90% of the classic arrangement. The Director refuses a look whose figure falls under 80% of the larger of v2's classic look and v0.8.0's drawing. A rail aside must be drawn at 70% of its own pixels or more. A grown claim no longer takes a strip figure's classic height. |
| Fill measured extent, which a plate or two thin bars satisfies | Final holds also report `cells` and `detail`, area measures over the whole frame (40px cells, 3% border). `detail` excludes flat fills. Two values become a `versus` (big figures and proportional bars), `columns` refuses two bars, and short callouts become a `rows` table. |
| `blank_at_stop` counted a pack's painted ground as ink | Ink is now measured against the bare-background capture. Browser tests hide one scene's body on signal and on blueprint and expect the finding. |
| Preferences not persisted per user on HypePaper | The deck side was already done (query, `localStorage`, `decksmith:prefs` up and down). The preview's `embed.html` plays the host on another origin and keeps the choices host-side, verified in Chrome across a reload and a deck switch. **HypePaper's own store is not built**, see below. |
| Minor | Final stops are undimmed under v2. One label style per grid, with the label column beside the field. Lists start under their heading. One eyebrow mark per pack, on the margin. Panel titles stay under 0.9 of the headline. IME keys fall back to `e.code`. L/XL caption floors. One `pickTheme` for CLI build and narrate, the library and the server. Duplicate flag and stray blank line removed. |

Not done: collapsing the caption strip between cues. The strip and the controls now share
one band, so collapsing it would resize the slide every time the speaker paused, which is
the reason the strip is reserved in the first place.

## Measured

Tier A numbers for the four preview decks and the 20-storyboard set are in the preview's
`index.html` (`~/.blackhole/DeckSmith/2026-10-07/preview/`). The extent-based hollow
rate falls a long way (30.6% to 4.8% on the samples, 41.5% to 7.0% on the 20-storyboard
set). The placement-independent area measures move little:

- Cells with detail: 0.369 to 0.364 on the samples, 0.348 to 0.383 on the set.
- Cells holding ink: 0.416 to 0.431 on the samples, 0.427 to 0.409 on the set.
- Holds with under 25% detail: 4 of 62 to 2 of 62 on the samples, 43 of 313 to 26 of 313 on the set.

What did change is the variety and the figures:

- Body layouts (archetype:variant): top-4 share from 73.8% to 39.9% on the set, distinct from 12 to 20.
- Figures: median area 1.14x v0.8.0's (1.34x on the samples), with 4 of 66 under 80%.
- Gates: 0 errors on all 24 v2 decks.

## Still open

- **HypePaper's side of the preferences.** This needs one store shared by the briefing
  player and the deck. Pass `?speed&cc&ccsize` when the deck iframe is built, and save on
  `decksmith:prefs` after checking the origin. The contract is in
  `2026-10-07-v2-player-host-prefs.md`. It is a HypePaper change and has to be verified
  in HypePaper before release.
- A handful of figure slides still draw at 71-79% of v0.8.0's area. The Director's
  estimate of v0.8.0's area is arithmetic, and the browser measures something slightly
  different.
- Content density by area is about level with v0.8.0. The gains are in layout variety and
  figure size, not in ink per frame.

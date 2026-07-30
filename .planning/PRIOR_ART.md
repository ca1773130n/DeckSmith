# Prior Art Survey

Survey date **2026-07-26**. Star counts, licenses, and last-push dates read from the
GitHub API, not from blog posts — several 2026 "comparison" articles that rank highly
in search are AI-generated and factually wrong (one claimed Motion Canvas was last
touched in Feb 2025; it was pushed 2026-07-02).

---

## The headline: someone already built the runtime

**`heygen-com/hyperframes`** — 37,625★ · Apache-2.0 · TypeScript · created **2026-03-10**
· pushed 2026-07-25 · 3.5k forks · 262 open issues · releases v0.7.67→v0.7.71 in four days.

*"Write HTML. Render video. Built for agents."*

It independently arrived at the architecture proposed in the first DeckSmith design
doc, and shipped it:

| DeckSmith v1 proposal | HyperFrames, already shipped |
|---|---|
| `Visual.seek(TimeState)`, pure, no internal clock | `FrameAdapter.seekFrame(frame)` — idempotent, random-access, *"the adapter never controls its own clock"* |
| Any media type behind one protocol | first-party adapters: GSAP · Anime.js · CSS keyframes · Lottie · **Three.js/WebGL** · WAAPI · **TypeGPU/WebGPU** |
| Ban `Math.random` / `Date.now` for reproducibility | published determinism contract + `packages/lint` |
| Deterministic headless capture instead of a 2nd renderer | Chrome `HeadlessExperimental.beginFrame` → FFmpeg; `--docker` pins Chrome + fonts |
| Model writes code against a prompt-sized typed surface | 19 agent skills + an HTML `data-*` schema; `npx skills add heygen-com/hyperframes` |
| Single self-contained artifact | composition *is* an HTML document; `@hyperframes/player` web component |

14 packages: `core · engine · producer · player · cli · sdk · studio · studio-server ·
lint · parsers · shader-transitions · aws-lambda · gcp-cloud-run`.

**And the deck layer exists too.** `skills/slideshow` (35 KB spec):
*"discrete slides, fragment reveals, branching, hotspot navigation, and built-in
presenter mode with speaker notes … Output is a navigable deck, not a rendered MP4."*
A JSON island marks which scenes are slides; the player's `SlideshowController` turns
the continuous GSAP timeline into a navigable deck. Pointer interactivity is supported
via an `interactive` attribute.

### Verified gaps in the slideshow skill

Grepped the skill spec directly — zero hits for `math`, `latex`, `katex`, `9:16`,
`vertical`, `1080x1920`, `pdf`. And linear MP4 export *from a deck* is explicitly
**deferred** ("until it ships, the supported path is…"; a naive render truncates).

So: no math typesetting, no vertical/multi-format, no PDF, no deck→video yet.

### Risks of depending on it

- Four and a half months old. Adapter API is marked **v0, experimental, breaking
  changes possible until v1**. Pin versions.
- Vendor-backed (HeyGen) — could pivot. Apache-2.0 + a fork of `packages/engine` is the
  insurance, and it is a real one.
- 262 open issues, multiple releases per day. Fast-moving is good for capability,
  bad for a stable base. Budget for churn.

`nexu-io/html-video` (4.2k★, Apache-2.0, "Open Design team") is a same-idea
competitor/derivative. Smaller, slower, no deck layer. Not worth splitting attention.

---

## Programmatic video engines

| Project | ★ | License | Last push | Verdict |
|---|---|---|---|---|
| remotion-dev/remotion | 54.3k | **NOASSERTION** (custom) | 2026-07-25 | Most mature, but see pricing below |
| slidevjs/slidev | 47.8k | MIT | 2026-07-22 | Best *presentation* framework; Vue/Vite, markdown-first |
| hakimel/reveal.js | 72.0k | MIT | 2026-05-21 | Venerable, DOM-centric, fights fullbleed WebGL |
| motion-canvas/motion-canvas | 18.8k | MIT | 2026-07-02 | Alive. Canvas2D scene graph, generator API. Awkward host for arbitrary web content |
| midrender/revideo | 3.9k | MIT | 2026-07-15 | Motion Canvas fork + render API/SSR. MIT is its main advantage over Remotion |
| FormidableLabs/spectacle | 10.1k | MIT | 2026-04-12 | React decks, no motion story |
| theatre-js/theatre | 12.6k | Apache-2.0 | **2024-08-14** | Effectively dormant |

**Remotion licensing (from remotion.dev/docs/license/pricing).** Free for individuals
and companies of ≤3 people. Beyond that: *Remotion for Automators* — "companies
launching applications and systems; such as video editors, prompt-to-video apps" —
$0.01/render with a **$100/mo minimum**; *Remotion for Creators* $25/mo per seat;
Enterprise from $500/mo. A DeckSmith built on Remotion inherits that bill **and passes
the license question to every open-source user**. Disqualifying for this project;
HyperFrames (Apache-2.0) and Revideo (MIT) do not have the problem.

---

## Paper → presentation research systems

| Project | ★ | License | Last push | Output |
|---|---|---|---|---|
| icip-cas/PPTAgent | 4.8k | MIT | 2026-07-20 | PPTX by editing a template; ships PPTEval |
| Paper2Poster/Paper2Poster | 3.9k | MIT | 2026-06-08 | Posters; claims 87% fewer tokens than GPT-4o baselines |
| showlab/Paper2Video | 2.3k | MIT | 2026-03-05 | **LaTeX project in** → Beamer slides + cursor + subtitles + TTS + talking head. Needs a GPU list; `hallo2` for the head |
| TIGER-AI-Lab/TheoremExplainAgent | 1.5k | MIT | **2025-07-27** | Manim videos; planner-agent + coder-agent; 93.8% success w/ o3-mini. Stale, but the *loop shape* is the reference |
| marcelo-earth/generative-manim | 0.9k | Apache-2.0 | 2026-07-25 | LLM → Manim, hosted |
| AIGeeksGroup/PresentAgent | 0.1k | **none** | 2026-05-15 | No license. Do not vendor |

Every one of them outputs **Beamer, PPTX, poster, or MP4**. None outputs an animated,
navigable, interactive web artifact. And all of them *place the paper's existing
figures* — none redraws the method as motion. That is the actual opening.

Reported weakness: PresentBench scores PPTAgent 50.2 vs NotebookLM 62.5 and Manus 57.8
(secondary source, unverified). Consistent with the general read that planning quality,
not rendering, is where these systems lose.

---

## Document ingestion

| Project | ★ | License | Last push | Note |
|---|---|---|---|---|
| microsoft/markitdown | 169.0k | MIT | 2026-07-23 | Broad, shallow |
| opendatalab/MinerU | 75.7k | **NOASSERTION** | 2026-07-25 | Strongest on CJK + complex layout; **verify license before commercial use** |
| docling-project/docling | 63.8k | MIT | 2026-07-24 | IBM; semantic hierarchy, formulas, code blocks; LangChain/LlamaIndex integrations |
| datalab-to/marker | 37.9k | Apache-2.0 | 2026-07-20 | Reported best accuracy/throughput in recent benchmarks |

Safe commercial defaults: **Docling (MIT)** or **Marker (Apache-2.0)**. ScholarAI is a
metadata/search/extraction *API* (200M+ papers), not a library — useful as an optional
source provider, not as the ingestion core.

---

## Short-form video generators

| Project | ★ | License | Last push |
|---|---|---|---|
| harry0703/MoneyPrinterTurbo | 99.3k | MIT | 2026-07-24 |
| RayVentura/ShortGPT | 7.7k | MIT | **2025-02-10** |

Both are *keyword → stock footage + TTS + captions*. Enormous audience, zero
explanatory power — they cannot draw an idea, only narrate over unrelated B-roll.
Different product; not competition, and not a base to build on.

---

## Conclusions

1. **Do not build a runtime, a player, or a video exporter.** HyperFrames has all
   three, Apache-2.0, and out-ships us by an order of magnitude.
2. **Do not build the step/presenter layer either.** `skills/slideshow` has it.
3. **Remotion is out** on licensing for a business that ships a video product.
4. The unoccupied space is **ingest → pedagogical planning → explanatory visual
   vocabulary → multi-format retarget**, which is where all existing systems are
   weakest and where none of them compete on rendering.

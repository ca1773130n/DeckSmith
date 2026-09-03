# Generated illustrations — design

**Status:** implemented on `feat/image-generation` (2026-09-02); the Verification
section records what was run. Opt-in. A built deck (`index.html`, `deck.html`) that never asks for a picture is
byte-identical to one built before this existed; a `.deck` pack's manifest gains a
defaulted `images` block, because packs carry every preference.

## What it is

A beat that has no figure to show can ask for one. The planner writes a brief; a
new `illustrate` step turns each brief into a picture file under `assets/`,
registers it as an ordinary `Figure` in `source.json`, and points the beat at it.
From there nothing downstream knows the picture was generated: `build`, `pack`,
`verify`, `render` and the server see a figure like any other.

This follows the decision already recorded in `.planning/VOCABULARY.md` (Gap 3):
generated media is a **plan-time input**, content-addressed by what produced it,
and never made during `build` or at render time. One departure, on purpose: the
hash lives in the figure's file name (`source.figures[].src`, the same
`<id>-<sha8><ext>` shape `assetName` in `src/source/assets.ts` already uses)
rather than in the storyboard, because `source.json` is what `build` reads and
the brief that produced it stays on the beat. It also stays inside the project's
stance on rasters (`ARCHITECTURE-CANVAS.md`): a picture is a *figure* inside a
slide the deck still lays out and animates, never a rendered slide.

## Where the pictures come from

Three rungs, tried in order. Every hop down is printed, never silent.

1. **A separate image backend**, if the deployment configured one. Selected by
   environment only, mirroring `DECKSMITH_TTS`:
   - `DECKSMITH_IMAGES=openai` — any OpenAI-compatible
     `POST {base}/images/generations` (`DECKSMITH_IMAGES_BASE_URL`, default
     `https://api.openai.com/v1`; LocalAI and gateways speak this too).
   - `DECKSMITH_IMAGES_API_KEY` — the key. Read from `process.env` only; never a
     preference, never in a config file, never in a `.deck`, never echoed, never
     part of an error message.
   - `DECKSMITH_IMAGES_MODEL` — optional model override (default `gpt-image-2`).
   Naming `DECKSMITH_IMAGES` without a key, or naming an unknown backend, is an
   error where the backend is *resolved* — at `illustrate` time on the CLI, in
   the preflight banner on the server, in `capabilities` for MCP. Nothing throws
   at import.
   NOT the default, and there will be no Gemini adapter: a metered API is the
   expensive branch, and a default must never be the expensive branch.
2. **The main account** — the Codex CLI that already plans the deck. Codex 0.149
   ships a stable `image_generation` feature (`codex features list` →
   `image_generation stable true` on this machine): the agent has an `image_gen`
   tool (`$imagegen`) and can save a PNG. `illustrate` runs `codex exec` in a
   scratch directory with `--sandbox workspace-write`, asks for one picture copied
   to `./picture.png`, and reads it back. An account without the tool answers
   `ok:false` with a reason, which is printed verbatim. **Verified live** (see
   Verification): non-interactive `codex exec` does expose the tool, a 1536×1024
   PNG came back in about a minute, and a copy of every picture also stays under
   `$CODEX_HOME/generated_images/` — `--ephemeral` does not cover it. The
   orientation is stated in words in every prompt, because the first live run
   returned 3:2 for a square slot when it was not.
3. **SVG, drawn by the tool itself.** A deterministic, text-free composition
   seeded from the brief. Cannot fail, so `illustrate` always finishes.

A rung that fails once is not tried again for later pictures in the same run
(printed once). That bounds spend: an account with no image tool pays one
`codex exec` to find out, not one per picture.

There is no "ask the model to write SVG" rung. A model-written SVG shown through
`<img>` can carry SMIL or CSS animation, which runs on wall-clock time under
capture — a nondeterministic render that every gate passes (measured in
chrome-headless-shell 145 during review). A blocklist sanitiser is the wrong
tool for that; the tool rung already covers "always finish".

`images.provider` says where the chain starts. **`codex` is the default**: the
account that planned the deck draws, and falls to the tool's SVG. `auto` puts a
configured backend in front of it, `svg` is the tool alone — no network, no
spend, fully deterministic.

## The contract

### Preferences (`prefsSchema.images`, sibling of `narration`)

| key | default | meaning |
| --- | --- | --- |
| `images.enabled` | `false` | Planner may request illustrations; server runs the stage. |
| `images.provider` | `"auto"` | `auto` \| `codex` \| `svg` — where the chain starts. |
| `images.model` | unset | Model for the separate backend only. The Codex rung uses the account's own model; `--model` there selects the agent, not the picture. |
| `images.style` | `"flat vector illustration"` | One phrase folded into every picture prompt. |
| `images.max` | `4` | Most **pictures** (a split-compare beat has two) drawn through the chain; extra briefs are drawn by the tool. |

The block is `.default({...})` with every field resolved, like `narration`.
`prefs.ts` is written for exactly one nested object: `PrefsPatch`, `merge` and
`checkKeys` each gain an `images` branch, `IMAGES_KEYS` is derived like
`NARRATION_KEYS`, and the "narration is the one nested object" comment is updated.

Flags: `--images` (boolean), `--image-provider`, `--image-model`,
`--image-style`, `--image-max` on `plan` and `illustrate`. `PrefFlags` gains
`images?: boolean` and the four strings; `flags()` in `cli.ts` special-cases
`--images` beside `--no-subtitles` (its whitelist is string-only) and whitelists
the four. `pack` (CLI and server) stamps `images.enabled` with
`hasIllustrations(storyboard, source)` from `src/plan/refs.ts`: "some beat
carries an illustration whose `figureId` resolves".

### Storyboard (`src/types.ts`)

```ts
export const illustrationSchema = z.object({
  /** The scene: objects, arrangement, mood. Never text, labels, numbers, charts. */
  prompt: z.string(),
  /** claim-figure prints it under the picture; a split-compare side keeps it as the figure's title. */
  caption: z.string(),
});
// claim-figure: figureId becomes optional; `illustration` is the alternative.
// At least one must be present (refine — survives z.toJSONSchema, verified).
// After `illustrate` both are: the brief stays as provenance.
// split-compare left/right: `illustration` optional beside `figureId`.
```

Both fields are `.optional()`, so every stored plan and every receipt in
`experiments/` still validates, and `forStructuredOutput` turns them into
`anyOf[…, null]` for Codex exactly as it does `inside.label`.

A slot with `illustration` and no `figureId` is **pending**.
`assertRefsResolve(sb, source, { pending?: "allow" | "refuse" })`, default
`refuse`, message: `beat "b03" params.figureId: asks for an illustration that has
not been generated — run \`decksmith illustrate\``. Call sites: `codexPlanner`
(codex.ts:165) and the `plan` verb (cli.ts:329) and the server's plan stage
(pipeline.ts:125) pass `allow` when `images.enabled`; `build`, `pack` and
everything else refuse. `codexPlanner` with images off and a pending brief refuses
with a message that says to pass `--images`.

The emitters get one guard each, because `emitDeck`/`emitScene` are public and
`assertRefsResolve` is not their only entry: a pending `claim-figure` throws
`claim-figure b03: illustration not generated — run \`decksmith illustrate\``
instead of `no figure "undefined"`; a `split-compare` side likewise.

### Planner prompt (`systemPrompt`, gated on `images.enabled`)

An `ILLUSTRATIONS` block appended to the rules: a `claim-figure`, or either side
of a `split-compare`, may carry `illustration: { prompt, caption }` instead of
`figureId` when no inventory figure fits — including when the inventory has no
figures at all; the prompt describes a scene and must not ask for text, labels,
numbers, charts or diagrams (nothing inside a picture can be read or checked —
the 40px floor sees DOM text only); the picture illustrates, it is not evidence,
so `evidence` still points at the section; at most `images.max` pictures.
`renderSource` is untouched (public signature, takes only `source`). Nothing
changes when images are off — the prompt tests that pin literal substrings stay
as they are.

### Providers (`src/images/providers.ts`)

```ts
export type ImageAspect = "landscape" | "square" | "portrait";
export interface ImageRequest { prompt: string; style: string; aspect: ImageAspect; model?: string }
// `model` rides on the request (from `images.model`) rather than the provider,
// because the backend is resolved from the environment before any preference
// is known; the Codex and tool rungs ignore it.
export interface ImageResult {
  bytes: Buffer; mime: "image/png" | "image/jpeg" | "image/svg+xml"; width: number; height: number;
}
export interface ImageProvider {
  readonly id: string;               // "openai" | "codex" | "svg"
  check(): Promise<void>;            // throws with an actionable sentence
  generate(req: ImageRequest): Promise<ImageResult>;
}
```

Every provider returns integer `width`/`height` it knows for itself:
rasters through the existing `imageSize` (PNG/JPEG/GIF sniff, unchanged — it is
also the server's only type check on a stranger's figure and stays that way),
the tool SVG from its own `viewBox`. A size failure is a rung failure.

- `openaiImages({ apiKey, baseUrl?, model?, fetch? })` — body
  `{ model, prompt, n: 1, size }` with size `1536x1024 | 1024x1024 | 1024x1536`
  by aspect; prompt is `"<prompt>. <style>, <orientation in words>, on a plain
  white background, no text."`. Reads `data[0].b64_json`; a `data[0].url` is
  followed only when its origin equals the configured base URL's origin (loopback
  included — LocalAI returns one), with no key on that request, `redirect:
  "error"`, a 16 MB cap and a 120 s `AbortSignal.timeout`. Any other origin
  throws. Errors are shaped by us — `openai images: HTTP 401
  (invalid_api_key)` — status plus `error.code|type`, never the body text or a URL,
  so the message is safe to print into a job log. `check()` requires the key.
- `codexImages({ run? })` — the main account, raster. Uses the existing `Runner`
  seam; `Runner` args gain optional `cwd` and `sandbox`. When `sandbox` is
  `workspace-write`, `runCodex` passes `-C <cwd> --sandbox workspace-write
  -c sandbox_workspace_write.exclude_tmpdir_env_var=true
  -c sandbox_workspace_write.exclude_slash_tmp=true` and spawns with
  `env: { ...process.env, TMPDIR: cwd }`, so the agent can write in its scratch
  directory and nowhere else — in agent sessions `TMPDIR` points at the repo.
  Unchanged behaviour when absent. Prompt: use `$imagegen` to make one picture of
  the scene in the style, on a white background, no text; copy the PNG to
  `./picture.png`; final message `{ ok, file, reason }` under a schema; if there is
  no image tool, `ok:false` and why. `ok:false`, a missing file, or a non-raster
  → throws with `reason`. Timeout 5 min. Scratch dir `decksmith-image-*` (in
  `.gitignore`'s mkdtemp list).
- `toolSvg()` — pure. `mulberry32` seeded from `sha256(prompt|style|aspect)`;
  6–10 overlapping circles, rounded rects and strokes; fixed paper `#ffffff` and
  ink `#1f2328` tints (both hosts put the figure on a white card regardless of
  theme), accent hue chosen by the seed from a small fixed set; no text, no
  animation, no external references; `viewBox` `0 0 1536 1024 | 1024 1024 |
  1024 1536` by aspect. Same request → same bytes.

`resolveImageBackend(env = process.env)` reads the env vars and returns a
provider or `undefined`; throws on a named-but-broken backend.
`imageChain(images, backend?)` returns the ordered list for a pref.

### `illustrate` (`src/images/illustrate.ts`)

```ts
export interface IllustrateOpts {
  prefs: Prefs;
  assetsDir: string;                 // `<dir of source.json>/assets`
  chain?: ImageProvider[];           // tests inject; default imageChain(prefs.images, resolveImageBackend())
  onStep?: (message: string) => void;
}
export interface Illustrated { beatId: string; figureId: string; provider: string; src: string; cached: boolean }
export async function illustrate(storyboard, source, opts): Promise<{ storyboard; source; illustrated: Illustrated[] }>
```

1. Walk beats in order; collect slots: `claim-figure` → id `gen-<beatId>`,
   aspect landscape; `split-compare` sides → `gen-<beatId>-left|right`, aspect
   square. A slot whose `figureId` already names a source figure is done.
2. The first `images.max` slots use the chain; the rest use the tool and say so.
3. For each provider still in the chain: key =
   `sha256(["v1", provider.id, model ?? "", aspect, style, prompt].join("\n"))`,
   name = `<figureId>-<key.slice(0,8)>`; if `<name>.png|.jpg|.svg` exists in
   `assetsDir` → cached, stop. Else `check()`, `generate()`; write to
   `<assetsDir>/.<name>.tmp` and `rename` (same directory, so no cross-device
   rename; `rm` the temp in `finally`). Any throw prints
   `illustrate: b03 via openai failed (<message>); trying codex`, drops that
   provider for the rest of the run, and continues. The tool rung is always last
   and cannot throw.
4. Append `{ id, src: name, caption, width, height }` to `source.figures`; set the
   slot's `figureId`; keep `illustration`. Return new objects parsed through
   `storyboardSchema` / `sourceSchema`.

Idempotent: a second run finds every slot done and calls no provider.

### CLI

- `decksmith illustrate storyboard.json --source source.json` — writes pictures to
  `<dir of source.json>/assets/`, rewrites `source.json` (figures appended) and
  `storyboard.json` (figureIds set) in place, prints one line per picture and a
  summary. Image flags apply; running the verb implies `images.enabled`.
- `plan --images` prints how many pictures the plan asks for and the `illustrate`
  command to run. `build` and `pack` refuse a pending brief.

### Server / MCP

- No new server option and no `ServeOptions` plumbing: like `narrate`, the stage
  resolves its providers from the environment at call time. `PipelineInput`
  gains two test seams, `imageChain?: ImageProvider[]` and the planner's
  `run?: Runner`, so `test/server.test.ts` can carry a job past `plan` into
  `illustrate` without spawning Codex.
- `JobOptions.images: boolean`; `parseOptions` reads field `images` into
  `prefs.images.enabled`; `catalog()` publishes `defaults.images: false` and
  `images.backend: "openai" | null` (id only).
- `Stage` gains `"illustrate"`; `stagesFor` inserts it after `plan` when asked;
  `runPipeline` calls `illustrate` on `<job>/src/assets`, **reassigns `source`
  and `storyboard` from its return** (build and pack use the in-memory objects),
  and writes both files. UI: a third switch (name `images`, label
  "Illustrations", sub-line about cost), step row, typical seconds,
  `plannedSteps`, `fd.set`.
- Preflight prints `decksmith: images via openai` / `decksmith: images via codex,
  then svg`, or lists the resolve error under MISSING — reported, never thrown. MCP: `images` boolean in `settingsSchema` (no
  default), `fieldsFor`, samples; `decksmith_capabilities` reports
  `images: { backend, ok, why }`; `create({ images: true })` is refused only when
  a backend is named and broken. No new required prerequisite — the tool rung
  means a request never fails for lack of one.
- `errors.ts` hints: `HTTP 401|403` → check `DECKSMITH_IMAGES_API_KEY`; `429` →
  quota; `could not generate a picture` → the account has no image tool, the tool
  drew an SVG instead.

### Docs

README: Prerequisites ("two commands reach outside" → three), the pipeline block
and bullets (`decksmith illustrate … # optional`), "What `build` writes"
(`assets/` line), a `## Illustrations` section beside `## Narration`, the
Preferences table and JSON example, the server Configuration env table, the MCP
settings/capabilities text, the library surface table (`illustrate`,
`imageChain`, `resolveImageBackend`, `ImageProvider`, `ImageRequest`,
`ImageResult`, `IllustrateOpts`), Repo layout (`src/images/`). `justfile`
settings comment for the three env vars. `.gitignore` mkdtemp prefixes.

Server code imports the new names through `../index.js` only
(test/server.test.ts pins that), so the export block lands with the module.

### Not in scope

Hero images on `title`/`callout` (no figure slot today); `annotated-figure`
(notes point *into* an image that does not exist yet); any Gemini adapter, ruled
out on 2026-09-03; SVG figures from *sources* (`imageSize` stays
raster-only on purpose — it is the upload type check); generated video (rejected
in VOCABULARY.md); a raster type floor (still the open item in DECISION.md);
reading `.env` from Node (only `just` does, as before).

## Verification (2026-09-02)

- `npm run check` green: 36 files, 1200 tests (71 new). `npm run sweep` re-pinned
  the receipt (48 ok, 5 refused over 53 cells, 11/11 known defects still fixed).
- A four-beat storyboard (title, split-compare with a brief on one side, two
  claim-figures with briefs) over the demo source: `build` before `illustrate`
  refused all three slots by name; `illustrate --image-provider svg` drew three
  SVGs; a second run drew nothing; `build` passed; the frames were looked at
  through `verify --snapshots` — the SVGs sit on the white card in both hosts,
  no text, layout unchanged.
- Live through the main account, `illustrate --image-max 1` with no backend
  configured: the split-compare side came back as a 1536×1024 PNG via `codex`
  in 62 s and matched its brief when looked at; the two slots past `max` were
  tool-drawn and said so; the scratch directory was gone afterwards; a copy of
  the PNG remained under `~/.codex/generated_images/`. The first probe, before
  the orientation words were added, returned 3:2 for a square slot.
- The backend adapter: request/response shape pinned to the documented one with an
  injected `fetch`; no key is present on this machine, so it was not exercised
  live.

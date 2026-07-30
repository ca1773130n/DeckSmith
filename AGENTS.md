## Project
A oneshot slide deck generation framework.
See .planning/INITIAL_DESIGN.md if you want to know about detailed product design sketch.

## The invariants

Break one of these and the deck still passes every gate. That is the point of
the list: each entry is a failure the gate stack cannot see. Most were found by
a human looking at the artifact, which is also how the next one will be found.

 1. **SEEK, NOT PLAY.** Capture sets an absolute time and grabs a frame.
 2. Every tween is `fromTo()`. Never `from()`.
 3. Timeline selectors are scoped per scene (`` `#${ctx.sid} .thing` ``) or lint fails.
 4. No `Date.now`, no `Math.random`, no network AT RENDER TIME in `index.html`.
 5. Audience text never below 40px at 1920x1080.
 6. Ambient life is one `.ds-live`-gated rule per scene inside a reduced-motion query.
 7. `deck.html` must never contain the literal string `data-composition-id`.
 8. A hold outside its own slide's window fails `emitIsland`.
 9. A font stack naming a family the bundle does not declare falls back silently.
10. Times are rounded to 3 decimals so float drift never moves a byte.
11. **`seek()` passes `suppressEvents`, so a GSAP `onUpdate` NEVER FIRES under
    capture.** Nor does `onStart`, `onComplete`, or any other callback. Motion
    driven by a callback plays perfectly in a browser and renders a **frozen
    video**, silently, with every gate green — `lint`, `check`, the type floor,
    and even `drift`, which passes twice over because both renders are
    identically frozen. State must be applied *by the thing being seeked* — tween
    the property — never by a callback hanging off it. If a value is not directly
    tweenable, tween a proxy object and bind the property; do not write it from
    `onUpdate`. This is the most dangerous failure shape in the project.

A related trap, found while reconciling the render and camera workstreams: the
video retimer freezes each scene at its holds and then plays whatever is left of
the scene. That tail must be taken from the **end** of the scene, not from the
source cursor's position — otherwise anything living after the last hold (a
camera dive does, by construction) is replaced by a replay of earlier frames, at
exactly the right length, with every gate green. See `framePlan` in
`src/render/timing.ts`.

**A gate passing is not evidence.** There are six documented cases in this
project of green gates over wrong output, and every one was caught by a human
looking at the artifact. If your work has a visible or audible result, look at
it — or listen to it — before you report.

## Required Tooling

These are standing requirements, not suggestions. Each one exists because the
default approach has repeatedly proved slower, noisier, or less accurate on this
codebase.

### Searching the codebase — codegraph MCP

Use codegraph for every question about where code lives or how it fits together.
It is a pre-built SQLite index of every symbol, edge, and file in the workspace,
so a question that would take dozens of grep-and-read cycles is usually answered
in two or three calls. Consult it **before** writing or editing code, not while
debugging the consequences.

- `codegraph_context` — the primary entry point; composes search, symbol lookup,
  callers, and callees in a single call. Start here for "how does X work".
- `codegraph_search` — locate a symbol by name.
- `codegraph_callers` / `codegraph_callees` — trace a call graph in one direction.
- `codegraph_impact` — determine the blast radius before a refactor. Prefer this
  over walking callers by hand.
- `codegraph_node` / `codegraph_explore` — read one symbol's source, or survey
  several related ones in a single capped call.
- `codegraph_files` — list what a directory contains.

Answer such questions directly from codegraph rather than delegating them to a
file-reading subagent, which merely repeats work the index has already done.
Fall back to Grep or Read only to confirm a specific detail codegraph did not
surface.

### Writing code — ponytail and context-mode

Apply **ponytail** to every coding task. It enforces the smallest solution that
actually works: question whether the work needs to exist at all, prefer the
standard library to custom code and native platform features to new
dependencies, and choose one line over fifty. This project has accumulated
enough surface area that new complexity must justify itself.

Apply **context-mode** throughout, so that large command output, file contents,
and search results are processed in the sandbox and only the resulting summary
enters the context window. The specific tools are listed below.

### Writing natural language — patina

Run **patina** over user-facing prose before it ships: UI copy, marketing text,
notification and email bodies, changelog and release notes, and any Korean
content. It detects and rewrites the patterns that make text read as
machine-generated, across Korean, English, Chinese, and Japanese, and verifies
that meaning is preserved rather than merely paraphrased. See
`feedback_copy_patina_conventions` for this project's established copy
conventions.

### File Operations — Context Mode MCP

Prefer these over Read/Bash/Grep to keep context window small:

- `ctx_batch_execute` — run multiple commands + search results in ONE call (primary tool)
- `ctx_execute` — run code in sandbox; only stdout enters context (use over Bash for large output)
- `ctx_execute_file` — read and process a file without loading contents into context
- `ctx_search` — search previously indexed content (batch all queries in one call)
- `ctx_index` — index docs/markdown into searchable knowledge base
- `ctx_fetch_and_index` — fetch URL, convert to markdown, index for search (use over WebFetch)
- `ctx_stats` — show context consumption stats
- `ctx_doctor` — diagnose context-mode installation
- `ctx_upgrade` — update context-mode to latest version

Fall back to Read/Grep/Glob only for quick targeted lookups or when editing files.

 

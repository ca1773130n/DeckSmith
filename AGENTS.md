**Read `~/.agents/AGENTS.md` and `~/.agents/OPERATIONS.md` first.** They are the
source of truth for how work is done here — process, memory, git, scratch files,
document naming — and they outrank this file. What follows is only what is
specific to this project.

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

**`decksmith frames` writes the PNGs, and no still frame settles invariant 11.**
Measured 2026-09-04 on a deck carrying a band painted ONLY from a GSAP
`onUpdate`, the three views of one instant disagree three ways: `frames` leaves
the band at the background's RGB (11,13,17), because it passes `suppressEvents`;
`hyperframes snapshot` paints it mid-tween at (143,4,5), because it does not; and
`hyperframes render` — the thing that actually ships — animates it smoothly to
(205,0,0) across the tween's own three seconds, 68 frames of genuine ramp.

That last number is the surprise, and it is NOT what invariant 11 predicts. The
capture is driven by Chrome's `beginFrame`, not by a suppressed seek, and under
`beginFrame` a callback ticks. Either invariant 11 is narrower than it reads, or
this injection is unlike the failure it was written from. **Until somebody
settles that, do not treat a still — from any of the three — as proof that
callback-driven motion will or will not render.** Watch the mp4. The rule against
callback-driven state stands either way: it is the shape nothing here can check
cheaply, which is reason enough not to write it.

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |

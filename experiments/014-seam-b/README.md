# 014 — Seam B, prototyped

A scene that measures its own layout in the browser and builds part of its
timeline from what it measured. Nothing here is wired into `src/`; it is a
standalone deck the real tools (`hyperframes render`, `check`, `snapshot`) can be
pointed at.

## Reproduce

```sh
node experiments/014-seam-b/emit.mjs           # writes out/<variant>/ (5 decks)
node experiments/014-seam-b/probe.mjs          # seek-order determinism + cost -> probe.json
node experiments/014-seam-b/cam-order.mjs DIR  # same question, asked of the SHIPPED camera
node experiments/014-seam-b/cost.mjs DIR       # cost of measuring every element of a built deck
```

`out/` is generated and deleted after use; `emit.mjs` rebuilds it in under a
second. `cam-order.mjs` wants a deck built from `demo/fixtures/camera.storyboard.json`.

The determinism result needs two real renders at different worker counts —
`hyperframes render` shards frames contiguously across processes, so worker *k*'s
first seek is mid-deck:

```sh
npx hyperframes render out/lazy -o /tmp/lazy-w1.mp4 --workers 1
npx hyperframes render out/lazy -o /tmp/lazy-w3.mp4 --workers 3
```

## The five variants

They emit identical DOM, CSS and intent. Only the moment of measurement differs.

| variant | measures | seek-stable | note |
|---|---|---|---|
| `emit` | never — guesses from a character count | yes | the status quo; wrong by construction |
| `parse` | in the scene IIFE, i.e. where `Scene.setup` runs today | yes | before `document.fonts.ready`; wrong geometry |
| `lazy` | on the tween's first render, memoised — what `cameraPreamble` does | **no** | 286/360 frames move when `--workers` changes |
| `defer` | after fonts+images, before the timeline exists | yes | Seam B |
| `defer-slow` | as `defer`, plus `DS_SLOW_MS` of artificial work | yes | capture waits; 12s/scene still renders correctly |

## Evidence in this directory

- `lazy-w1-vs-w3-t3.png` — same deck, same frame, `--workers 1` above
  `--workers 3` below. The arrow routes differently.
- `defer-vs-parse-tail.png` — `defer` above, `parse` below. Measuring before the
  webfont loads starts the arrow 8.6px inside the box it leaves.
- `probe.json` — the full seek-order table.

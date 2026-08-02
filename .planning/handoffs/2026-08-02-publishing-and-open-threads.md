# HANDOFF — publishing, and what is still open

Written 2026-08-02. Every number below is measured in this repo or read off the
registry. Where something is an assumption it says so.

`main` is at `521e4af`. `@jokerized/decksmith@0.1.3` is on npm and verified from
the registry: `decksmith --version` answers `0.1.3`, and `decksmith-mcp` answers
an `initialize` over stdio with `{"name":"decksmith","version":"0.1.3"}`.

---

## How a release happens now

Push a `v*` tag. `.github/workflows/release.yml` re-runs typecheck, lint, tests
and build, checks the tag against `version` in `package.json`, and publishes.

There is no npm token anywhere. Authentication is OIDC (npm trusted publishing),
so npm mints a short-lived credential for that workflow, on that repository, at
publish time.

```sh
npm version patch
git push --follow-tags
```

Three strings have to agree across two systems, and npm validates none of them
when you save the trusted publisher. A mismatch fails as an authentication error
that names none of them:

| where | what |
| --- | --- |
| the workflow's filename | `release.yml` |
| the job's environment | `release` |
| `package.json` | `repository.url` = `git+https://github.com/ca1773130n/DeckSmith.git` |

---

## What I would do next, in this order

### 1. `dist/` is never cleaned, and a hand-publish already shipped the extras

**Fixed in `14f4f6a` (#20), 2026-08-02.** The build empties `dist` before its
first esbuild call, and `prepare` runs the build ahead of `npm pack` and
`npm publish`, so the tarball is the build output whatever the local tree held.
Checked by planting `dist/server/main.js` and `dist/stale.js`, building and
packing: 71 entries, nothing under `dist/server`. Naming the four artifacts in
`files` was not done — it is now a second lock on a door that closes by itself.
The rest of this section is the reasoning, kept because the traps below lean on
it.

`files` is `["dist", "README.md"]`, which takes the whole directory, and
`scripts/build.mjs` wrote into it without emptying it first. The tarball's
contents therefore depended on what happened to be built locally beforehand.

Not hypothetical. `npm run serve` builds `dist/server/`, and 0.1.0 went to npm
carrying eight server files, 78 entries against 0.1.3's 71:

```
0.1.0: 78 files, dist/server entries: 8
0.1.3: 71 files, dist/server entries: 0
```

0.1.3 is clean only because CI checks out a fresh tree. Every release from here
is a CI release, so what is exposed is a hand-publish, which is what 0.1.0 was,
and what the first publish of any new package has to be. See the traps below.

Emptying `dist` at the top of the build is the smaller change and has the side
benefit of making a local build match a CI one. Naming the four artifacts
explicitly in `files` is stricter and would have caught this without a build step
running at all. I would do the first and think about the second.

### 2. `CUE_OVERHEAD` is measured at one rate and applied at four

**Settled in `ba0d4bc` (#24), 2026-08-02 — the assumption holds.**
`scripts/measure-cue-rate.mjs` re-synthesised the anchor deck at all five steps
and `p95/mean` does not trend with rate: 1.2467, 1.2945, 1.2434, 1.2548, 1.2628.
So it stays a constant. The `+10%` reading is not an outlier worth chasing —
p95 over 39 cues is the second-highest cue, and `median/mean` is flat to within
a percent across the whole range.

The run turned up something else, which is now item 6 below and matters more
than this did: `RATE_STEPS` overstates every speedup, and the two errors
currently cancel. Read that before touching either constant.

In `src/plan/duration.ts`. The constant converts a mean spoken rate into a p95
cue rate, and it decides how fast a fast-forward deck speaks. That puts it in
shipped output instead of in a gate, which is how the old value survived so long.

It reads 1.28 now, measured on `demo/audio/narration.json`: 37 segments, 39 cues,
mean speech 14.440 cps, p95 cue 18.409. But that measurement is taken at `+0%`
and applied at every step in `RATE_STEPS`, on the reasoning that speeding the
voice up shrinks the cue windows and the breaths between them together.

That reasoning is the last unmeasured thing in the duration model. Settling it
means synthesising the demo again at `+10%` and `+20%` and recomputing
p95 cue ÷ (`SPEECH_CPS.latin` × speedup) at each. If the ratio moves, the
constant has to become a function of the step. Needs edge-tts and about ten
minutes of audio.

### 3. The CJK width fallback over-charges Hangul by about 12%

**Fixed in `fdbc60c` (#22), 2026-08-02.** `BLOCK_ADVANCE` in `src/emit/svg.ts`
pins a measured advance per Unicode block — Hangul at 0.920 — derived
exhaustively over every codepoint the four bundled Noto families declare.
`test/svg.test.ts` lost the 1.13 bar with it; CJK now passes the same 1.07 as
every other script. Two further things came out of doing it:

- `weightFactor` was being applied to CJK, which charged bold Hangul 4.5% that
  a face drawn on an em grid never spends. Weight now applies only to the pool
  that answers to it.
- Splitting the sum into two pools reassociates the multiply for Latin as well,
  and `(u * f) * K * size` differs from `u * K * size * f` by about 1e-12px on
  a third of inputs. That flipped `b06-stack:4` to a real label overprint.
  Latin keeps the original bracketing exactly. **Only `npm run sweep` caught
  it** — `check` was green throughout, which is the trap below about a green
  `check` proving less than it looks like it does, in its sharpest form.

Hangul jamo and half-width forms deliberately keep the blanket: no bundled
family carries enough of either to measure. The reasoning below is kept because
it is why the numbers are what they are.

In `src/emit/svg.ts`. Any character the measured `ADVANCE` table did not carry
cost a flat 1.02 em: Hangul, kana, Han, full-width forms and emoji alike. Noto
Sans KR sets Hangul at roughly 0.92, so a Korean deck got measured about 12%
wider than it drew, and what that cost is beats refused for room they have.

Tighten it by measuring per script. Lowering the blanket is the wrong move, since
the same 1.02 also covers emoji, which genuinely exceed one em.
`scripts/measure-type.mjs` is the harness. It would need the bundled Noto faces
in place of Inter, and a per-block table in place of one number.

### 4. There is no human approval on a release — RESOLVED 2026-08-02

Anyone who can push a `v*` tag publishes to npm. The `release` environment is
restricted to `v*` tags, so a branch push cannot reach it, but required reviewers
are plan-gated:

```
422 Failed to create the environment protection rule.
    Please ensure the billing plan supports the required reviewers protection rule.
```

**THE PREMISE ABOVE IS STALE, corrected 2026-08-02. The repository is public.**
`gh repo view` says `"visibility":"PUBLIC"`. The 422 is from 2026-08-01, when it
was not, and everything that error implied has changed:

- **Required reviewers are ON.** Retried, and the call that returned 422 in
  August now returns 200: protection rules are free on a public repository.
  `ca1773130n` is the sole reviewer, rule `61535301`. A `v*` tag no longer
  publishes on its own — the job waits at the `release` environment for a human
  to approve it, which is the gate this item wanted.

  `prevent_self_review` is deliberately `false`. There is one maintainer, so
  requiring a second pair of eyes would mean nothing could ever be released.
  Turn it on the day there are two.

  The PUT replaces the environment, so it was sent carrying
  `deployment_branch_policy` unchanged; the `v*` tag policy (`56226842`) is
  still there and was checked afterwards, not assumed. Anyone editing this
  environment through the API again has to do the same, or the tag restriction
  goes silently and every branch can reach the release job.
- **Provenance should now appear by itself.** npm generates an attestation
  automatically for a trusted publish when the package is public and the
  REPOSITORY is public, with no `--provenance` flag; passing the flag is not the
  missing piece and never was.

0.1.0 through 0.1.3 carry no attestation, and that is the old state rather than
a broken workflow: all four were published inside a hundred minutes on
2026-08-01, while the repo was still private, and provenance is not supported
from a private source however public the package is. **If 0.1.4 also lands
without one, that is a real failure** — check it, rather than assuming this
paragraph still holds.

The original text follows, because the 422 is real and someone will hit it again
if the repository is ever made private.

Two ways out, and both are decisions rather than code: a paid plan, or making the
repository public. Going public would also turn npm provenance back on. It is
disabled for private sources, which is why `--provenance` is not in the release
workflow and why 0.1.x ships without attestations.

### 5. 0.1.0 and 0.1.1 are on npm with a broken binary

Both declare `decksmith-mcp -> dist/mcp.js`; neither contains the file, so the
bin resolves to a dangling link. Fixed in 0.1.2.

Deprecating them needs the owner's one-time password, and **the OIDC trusted
publishing this repo already has does not help** — a reasonable thing to expect
it to. npm's own limitation, quoted:

> OIDC authentication supports the `npm publish` and `npm stage publish`
> commands. [...] Other npm commands such as `install`, `view`, or `access` still
> require traditional authentication methods.

`npm deprecate` is none of those two. The credential npm mints inside the
release workflow is scoped to that publish and expires with it, so there is no
way to spend it on a deprecate — not from CI, and certainly not from a laptop,
where no OIDC token exists at all.

That leaves two paths. An OTP, below, because the account's 2FA level is
`auth-and-writes` and a deprecate is a write. Or a granular access token with
write permission on the package, which would not prompt — but that is a
long-lived write credential of exactly the kind trusted publishing was adopted
to get rid of, minted for two one-off commands. The OTP is the cheaper trade.

The account is `auth-and-writes`, and `npm deprecate` is a write:

```sh
npm deprecate "@jokerized/decksmith@0.1.0" "Broken decksmith-mcp binary — use 0.1.3 or later." --otp=<code>
npm deprecate "@jokerized/decksmith@0.1.1" "Broken decksmith-mcp binary — use 0.1.3 or later." --otp=<code>
```

Low stakes. `latest` is 0.1.3, so nobody lands on them without pinning.

### 6. `RATE_STEPS` overstates every speedup — FIXED `9d724d9` (#27), 2026-08-02

Both constants moved together: the speedups are now the measured 1.086 / 1.182 /
1.278 / 1.393, and `CUE_OVERHEAD` rose 1.28 → 1.30 to sit above every ratio the
run observed rather than relying on the inflated speedups to cover it.

**It cost a promise, and the promise was never real.** A 60s deck over twelve
slides at low density now plans 66 characters against `EXPLAINING_CHARS` of 72.
That is the configuration this repo's tests call "the configuration that shipped
the complaint". It had been clearing 72 by two tenths of a character — 4.225 ×
14.4 × 1.187 = 72.2 — on the strength of the wrong speedup, so the planner was
asking for words the voice would not have fit in the beat. 90s reaches 102 and
is where that configuration lives now.

**One knob is still open, deliberately.** `CUE_OVERHEAD` at 1.30 refuses `+20%`
for the demo (predicts 22.13 against a ceiling of 22) even though the artifact's
own cues at that step read 21.76 and are inside it. ~1.26 is the centre of the
five observations: it would take that step, track the artifact to within 0.6%,
and put the 60s case back over 72 — while under-predicting on about half of
future runs. Chosen 1.30 on 2026-08-02 to never be under on a statistic measured
once over 39 cues. Both costs are pinned with their arithmetic in
`test/duration.test.ts`; switching is one constant and two expectations.

The finding and reasoning follow.

Found on 2026-08-02 while settling item 2.

The speedups in `src/plan/duration.ts` were timed on ONE 72-character sentence.
Measured again over the anchor deck's 37 segments, `--rate` buys rather less:

```
  step    table   measured
  +10%    1.187      1.086
  +20%    1.252      1.182
  +30%    1.394      1.278
  +40%    1.533      1.393
```

A short sentence carries proportionally more silence at its ends, so timing one
overstates what the prosody rate does to speech.

**Do not fix this alone.** (Both were fixed together in #27; this is the record
of why that was the only safe way.) `CUE_OVERHEAD` is 1.28 and the cue ratio measured at
`+10%` is 1.2945 — 1.1% above it, which by itself under-predicts a cue rate, and
under-predicting is what puts unreadable captions on a deck. The inflated
speedups are what covers that: together they land 1.9% to 10.7% ABOVE the
artifact at every step, the safe direction for a ceiling. Lower these and the
cover goes with them.

Both constants carry the coupling in their own comments now, and
`node scripts/measure-cue-rate.mjs` produces every number for both in one run,
which is the only way they should move. It needs edge-tts, ffprobe, a network
and about ten minutes. There is no `npm run` alias, the same as
`measure-type.mjs`: neither is a gate, and giving them one invites someone to
put them in `check`, where they would fail on a plane.

What it costs today: at `+20%` the artifact's p95 cue is 21.321 against a ceiling
of 22, so that step is admissible — but the code predicts 23.077 for it and takes
`+10%` instead. Fast-forward decks speak one step slower than they need to. That
is a real cost and it is the safe kind, which is why this can wait for someone
with ten minutes and a network.

---

## Traps

**A new package's first publish cannot use OIDC.** npm requires the package to
exist before a trusted publisher can attach to it; `npm trust`'s own
prerequisites say "Package must exist". A new package therefore needs one manual
`npm publish --access public --otp=<code>`, and only then does the tag path work.
This is also why §1 matters.

**The sweep receipt binds to `dist/`.** `experiments/sweep/ledger.json` carries a
fingerprint over the built tree and the harness, and
`experiments/sweep/swept.test.mjs` fails when they disagree. Change anything
under `src/` and `npm run sweep` has to run again, or the suite goes red for a
reason unrelated to the change.

**`ADVANCE`, `weightFactor` and `KERN_SLACK` are one unit.** `ADVANCE` is defined
as the max over weights of the true advance divided by `weightFactor`, so
changing either one alone breaks the never-under-predict guarantee the whole
table exists to keep. `node scripts/measure-type.mjs` re-derives all three and
prints the table ready to paste; `test/svg.test.ts` holds the result against ten
widths read out of a browser.

**`TMPDIR` points at the repository.** Agent sessions here run with
`TMPDIR=/Users/neo/Developer/Projects/DeckSmith`, which appears in no shell
profile (a clean login shell has it empty), so something injects it per session.
Thirteen places ask `os.tmpdir()` for scratch, so every `mkdtemp` lands in the
project root. 1,596 directories had accumulated before anyone looked.

`scripts/tmpdir.mjs` drops the variable when it resolves inside the repo, wired
in through `vitest.config.ts`. It covers the test suite and nothing else. Running
`node dist/mcp.js` or a script directly still writes into the repo, since the MCP
server's work root is `join(tmpdir(), "decksmith-mcp")`, and
`node-compile-cache/` appears regardless because Node creates it before any setup
file runs.

---

## Not defects — do not "fix" these

Five refused cells in the sweep, out of `48 ok, 5 refused over 53`. A refusal is
an archetype declining a beat it cannot draw, which is correct behaviour and the
entire point of the height and width guards:

```
b07-split-compare:4   panels do not fit beside each other at the 40px floor
b09-data-table:3      9 rows stand 864px against the slide's 698px
b09-data-table:4      10 rows stand 950px
b12-callout:3         894px of panel in a 606px box
b12-callout:4         1572px of panel in a 606px box
```

`b09-data-table:3` and `:4` are pinned with the verdict `refused` in
`scripts/sweep.mjs` precisely so they cannot quietly become `ok` again. A table
that starts drawing at 9 rows is the old canvas-overflow bug back.

The 1.02 CJK blanket over-charges rather than under-charges, which is the safe
direction. §3 has the proper way to tighten it.

Squash merges on `main` keep every commit message inline in the squash body, so
nothing is lost. What is lost is the per-commit granularity.

---

## Things worth knowing about the tooling

`npm run check` is typecheck, lint and tests. It does not build. `npm run sweep`
builds first. A green `check` over a stale or missing `dist/` proves less than it
looks like it does.

GitHub Actions was switched off for this repository until 2026-08-01. The last CI
run before that was a failing one from 2026-07-31, and pull requests were
carrying a GitGuardian check and nothing else. It is on now, and this is a
private repository, so the minutes are billable.

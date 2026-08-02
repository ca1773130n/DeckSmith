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

`files` is `["dist", "README.md"]`, which takes the whole directory, and
`scripts/build.mjs` writes into it without emptying it first. The tarball's
contents therefore depend on what happened to be built locally beforehand.

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

In `src/emit/svg.ts`. Any character the measured `ADVANCE` table does not carry
costs a flat 1.02 em: Hangul, kana, Han, full-width forms and emoji alike. Noto
Sans KR sets Hangul at roughly 0.92, so a Korean deck gets measured about 12%
wider than it draws, and what that costs is beats refused for room they have.

It is safe, it is deliberate, and `test/svg.test.ts` pins it, allowing the Korean
case its own 1.13 bar and saying why.

Tighten it by measuring per script. Lowering the blanket is the wrong move, since
the same 1.02 also covers emoji, which genuinely exceed one em.
`scripts/measure-type.mjs` is the harness. It would need the bundled Noto faces
in place of Inter, and a per-block table in place of one number.

### 4. There is no human approval on a release

Anyone who can push a `v*` tag publishes to npm. The `release` environment is
restricted to `v*` tags, so a branch push cannot reach it, but required reviewers
are plan-gated:

```
422 Failed to create the environment protection rule.
    Please ensure the billing plan supports the required reviewers protection rule.
```

Two ways out, and both are decisions rather than code: a paid plan, or making the
repository public. Going public would also turn npm provenance back on. It is
disabled for private sources, which is why `--provenance` is not in the release
workflow and why 0.1.x ships without attestations.

### 5. 0.1.0 and 0.1.1 are on npm with a broken binary

Both declare `decksmith-mcp -> dist/mcp.js`; neither contains the file, so the
bin resolves to a dangling link. Fixed in 0.1.2.

Deprecating them needs the owner's one-time password. The account is
`auth-and-writes`, and `npm deprecate` is a write:

```sh
npm deprecate "@jokerized/decksmith@0.1.0" "Broken decksmith-mcp binary — use 0.1.3 or later." --otp=<code>
npm deprecate "@jokerized/decksmith@0.1.1" "Broken decksmith-mcp binary — use 0.1.3 or later." --otp=<code>
```

Low stakes. `latest` is 0.1.3, so nobody lands on them without pinning.

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

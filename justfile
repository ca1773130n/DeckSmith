# DeckSmith — edit the settings block, then run a recipe.
#
# `just` with no arguments lists everything. Every setting below is also an
# environment variable, so `PORT=9000 just serve` wins over the file for one run
# without editing it.

# ─────────────────────────────────────────────────────────────── settings ────

# Interface the server binds. 127.0.0.1 keeps it on this machine; 0.0.0.0 puts
# it on your network, where anyone who can reach it can queue jobs that SPEND
# CODEX TOKENS ON YOUR ACCOUNT. There is no auth in this server — the only
# brakes are the two rate limits below. Opening it is meant to be a decision.
host := env("DECKSMITH_HOST", "0.0.0.0")
port := env("PORT", "8475")

# Where jobs unpack, build and get swept from.
#
# NOT `os.tmpdir()`, deliberately. Agent sessions in this repo run with
# TMPDIR pointing AT THE REPO, so the server's default work root resolves to
# <repo>/decksmith-server and every job's scratch lands in the source tree.
# 1,596 such directories had accumulated before anyone noticed.
# `scripts/tmpdir.mjs` guards the test suite and nothing else.
work := env("DECKSMITH_WORK", home_dir() / ".decksmith/work")

# Jobs one IP may start per hour, and requests per minute. Lower the first if
# the server is reachable from anywhere you do not control.
jobs_per_hour := env("DECKSMITH_JOBS_PER_HOUR", "5")
reqs_per_min := env("DECKSMITH_REQS_PER_MIN", "240")

# Fetch figures a document links rather than attaches. `guardFigures` refuses
# any URL resolving to a private, loopback or link-local address. "0" disables.
fetch_figures := env("DECKSMITH_FETCH_FIGURES", "1")

# Job records and their files are dropped this many minutes after finishing.
job_ttl_min := env("DECKSMITH_JOB_TTL_MIN", "120")

_default:
    @just --list --unsorted

# ─────────────────────────────────────────────────────────────── the server ──

# Build and run the deck server. Ctrl-C stops it.
serve:
    @echo "http://{{ host }}:{{ port }}   work: {{ work }}"
    @mkdir -p "{{ work }}"
    DECKSMITH_HOST="{{ host }}" \
    PORT="{{ port }}" \
    DECKSMITH_WORK="{{ work }}" \
    DECKSMITH_JOBS_PER_HOUR="{{ jobs_per_hour }}" \
    DECKSMITH_REQS_PER_MIN="{{ reqs_per_min }}" \
    DECKSMITH_FETCH_FIGURES="{{ fetch_figures }}" \
    DECKSMITH_JOB_TTL_MIN="{{ job_ttl_min }}" \
    npm run serve

# What the server needs, and where it is. Run this before asking why a job died.
#
# `edge-tts` reported missing here is usually a FALSE ALARM: the server's
# preflight only looks on PATH, while `resolveEdgeTts` also tries
# `python3 -m edge_tts`. This checks both.
[doc('Check every binary the server needs, and the TMPDIR trap')]
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    for bin in codex ffmpeg ffprobe; do
      printf '  %-9s %s\n' "$bin" "$(command -v $bin || echo 'MISSING')"
    done
    if command -v edge-tts >/dev/null; then
      printf '  %-9s %s\n' edge-tts "$(command -v edge-tts)"
    elif python3 -c 'import edge_tts' 2>/dev/null; then
      printf '  %-9s %s\n' edge-tts "python3 -m edge_tts ($(python3 -c 'import edge_tts;print(edge_tts.__version__)'))"
    else
      printf '  %-9s %s\n' edge-tts MISSING
    fi
    printf '  %-9s %s\n' node "$(node -v)"
    printf '  %-9s %s\n' work "{{ work }}"
    node -e 'const t=require("os").tmpdir(), r=process.cwd();
      if (t===r||t.startsWith(r+"/")) console.log("  TMPDIR    points INSIDE the repo ("+t+") — recipes here set DECKSMITH_WORK around it");
      else console.log("  TMPDIR    "+t);'

# ────────────────────────────────────────────────────────────────── gates ────

# typecheck + lint + tests. Does NOT build — a green check over a stale dist
# proves less than it looks like it does.
[doc('typecheck + lint + tests (does not build)')]
check:
    npm run check

# Build, then run the perturbation sweep and re-pin its receipt.
#
# The receipt binds to dist/, so this must be re-run after ANY change under
# src/ or the suite goes red for a reason unrelated to the change.
[doc('Build, run the perturbation sweep, re-pin its receipt')]
sweep:
    npm run sweep

fmt:
    npm run format

build:
    npm run build

# Build the demo deck and serve it at :8080.
demo:
    npm run demo

# ──────────────────────────────────────────────────────── measurements ───────
#
# Neither is a gate: both need the network, a browser or a TTS service, and
# minutes. They exist so the constants they feed are checkable rather than
# folklore. Paste their output into the file each names.

# Re-derive ADVANCE, TABULAR_*, weightFactor, KERN_SLACK and BLOCK_ADVANCE.
[doc('Re-measure the type metrics in src/emit/svg.ts')]
measure-type:
    node scripts/measure-type.mjs

# Re-derive CUE_OVERHEAD and the RATE_STEPS speedups. ~10 minutes of synthesis.
# They are ONE UNIT — never move one without the other.
[doc('Re-measure the narration constants (~10 min, needs edge-tts)')]
measure-cue:
    node scripts/measure-cue-rate.mjs

# ───────────────────────────────────────────────────────────────── release ───

# Cut a release: bump, tag, push. CI builds, tests and publishes over OIDC.
#
#   just release           # patch
#   just release minor
#
# The tag push starts .github/workflows/release.yml, which then WAITS for a
# human to approve the `release` environment. Nothing reaches npm until you do.
[doc('Bump, tag and push; CI publishes after you approve')]
release kind="patch": _release-preflight
    npm version {{ kind }}
    git push --follow-tags
    @echo
    @echo "Approve the run to publish:"
    @gh run list --workflow=release.yml --limit 1 --json url --jq '.[0].url'

# Refuses a release that would publish something other than what you tested.
_release-preflight:
    #!/usr/bin/env bash
    set -euo pipefail
    [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "not on main"; exit 1; }
    [ -z "$(git status --porcelain)" ] || { echo "working tree is dirty"; exit 1; }
    git fetch -q origin main
    [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main and origin/main disagree"; exit 1; }
    npm run check
    npm run build
    echo "preflight ok"

# Would a release publish anything new? Compares a fresh build against the
# tarball already on npm. "identical" means a new version would ship the same
# bytes under a new number — comments and docs do not reach dist/.
[doc('Would a release ship anything new? Compare build against npm')]
diff-published:
    #!/usr/bin/env bash
    set -euo pipefail
    npm run build >/dev/null 2>&1
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    ( cd "$tmp" && npm pack "@jokerized/decksmith@$(npm view @jokerized/decksmith version)" >/dev/null 2>&1 && tar xzf ./*.tgz )
    if diff -rq dist "$tmp/package/dist" >/dev/null 2>&1; then
      echo "identical — a release would publish the same bytes"
    else
      diff -rq dist "$tmp/package/dist" || true
    fi

# Prove the published package actually runs: contents, CLI, MCP handshake.
verify-published version="latest":
    #!/usr/bin/env bash
    set -euo pipefail
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    cd "$tmp"
    npm pack "@jokerized/decksmith@{{ version }}" >/dev/null 2>&1
    echo "  entries:        $(tar tzf ./*.tgz | wc -l | tr -d ' ')"
    echo "  dist/server:    $(tar tzf ./*.tgz | grep -c 'dist/server' || true)  (must be 0 — see scripts/build.mjs)"
    npm init -y >/dev/null 2>&1 && npm i ./*.tgz >/dev/null 2>&1
    echo "  decksmith:      $(./node_modules/.bin/decksmith --version)"
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"just","version":"0"}}}' \
      | ./node_modules/.bin/decksmith-mcp 2>/dev/null | head -c 200
    echo
    npm audit signatures 2>&1 | grep -i attestation || echo "  (no attestation — expected only for versions published while the repo was private)"

# Deprecate a version or range. Takes a RANGE, so one call covers several:
#
#   just deprecate '<0.1.2' 'Broken decksmith-mcp binary — use 0.1.4 or later.'
#
# OIDC does not cover this — trusted publishing is `npm publish` only — so npm
# will open a browser to authenticate. Repeating a deprecation that already says
# the same thing fails E422, which reads like a permission error and is not one.
[doc('Deprecate a version range on npm')]
deprecate range message:
    npm deprecate "@jokerized/decksmith@{{ range }}" "{{ message }}"
    @npm view "@jokerized/decksmith" versions --json

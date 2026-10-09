/**
 * The gate the bespoke pass runs on its candidates: build a real deck with them
 * in it, run every gate `verify` runs, add the motion gates, and photograph each
 * candidate at its cue boundaries for the critique round.
 *
 * A REAL BUILD, not the scene in isolation, because the failures worth catching
 * are the deck's: a scene's CSS reaching a neighbour, a hold the island refuses,
 * a handoff that leaves it lit, a font the bundle does not carry. `buildDeck` is
 * the library half of `build`, so the probe deck is the deck, minus its audio.
 *
 * Findings are pinned to a scene by what they name — a `#sN` selector, a beat
 * id, or a time inside the scene's window — the way the spike's harness did.
 * Errors fail the scene; warnings travel to the critique round as text only.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DeckNarration } from "../emit/composition.js";
import { buildDeck } from "../index.js";
import { openDeck } from "../render/capture.js";
import type { Finding, Format, Source, Storyboard } from "../types.js";
import { verify } from "../verify/index.js";
import { probeScenes, readTimingFile, type SceneWindow, sceneWindows } from "../verify/scenes.js";
import type { GateFn, GateResult } from "./pipeline.js";
import type { BespokeMap } from "./scene.js";
import { contactSheet } from "./sheet.js";

export interface ProbeDeck {
  storyboard: Storyboard;
  source: Source;
  format: Format;
  narration: DeckNarration;
  theme: string;
  /** Where the source's assets live (`build` copies them from here). */
  assetsFrom: string;
  /** Scratch: probe decks and contact sheets go here. */
  work: string;
  onStep?: (message: string) => void;
}

/** Which scene a `verify` finding is about, if it says. */
export function attribute(f: Finding, windows: readonly SceneWindow[]): string | undefined {
  for (const w of windows) {
    if (f.beatId && f.beatId === w.beatId) return w.sid;
    if (new RegExp(`#${w.sid}(?![0-9])`).test(f.message)) return w.sid;
  }
  // A finding that names another scene is that scene's, whatever its time says.
  if (/#s\d+(?![0-9])/.test(f.message)) return undefined;
  const at = /t=([0-9.]+)s/.exec(f.message);
  if (at) {
    const t = Number(at[1]);
    return windows.find((w) => t >= w.start && t < w.start + w.duration)?.sid;
  }
  return undefined;
}

/**
 * A console error no scene id names fails every scene probed with it — unless
 * the value it quotes appears in exactly one candidate, which is then the
 * culprit: an SVG parse error quotes the bad attribute. MEASURED 2026-10-09:
 * one draft's broken path sent all five drafts of a deck to critique.
 */
export function pinPageErrors(
  findings: Finding[],
  candidates: BespokeMap,
  sidOf: ReadonlyMap<string, string>,
): Finding[] {
  const bare = (m: string) => m.replace(/^#s\d+: /, "");
  const culprit = new Map<string, string>();
  for (const f of findings) {
    if (f.rule !== "page_error" || culprit.has(bare(f.message))) continue;
    const quoted = /"([^"]{4,})"/.exec(f.message)?.[1];
    if (!quoted) continue;
    const hits = Object.entries(candidates).filter(([, e]) =>
      `${e.fragment.markup}\n${e.fragment.script}`.includes(quoted),
    );
    const sid = hits.length === 1 ? sidOf.get(hits[0]?.[0] as string) : undefined;
    if (sid) culprit.set(bare(f.message), sid);
  }
  return findings.filter((f) => {
    if (f.rule !== "page_error") return true;
    const owner = culprit.get(bare(f.message));
    return owner === undefined || f.message.startsWith(`#${owner}:`);
  });
}

export function browserGate(deck: ProbeDeck): GateFn {
  const step = deck.onStep ?? (() => {});
  return async (candidates: BespokeMap, round) => {
    const dir = join(deck.work, `probe-${round}`);
    await rm(dir, { recursive: true, force: true });
    const built = await buildDeck(deck.storyboard, deck.source, dir, {
      design: "v2",
      theme: deck.theme,
      narration: deck.narration,
      speed: 1,
      assetsFrom: deck.assetsFrom,
      bespoke: candidates,
      // As `build` does: a beat its archetype refuses costs that slide, not the probe.
      onBeatError: () => {},
    });
    const sidOf = new Map(built.cut.kept.map((b, i) => [b.id, `s${i + 1}`]));
    const timing = await readTimingFile(dir);
    if (!timing) throw new Error("the probe deck has no timing.json");
    const wanted = new Set(
      Object.keys(candidates)
        .map((id) => sidOf.get(id))
        .filter((s): s is string => s !== undefined),
    );
    const beatOf = new Map([...sidOf].map(([b, s]) => [s, b]));
    const windows = sceneWindows(timing, wanted).map((w) => ({ ...w, beatId: beatOf.get(w.sid) }));

    step(`bespoke: ${round} gates on ${windows.length} scene(s)`);
    const errors: string[] = [];
    const probe = await probeScenes(windows, {
      open: () => openDeck(dir, { watch: errors }),
      errors,
      keepFrames: true,
      geometry: true,
    });
    const verdict = await verify(dir, { fidelity: true, scenes: false });

    probe.findings = pinPageErrors(probe.findings, candidates, sidOf);
    const out = new Map<string, GateResult>();
    for (const w of windows) {
      const beat = w.beatId as string;
      const mine = (f: Finding) =>
        f.message.startsWith(`#${w.sid}:`) || f.message.startsWith(`#${w.sid} `);
      const motion = probe.findings.filter(mine);
      const gates = verdict.findings.filter((f) => attribute(f, windows) === w.sid);
      const failing = [...motion, ...gates].filter((f) => f.severity === "error");
      const frames = probe.frames.filter((f) => f.sid === w.sid);
      const sheet = join(deck.work, `${beat}.${round}.png`);
      await contactSheet(
        frames.map((f) => ({ label: `${f.key} ${f.t.toFixed(2)}s`, png: f.png })),
        sheet,
      );
      const end = probe.layout.find((l) => l.sid === w.sid && l.key === "end");
      const cueChange = probe.cueChanges
        .filter((c) => c.sid === w.sid)
        .sort((a, b) => a.cue - b.cue)
        .map((c) => c.changed / c.total);
      out.set(beat, {
        // `info` is a finding already accepted (a camera's clipped overflow): not
        // the critique round's to act on, and it read as a reason to drop the camera.
        findings: [...motion, ...gates]
          .filter((f) => f.severity !== "info")
          .map((f) => `${f.severity} ${f.rule}: ${f.message}`),
        failed: failing.length > 0,
        sheet,
        legend: frames.map((f) => `${f.key} = ${f.t.toFixed(2)}s`).join(", "),
        metrics: {
          ...(end?.fill !== undefined ? { fill: end.fill } : {}),
          ...(end?.cells !== undefined ? { cells: end.cells } : {}),
          ...(end?.maxType !== undefined ? { maxType: end.maxType } : {}),
          ...(end?.mass !== undefined ? { mass: end.mass } : {}),
          ...(end?.dimmed !== undefined ? { dimmed: end.dimmed } : {}),
          cueChange,
        },
        // What the repair pass reads: every graded frame's geometry, in order.
        layout: probe.layout.filter((l) => l.sid === w.sid),
        sid: w.sid,
        // The scene's own warnings: not the storyboard's (a headline that
        // recites labels is the plan's), not lint's file-size note.
        warnings: [...motion, ...gates]
          .filter((f) => f.severity === "warning" && f.gate !== "storyboard")
          .map((f) => `${f.rule}: ${f.message.slice(0, 160)}`),
      });
    }
    return out;
  };
}

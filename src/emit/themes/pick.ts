/**
 * Which v2 pack a deck wears, when nobody said.
 *
 * DETERMINISTIC: a pure function of the storyboard's beats and a seed, so the
 * same deck is the same bytes on every build (invariant 4 is about render time,
 * but a pick that moved between builds would be the same failure one step
 * earlier). The seed is the source id unless the caller passes one — HypePaper
 * should pass the PAPER id, so a paper's en and ko decks share a look.
 *
 * WEIGHTED BY CONTENT, so the hash is not the only voice. Each pack carries an
 * affinity for the four archetype families (`ARCHETYPE_FAMILY`): a deck that is
 * mostly equations leans to the serif packs, one that is mostly bars and tables
 * to the grotesk and drafting ones. The lean is mild — every pack keeps a floor
 * weight — because the founder's complaint is sameness across decks, and a
 * strong content rule would put every paper of one field on one pack.
 *
 * Rendezvous hashing: each pack draws `-ln(u) / weight` from its own hash of
 * (seed, pack) and the smallest draw wins. That is a weighted choice whose
 * probabilities are exactly the normalised weights, and the full ordering is a
 * ready-made fallback list — the next pack is the next-smallest draw, so a
 * caller that must refuse one (narration staged against another look) moves
 * along it without re-rolling anything.
 */
import { ARCHETYPE_FAMILY, type ArchetypeFamily, type Storyboard } from "../../types.js";
import { PACKS } from "./packs.js";

/** How much each family pulls a deck toward a pack. Mild by design; see above. */
const AFFINITY: Readonly<Record<string, Partial<Record<ArchetypeFamily, number>>>> = {
  signal: { quantity: 0.6, frame: 0.3 },
  blueprint: { structure: 0.7, formal: 0.2 },
  atlas: { frame: 0.6, structure: 0.2 },
  folio: { formal: 0.8, frame: 0.2 },
  chalk: { quantity: 0.5, structure: 0.4 },
  journal: { formal: 0.4, frame: 0.4 },
};

/** 32-bit FNV-1a. Stable across platforms and Node versions, unlike any Map order. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The share of beats in each family. Empty storyboards weigh nothing. */
function mix(beats: Storyboard["beats"]): Record<ArchetypeFamily, number> {
  const out: Record<ArchetypeFamily, number> = { frame: 0, structure: 0, quantity: 0, formal: 0 };
  for (const b of beats) out[ARCHETYPE_FAMILY[b.archetype]] += 1 / beats.length;
  return out;
}

/** A pack's weight for this deck: 1, plus its affinity times the family mix. */
export function packWeights(beats: Storyboard["beats"]): Record<string, number> {
  const m = mix(beats);
  const out: Record<string, number> = {};
  for (const name of Object.keys(PACKS)) {
    const a = AFFINITY[name] ?? {};
    out[name] =
      1 + Object.entries(a).reduce((s, [f, w]) => s + (w ?? 0) * m[f as ArchetypeFamily], 0);
  }
  return out;
}

/** Every pack, most-preferred first, for this deck and seed. */
export function rankPacks(beats: Storyboard["beats"], seed: string): string[] {
  const weights = packWeights(beats);
  const draw = (name: string) => {
    // (h + 0.5) / 2^32 is never 0 or 1, so the log is always finite.
    const u = (fnv1a(`${seed}\u0000${name}`) + 0.5) / 2 ** 32;
    return -Math.log(u) / (weights[name] ?? 1);
  };
  return Object.keys(PACKS)
    .map((name) => ({ name, d: draw(name) }))
    .sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : 1))
    .map((r) => r.name);
}

/** The design generation a build emits. `classic` is v0.8.0, byte for byte. */
export type Design = "classic" | "v2";

export interface LookChoice {
  /** `--theme` or a config file. Always wins: a named theme is a forced one. */
  stated?: string | undefined;
  storyboard: Pick<Storyboard, "theme" | "beats" | "sourceId">;
  design: Design;
  /** Overrides `storyboard.sourceId` as the hash seed. */
  seed?: string | undefined;
  /**
   * Whether this build can wear a pack. `build` passes a check that the pack
   * stages every beat with the stop count the narration was recorded at; a pack
   * it refuses is skipped for the next in the ranking.
   */
  accepts?: (name: string) => boolean;
}

/**
 * The theme name a build, a narration or a timing pass should stage with.
 *
 * Classic: what it always was, `stated ?? storyboard.theme`.
 *
 * v2: a stated theme still wins, and so does a storyboard that names anything
 * but `ink` — that is the storyboard forcing a look. `ink` is the schema's
 * DEFAULT, so it is indistinguishable from "nobody said" once parsed, and is
 * read that way (as `--theme ink` is: the CLI treats a default value as
 * unstated). The v0.8.0 look is `--design classic`, not a v2 deck in ink.
 * Otherwise the first ranked pack `accepts` allows; if it allows none, the
 * storyboard's own theme, which is what any narration on disk was staged
 * against. Never throws.
 */
export function chooseLook(c: LookChoice): string {
  if (c.stated) return c.stated;
  if (c.design !== "v2" || c.storyboard.theme !== "ink") return c.storyboard.theme;
  const ranked = rankPacks(c.storyboard.beats, c.seed ?? c.storyboard.sourceId);
  return ranked.find((name) => c.accepts?.(name) ?? true) ?? c.storyboard.theme;
}

/**
 * THE FIDELITY GATE — at each stop, did the thing this slide is about appear?
 *
 * WHY THIS EXISTS. Four of the twenty compositional decks in
 * `experiments/015-decision/` are GATE-CLEAN and draw their main diagram as
 * nothing at all: eight to fifteen drawables per deck, sized legally, placed
 * legally, and multiplied to zero opacity by a group they were nested in.
 * `out/f-vocab18.png` is a headline over three grey arrowheads. `lint`,
 * `runtime`, `layout`, `motion`, `contrast`, the 40px floor and `drift` all pass
 * on it — `drift` twice over, because both renders are identically empty. Every
 * gate in this repo reads what the DOM CONTAINS. This one reads what the frame
 * SHOWS, which is the only thing the audience gets.
 *
 * WHERE IT MEASURES, AND WHY NOT THE CHEAPER PLACE. Two prototypes exist.
 * `invisible.mjs` does arithmetic over the plan — effective opacity as the
 * product down the parent chain — and found 4 of 20. `ink.mjs` renders the deck
 * and counts non-background pixels at every hold, and found 5 of 20. The
 * arithmetic is ~1000x cheaper and it is NOT the gate, for a reason that is
 * structural rather than aesthetic: the shipped path has no plan to do
 * arithmetic over. A DeckSmith storyboard never mentions opacity — revealing
 * what a beat draws is the archetype's job — so on the artifact this project
 * actually produces there is nothing for `invisible.mjs` to read. It cannot be
 * a pre-filter either, for the same reason. Pixels are the only instrument that
 * works on both authoring paths, so pixels are the gate.
 *
 * WHICH PIXELS. Not `hyperframes snapshot`, which is the obvious cheap frame
 * source and is unsound here: it calls `player.renderSeek(t)` with no options
 * (`cli.js`, `seekCompositionTimeline`), so `suppressEvents` is falsy and a GSAP
 * `onUpdate` FIRES. Invariant 11 says the capture path suppresses events, so
 * callback-driven motion plays under snapshot and renders frozen — snapshot is
 * permissive in exactly the direction that hides the failure this gate is for.
 * So the gate drives the capture path's own two calls: inject the pinned
 * hyperframes runtime, `renderSeek(t, { suppressEvents: true })`, then
 * `Page.captureScreenshot` with the renderer's own clip parameters. Measured
 * against `experiments/015-decision/out/vocab-18.mp4` — a real render — at all
 * twelve of its holds, this agrees to a worst case of 0.11 and a mean of 0.03
 * percentage points, the residual being H.264 quantisation (the video's
 * background reads 11,13,15 where the screenshot reads 11,13,16).
 *
 * WHAT COUNTS AS INK. Pixels that differ from the frame's own modal colour by
 * more than `INK_DELTA` on any channel. `ink.mjs` used absolute luma > 26, which
 * is half of the `ink` theme's background and therefore counts 100% of a `mono`
 * deck's white frame as ink; a shipped gate cannot be theme-specific. The modal
 * colour IS the background — it holds 80–98% of every frame measured — and one
 * line of 40px type comes out at 0.684% of the band on `ink`, 0.669% on `mono`
 * and 0.668% on `paper`, so the measure is theme-independent to within 2.4%.
 * This is also where `ink.mjs` and `invisible.mjs` disagreed: `ink.mjs` called
 * `vocab-10` empty at 0.376%, under its 0.4% threshold, because luma > 26 misses
 * a panel fill that is drawn but dim. Background-relative, `vocab-10`'s emptiest
 * hold is 3.705% — nine times its own reported value and nowhere near any floor.
 * The disagreement was the instrument, not the deck: the true count is 4 of 20.
 *
 * WHERE IT LOOKS. Below the slide's caption. Whole-frame ink does not
 * discriminate — measured, MENU's median hold is 16.5% of the frame and VOCAB's
 * is 3.4%, but the hand-written control is 3.6%, sitting among the failures
 * rather than above them, because the headline alone is 1.5–2% and every deck
 * has one. `ink.mjs` cut a fixed band at 0.22H. That band is wrong for this
 * emitter: a two-line DeckSmith `.headline` reaches 0.309H at 16:9 and 0.382H on
 * the twelve-beat demo's last scene, so a fixed 0.22H leaves most of the caption
 * inside the measured region, where its ink would mask an empty body. So the
 * band's top comes from the artifact — the bottom of the active scene's own
 * caption — and 0.22H is only the fallback for a composition that names none.
 * The control that had to be run: blank the archetype on four of the demo's
 * scenes and measure what is left below the caption. It is 0.0000% on all four,
 * so a DeckSmith slide whose beat drew nothing reads exactly zero. The gate is
 * not being propped up by chrome.
 *
 * THE FLOOR IS NOT FITTED. 0.15% of the frame is the measured ink of ONE SHORT
 * LABEL at the 40px audience floor of invariant 5 (0.213% of a 0.73H band =
 * 0.155% of the frame, measured in Chrome, three themes). Below that the body
 * holds less ink than the smallest legible thing this project permits. The
 * corpus then CHECKS it rather than setting it: over 466 stops the worst
 * positive reads 0.039% of the frame and the best negative 0.663%, so the floor
 * derived from the type gate lands 3.8x above one and 4.4x below the other. Had
 * it landed outside that gap, the floor would have been wrong and the gap would
 * have said so. Fitting it would have looked exactly like this and meant
 * nothing, which is why the number came from somewhere else first.
 *
 * ACCEPTANCE, from `fidelity()` itself and not a lookalike. 41 decks, 466 stops:
 * TP 4, FP 0, TN 37, FN 0. It flags `vocab-11`, `-13`, `-16` and `-18` and names
 * the scene (`s01-flow` in all four). It flags none of arm MENU's 20, none of the
 * twelve other VOCAB decks, not the hand-written control, and not the twelve-beat
 * demo in any of its four formats — whose tightest margin is 7.6x the floor
 * (9:16, 1.138%; 16:9 and video 1.732%; 1x1 1.704%) — nor `demo/fixtures/`
 * (plain 4.435%, camera 7.181%). Re-run three times, every number identical to
 * four decimals: this gate does not flake, which matters more than its sensitivity
 * because a false positive on a good slide is how `composition_file_too_large`
 * became something everyone ignores.
 *
 * The number that did NOT move is the one worth the most. Arm MENU is 0 of 20
 * under `invisible.mjs`, 0 of 20 under `ink.mjs` and 0 of 20 here — three
 * different measures, three different thresholds, one answer — which is what
 * makes 4 of 20 on the other arm a property of composition rather than of
 * whoever wrote the checker.
 *
 * THE CONTROL THAT COULD HAVE REFUTED IT. Case thirteen is not expressible on the
 * shipped path, so it was forced: a copy of the twelve-beat demo with one CSS
 * rule holding every scene's content at opacity 0 while the captions reveal
 * normally. Every other gate passes it with ZERO errors and ZERO warnings — it
 * even loses `connector_detached`, because an invisible connector detaches from
 * nothing — and this gate fails it with 12 errors, 37 of 37 stops at 0.0000%. The
 * same deck unbroken reads 1.732% and passes. That is the fourteenth case, caught
 * before it shipped rather than after.
 *
 * WHAT WAS TRIED AND REFUTED. "Ink INCREASED across the reveal" is the more
 * appealing signal — it promises to excuse a sparse slide — and the corpus kills
 * it. Per scene, last hold minus first: the hand-written control's scene 2 gains
 * 0.71 points while every broken scene gains more (vocab-11 0.80, vocab-13 1.04,
 * vocab-18 1.28, vocab-16 1.80), because a scene that starts at zero and ends
 * faint still increases. Per-scene MAXIMUM ink fails too, and by a hair that is
 * worse than a wide miss: vocab-16's broken third scene peaks at 2.51% against
 * the control's honest 2.44%. Presence at a stop is the signal; nothing else in
 * the corpus separates.
 *
 * WHAT IT STILL CANNOT SEE, written down here so it is not rediscovered as a
 * surprise. It answers "something was drawn", never "something was legible": a
 * panel wash 13 levels off the background clears the floor while being nearly
 * invisible, and nothing in the stack measures contrast for a SHAPE — `contrast`
 * only grades runs of text. It measures only at declared stops, so a scene with
 * no holds is not looked at, on the grounds that the deck never claims the
 * audience is stopped there. And it is per-scene, not per-element, which costs a
 * real case: `vocab-16`'s third scene is a bar chart whose FIVE BARS are all
 * invisible while its value labels, axis and category labels are not — opened, it
 * is five numbers floating over an axis — and it reads 0.520% at its emptiest
 * stop, 3.5x the floor, so this gate passes it. The deck is still caught, on its
 * first scene, so the confusion matrix does not show the miss; the scene-level
 * miss is real all the same. No threshold fixes it, because the labels genuinely
 * appeared. What would fix it is knowing that a bar chart must have bars — the
 * beat's intent, which is precisely what arm MENU's archetypes encode and a
 * composed plan does not.
 *
 * COST, and this is why it is not behind a flag. Alone it is 3.8–4.7s for the
 * twelve-beat demo's 37 stops — one browser, one page, one screenshot each. In
 * `verify` it is FREE: it runs concurrently with `check`, which is a child
 * process on its own Chrome, and finishes first. Measured, three runs each:
 * `verify --no-fidelity` 5.66 / 5.77 / 5.75s, `verify` 5.61 / 5.64 / 5.66s. So
 * the marginal wall cost is zero and the difference is noise, which was NOT the
 * expected answer — the estimate before measuring was +7%. `npm run score` on the
 * demo moves 5.81s to 6.32s, and that is a cold cache. A gate too slow to run is
 * a gate nobody runs; this one costs nothing, so it runs by default.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DECK_PAGE } from "../emit/composition.js";
import { openDeck } from "../render/capture.js";
import { TIMING_FILE } from "../render/timing.js";
import type { Finding } from "../types.js";
import { type ApparentStop, collectApparent, gradeApparent, midpoints } from "./apparent.js";
import { collectSvgTextRuns, gradeOverprint, type Overprinted, overprints } from "./overprint.js";

/**
 * Ink at a stop, as a fraction of the WHOLE frame — not of the measured band.
 *
 * The band's top moves with the caption, so a band-relative fraction would move
 * the threshold every time a headline wrapped to another line. Normalising by
 * the frame instead makes the number an amount of ink, and tightening the band
 * can then only lower it. That is the safe direction: a stricter band cannot
 * make a blank slide pass.
 */
export const INK_FLOOR = 0.0015;

/**
 * How far from the background a pixel must be to count, per channel, of 255.
 *
 * 12 is ~5% of the range. For white-on-`ink` text that is an antialiasing blend
 * of about 5%, which is where `ink.mjs`'s luma > 26 also sat on that theme — so
 * the fringe of a glyph counts and the flat background does not, on any theme.
 */
const INK_DELTA = 12;

/** Used when the composition names no caption. `ink.mjs`'s band, kept for that case. */
const FALLBACK_BAND_TOP = 0.22;

/**
 * The caption every slide carries, which is not what the slide is ABOUT.
 *
 * `.sub` and `.bighead` are deliberately absent: on a title slide the big head
 * IS the content, and `.sub` sits BELOW it (0.943H), so including either would
 * push the band past the whole slide and fail the one archetype that is
 * legitimately nothing but type.
 */
const CAPTION = ".headline, .eyebrow";

/** One declared stop: which scene, and where on the deck timeline. */
export interface Stop {
  /** Composition id — `s1`, `s2`. */
  sid: string;
  /** Absolute seconds on the composition timeline. */
  t: number;
}

export interface Measured extends Stop {
  /** Non-background pixels below the caption, over the whole frame's pixels. */
  ink: number;
  /** Where the band began, as a fraction of frame height. Reported for triage. */
  bandTop: number;
}

export interface FidelityOptions {
  floor?: number;
  /**
   * Stops to measure. Supplied by the 015 calibration harness, whose decks are
   * not DeckSmith builds and carry neither `timing.json` nor an island; the
   * shipped path reads them off the artifact.
   */
  stops?: readonly Stop[];
  timeoutMs?: number;
}

export interface FidelityReport {
  stops: Measured[];
  /**
   * Both gates' findings — this one's `blank_at_stop` and `overprint`'s
   * `svg_text_overprint`.
   *
   * They share a report because they share a browser, a page and a seek: the
   * collision rule is one `page.evaluate` inside the loop below. Keeping it in
   * its own module and folding the findings in here is the split that costs
   * nothing — see `verify/overprint.ts` for why the rule has to exist at all.
   */
  findings: Finding[];
  elapsedMs: number;
}

/* ------------------------------------------------------------------ decoding */

export interface Frame {
  width: number;
  height: number;
  /** 3 for RGB, 4 for RGBA. */
  channels: number;
  pixels: Uint8Array;
}

/**
 * Chrome's screenshot PNG, unpacked.
 *
 * Written out rather than taken from a dependency because `fflate` already ships
 * for the pack format and supplies the only hard part; what is left is one
 * chunk walk and one unfilter. `ffmpeg` would also do it, but `verify` does not
 * otherwise need ffmpeg and a gate that needs a second binary is a gate that
 * gets skipped on the machine that lacks it.
 */
export async function decodePng(png: Uint8Array): Promise<Frame> {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let at = 8;
  let header: { w: number; h: number; depth: number; color: number; interlace: number } | null =
    null;
  const idat: Buffer[] = [];
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR")
      header = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8] as number,
        color: data[9] as number,
        interlace: data[12] as number,
      };
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  if (!header) throw new Error("PNG has no IHDR");
  const channels = header.color === 6 ? 4 : header.color === 2 ? 3 : 0;
  // Chrome emits 8-bit non-interlaced RGB/RGBA. Anything else is a different
  // capture path than the one this was measured against, so refuse it rather
  // than guess: a wrong decode would read as an empty frame and fail a good deck.
  if (header.depth !== 8 || header.interlace !== 0 || channels === 0)
    throw new Error(
      `unsupported PNG (depth ${header.depth}, colour type ${header.color}, interlace ${header.interlace})`,
    );
  const { unzlibSync } = await import("fflate");
  const raw = unzlibSync(new Uint8Array(Buffer.concat(idat)));
  const { w, h } = header;
  const stride = w * channels;
  const pixels = new Uint8Array(stride * h);
  let src = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[src++] as number;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] as number;
      const a = x >= channels ? (pixels[row + x - channels] as number) : 0;
      const b = y > 0 ? (pixels[up + x] as number) : 0;
      const c = x >= channels && y > 0 ? (pixels[up + x - channels] as number) : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`PNG row ${y} has filter type ${filter}`);
      }
      pixels[row + x] = out & 0xff;
    }
    src += stride;
  }
  return { width: w, height: h, channels, pixels };
}

/**
 * The frame's background colour, as the mean of its modal 5-bit bucket.
 *
 * Quantising to 5 bits per channel costs one 32K histogram instead of a 16M one
 * and cannot pick the wrong colour here: the background holds 80–98% of every
 * frame this was measured on, so its bucket wins by orders of magnitude. The
 * mean inside the bucket recovers the exact value, which matters because the
 * threshold is only 12 wide.
 */
function background(frame: Frame): [number, number, number] {
  const { pixels, channels } = frame;
  const hist = new Uint32Array(1 << 15);
  const bucket = (i: number) =>
    (((pixels[i] as number) >> 3) << 10) |
    (((pixels[i + 1] as number) >> 3) << 5) |
    ((pixels[i + 2] as number) >> 3);
  for (let i = 0; i < pixels.length; i += channels)
    hist[bucket(i)] = (hist[bucket(i)] as number) + 1;
  let best = 0;
  for (let i = 1; i < hist.length; i++) if ((hist[i] as number) > (hist[best] as number)) best = i;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    if (bucket(i) !== best) continue;
    r += pixels[i] as number;
    g += pixels[i + 1] as number;
    b += pixels[i + 2] as number;
    n++;
  }
  return [r / n, g / n, b / n];
}

/**
 * Non-background pixels from `bandTopPx` down, over the whole frame's pixels.
 *
 * Pure and exported so the measurement can be tested without a browser — and so
 * that "what this counts" is a thing someone can read in twenty lines rather
 * than infer from a gate's verdict. It counts PIXELS. It does not read a
 * bounding box, and it does not ask the DOM whether an element is visible; both
 * of those have been wrong in this project inside the last week.
 */
export function inkBelow(frame: Frame, bandTopPx: number): number {
  const [br, bg, bb] = background(frame);
  const { width, height, channels, pixels } = frame;
  let ink = 0;
  for (let y = Math.max(0, Math.round(bandTopPx)); y < height; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      const i = row + x * channels;
      const d = Math.max(
        Math.abs((pixels[i] as number) - br),
        Math.abs((pixels[i + 1] as number) - bg),
        Math.abs((pixels[i + 2] as number) - bb),
      );
      if (d > INK_DELTA) ink++;
    }
  }
  return ink / (width * height);
}

/* -------------------------------------------------------------------- stops */

/**
 * The stops a built deck declares, from `timing.json` if it is there and the
 * slideshow island if it is not.
 *
 * `timing.json` is preferred because it exists for every format — `short-9x16`
 * emits no navigable page and so no island — and because it names the scene each
 * stop belongs to, which is what makes a finding aimable. Its `holds` are
 * SCENE-RELATIVE and its `scenes[].start` absolute; the island's `fragments` are
 * already absolute. (`TimedScene.holds`' doc comment in `src/render/timing.ts`
 * says "absolute" and is stale — `framePlan` adds `scene.start` at line 265, and
 * line 370 says so outright.)
 */
export function readStops(timing: string | null, deckPage: string | null): Stop[] {
  if (timing) {
    try {
      const parsed = JSON.parse(timing) as {
        scenes?: Array<{ id?: unknown; start?: unknown; holds?: unknown }>;
      };
      const stops: Stop[] = [];
      for (const scene of parsed.scenes ?? []) {
        if (typeof scene.id !== "string" || typeof scene.start !== "number") continue;
        for (const hold of Array.isArray(scene.holds) ? scene.holds : []) {
          if (typeof hold === "number" && Number.isFinite(hold))
            stops.push({ sid: scene.id, t: Math.round((scene.start + hold) * 1000) / 1000 });
        }
      }
      if (stops.length > 0) return stops;
    } catch {
      // Fall through to the island: an unreadable timing.json is not a reason to
      // measure nothing, and `check` already owns "this deck is malformed".
    }
  }
  if (!deckPage) return [];
  const island =
    /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/.exec(
      deckPage,
    )?.[1];
  if (!island) return [];
  try {
    const parsed = JSON.parse(island) as {
      slides?: Array<{ sceneId?: unknown; fragments?: unknown }>;
    };
    return (parsed.slides ?? []).flatMap((slide) =>
      (Array.isArray(slide.fragments) ? slide.fragments : [])
        .filter((t): t is number => typeof t === "number" && Number.isFinite(t))
        .map((t) => ({ sid: typeof slide.sceneId === "string" ? slide.sceneId : "?", t })),
    );
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------- grading */

/**
 * Findings for the stops whose body drew nothing.
 *
 * One finding per SCENE rather than per stop. The failure is a scene whose
 * content never arrives, and vocab-16 has five such stops in one scene — five
 * lines saying the same thing is how a report becomes wallpaper. The worst stop
 * is named because that is the frame to open.
 */
export function gradeFidelity(rows: readonly Measured[], floor = INK_FLOOR): Finding[] {
  const blank = new Map<string, Measured[]>();
  for (const row of rows) {
    if (row.ink >= floor) continue;
    const seen = blank.get(row.sid);
    if (seen) seen.push(row);
    else blank.set(row.sid, [row]);
  }
  const pct = (v: number) => `${(100 * v).toFixed(3)}%`;
  return [...blank].map(([sid, stops]) => {
    const worst = stops.reduce((a, b) => (a.ink <= b.ink ? a : b));
    return {
      severity: "error" as const,
      gate: "fidelity",
      rule: "blank_at_stop",
      // `#${sid}`, so the scene can be found the same way every other finding in
      // this project names one — and so a reader of the report can attribute it.
      // See the same note in `overprint.ts`: written bare, a finding is a
      // sentence about a scene nothing downstream can identify.
      message:
        `#${sid} stops ${stops.length === 1 ? "" : `${stops.length}x `}with nothing below its caption: ` +
        `${pct(worst.ink)} of the frame is ink at t=${worst.t}s (floor ${pct(floor)}, ` +
        `about one 40px label), so the audience is looking at a headline over an empty stage. ` +
        `Times: ${stops.map((s) => `${s.t}s`).join(", ")}.`,
    };
  });
}

/** Serialised into the page: the bottom of this scene's caption, in device px. */
function captionBottom(sid: string, selector: string, fallbackPx: number): number {
  const scene = document.querySelector(`[data-composition-id="${CSS.escape(sid)}"]`);
  let bottom = 0;
  for (const el of Array.from(scene?.querySelectorAll(selector) ?? [])) {
    const box = el.getBoundingClientRect();
    if (box.height > 0) bottom = Math.max(bottom, box.bottom);
  }
  return bottom > 0 ? bottom : fallbackPx;
}

/**
 * Seek every declared stop and count the ink below its caption.
 *
 * Never throws for an environmental reason: a machine that cannot open a browser
 * gets a WARNING saying the gate did not run, because "the instrument is
 * missing" and "the deck is blank" are different claims and only the second is
 * the deck's fault. A stop that *was* measured and came up empty is an error.
 */
export async function fidelity(dir: string, opts: FidelityOptions = {}): Promise<FidelityReport> {
  const started = Date.now();
  const floor = opts.floor ?? INK_FLOOR;
  const notMeasured = (why: string): FidelityReport => ({
    stops: [],
    findings: [
      {
        severity: "warning",
        gate: "fidelity",
        rule: "not_measured",
        message: `did not check whether each stop draws anything: ${why}`,
      },
    ],
    elapsedMs: Date.now() - started,
  });

  const stops =
    opts.stops ??
    readStops(
      await readFile(join(dir, TIMING_FILE), "utf8").catch(() => null),
      await readFile(join(dir, DECK_PAGE), "utf8").catch(() => null),
    );
  if (stops.length === 0) return notMeasured("the deck declares no stops");

  let deck: Awaited<ReturnType<typeof openDeck>> | null = null;
  try {
    // The capture path itself lives in `../render/capture.js`, shared with the
    // `frames` verb, so a person looking at a PNG and this gate are looking at
    // the same three calls. What stays here is only the arithmetic over them.
    deck = await openDeck(dir, { timeoutMs: opts.timeoutMs });
    const { page, height } = deck;
    const measured: Measured[] = [];
    const collided: Overprinted[] = [];
    const apparent: ApparentStop[] = [];
    for (const stop of stops) {
      await deck.seek(stop.t);
      const bandTopPx = await page.evaluate(
        captionBottom,
        stop.sid,
        CAPTION,
        FALLBACK_BAND_TOP * height,
      );
      // The frame is already seeked and already settled, so the collision rule
      // is one more DOM read on the same page. The pairwise arithmetic stays in
      // Node, where it can be tested without a browser.
      collided.push({
        ...stop,
        pairs: overprints(await page.evaluate(collectSvgTextRuns, stop.sid)),
      });
      // One more read on the frame that is already seeked and settled: how big
      // the glyphs actually came out. `typefloor` reads the source and says in
      // its own header that it cannot see this.
      apparent.push({
        ...stop,
        settled: true,
        ...(await page.evaluate(collectApparent, stop.sid)),
      });
      const frame = await decodePng(await deck.shoot());
      measured.push({
        ...stop,
        ink: inkBelow(frame, bandTopPx),
        bandTop: Math.round((1000 * bandTopPx) / height) / 1000,
      });
    }
    // A second pass between the stops, for the apparent floor only. No screenshot
    // and no ink arithmetic — a seek and one DOM read — which is what makes
    // doubling the sample count affordable.
    for (const mid of midpoints(stops)) {
      await deck.seek(mid.t);
      apparent.push({ ...mid, settled: false, ...(await page.evaluate(collectApparent, mid.sid)) });
    }

    return {
      stops: measured,
      findings: [
        ...gradeFidelity(measured, floor),
        ...gradeOverprint(collided),
        ...gradeApparent(apparent),
      ],
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return notMeasured(err instanceof Error ? err.message : String(err));
  } finally {
    await deck?.close().catch(() => {});
  }
}

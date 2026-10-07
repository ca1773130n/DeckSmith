/**
 * `--design v2` in the renderer's own browser: the demo built with the
 * Director's looks, and the gates that read pixels run over it.
 *
 * WHY THIS IS A BROWSER TEST. The first v2 build of a real paper passed every
 * unit test here and FAILED its own fidelity gate seven times: `blank_at_stop`
 * measured ink below the headline, and under a `foot` headline there is nothing
 * by design, while beside a `rail` the body is to the right, not below. Only a
 * frame shows that.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath } from "../src/render/capture.js";
import { fidelity } from "../src/verify/fidelity.js";

const run = promisify(execFile);
const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const chrome = await chromePath("build a v2 deck with").catch(() => null);

describe.skipIf(chrome === null)("a --design v2 deck, measured in the browser", () => {
  let dir = "";
  let out = "";
  let looks: { beats: { signature: string; placement: string }[] };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-look-"));
    out = join(dir, "deck");
    await run(process.execPath, [
      repo("dist/cli.js"),
      "build",
      repo("demo/storyboard.json"),
      "--source",
      repo("demo/source.json"),
      "-o",
      out,
      "--design",
      "v2",
      // Pinned: under v2 an unnamed theme picks a style pack (and `ink`, the
      // default, reads as unnamed), and the pack's chrome scale moves which looks
      // the Director prefers — under blueprint the demo has no rail slide. This
      // test is about rail and foot slides in the browser, not which pack won.
      "--theme",
      "signal",
      "--no-fidelity",
    ]).catch((err: { stderr?: string }) => {
      throw new Error(`build failed: ${err.stderr ?? err}`);
    });
    looks = JSON.parse(await readFile(join(out, "look.json"), "utf8"));
  }, 180_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes the Director's decisions beside the deck, with rail and foot slides in it", () => {
    const placements = new Set(looks.beats.map((b) => b.placement));
    expect(placements.has("rail")).toBe(true);
    expect(placements.has("foot")).toBe(true);
  });

  it("finds a body at every stop, wherever the headline went", async () => {
    const report = await fidelity(out);
    expect(report.stops.length).toBeGreaterThan(0);
    expect(report.findings.filter((f) => f.rule === "blank_at_stop")).toEqual([]);
    expect(report.findings.filter((f) => f.rule === "not_measured")).toEqual([]);
  }, 180_000);

  it.each(["signal", "blueprint"])(
    "still catches a stop with nothing on it over %s's painted ground",
    async (pack) => {
      // Review 2026-10-08: against the frame's modal colour, signal's glow and
      // blueprint's grid read as 4.42% and 2.40% ink with every scene hidden —
      // 29x and 16x the floor — so a stop whose content never arrived passed.
      const deck = join(dir, `blank-${pack}`);
      await run(process.execPath, [
        repo("dist/cli.js"),
        "build",
        repo("demo/storyboard.json"),
        "--source",
        repo("demo/source.json"),
        "-o",
        deck,
        "--design",
        "v2",
        "--theme",
        pack,
        "--no-fidelity",
      ]);
      // Every part of one scene's body goes; its chrome stays.
      const index = join(deck, "index.html");
      const keep = ".eyebrow,.headline,.lk-head,.lk-foot,.lk-rail,.lk-main,.lk-body";
      const hide = `<style>#s3 *:not(${keep}){opacity:0!important}</style>`;
      await writeFile(index, (await readFile(index, "utf8")).replace("</head>", `${hide}</head>`));
      const report = await fidelity(deck);
      const blank = report.findings.filter((f) => f.rule === "blank_at_stop");
      expect(blank.map((f) => f.message.slice(0, 4))).toEqual(["#s3 "]);
    },
    240_000,
  );
});

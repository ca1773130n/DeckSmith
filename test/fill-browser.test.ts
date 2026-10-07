/**
 * THE FIT ENGINE'S PREDICTIONS, held against the renderer's own browser.
 *
 * `test/fit.test.ts` pins what each archetype PREDICTS; this builds the demo —
 * all thirteen archetypes — with `--design v2` and lets `fidelity` measure the
 * same ratio on the frames. Agreement is the claim the fill gate exists to
 * check on every v2 build, so it is checked here on the one deck every change
 * to the vocabulary is built against.
 *
 * Skipped without Chrome, exactly as test/math-fit.test.ts is: CI installs no
 * browser, so this runs on the machine of whoever is about to believe it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIT_FILE, type FitManifest } from "../src/emit/fit.js";
import { chromePath } from "../src/render/capture.js";
import { type FidelityReport, fidelity } from "../src/verify/fidelity.js";
import { FILL_TOLERANCE } from "../src/verify/fill.js";

const run = promisify(execFile);
const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const chrome = await chromePath("measure fill with").catch(() => null);

describe.skipIf(chrome === null)("v2 fill, predicted and measured on the demo", () => {
  let dir = "";
  let out = "";
  let manifest: FitManifest;
  let report: FidelityReport;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-fill-"));
    out = join(dir, "deck");
    const said = await run(process.execPath, [
      repo("dist/cli.js"),
      "build",
      repo("demo/storyboard.json"),
      "--source",
      repo("demo/source.json"),
      "-o",
      out,
      "--design",
      "v2",
      "--no-fidelity",
    ]).then(
      (r) => r.stderr,
      (err: { stderr?: string }) => err.stderr ?? "",
    );
    expect(said).toMatch(/design v2/);
    manifest = JSON.parse(await readFile(join(out, FIT_FILE), "utf8")) as FitManifest;
    report = await fidelity(out);
  }, 300_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes a v2 manifest naming every drawn scene", () => {
    expect(manifest.design).toBe("v2");
    expect(manifest.scenes.length).toBeGreaterThan(10);
    expect(report.fills.map((f) => f.sid).sort()).toEqual(manifest.scenes.map((s) => s.id).sort());
  });

  it("measures every prediction within the tolerance the gate allows", () => {
    const fills = new Map(report.fills.map((f) => [f.sid, f.fill]));
    const off = manifest.scenes
      .filter((s) => s.fit !== undefined)
      .map((s) => ({
        sid: s.id,
        archetype: s.archetype,
        predicted: s.fit?.fill,
        measured: fills.get(s.id),
      }))
      .filter((r) => Math.abs((r.predicted ?? 0) - (r.measured ?? 0)) > FILL_TOLERANCE);
    expect(off).toEqual([]);
    expect(report.findings.filter((f) => f.rule === "fill_model_disagrees")).toEqual([]);
  });

  it("paints no grown body through the bottom of its region", () => {
    expect(report.fills.filter((f) => f.fill > 1.02)).toEqual([]);
  });
});

/**
 * The MCP surface, checked without a model, a browser or a network.
 *
 * `deckTools` returns plain functions on purpose: the protocol is `main.ts`'s
 * business, and everything worth checking — what a setting does, what is
 * refused, what an agent is handed back — is here.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { deckTools, settingsSchema } from "../src/mcp/tools.js";
import { parseOptions } from "../src/server/options.js";

const work = () => mkdtemp(join(tmpdir(), "ds-mcp-"));
const tools = async () => deckTools({ root: await work(), work: await work() });

/**
 * What the machine has, stated rather than probed.
 *
 * Every test here is about the MCP surface, not about this laptop. Left to the
 * real probe, three of them passed only where Codex happened to be installed
 * and failed on a runner that has none — which is how a suite goes green for a
 * reason that has nothing to do with the code.
 */
function installed(...absent: string[]) {
  const all = ["codex", "edge-tts", "ffmpeg"].map((name) => ({
    name,
    ok: !absent.includes(name),
    neededFor: "plan",
    install: `install ${name}`,
  }));
  return async () => all;
}

describe("the settings schema", () => {
  /**
   * THE ONE THAT PROTECTS `stated`. `JobOptions.stated` is derived from which
   * keys arrived, so a default here is indistinguishable from a choice and the
   * storyboard's own theme and the document's own language both lose to it
   * silently. The symptom is a Korean paper narrated in English.
   */
  it("gives no field a default, so absent still means unstated", () => {
    const parsed = settingsSchema.parse({});
    expect(Object.keys(parsed)).toEqual([]);
    for (const key of Object.keys(settingsSchema.shape)) {
      expect(settingsSchema.parse({}), `${key} defaulted`).not.toHaveProperty(key);
    }
  });

  it("refuses a value the pipeline would refuse later", () => {
    expect(() => settingsSchema.parse({ duration: 5 })).toThrow();
    expect(() => settingsSchema.parse({ slides: 99 })).toThrow();
    expect(() => settingsSchema.parse({ rate: "fast" })).toThrow();
    expect(() => settingsSchema.parse({ theme: "neon" })).toThrow();
  });

  /**
   * EVERY ADVERTISED FIELD REACHES `parseOptions`. Two of them did not — `rate`
   * and `pitch` sat in `prefsSchema` and the server's parser never read them, so
   * a caller setting either got the default with no error and no warning. This
   * closes the whole class, including the next field somebody adds.
   */
  it("carries every field it advertises through to the preferences", () => {
    const samples: Record<string, unknown> = {
      format: "short-9x16",
      theme: "paper",
      lang: "ko",
      tone: "punchy",
      density: "dense",
      duration: 90,
      slides: 20,
      animation_speed: 0.5,
      narrate: true,
      voice: "en-US-AndrewMultilingualNeural",
      rate: "+20%",
      pitch: "-5Hz",
      narration_density: "medium",
      video: true,
    };
    const base = JSON.stringify(parseOptions({}));
    for (const [key, value] of Object.entries(samples)) {
      const settings = settingsSchema.parse({ [key]: value });
      // Same mapping the tool uses, exercised through the real parser.
      const fields: Record<string, string> = {};
      const map: Record<string, string> = {
        animation_speed: "speed",
        narration_density: "narrationDensity",
      };
      for (const [k, v] of Object.entries(settings)) fields[map[k] ?? k] = String(v);
      expect(JSON.stringify(parseOptions(fields)), `${key} was swallowed`).not.toBe(base);
    }
  });
});

describe("decksmith_estimate_length", () => {
  /**
   * The warnings are the product telling the author what the settings cost. An
   * MCP that swallowed them would ship the exact failure this project keeps
   * having: a green result over a deck nobody wanted.
   */
  it("hands back what a short target costs, warnings included", async () => {
    const t = await tools();
    const out = t.estimate({ settings: { duration: 60, narration_density: "low" } });
    expect(out.slides).toBe(12);
    expect(out.narration_rate).not.toBe("+0%");
    expect(out.characters_per_slide).toBeGreaterThan(0);
    expect(out.warnings.join(" ")).toContain("characters per second");
  });

  it("derives the slide count from the duration, and obeys a stated one", async () => {
    const t = await tools();
    expect(t.estimate({ settings: { duration: 600 } }).slides).toBe(30);
    expect(t.estimate({ settings: { duration: 600, slides: 12 } }).slides).toBe(12);
  });
});

describe("decksmith_create_deck", () => {
  it("refuses a document outside its root", async () => {
    const t = await tools();
    await expect(t.create({ document_path: "/etc/passwd" })).rejects.toThrow(/outside/);
  });

  it("refuses a relative path, which no fence can resolve safely", async () => {
    const t = await tools();
    await expect(t.create({ document_path: "../../etc/passwd" })).rejects.toThrow(/absolute/);
  });

  it("insists on exactly one of path and text", async () => {
    const t = await tools();
    await expect(t.create({})).rejects.toThrow(/exactly one/);
    await expect(t.create({ document_path: "/a.md", document_text: "x" })).rejects.toThrow(
      /exactly one/,
    );
  });

  /**
   * THE ONE THAT KEEPS THE FENCE IN FRONT. The prereq probe used to run first,
   * so on a machine without Codex `/etc/passwd` was answered with "codex is not
   * installed" — the refusal that matters buried under a message about somebody's
   * toolchain, and the two tests above passing for the wrong reason wherever
   * Codex happened to exist.
   */
  it("refuses a path outside the root before it looks at what is installed", async () => {
    const t = deckTools({ root: await work(), work: await work(), probe: installed("codex") });
    await expect(t.create({ document_path: "/etc/passwd" })).rejects.toThrow(/outside/);
    await expect(t.create({ document_path: "../../etc/passwd" })).rejects.toThrow(/absolute/);
    // …and the probe still speaks for a request the fence has nothing to say about.
    await expect(t.create({ document_text: "# x" })).rejects.toThrow(/codex is not installed/);
  });
});

describe("decksmith_job_status", () => {
  it("says so plainly when the job is not there", async () => {
    const t = await tools();
    await expect(t.status({ job_id: "nope" })).rejects.toThrow(/No job/);
  });

  /**
   * THE PATH THE AGENT IS TOLD TO READ. It pointed at `<dir>/src/storyboard.json`
   * for one end-to-end run — the CLI's output shape, not the server's — so the
   * one file the whole seam exists to hand over was not where the report said.
   * Pinned against `runPipeline`'s own `join(job.dir, "storyboard.json")`.
   */
  it("reports the storyboard where the pipeline writes it", async () => {
    const dir = await work();
    const t = deckTools({ root: dir, work: dir, probe: installed() });
    const out = await t.create({ document_text: "# x", settings: {}, wait_seconds: 0 });
    expect(out.storyboard_path.endsWith(`${sep}storyboard.json`)).toBe(true);
    expect(out.storyboard_path).toContain(out.job_id);
  });
});

/**
 * The gate and the renderer must be the same browser.
 *
 * `frames` and the `fidelity` gate exist so a human can look at the frame the
 * renderer would produce. For months they opened a DIFFERENT browser: puppeteer's
 * cached shell (145 on the machine where this was found) against the renderer's
 * hyperframes shell (152), justified by a comment saying that for a screenshot of
 * a static page the two render identically.
 *
 * For a DOM deck that was true, which is why nobody noticed. For a WebGL canvas
 * 145 refuses a context and 152 grants one, so the gate scored a mesh deck with
 * the mesh missing — a clean, plausible, entirely empty frame, all green. It was
 * caught by opening the PNG.
 *
 * These are source-reading assertions for the ordering and the launch arguments,
 * because `openDeck` needs a browser and a built deck and this suite has neither.
 * That is a weaker instrument than running it and it is recorded as such: it
 * catches the order being swapped or an argument being dropped, not a behavioural
 * regression underneath them. The env-var case below is real, and is the one that
 * makes the two provably the same binary.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveChrome } from "../src/render/capture.js";

const source = async () =>
  await readFile(fileURLToPath(new URL("../src/render/capture.ts", import.meta.url)), "utf8");

describe("which Chrome the capture path opens", () => {
  it("takes the variable the renderer itself honours, before anything else", async () => {
    const saved = {
      hf: process.env.HYPERFRAMES_BROWSER_PATH,
      ds: process.env.DECKSMITH_CHROME,
    };
    try {
      // Both set, pointing at different binaries: the renderer's wins, because
      // matching it is the whole point.
      process.env.HYPERFRAMES_BROWSER_PATH = "/renderers/own/chrome";
      process.env.DECKSMITH_CHROME = "/somebody/elses/chrome";
      expect(await resolveChrome()).toEqual({ path: "/renderers/own/chrome", source: "env" });
    } finally {
      if (saved.hf === undefined) delete process.env.HYPERFRAMES_BROWSER_PATH;
      else process.env.HYPERFRAMES_BROWSER_PATH = saved.hf;
      if (saved.ds === undefined) delete process.env.DECKSMITH_CHROME;
      else process.env.DECKSMITH_CHROME = saved.ds;
    }
  });

  it("looks in hyperframes' cache before puppeteer's, which is the bug", async () => {
    const s = await source();
    const hf = s.indexOf('"hyperframes", "chrome"');
    const pup = s.indexOf("PUPPETEER_CACHE_DIR");
    expect(hf, "the hyperframes cache lookup is gone").toBeGreaterThan(-1);
    expect(pup, "the puppeteer cache lookup is gone").toBeGreaterThan(-1);
    expect(hf, "puppeteer's cache is consulted first again — that is the defect").toBeLessThan(pup);
  });

  it("asks for a GL context, because without one a canvas screenshots empty", async () => {
    const s = await source();
    for (const flag of [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ]) {
      expect(s, `${flag} is no longer passed; a WebGL deck will capture blank`).toContain(flag);
    }
  });

  it("refuses a canvas it cannot draw rather than screenshotting the background", async () => {
    const s = await source();
    // The guard, not merely the flags: flags can silently stop working, and a
    // blank frame that passes is the failure this file is named after.
    expect(s).toMatch(/cannot create a WebGL\s*` \+/);
    expect(s).toContain('querySelector("canvas")');
    expect(s).toContain('getContext("webgl2")');
  });
});

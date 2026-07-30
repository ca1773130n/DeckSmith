import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS, resolveProvider, type SpeechProvider, synthesize } from "../src/narrate/tts.js";

/**
 * A provider that is nothing like edge-tts: no subprocess, no SRT file, timings
 * it made up. If this can drive `synthesize`, the seam is real — the point of
 * the exercise is that a hosted API returning JSON word timings should not have
 * to fabricate a subtitle file on disk to be usable here.
 */
function fake(): { provider: SpeechProvider; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      id: "fake",
      async check() {},
      async speak(req) {
        calls.push(req.text);
        await writeFile(req.audio, "not really an mp3");
        return {
          seconds: 2.5,
          cues: [{ start: 0.1, end: 2.4, text: req.text }],
        };
      },
    },
  };
}

describe("SpeechProvider", () => {
  it("drives synthesize with no subprocess, no SRT and no ffmpeg", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ds-prov-"));
    const { provider, calls } = fake();
    const out = await synthesize("A sentence to say.", { voice: "v", dir, provider });

    expect(calls).toEqual(["A sentence to say."]);
    expect(out.seconds).toBe(2.5);
    expect(out.cues).toEqual([{ start: 0.1, end: 2.4, text: "A sentence to say." }]);
    expect(await readFile(out.audio, "utf8")).toBe("not really an mp3");
  });

  it("caches by content, so a second provider call never happens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ds-prov-"));
    const { provider, calls } = fake();
    await synthesize("Same words.", { voice: "v", dir, provider });
    await synthesize("Same words.", { voice: "v", dir, provider });
    expect(calls).toHaveLength(1);
  });

  it("names edge-tts as the default and lists what else is registered", () => {
    expect(resolveProvider().id).toBe("edge-tts");
    expect(Object.keys(PROVIDERS)).toContain("edge-tts");
  });

  it("refuses an unknown provider by name, and says what is available", () => {
    expect(() => resolveProvider("elevenlabs")).toThrow(
      /Unknown speech provider "elevenlabs".*edge-tts/s,
    );
  });
});

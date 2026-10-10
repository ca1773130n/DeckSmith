/**
 * Round 6's depth (src/bespoke/depth.ts): where a backdrop is cut into planes,
 * how far each plane and each subject is put, and — because both models are
 * optional — that a machine without them still gets planes, flat ones, with
 * the reason said.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CUT_QUANTILES,
  cutPicture,
  DEPTH_MODEL_NAME,
  depthCuts,
  depthModel,
  FLAT_Z,
  footDepths,
  MIN_SEPARATION,
  REF_BEHIND,
  referenceDepth,
  SUBJECT_Z,
  subjectZ,
  upscaler,
  Z_FAR,
  Z_NEAR,
  zOf,
} from "../src/bespoke/depth.js";
import { chromePath } from "../src/render/capture.js";
import { testPng } from "./fixtures/png.js";

describe("cutting a backdrop by depth", () => {
  it("cuts at the depth quantiles, and not where two planes would move alike", () => {
    // A ramp from far (0) to near (255): the cuts land on its quantiles.
    const ramp = Array.from({ length: 1000 }, (_, i) => Math.round((255 * i) / 999));
    const cuts = depthCuts(ramp);
    expect(cuts).toHaveLength(CUT_QUANTILES.length);
    expect(cuts[0]).toBeCloseTo(CUT_QUANTILES[0], 1);
    expect(cuts[1]).toBeCloseTo(CUT_QUANTILES[1], 1);
    // A flat picture has no depth to cut.
    expect(depthCuts(new Array(500).fill(128))).toEqual([]);
    // Two values close together: at most one cut, never two planes that move alike.
    const two = depthCuts([...new Array(500).fill(100), ...new Array(500).fill(120)]);
    expect(two.length).toBeLessThanOrEqual(1);
    for (let i = 1; i < cuts.length; i++)
      expect((cuts[i] as number) - (cuts[i - 1] as number)).toBeGreaterThanOrEqual(MIN_SEPARATION);
    expect(depthCuts([])).toEqual([]);
  });

  it("puts the subjects' plane at 1, farther planes beyond it, nearer ones in front, within bounds", () => {
    expect(zOf(0.4, 0.4)).toBe(1);
    expect(zOf(0.1, 0.4)).toBeGreaterThan(1);
    expect(zOf(0.9, 0.4)).toBeLessThan(1);
    for (const u of [0, 0.2, 0.5, 1]) {
      expect(zOf(u, 0.5)).toBeGreaterThanOrEqual(Z_NEAR);
      expect(zOf(u, 0.5)).toBeLessThanOrEqual(Z_FAR);
    }
    // Subjects are held near the camera's plane: their boxes are its targets.
    expect(subjectZ(0, 0.9)).toBe(SUBJECT_Z[1]);
    expect(subjectZ(1, 0)).toBe(SUBJECT_Z[0]);
  });

  it("keeps the subjects IN the scene: always nearer than its farthest plane, so the backdrop moves less", () => {
    // Feet that read farther than every band (a subject drawn high on the far wall).
    const bands = [0.3, 0.55, 0.85];
    const u = referenceDepth([0.1, 0.12, 0.2], bands);
    expect(u).toBeCloseTo(0.3 + REF_BEHIND, 5);
    expect(zOf(bands[0] as number, u)).toBeGreaterThan(1);
    // Feet in the middle of the scene are taken as they are; feet past the nearest band are held to it.
    expect(referenceDepth([0.6, 0.62, 0.7], bands)).toBe(0.62);
    expect(referenceDepth([0.95, 0.99], bands)).toBe(0.85);
    // No bands (a flat picture): the feet alone.
    expect(referenceDepth([0.4], [])).toBe(0.4);
  });

  it("never puts a plane nearer than 0.8 (a 1.6x push would swing it past 1.9x)", () => {
    expect(Z_NEAR).toBeGreaterThanOrEqual(0.8);
  });

  it("reads each subject's depth where its foot meets the floor", () => {
    // A 10x10 depth map: far at the top, near at the bottom.
    const w = 10;
    const h = 10;
    const map = Array.from({ length: w * h }, (_, i) =>
      Math.round((255 * Math.floor(i / w)) / (h - 1)),
    );
    const [high, low] = footDepths(map, w, h, [
      [0.2, 0.1, 0.2, 0.3],
      [0.6, 0.4, 0.2, 0.55],
    ]);
    expect(high).toBeLessThan(low as number);
    expect(low).toBeGreaterThan(0.8);
  });
});

describe("the optional models", () => {
  const nowhere = { HOME: "/nonexistent-home", DECKSMITH_CACHE_DIR: "/nonexistent-cache" };

  it("says why there is no depth model: off macOS, or not on disk", async () => {
    expect(await depthModel(nowhere, "linux")).toEqual({ reason: "no Core ML off macOS" });
    const missing = await depthModel(nowhere, "darwin");
    expect("reason" in missing && missing.reason).toContain(DEPTH_MODEL_NAME);
  });

  it("says why there is no upscaler", async () => {
    const up = await upscaler(nowhere);
    expect("reason" in up && up.reason).toMatch(/no upscaler at/);
  });
});

const chrome = await chromePath("cut a picture with").catch(() => null);

describe.skipIf(chrome === null)("a picture cut without the models", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("falls back to the flat picture: one backdrop plane, the subjects at the camera's plane, and why", async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-depth-"));
    const cut = await cutPicture({
      subjects: testPng(800, 450),
      plate: testPng(800, 450, { discs: [] }),
      boxes: [
        [0.09, 0.4, 0.32, 0.4],
        [0.43, 0.28, 0.24, 0.3],
        [0.66, 0.46, 0.28, 0.32],
      ],
      frame: { width: 1920, height: 1080 },
      work: dir,
      tag: "b1",
      toolDir: join(dir, "tools"),
      env: { HOME: dir, DECKSMITH_CACHE_DIR: join(dir, "cache") },
    });
    expect(cut.info.model).toBe("flat");
    expect(cut.info.reason).toBeTruthy();
    expect(cut.info.upscale).toBe(1);
    expect(cut.info.upscaleReason).toMatch(/no upscaler/);
    expect(cut.planes).toHaveLength(1);
    expect(cut.planes[0]?.z).toBe(FLAT_Z);
    expect(cut.planes[0]?.webp.toString("latin1", 8, 12)).toBe("WEBP");
    // Its out-of-focus twin, for the rack focus.
    expect(cut.planes[0]?.soft.toString("latin1", 8, 12)).toBe("WEBP");
    expect(cut.planes[0]?.soft.length).toBeLessThan(cut.planes[0]?.webp.length ?? 0);
    expect(cut.subjects.map((s) => s.subject)).toEqual([1, 2, 3]);
    expect(cut.subjects.every((s) => s.z === 1)).toBe(true);
    // Each subject's box is in frame px, inside the frame.
    for (const s of cut.subjects) {
      expect(s.box.x).toBeGreaterThanOrEqual(0);
      expect(s.box.x + s.box.w).toBeLessThanOrEqual(1920);
    }
    // An 800px picture covering a 1920px frame is under one picture px per frame px.
    expect(cut.scale).toBeLessThan(1);
  }, 60_000);
});

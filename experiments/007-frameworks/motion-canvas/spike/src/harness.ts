/**
 * Headless measurement harness for Motion Canvas.
 *
 * It mirrors what `Renderer.renderFrame(settings, time)` does internally
 * (reset -> seek -> stage.render) but instruments PlaybackManager.next() so we
 * can count how many generator advances a single "seek" actually costs.
 *
 * Everything here is public API surface of @motion-canvas/core 3.17.2.
 */
import {Renderer, Vector2} from '@motion-canvas/core';
import project from './project';

const FPS = 60;

const renderer = new Renderer(project);
const playback: any = (renderer as any).playback;
const stage: any = (renderer as any).stage;
const status: any = (renderer as any).status;

const settings = {
  size: new Vector2(1920, 1080),
  resolutionScale: 1,
  colorSpace: 'srgb' as const,
  background: null,
  fps: FPS,
};

// Instrument the generator advance so "seek cost" is a count, not a guess.
let advances = 0;
const originalNext = playback.next.bind(playback);
playback.next = async (...args: unknown[]) => {
  advances++;
  return originalNext(...args);
};

async function reloadScenes() {
  const scenes = playback.onScenesRecalculated.current;
  for (let i = 0; i < project.scenes.length; i++) {
    const description: any = project.scenes[i];
    const scene = scenes[i];
    scene.reload({
      config: description.onReplaced.current.config,
      size: settings.size,
      resolutionScale: settings.resolutionScale,
    });
    scene.meta.set(description.meta.get());
    scene.variables.updateSignals(project.variables ?? {});
  }
}

/** Exactly the body of Renderer.renderFrame, minus the hot-reload export. */
async function renderFrameAtTime(time: number, doReset: boolean) {
  const frame = status.secondsToFrames(time);
  stage.configure(settings);
  playback.fps = FPS;
  playback.state = 2; // PlaybackState.Rendering
  await reloadScenes();
  if (doReset) {
    await playback.reset();
  }
  advances = 0;
  const t0 = performance.now();
  await playback.seek(frame);
  const seekMs = performance.now() - t0;
  const t1 = performance.now();
  await stage.render(playback.currentScene, playback.previousScene);
  const renderMs = performance.now() - t1;
  return {time, frame, advances, seekMs, renderMs};
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function frameHash(): Promise<string> {
  const blob: Blob = await new Promise(res =>
    stage.finalBuffer.toBlob((b: Blob) => res(b), 'image/png'),
  );
  return sha256(await blob.arrayBuffer());
}

(window as any).mc = {
  /** Cold seek: reset then seek, i.e. what an exporter does per still frame. */
  async coldSeek(times: number[]) {
    const out = [];
    for (const t of times) {
      const r = await renderFrameAtTime(t, true);
      out.push({...r, hash: await frameHash()});
    }
    return out;
  },

  /**
   * Sequential forward playthrough: seek 0,1,2,... without resetting, i.e. the
   * cheap path. Shows that cost is amortised only when you never jump back.
   */
  async forwardWalk(times: number[]) {
    const out = [];
    await playback.reset();
    for (const t of times) {
      const r = await renderFrameAtTime(t, false);
      out.push(r);
    }
    return out;
  },

  /** Deck navigation: jump to a late slide, then jump BACK to an early one. */
  async backwardJump(lateTime: number, earlyTime: number) {
    await playback.reset();
    const late = await renderFrameAtTime(lateTime, false);
    const back = await renderFrameAtTime(earlyTime, false);
    return {late, back};
  },

  /** Same timestamp, repeated cold seeks: intra-process determinism. */
  async repeatHash(time: number, n: number) {
    const hashes = [];
    for (let i = 0; i < n; i++) {
      await renderFrameAtTime(time, true);
      hashes.push(await frameHash());
    }
    return hashes;
  },

  /**
   * Best case: scenes stay CACHED (no reload between frames), so seek() can
   * use findBestScene and reset only the scene it lands in. This is NOT what
   * Renderer.renderFrame does — it reloads every call, invalidating the cache.
   */
  async cachedSeek(times: number[]) {
    playback.fps = FPS;
    stage.configure(settings);
    await reloadScenes();
    await playback.recalculate();
    const out = [];
    for (const t of times) {
      const frame = status.secondsToFrames(t);
      await playback.reset();
      advances = 0;
      const t0 = performance.now();
      await playback.seek(frame);
      const seekMs = performance.now() - t0;
      out.push({time: t, frame, advances, seekMs});
    }
    return out;
  },

  async ready() {
    playback.fps = FPS;
    stage.configure(settings);
    await reloadScenes();
    await playback.recalculate();
    await renderFrameAtTime(0, true);
    return {
      duration: playback.duration,
      fps: FPS,
      sceneCount: project.scenes.length,
      scenes: playback.onScenesRecalculated.current.map((s: any) => ({
        name: s.name,
        first: s.firstFrame,
        last: s.lastFrame,
      })),
    };
  },
};

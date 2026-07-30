/**
 * The seam. Everything above this file is R3F/Theatre; everything below it is
 * what HyperFrames already knows how to drive.
 *
 * The contract was not read off a README — it was read out of
 * node_modules/hyperframes/dist/hyperframe-runtime.js. The runtime seeks a
 * registered timeline with, in order of preference:
 *
 *     obj.pause()
 *     obj.totalTime(seconds, suppressEvents)   // else obj.seek(seconds, ...)
 *
 * and measures it with `obj.duration()`. That is the entire duck type. Anything
 * satisfying it can be registered at window.__timelines[sid], which is why a
 * Theatre sequence can be adapted in about fifteen lines.
 */
import { createRoot } from "react-dom/client";
import { preloadFont } from "troika-three-text";
import { Scene, SEQ_LENGTH, type SceneHandle, sheet } from "./scene.js";

declare global {
  interface Window {
    __timelines: Record<string, unknown>;
    __renderReady: boolean;
    __hfTimelinesBuilding: boolean;
    __dsFrame: (t: number) => void;
  }
}

const SID = (document.currentScript as HTMLScriptElement | null)?.dataset.sid ?? "s1";

window.__timelines = window.__timelines || {};

/**
 * THE GATE. Setting `window.__renderReady = false` — which is what
 * composition.ts does for images — does not work here, because the HyperFrames
 * runtime OWNS that flag: it sets it true itself the moment a timeline is bound
 * (`window.__renderReady = true` in its init path). A composition that registers
 * its timeline synchronously is therefore declared ready while React is still
 * mounting and the WebGL canvas is still blank, and capture records the first
 * few frames black. How many is a race, so it differs between renders.
 *
 * The runtime's actual protocol for "my timelines are not built yet" is this
 * flag plus the `hf-timelines-built` event; while it is set, readiness returns
 * false and a one-shot listener re-checks when the event fires.
 *
 * This is the whole difference between "WebGL is nondeterministic under
 * HyperFrames" and "WebGL is bit-exact under HyperFrames". Measured: 3 of 360
 * frames differed without it, 0 of 360 with it.
 */
window.__hfTimelinesBuilding = true;

let handle: SceneHandle | null = null;
let last = -1;

/**
 * One frame, synchronously.
 *
 * Set the sequence position, then PULL — `obj.value` is a synchronous prism
 * read, so every useFrame callback sees the new value without waiting for
 * Theatre's own raf ticker. Then advance() runs those callbacks and issues
 * exactly one gl.render(). No requestAnimationFrame is involved anywhere.
 */
function frame(t: number): void {
  const clamped = Math.max(0, Math.min(SEQ_LENGTH, t));
  sheet.sequence.position = clamped;
  if (handle) {
    // The timestamp argument is only forwarded to useFrame's `state.clock`;
    // nothing in this scene reads it. Passing the seek time rather than
    // performance.now() keeps even that deterministic.
    handle.advance(clamped * 1000, true);
  }
  last = clamped;
}
window.__dsFrame = frame;

/** The HyperFrames-shaped adapter over a Theatre sequence. */
const adapter = {
  _theatre: sheet.sequence,
  duration(): number {
    return SEQ_LENGTH;
  },
  pause(): void {},
  play(): void {},
  timeScale(): number {
    return 1;
  },
  totalTime(t?: number): number {
    if (typeof t !== "number") return last < 0 ? 0 : last;
    frame(t);
    return t;
  },
  seek(t: number): number {
    frame(t);
    return t;
  },
  time(t?: number): number {
    return this.totalTime(t);
  },
  progress(p?: number): number {
    if (typeof p !== "number") return (last < 0 ? 0 : last) / SEQ_LENGTH;
    frame(p * SEQ_LENGTH);
    return p;
  },
};
const host = document.getElementById(`${SID}-gl`);
if (!host) throw new Error(`no host element ${SID}-gl`);

createRoot(host).render(
  <Scene
    onReady={(h) => {
      handle = h;
      // Fonts must be resident before the first captured frame or the labels
      // pop in a few frames late and two renders differ (EXPERIMENT-006's
      // failure mode, in a different costume).
      Promise.all([
        new Promise<void>((res) => preloadFont({ font: "./assets/label.ttf" }, () => res())),
        new Promise<void>((res) => preloadFont({ font: "./assets/body.ttf" }, () => res())),
      ]).then(() => {
        // Warm the shader programs at a pose that has everything visible, so no
        // frame pays a first-compile cost mid-capture. Then land on t=0 and
        // force the drawing buffer through to the compositor before declaring
        // the timeline built.
        frame(SEQ_LENGTH * 0.75);
        frame(0);
        const ctx = h.gl.getContext();
        ctx.finish();
        window.__timelines[SID] = adapter;
        window.__hfTimelinesBuilding = false;
        window.dispatchEvent(new Event("hf-timelines-built"));
      });
    }}
  />,
);

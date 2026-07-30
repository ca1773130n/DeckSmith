/**
 * The same assembling point cloud, expressed in React Three Fiber + drei, driven
 * by the same paused GSAP timeline. Written to be a fair control, not a straw
 * man: no editor, no Theatre, seeded identically, same 12,000 points.
 *
 * The one thing that cannot be kept the same is WHEN a frame is produced. R3F
 * schedules renders through requestAnimationFrame; `invalidate()` asks for a
 * frame later. For a seek-and-capture pipeline that is fatal, so the Canvas runs
 * with frameloop="never" and every state change calls `advance()`, which renders
 * synchronously. That is the R3F equivalent of calling renderer.render().
 */
import { Html } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { gauss, rng } from "../src/rng.mjs";

const PALETTE = ["#7dd3fc", "#fca5a5", "#fcd34d"];
const CENTRES = [
  [-1.7, 0.35, 0.2],
  [1.5, -0.5, -0.6],
  [0.1, 1.35, 0.9],
];
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function useCloud(seed, count) {
  return useMemo(() => {
    const next = rng(seed);
    const from = new Float32Array(count * 3);
    const to = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const k = i % 3;
      const c = CENTRES[k];
      const r = 5.5 + next() * 2.5;
      const th = next() * Math.PI * 2;
      const ph = Math.acos(2 * next() - 1);
      from[i * 3] = r * Math.sin(ph) * Math.cos(th);
      from[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.55;
      from[i * 3 + 2] = r * Math.cos(ph);
      to[i * 3] = c[0] + gauss(next) * 0.42;
      to[i * 3 + 1] = c[1] + gauss(next) * 0.42;
      to[i * 3 + 2] = c[2] + gauss(next) * 0.42;
      const t = new THREE.Color(PALETTE[k]);
      col[i * 3] = t.r;
      col[i * 3 + 1] = t.g;
      col[i * 3 + 2] = t.b;
    }
    return { from, to, col, pos: new Float32Array(count * 3) };
  }, [seed, count]);
}

function Cloud({ sid, seed, count, state }) {
  const { from, to, col, pos } = useCloud(seed, count);
  const geo = useRef();
  const { camera, advance } = useThree((s) => ({ camera: s.camera, advance: s.advance }));

  useLayoutEffect(() => {
    let frame = 0;
    const apply = () => {
      const a = smooth(Math.min(1, Math.max(0, state.assemble)));
      for (let i = 0; i < count * 3; i++) {
        const d = ((i / 3) % 97) / 97;
        const t = Math.min(1, Math.max(0, (a - d * 0.35) / 0.65));
        pos[i] = lerp(from[i], to[i], smooth(t));
      }
      geo.current.attributes.position.needsUpdate = true;
      const ang = lerp(-0.55, 0.5, state.orbit);
      const rad = lerp(9.5, 6.4, a);
      camera.position.set(Math.sin(ang) * rad, lerp(2.6, 1.5, state.orbit), Math.cos(ang) * rad);
      camera.lookAt(0, 0.15, 0);
      camera.updateMatrixWorld();
      advance(++frame); // synchronous render; invalidate() would defer to rAF
    };
    window.__3d = window.__3d || {};
    window.__3d[sid] = { s: state, render: apply };
    apply();
  }, [state, sid, camera, advance, count, from, to, pos]);

  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 5]} intensity={2.2} />
      <points>
        <bufferGeometry ref={geo}>
          <bufferAttribute attach="attributes-position" array={pos} count={count} itemSize={3} />
          <bufferAttribute attach="attributes-color" array={col} count={count} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.035} vertexColors transparent opacity={0.95} />
      </points>
      {CENTRES.map((c, i) => (
        <Html key={PALETTE[i]} position={c} center style={{ opacity: state.tag }}>
          <span className="lbl">class {"ABC"[i]}</span>
        </Html>
      ))}
    </>
  );
}

export function mountR3F(sid, spec) {
  const state = { assemble: 0, orbit: 0, tag: 0 };
  const reactive = {};
  for (const k of Object.keys(state)) {
    Object.defineProperty(reactive, k, {
      enumerable: true,
      get: () => state[k],
      set: (v) => {
        state[k] = v;
        window.__3d?.[sid]?.render();
      },
    });
  }
  createRoot(document.getElementById(sid)).render(
    <Canvas frameloop="never" camera={{ fov: 38, position: [0, 2.6, 9.5] }} gl={{ antialias: true }}>
      <Cloud sid={sid} seed={spec.seed} count={spec.count} state={reactive} />
    </Canvas>,
  );
  return reactive;
}
window.DS3D_R3F = { mount: mountR3F };

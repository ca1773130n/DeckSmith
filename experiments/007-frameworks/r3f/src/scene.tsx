/**
 * The spike scene: a ViT-B/16 encoder stack the camera flies along.
 *
 * Chosen because it is a slide DeckSmith would actually want and 2D cannot do
 * well — the whole point of the diagram is that the stages are BEHIND one
 * another and the camera travels through them. A spinning cube would prove
 * nothing.
 *
 * Everything is driven by Theatre.js. Nothing reads a clock: R3F runs with
 * frameloop="never", so the only thing that produces a frame is our own
 * advance() call, invoked from the seek adapter. Invariant 1.
 */
import { Billboard, Instance, Instances, Line, Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ISheet, ISheetObject } from "@theatre/core";
import { getProject, types } from "@theatre/core";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PROJECT_STATE, SEQ_LENGTH } from "./theatre-state.js";

// ---------------------------------------------------------------- content

const ACCENT = "#4dd4c8";
const TONE_B = "#f0a35e";
const FG = "#f2f4f8";
const DIM = "#7b8496";

interface StageSpec {
  key: string;
  label: string;
  sub: string;
  z: number;
  color: string;
  /** tokens across × down on this stage's face */
  grid: [number, number];
  /** which side the label hangs off: +1 right, -1 left */
  side: 1 | -1;
}

const STAGES: StageSpec[] = [
  { key: "Stage0", label: "Patch Embed", sub: "196 × 768", z: 0, color: "#3d5a80", grid: [7, 7], side: 1 },
  { key: "Stage1", label: "Multi-Head Attn", sub: "12 heads", z: -5, color: "#4dd4c8", grid: [7, 7], side: -1 },
  { key: "Stage2", label: "MLP", sub: "768 → 3072 → 768", z: -10, color: "#3d5a80", grid: [7, 7], side: 1 },
  { key: "Stage3", label: "× 12 blocks", sub: "residual + LN", z: -15, color: "#3d5a80", grid: [7, 7], side: -1 },
  { key: "Stage4", label: "Class Head", sub: "1000-way", z: -20, color: "#f0a35e", grid: [3, 3], side: 1 },
];

const FONT_BOLD = "./assets/label.ttf";
const FONT_BODY = "./assets/body.ttf";

// ---------------------------------------------------------------- theatre

const project = getProject("DeckSmithScene", { state: PROJECT_STATE as never });
export const sheet: ISheet = project.sheet("Scene");

const camObj = sheet.object("Camera", {
  pos: { x: types.number(2.5), y: types.number(3.6), z: types.number(19) },
  look: { x: types.number(0), z: types.number(-7) },
});
const highlightObj = sheet.object("Highlight", { amount: types.number(0, { range: [0, 1] }) });
const captionObj = sheet.object("Caption", { opacity: types.number(0, { range: [0, 1] }) });
const stageObjs: Record<string, ISheetObject<{ reveal: never }>> = {};
for (const s of STAGES) {
  stageObjs[s.key] = sheet.object(s.key, {
    reveal: types.number(0, { range: [0, 1] }),
    // biome-ignore lint/suspicious/noExplicitAny: theatre's generic is structural
  }) as any;
}

// ---------------------------------------------------------------- helpers

/** Smoothstep, so a linear reveal value still reads as motion. */
function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- pieces

function Rig() {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const v = camObj.value;
    camera.position.set(v.pos.x, v.pos.y, v.pos.z);
    target.set(v.look.x, 0.6, v.look.z);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  });
  return null;
}

function TokenGrid({ spec }: { spec: StageSpec }) {
  const [cols, rows] = spec.grid;
  const cells = useMemo(() => {
    const out: { x: number; y: number; d: number }[] = [];
    const pitch = 0.62;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * pitch;
        const y = (r - (rows - 1) / 2) * pitch;
        // Deterministic stagger: distance from centre, no Math.random anywhere.
        out.push({ x, y, d: Math.hypot(c - (cols - 1) / 2, r - (rows - 1) / 2) / 5 });
      }
    }
    return out;
  }, [cols, rows]);

  return (
    <Instances limit={cells.length} castShadow={false}>
      <boxGeometry args={[0.44, 0.44, 0.16]} />
      <meshStandardMaterial color={spec.color} roughness={0.45} metalness={0.15} />
      {cells.map((cell, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed generated grid
        <Token key={i} cell={cell} stageKey={spec.key} />
      ))}
    </Instances>
  );
}

function Token({
  cell,
  stageKey,
}: {
  cell: { x: number; y: number; d: number };
  stageKey: string;
}) {
  const ref = useRef<THREE.Object3D>(null);
  useFrame(() => {
    const o = ref.current;
    if (!o) return;
    const reveal = (stageObjs[stageKey].value as unknown as { reveal: number }).reveal;
    // Per-token stagger from its own distance — the "assemble" read.
    const p = ease((reveal - cell.d * 0.35) / (1 - cell.d * 0.35 || 1));
    o.position.set(cell.x, cell.y, (1 - p) * 2.4);
    const s = 0.001 + p * 0.999;
    o.scale.setScalar(s);
  });
  return <Instance ref={ref} position={[cell.x, cell.y, 0]} />;
}

function Stage({ spec, index }: { spec: StageSpec; index: number }) {
  const group = useRef<THREE.Group>(null);
  const slab = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const isAttention = index === 1;

  useFrame(() => {
    const reveal = (stageObjs[spec.key].value as unknown as { reveal: number }).reveal;
    const p = ease(reveal);
    if (group.current) group.current.visible = p > 0.001;
    if (slab.current) {
      const m = slab.current.material as THREE.MeshStandardMaterial;
      m.opacity = 0.16 * p;
      slab.current.scale.set(0.6 + 0.4 * p, 0.6 + 0.4 * p, 1);
    }
    if (ring.current) {
      const a = highlightObj.value.amount as unknown as number;
      ring.current.visible = a > 0.001;
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.opacity = a * 0.9;
      ring.current.scale.setScalar(0.9 + a * 0.12);
    }
  });

  const half = (Math.max(spec.grid[0], spec.grid[1]) * 0.62) / 2 + 0.5;

  return (
    <group ref={group} position={[0, 0.6, spec.z]}>
      {/* the slab the tokens sit on */}
      <mesh ref={slab}>
        <planeGeometry args={[half * 2, half * 2]} />
        <meshBasicMaterial color={FG} transparent opacity={0.16} side={THREE.DoubleSide} />
      </mesh>
      <TokenGrid spec={spec} />
      {isAttention && (
        <mesh ref={ring} position={[0, 0, 0.02]}>
          <ringGeometry args={[half * 0.98, half * 1.04, 64]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* Labels alternate sides so five of them never stack into one smear
          when the camera is deep in the run. A 2D emitter cannot make this
          mistake; a 3D one has to think about it. */}
      {/* depthTest off + renderOrder: an annotation that a nearer slab can hide
          is not an annotation. This is the single biggest difference between
          labelling a 2D SVG and labelling a 3D scene. */}
      <Text
        font={FONT_BOLD}
        fontSize={0.52}
        color={isAttention ? ACCENT : FG}
        anchorX={spec.side > 0 ? "left" : "right"}
        anchorY="middle"
        position={[spec.side * (half + 0.55), 0.35, 0]}
        renderOrder={10}
        material-depthTest={false}
        material-toneMapped={false}
      >
        {spec.label}
      </Text>
      <Text
        font={FONT_BODY}
        fontSize={0.32}
        color={DIM}
        anchorX={spec.side > 0 ? "left" : "right"}
        anchorY="middle"
        position={[spec.side * (half + 0.55), -0.25, 0]}
        renderOrder={10}
        material-depthTest={false}
        material-toneMapped={false}
      >
        {spec.sub}
      </Text>
      {/* A leader from the slab edge out to the label. */}
      <Line
        points={[
          [spec.side * (half * 0.75), 0.05, 0],
          [spec.side * (half + 0.4), 0.05, 0],
        ]}
        color={isAttention ? ACCENT : DIM}
        lineWidth={1}
        transparent
        opacity={0.55}
      />
    </group>
  );
}

function Beams() {
  const pts = useMemo(() => {
    const out: [THREE.Vector3, THREE.Vector3][] = [];
    for (let i = 0; i < STAGES.length - 1; i++) {
      const a = STAGES[i];
      const b = STAGES[i + 1];
      for (const [x, y] of [
        [-1.6, 1.6],
        [1.6, 1.6],
        [-1.6, -1.6],
        [1.6, -1.6],
      ] as const) {
        out.push([
          new THREE.Vector3(x, 0.6 + y * 0.001 + y, a.z),
          new THREE.Vector3(x * 0.55, 0.6 + y * 0.55, b.z),
        ]);
      }
    }
    return out;
  }, []);
  return (
    <group>
      {pts.map((p, i) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed generated set
          key={i}
          points={[p[0], p[1]]}
          color={DIM}
          lineWidth={1}
          transparent
          opacity={0.35}
        />
      ))}
    </group>
  );
}

function Caption() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const o = captionObj.value.opacity as unknown as number;
    if (!ref.current) return;
    ref.current.visible = o > 0.001;
    ref.current.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.Material | undefined;
      if (m && "opacity" in m) {
        m.transparent = true;
        (m as THREE.MeshBasicMaterial).opacity = o;
      }
    });
  });
  return (
    // Billboard: always faces the camera, so the caption stays readable
    // through the whole swing. Deterministic — it is a pure function of the
    // camera pose, which is itself a pure function of the seek time.
    <Billboard ref={ref} position={[-1.0, -3.6, -6]}>
      <Text
        font={FONT_BOLD}
        fontSize={0.5}
        color={ACCENT}
        anchorX="center"
        anchorY="middle"
        renderOrder={20}
        material-depthTest={false}
        material-toneMapped={false}
      >
        Attention is all-to-all
      </Text>
      <Text
        font={FONT_BODY}
        fontSize={0.32}
        color={FG}
        anchorX="center"
        anchorY="top"
        position={[0, -0.46, 0]}
        maxWidth={9}
        textAlign="center"
        renderOrder={20}
        material-depthTest={false}
        material-toneMapped={false}
      >
        every patch token attends to every other, so the receptive field is the
        whole image at layer one.
      </Text>
    </Billboard>
  );
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.4, -10]}>
      <planeGeometry args={[60, 80]} />
      <meshStandardMaterial color="#0d1017" roughness={1} metalness={0} />
    </mesh>
  );
}

/** Publishes the R3F store so the seek adapter can drive it from outside React. */
function Expose({ onReady }: { onReady: (s: SceneHandle) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const advance = useThree((s) => s.advance);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    // Measurement hook for probe.mjs. Reading the live scene graph is the only
    // honest way to answer "how many pixels tall is that label", because in 3D
    // the answer depends on the camera and nothing static knows it.
    (window as unknown as { __dsExpose: unknown }).__dsExpose = { gl, scene, camera, THREE };
    onReady({ gl, advance, invalidate });
  }, [gl, scene, camera, advance, invalidate, onReady]);
  return null;
}

export interface SceneHandle {
  gl: THREE.WebGLRenderer;
  advance: (timestamp: number, runGlobalEffects?: boolean) => void;
  invalidate: () => void;
}

export function Scene({ onReady }: { onReady: (s: SceneHandle) => void }) {
  return (
    <Canvas
      // The invariant, expressed as a prop: nothing renders unless we say so.
      frameloop="never"
      gl={{
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      }}
      camera={{ fov: 38, near: 0.1, far: 200, position: [13, 8.5, 20] }}
      dpr={1}
      shadows={false}
    >
      <color attach="background" args={["#0a0c11"]} />
      <fog attach="fog" args={["#0a0c11", 18, 62]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 12, 8]} intensity={1.5} />
      <directionalLight position={[-8, 2, -12]} intensity={0.6} color={ACCENT} />
      <Floor />
      <Beams />
      {STAGES.map((s, i) => (
        <Stage key={s.key} spec={s} index={i} />
      ))}
      <Caption />
      <Rig />
      <Expose onReady={onReady} />
    </Canvas>
  );
}

export { SEQ_LENGTH };

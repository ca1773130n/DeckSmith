/**
 * The same scene again, this time with Theatre.js driving it — the shape the
 * control agent's stack takes. Two things change and both matter to DeckSmith.
 *
 * 1. The animation is no longer statements in the emitted document; it is a
 *    project STATE JSON that the studio writes and `getProject(name, {state})`
 *    consumes. A program can emit that JSON, but it is a second serialisation
 *    format with a second schema alongside the storyboard.
 * 2. Playback position is set with `sheet.sequence.position = t`, which is a
 *    real absolute seek — Theatre is genuinely seekable. But it drives R3F's
 *    frameloop, so the frame still lands whenever R3F next renders.
 */
import { getProject } from "@theatre/core";
import { editable as e, SheetProvider } from "@theatre/r3f";
import { Canvas } from "@react-three/fiber";
import { createRoot } from "react-dom/client";

/** What the planner would have to emit instead of `tl: string[]`. */
const STATE = {
  sheetsById: {
    Scene: {
      staticOverrides: { byObject: {} },
      sequence: {
        subUnitsPerUnit: 30,
        length: 7,
        type: "PositionalSequence",
        tracksByObject: {
          cloud: {
            trackData: {
              t1: {
                type: "BasicKeyframedTrack",
                keyframes: [
                  { id: "k1", position: 0.4, connectedRight: true, handles: [0.5, 0, 0.5, 1], type: "bezier", value: 0 },
                  { id: "k2", position: 4.0, connectedRight: false, handles: [0.5, 0, 0.5, 1], type: "bezier", value: 1 },
                ],
              },
            },
            trackIdByPropPath: { '["assemble"]': "t1" },
          },
        },
      },
    },
  },
  definitionVersion: "0.4.0",
  revisionHistory: [],
};

const project = getProject("Deck", { state: STATE });
const sheet = project.sheet("Scene");

export function mountTheatre(sid) {
  createRoot(document.getElementById(sid)).render(
    <Canvas frameloop="never" camera={{ fov: 38, position: [0, 2.6, 9.5] }}>
      <SheetProvider sheet={sheet}>
        <ambientLight intensity={1.1} />
        <e.mesh theatreKey="cloud">
          <sphereGeometry args={[1, 32, 32]} />
          <meshStandardMaterial color="#7dd3fc" />
        </e.mesh>
      </SheetProvider>
    </Canvas>,
  );
  window.__3d = window.__3d || {};
  // The seam a DeckSmith emitter would have to write: one number in, one frame out.
  window.__3d[sid] = {
    s: {
      set t(v) {
        sheet.sequence.position = v;
      },
    },
  };
}
window.DS3D_THEATRE = { mount: mountTheatre };

/**
 * Theatre.js project state, EMITTED BY A PROGRAM.
 *
 * This is the whole point of the Theatre.js half of the spike: the studio is an
 * editor for humans, and DeckSmith has no humans. So the question is not "is the
 * editor good", it is "can a planner emit this JSON". This file is that JSON,
 * built from a beat-shaped description rather than hand-authored, so the shape
 * is visible and the arithmetic is ours.
 *
 * Everything here was derived by reading the state a real studio session saves.
 * Note what a keyframe costs: an id, a position, a handle pair, a type tag and a
 * value — five fields to say "z is -8 at t=2.4".
 */

export interface Key {
  /** seconds */
  t: number;
  v: number;
  /** cubic bezier handles, in normalised keyframe-space. [ox, oy, ix, iy] */
  h?: [number, number, number, number];
}

/** One animated leaf: a dotted path into the object's props, plus its keys. */
export interface Track {
  path: string[];
  keys: Key[];
}

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Deterministic keyframe ids: NO Math.random, NO Date.now (invariant 2). */
function kfId(objKey: string, path: string[], i: number): string {
  return `k-${objKey}-${path.join(".")}-${i}`.replace(/[^a-zA-Z0-9-]/g, "_");
}
function trackId(objKey: string, path: string[]): string {
  return `t-${objKey}-${path.join(".")}`.replace(/[^a-zA-Z0-9-]/g, "_");
}

export function buildProjectState(
  projectId: string,
  sheetId: string,
  objects: Record<string, Track[]>,
  lengthSeconds: number,
) {
  const trackData: Record<string, unknown> = {};
  const tracksByObject: Record<string, unknown> = {};

  for (const [objKey, tracks] of Object.entries(objects)) {
    const trackIdByPropPath: Record<string, string> = {};
    for (const track of tracks) {
      const tid = trackId(objKey, track.path);
      trackIdByPropPath[JSON.stringify(track.path)] = tid;
      trackData[tid] = {
        type: "BasicKeyframedTrack",
        __debugName: `${objKey}:${track.path.join(".")}`,
        keyframes: track.keys.map((k, i) => ({
          id: kfId(objKey, track.path, i),
          position: k.t,
          connectedRight: i < track.keys.length - 1,
          handles: k.h ?? EASE_OUT,
          type: "bezier",
          value: k.v,
        })),
      };
    }
    tracksByObject[objKey] = {
      trackData: {},
      trackIdByPropPath,
    };
  }

  // Theatre stores trackData under the sheet, keyed by object, so re-shape.
  const byObject: Record<string, unknown> = {};
  for (const [objKey, tracks] of Object.entries(objects)) {
    const td: Record<string, unknown> = {};
    const idByPath: Record<string, string> = {};
    for (const track of tracks) {
      const tid = trackId(objKey, track.path);
      idByPath[JSON.stringify(track.path)] = tid;
      td[tid] = trackData[tid];
    }
    byObject[objKey] = { trackData: td, trackIdByPropPath: idByPath };
  }

  return {
    sheetsById: {
      [sheetId]: {
        staticOverrides: { byObject: {} },
        sequence: {
          subUnitsPerUnit: 30,
          length: lengthSeconds,
          type: "PositionalSequence",
          tracksByObject: byObject,
        },
      },
    },
    definitionVersion: "0.4.0",
    revisionHistory: ["decksmith-emitted"],
  };
}

/** The animation for THIS spike, described as beats and compiled to the above. */
export const SEQ_LENGTH = 12;

export const ANIMATION: Record<string, Track[]> = {
  // Camera flies from an establishing wide shot down the length of the stack.
  Camera: [
    { path: ["pos", "x"], keys: [{ t: 0, v: 2.5 }, { t: 3.4, v: 11 }, { t: 7, v: 14.5 }, { t: 11, v: 10.5 }] },
    { path: ["pos", "y"], keys: [{ t: 0, v: 3.6 }, { t: 3.4, v: 5.6 }, { t: 7, v: 4.0 }, { t: 11, v: 3.2 }] },
    { path: ["pos", "z"], keys: [{ t: 0, v: 19 }, { t: 3.4, v: 12.5 }, { t: 7, v: 5.5 }, { t: 11, v: 9 }] },
    { path: ["look", "x"], keys: [{ t: 0, v: 0 }, { t: 3.4, v: 0 }, { t: 7, v: -0.4 }, { t: 11, v: 0 }] },
    { path: ["look", "z"], keys: [{ t: 0, v: -7 }, { t: 3.4, v: -9 }, { t: 7, v: -7.5 }, { t: 11, v: -9 }] },
  ],
  // Stages assemble front-to-back, each a beat apart.
  Stage0: [{ path: ["reveal"], keys: [{ t: 0.2, v: 0 }, { t: 1.4, v: 1 }] }],
  Stage1: [{ path: ["reveal"], keys: [{ t: 1.6, v: 0 }, { t: 2.8, v: 1 }] }],
  Stage2: [{ path: ["reveal"], keys: [{ t: 3.0, v: 0 }, { t: 4.2, v: 1 }] }],
  Stage3: [{ path: ["reveal"], keys: [{ t: 4.4, v: 0 }, { t: 5.6, v: 1 }] }],
  Stage4: [{ path: ["reveal"], keys: [{ t: 5.8, v: 0 }, { t: 7.0, v: 1 }] }],
  // The attention block gets a highlight while the camera is beside it.
  Highlight: [
    { path: ["amount"], keys: [{ t: 6.6, v: 0 }, { t: 7.6, v: 1 }, { t: 10.2, v: 1 }, { t: 11.2, v: 0 }] },
  ],
  Caption: [
    { path: ["opacity"], keys: [{ t: 7.4, v: 0 }, { t: 8.4, v: 1 }] },
  ],
};

export const PROJECT_STATE = buildProjectState(
  "DeckSmithScene",
  "Scene",
  ANIMATION,
  SEQ_LENGTH,
);

// Spike: emit a Lottie animation from a DeckSmith-shaped beat with NO human step.
// This is what an emitter would produce instead of GSAP statement text.
import { writeFileSync } from 'node:fs';

const FR = 60;
const W = 1920;
const H = 1080;

/** ease: lottie bezier control handles, the direct analogue of a GSAP ease string */
const EASE_OUT = { i: { x: [0.16], y: [1] }, o: { x: [0.3], y: [0] } };

function textLayer({ ind, text, size, x, y, inFrame, color = [1, 1, 1] }) {
  return {
    ddd: 0, ind, ty: 5, nm: `t${ind}`, sr: 1,
    ks: {
      o: { a: 1, k: [
        { t: inFrame, s: [0], ...EASE_OUT },
        { t: inFrame + 18, s: [100] },
      ] },
      r: { a: 0, k: 0 },
      p: { a: 1, k: [
        { t: inFrame, s: [x, y + 40], ...EASE_OUT },
        { t: inFrame + 18, s: [x, y] },
      ] },
      a: { a: 0, k: [0, 0] },
      s: { a: 0, k: [100, 100] },
    },
    ao: 0,
    t: {
      d: { k: [{ t: 0, s: { s: size, f: 'Deck', t: text, j: 0, tr: 0, lh: size * 1.2, ls: 0, fc: color } }] },
      p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: [],
    },
    ip: 0, op: 240, st: 0, bm: 0,
  };
}

function barLayer({ ind, y, color, inFrame }) {
  return {
    ddd: 0, ind, ty: 4, nm: `bar${ind}`, sr: 1,
    ks: {
      o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
      p: { a: 1, k: [
        { t: inFrame, s: [-500, y], ...EASE_OUT },
        { t: inFrame + 36, s: [420, y] },
      ] },
      a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
    },
    ao: 0,
    shapes: [
      { ty: 'rc', d: 1, s: { a: 0, k: [600, 84] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 12 }, nm: 'r' },
      { ty: 'fl', c: { a: 0, k: [...color, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'f' },
    ],
    ip: 0, op: 240, st: 0, bm: 0,
  };
}

const beat = {
  v: '5.12.2', fr: FR, ip: 0, op: 240, w: W, h: H, nm: 'claim-beat', ddd: 0,
  fonts: { list: [{ fName: 'Deck', fFamily: 'Helvetica', fStyle: 'Bold', ascent: 72 }] },
  assets: [],
  layers: [
    textLayer({ ind: 1, text: 'Backpropagation', size: 96, x: 200, y: 260, inFrame: 0 }),
    barLayer({ ind: 2, y: 480, color: [0.2, 0.6, 0.86], inFrame: 20 }),
    barLayer({ ind: 3, y: 640, color: [0.9, 0.3, 0.24], inFrame: 40 }),
    barLayer({ ind: 4, y: 800, color: [0.18, 0.8, 0.44], inFrame: 60 }),
    textLayer({ ind: 5, text: 'chain rule, applied backwards', size: 56, x: 200, y: 960, inFrame: 80, color: [0.7, 0.75, 0.8] }),
  ],
};

const json = JSON.stringify(beat);
writeFileSync(new URL('./out/beat.json', import.meta.url), json);
console.log(`lottie json bytes=${json.length} layers=${beat.layers.length} deterministicWriter=${JSON.stringify(beat).length === json.length}`);

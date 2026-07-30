/**
 * Deterministic PRNG seeded from a fixed string.
 *
 * Invariant 2 forbids Math.random at render time. Every point position in this
 * spike comes from here, so the cloud is the same cloud in every render, on
 * every machine, forever.
 */
export function rng(seed) {
  // cyrb128 -> one 32-bit state, then mulberry32.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller from a uniform source, so clusters are Gaussian and still seeded. */
export function gauss(next) {
  const u = Math.max(next(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

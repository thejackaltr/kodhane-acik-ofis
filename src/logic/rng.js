// Deterministic RNG (mulberry32). The seed lives in the save so offline simulation is reproducible.
export function next(state) {
  let t = (state.rng = (state.rng + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function range(state, a, b) { return a + (b - a) * next(state); }
export function pick(state, arr) { return arr[Math.floor(next(state) * arr.length) % arr.length]; }

// The single source of GAMEPLAY randomness (spawn angles, spacing jitter, raider
// timers). Seedable, so a run is reproducible from a seed: the playtest harness
// seeds it per run, the browser seeds it randomly at load. Cosmetic randomness
// (burst shard shapes, audio noise) stays on Math.random so it can never shift the
// gameplay sequence.
//
// mulberry32: small, fast, good enough for spawn tables; state is one uint32.
let state = (Math.random() * 0x100000000) >>> 0

export function seedRng(seed: number): void {
  state = seed >>> 0
}

/** Uniform in [0, 1) - a drop-in for Math.random() in gameplay code. */
export function rand(): number {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
}

/** Uniform in [a, b). */
export const randRange = (a: number, b: number): number => a + rand() * (b - a)

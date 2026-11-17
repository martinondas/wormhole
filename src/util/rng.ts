// The single source of GAMEPLAY randomness (spawn angles, spacing jitter, raider
// timers). Seedable, so a run is reproducible from a seed: the playtest harness
// seeds it per run, the browser seeds it randomly at load. Cosmetic randomness
// (burst shard shapes, audio noise) stays on Math.random so it can never shift the
// gameplay sequence.
//
// mulberry32: small, fast, good enough for spawn tables; state is one uint32.
/** A generator with its own state, uniform in [0, 1): for noise that must not shift the gameplay sequence. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

let gameplay = createRng(Math.random() * 0x100000000)

export function seedRng(seed: number): void {
  gameplay = createRng(seed)
}

/** Uniform in [0, 1) - a drop-in for Math.random() in gameplay code. */
export const rand = (): number => gameplay()

/** Uniform in [a, b). */
export const randRange = (a: number, b: number): number => a + rand() * (b - a)

export const DEG = Math.PI / 180 // radians per degree

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/** Move `cur` toward `target` by at most `maxStep`, without overshooting. */
export function approach(cur: number, target: number, maxStep: number): number {
  if (cur < target) return Math.min(cur + maxStep, target)
  if (cur > target) return Math.max(cur - maxStep, target)
  return target
}

/** 0 below `lo`, 1 above `hi`, a smooth S-curve between. */
export function smoothstep(lo: number, hi: number, v: number): number {
  const t = clamp((v - lo) / (hi - lo), 0, 1)
  return t * t * (3 - 2 * t)
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Smallest signed difference between two angles, wrapped to (-PI, PI]. */
export const angleDiff = (a: number, b: number): number =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** Share of the gap to a target that a value smoothed with time constant `lag` (s) closes in `dt` seconds. */
export const smoothing = (dt: number, lag: number): number => 1 - Math.exp(-dt / Math.max(lag, 1e-4))

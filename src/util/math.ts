export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/** Move `cur` toward `target` by at most `maxStep`, without overshooting. */
export function approach(cur: number, target: number, maxStep: number): number {
  if (cur < target) return Math.min(cur + maxStep, target)
  if (cur > target) return Math.max(cur - maxStep, target)
  return target
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

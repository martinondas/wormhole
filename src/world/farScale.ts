import { RENDER } from '../config'
import { clamp } from '../util/math'

// Draw scale for a wall object or raider at ship-relative z (negative = ahead):
// 1 near the ship, rising linearly to 1 + gain at FAR_SCALE.FAR ahead. `gain` is
// FAR_SCALE.GAIN for wall objects; raiders pass FAR_SCALE.RAIDER_GAIN.
export function farScale(z: number, gain: number = RENDER.FAR_SCALE.GAIN): number {
  const { NEAR, FAR } = RENDER.FAR_SCALE
  return 1 + gain * clamp((-z - NEAR) / (FAR - NEAR), 0, 1)
}

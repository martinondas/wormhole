import { FEEL } from '../config'
import { DEG } from '../util/math'

// Camera shake from one `trauma` value in 0..1. Events add trauma, it decays
// linearly at SHAKE.DECAY per second, and the offset is trauma squared times a sum
// of three fixed-frequency sines per axis (smooth, not random jitter). The camera
// rig applies it after lookAt; it never touches the craft state or the aim.
export interface Shake {
  readonly trauma: number
  add(amount: number): void
  update(dt: number): void // advance time and decay trauma
  readonly x: number // view offset along camera right (world units)
  readonly y: number // view offset along camera up (world units)
  readonly roll: number // view roll (rad)
  reset(): void
}

// Three incommensurate frequencies (Hz) per axis, with fixed phases, so the motion
// does not repeat visibly.
const FX = [7.3, 13.1, 21.7]
const FY = [8.9, 15.3, 23.9]
const FR = [5.7, 11.9, 19.3]
const TAU = Math.PI * 2

function wave(freqs: readonly number[], t: number, phase: number): number {
  let s = 0
  for (let i = 0; i < freqs.length; i++) s += Math.sin(TAU * freqs[i]! * t + phase * (i + 1))
  return s / freqs.length
}

export function createShake(): Shake {
  let t = 0
  let trauma = 0
  let x = 0
  let y = 0
  let roll = 0
  return {
    add(amount: number): void {
      trauma = Math.min(1, trauma + amount)
    },
    update(dt: number): void {
      t += dt
      trauma = trauma - FEEL.SHAKE.DECAY * dt
      if (trauma < 1e-9) trauma = 0 // land on exactly 0 despite float steps
      const k = trauma * trauma
      if (k === 0) {
        x = 0
        y = 0
        roll = 0
        return
      }
      x = FEEL.SHAKE.MAX_OFFSET * k * wave(FX, t, 0.7)
      y = FEEL.SHAKE.MAX_OFFSET * k * wave(FY, t, 2.1)
      roll = FEEL.SHAKE.MAX_ROLL_DEG * DEG * k * wave(FR, t, 4.3)
    },
    get trauma(): number {
      return trauma
    },
    get x(): number {
      return x
    },
    get y(): number {
      return y
    },
    get roll(): number {
      return roll
    },
    reset(): void {
      trauma = 0
      x = 0
      y = 0
      roll = 0
    },
  }
}

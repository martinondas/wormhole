import { PHYSICS, SPEED } from './config'
import { stepPendulum, type PendulumState } from './physics/pendulum'
import { type InputState } from './input'
import { approach, clamp } from './util/math'

// Full player-craft state: the angular pendulum plus forward speed and a
// smoothed steering signal (so taps feel weighty rather than instant).
export interface CraftState extends PendulumState {
  steerSignal: number // smoothed steering, -1..1
  speed: number       // forward units/s
  distance: number    // total forward distance travelled
}

export function createCraft(): CraftState {
  return { theta: 0, omega: 0, steerSignal: 0, speed: SPEED.NORMAL, distance: 0 }
}

export function resetCraft(s: CraftState): void {
  s.theta = 0
  s.omega = 0
  s.steerSignal = 0
  s.speed = SPEED.NORMAL
  s.distance = 0
}

export function updateCraft(
  s: CraftState,
  input: InputState,
  targetSpeed: number,
  gravityK: number,
  speedMax: number,
  dt: number,
): void {
  // Ramp the steering signal toward the target. Faster to engage (attack) than
  // to release, so a quick tap delivers a crisp, weighty push.
  const goingUp = Math.abs(input.steerTarget) >= Math.abs(s.steerSignal)
  const rate = (goingUp ? 1 / PHYSICS.STEER_ATTACK : 1 / PHYSICS.STEER_RELEASE) * dt
  s.steerSignal = approach(s.steerSignal, input.steerTarget, rate)

  // Drive the pendulum. Steering torque has a soft cap: as |omega| approaches
  // STEER_OMEGA_MAX, fade the torque to zero IF it would spin you faster in the
  // direction you are already going (same sign as omega). Initiating or
  // reversing a swing always gets full torque, so the craft stays responsive;
  // only the "hold a side key and spin up forever" runaway is tamed. Gravity is
  // left untouched, so a dive from high up can still carry omega past the cap.
  let steerTorque = PHYSICS.STEER_TORQUE * s.steerSignal
  if (steerTorque * s.omega > 0) {
    steerTorque *= clamp(1 - Math.abs(s.omega) / PHYSICS.STEER_OMEGA_MAX, 0, 1)
  }
  stepPendulum(s, steerTorque, gravityK, dt)

  // Forward speed is set by the active flight tier / section (the player no
  // longer throttles); ease toward it so section changes ramp instead of snap.
  // Never halts (tiers are all > 0).
  s.speed = approach(s.speed, targetSpeed, SPEED.EASE * dt)
  // Floor: never halt (SPEED.SLOW is the lowest tier of level 1). Ceiling: the
  // current level's fast-tier speed (grows with the level, so high levels are not
  // capped at the level-1 top speed).
  if (s.speed < SPEED.SLOW) s.speed = SPEED.SLOW
  if (s.speed > speedMax) s.speed = speedMax

  s.distance += s.speed * dt
}

import { CLIMB, PHYSICS, SPEED } from './config'
import { stepPendulum, type PendulumState } from './physics/pendulum'
import { type InputState } from './input'
import { angleDiff, approach, clamp, smoothstep } from './util/math'

// Full player-craft state: the angular pendulum plus forward speed and a
// smoothed steering signal (so taps feel weighty rather than instant).
export interface CraftState extends SwingState {
  speed: number       // forward units/s
  distance: number    // total forward distance travelled
}

// A run starts at rest at the bottom, already at the speed of the first section's
// tier (the session passes it), so it never opens with a speed change.
export function createCraft(speed: number = SPEED.SLOW): CraftState {
  return { theta: 0, omega: 0, steerSignal: 0, speed, distance: 0 }
}

export function resetCraft(s: CraftState, speed: number = SPEED.SLOW): void {
  s.theta = 0
  s.omega = 0
  s.steerSignal = 0
  s.speed = speed
  s.distance = 0
}

// The angular part of one fixed step: the steer ramp, the steering torque with its
// soft cap, and the pendulum. The craft, the gem-line ghost (world/phrases.ts) and
// the bots all swing through this one function.
export interface SwingState extends PendulumState {
  steerSignal: number // smoothed steering, -1..1
}

export function stepSwing(s: SwingState, steerTarget: number, gravityK: number, dt: number): void {
  // Ramp the steering signal toward the target. Faster to engage (attack) than
  // to release, so a quick tap delivers a crisp, weighty push.
  const goingUp = Math.abs(steerTarget) >= Math.abs(s.steerSignal)
  const rate = (goingUp ? 1 / PHYSICS.STEER_ATTACK : 1 / PHYSICS.STEER_RELEASE) * dt
  s.steerSignal = approach(s.steerSignal, steerTarget, rate)

  // Drive the pendulum. Steering torque has a soft cap: as |omega| approaches
  // STEER_OMEGA_MAX, fade the torque to zero IF it would spin you faster in the
  // direction you are already going (same sign as omega). Initiating or
  // reversing a swing always gets full torque, so the craft stays responsive;
  // only the "hold a side key and spin up forever" runaway is tamed. Gravity is
  // left untouched, so a dive from high up can still carry omega past the cap.
  let steerTorque = PHYSICS.STEER_TORQUE * s.steerSignal
  // Climb fade (config CLIMB): high on the wall the torque that pushes farther up
  // weakens, so height there comes from momentum. h is the angle from the bottom;
  // `up` is 1 while the torque pushes away from the bottom and blends to 0 at the
  // top, which keeps the torque continuous when the craft crosses it. At or below
  // CLIMB.START nothing is touched.
  if (CLIMB.FADE > 0 && steerTorque !== 0) {
    const h = Math.abs(angleDiff(s.theta, 0))
    if (h > CLIMB.START) {
      const up = clamp((Math.sign(steerTorque) * Math.sin(s.theta)) / CLIMB.UP_SOFT, 0, 1)
      steerTorque *= 1 - CLIMB.FADE * smoothstep(CLIMB.START, CLIMB.END, h) * up
    }
  }
  if (steerTorque * s.omega > 0) {
    steerTorque *= clamp(1 - Math.abs(s.omega) / PHYSICS.STEER_OMEGA_MAX, 0, 1)
  }
  stepPendulum(s, steerTorque, gravityK, dt)
}

export function updateCraft(
  s: CraftState,
  input: InputState,
  targetSpeed: number,
  gravityK: number,
  speedMax: number,
  dt: number,
): void {
  stepSwing(s, input.steerTarget, gravityK, dt)

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

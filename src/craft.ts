import { PHYSICS, SPEED } from './config'
import { stepPendulum, type PendulumState } from './physics/pendulum'
import { type InputState } from './input'
import { approach } from './util/math'

// Full player-craft state: the angular pendulum plus forward speed and a
// smoothed steering signal (so taps feel weighty rather than instant).
export interface CraftState extends PendulumState {
  steerSignal: number // smoothed steering, -1..1
  speed: number       // forward units/s
  distance: number    // total forward distance travelled
}

export function createCraft(): CraftState {
  return { theta: 0, omega: 0, steerSignal: 0, speed: SPEED.CRUISE, distance: 0 }
}

export function updateCraft(s: CraftState, input: InputState, dt: number): void {
  // Ramp the steering signal toward the target. Faster to engage (attack) than
  // to release, so a quick tap delivers a crisp, weighty push.
  const goingUp = Math.abs(input.steerTarget) >= Math.abs(s.steerSignal)
  const rate = (goingUp ? 1 / PHYSICS.STEER_ATTACK : 1 / PHYSICS.STEER_RELEASE) * dt
  s.steerSignal = approach(s.steerSignal, input.steerTarget, rate)

  // Drive the pendulum.
  stepPendulum(s, PHYSICS.STEER_TORQUE * s.steerSignal, dt)

  // Forward speed: boost > throttle > brake > ease back to cruise. Never halts.
  if (input.boost) {
    s.speed += SPEED.BOOST_ACCEL * dt
  } else if (input.throttle) {
    s.speed += SPEED.THROTTLE_ACCEL * dt
  } else if (input.brake) {
    s.speed -= SPEED.EASE_DECEL * dt
  } else {
    s.speed = approach(s.speed, SPEED.CRUISE, SPEED.EASE_DECEL * dt)
  }
  if (s.speed < SPEED.MIN) s.speed = SPEED.MIN
  if (s.speed > SPEED.MAX) s.speed = SPEED.MAX

  s.distance += s.speed * dt
}

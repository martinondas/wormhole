import { PHYSICS } from '../config'

export interface PendulumState {
  theta: number // angle around tube, 0 = bottom, UNBOUNDED (can loop over the top)
  omega: number // angular velocity (rad/s)
}

// One fixed-timestep step of a damped, driven pendulum (semi-implicit Euler).
//   angAccel = -gravityK*sin(theta) - C*omega + torque
// gravityK is passed in (not read from config) so it can vary by gravity mode /
// tube zone; 0 makes it a free rotor (no pull toward the bottom). Semi-implicit
// (update omega first, then theta with the new omega) is stable and energy-
// friendly, which keeps the swing feeling honest over long sessions.
export function stepPendulum(s: PendulumState, torque: number, gravityK: number, dt: number): void {
  const angAccel = -gravityK * Math.sin(s.theta) - PHYSICS.DAMPING_C * s.omega + torque
  s.omega += angAccel * dt
  s.theta += s.omega * dt
}

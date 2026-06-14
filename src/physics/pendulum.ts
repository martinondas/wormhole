import { PHYSICS } from '../config'

export interface PendulumState {
  theta: number // angle around tube, 0 = bottom, UNBOUNDED (can loop over the top)
  omega: number // angular velocity (rad/s)
}

// One fixed-timestep step of a damped, driven pendulum (semi-implicit Euler).
//   angAccel = -K*sin(theta) - C*omega + torque
// Semi-implicit (update omega first, then theta with the new omega) is stable
// and energy-friendly, which keeps the swing feeling honest over long sessions.
export function stepPendulum(s: PendulumState, torque: number, dt: number): void {
  const angAccel = -PHYSICS.GRAVITY_K * Math.sin(s.theta) - PHYSICS.DAMPING_C * s.omega + torque
  s.omega += angAccel * dt
  s.theta += s.omega * dt
}

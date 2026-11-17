import { SHIP, RIDE_RADIUS } from '../config'
import { clamp } from '../util/math'

// Hull attitude from the swing (visual only). `yaw` has the sign of omega: the nose
// turns toward the direction the craft slides along the wall. `roll` leans into the
// steer input and into the swing, so the hull stays slewed while momentum carries
// after the key is released. Both are smoothed with SHIP.ATTITUDE_LAG.
export interface Attitude {
  yaw: number // rad, + = toward increasing theta
  roll: number // rad, about the hull's forward axis (same sense as the bank)
  update(omega: number, speed: number, steerSignal: number, dt: number): void
  reset(): void
}

export function createAttitude(): Attitude {
  const att: Attitude = {
    yaw: 0,
    roll: 0,
    update(omega: number, speed: number, steerSignal: number, dt: number): void {
      const slip = Math.atan2(omega * RIDE_RADIUS, Math.max(speed, 1e-3))
      const yawTarget = clamp(SHIP.YAW_FOLLOW * slip, -SHIP.YAW_MAX, SHIP.YAW_MAX)
      const rollTarget = clamp(-SHIP.BANK * steerSignal - SHIP.BANK_OMEGA * omega, -SHIP.ROLL_MAX, SHIP.ROLL_MAX)
      const k = 1 - Math.exp(-dt / Math.max(SHIP.ATTITUDE_LAG, 1e-4))
      att.yaw += (yawTarget - att.yaw) * k
      att.roll += (rollTarget - att.roll) * k
    },
    reset(): void {
      att.yaw = 0
      att.roll = 0
    },
  }
  return att
}

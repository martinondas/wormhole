import { PerspectiveCamera, Vector3 } from 'three'
import { CAMERA, TUBE, SHIP } from '../config'
import { type CraftState } from '../craft'

// Mostly-fixed chase cam: the tube (wormhole) stays put while the craft rides
// the walls across the view. Small ORBIT/ROLL/AIM follows add a little life
// without rotating the whole world (which would hide incoming objects).
export interface CameraRig {
  update(craft: CraftState, frameDt: number): void
}

export function createCameraRig(camera: PerspectiveCamera): CameraRig {
  let camTheta = 0 // smoothed orbit angle (small fraction of craft.theta)
  const camRadius = TUBE.RADIUS - SHIP.RADIAL_OFFSET - CAMERA.RISE
  const lookRadius = TUBE.RADIUS - SHIP.RADIAL_OFFSET
  const up = new Vector3()

  return {
    update(craft: CraftState, frameDt: number): void {
      // Drive the small camera follows from sin(theta): a smooth, 2*PI-periodic
      // signal. It is zero at every bottom rest point (theta = k*2*PI), so
      // gravity stays locked to screen-down when settled, AND it is continuous
      // across the top (theta = PI) so loops are smooth - no jump. For small
      // swings sin(theta) ~= theta, so the everyday feel is unchanged.
      const s = Math.sin(craft.theta)

      // orbit only a little, smoothed (frame-rate independent)
      const k = 1 - Math.exp(-frameDt / Math.max(CAMERA.FOLLOW_LAG, 1e-4))
      camTheta += (s * CAMERA.ORBIT_FOLLOW - camTheta) * k

      camera.position.set(
        Math.sin(camTheta) * camRadius,
        -Math.cos(camTheta) * camRadius,
        SHIP.Z + CAMERA.BACK,
      )

      // subtle bank (unit vector, no normalize needed)
      const rollPhi = s * CAMERA.ROLL_FOLLOW
      up.set(-Math.sin(rollPhi), Math.cos(rollPhi), 0)
      camera.up.copy(up)

      // aim down the tube, biased partway toward the craft so it stays framed
      camera.lookAt(
        Math.sin(craft.theta) * lookRadius * CAMERA.AIM_FOLLOW,
        -Math.cos(craft.theta) * lookRadius * CAMERA.AIM_FOLLOW,
        SHIP.Z - CAMERA.LOOK_AHEAD,
      )
    },
  }
}

import { PerspectiveCamera, Vector3 } from 'three'
import { CAMERA, TUBE, SHIP } from '../config'
import { type CraftState } from '../craft'

// Chase cam that orbits the tube to sit behind the craft at its current angle,
// so the world appears to rotate as you swing. Its "up" follows the inward
// radial (blended toward world-up by ROLL_FOLLOW), so going over the top rolls
// the view through the loop. The orbit/roll lags for weight.
export interface CameraRig {
  update(craft: CraftState, frameDt: number): void
}

export function createCameraRig(camera: PerspectiveCamera): CameraRig {
  let camTheta = 0
  const camRadius = TUBE.RADIUS - SHIP.RADIAL_OFFSET - CAMERA.RISE
  const lookRadius = TUBE.RADIUS - SHIP.RADIAL_OFFSET
  const up = new Vector3()
  const worldUp = new Vector3(0, 1, 0)
  const inward = new Vector3()

  return {
    update(craft: CraftState, frameDt: number): void {
      // exponential smoothing toward the craft's angle (frame-rate independent)
      const k = 1 - Math.exp(-frameDt / Math.max(CAMERA.ROLL_LAG, 1e-4))
      camTheta += (craft.theta - camTheta) * k

      camera.position.set(
        Math.sin(camTheta) * camRadius,
        -Math.cos(camTheta) * camRadius,
        SHIP.Z + CAMERA.BACK,
      )

      // inward radial at camTheta, blended toward world up
      inward.set(-Math.sin(camTheta), Math.cos(camTheta), 0)
      up.copy(worldUp).lerp(inward, CAMERA.ROLL_FOLLOW).normalize()
      camera.up.copy(up)

      // aim down the tube, nudged toward where the craft currently rides
      camera.lookAt(
        Math.sin(craft.theta) * lookRadius * 0.25,
        -Math.cos(craft.theta) * lookRadius * 0.25,
        SHIP.Z - CAMERA.LOOK_AHEAD,
      )
    },
  }
}

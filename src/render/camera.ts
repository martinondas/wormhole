import { PerspectiveCamera, Vector3 } from 'three'
import { CAMERA, SHIP, RIDE_RADIUS } from '../config'
import { type CraftState } from '../craft'
import { smoothing } from '../util/math'
import { type Shake } from './shake'

// Mostly-fixed chase cam: the tube (wormhole) stays put while the craft rides
// the walls across the view. Small ORBIT/ROLL/AIM follows add a little life
// without rotating the whole world (which would hide incoming objects).
// On top of that the view widens with speed (speed01: 0 at the level's slow tier,
// 1 at its fast tier) and takes the shake after lookAt, so neither moves the aim.
export interface CameraRig {
  update(craft: CraftState, frameDt: number, speed01: number): void
  reset(): void // snap the speed FOV to the slow tier (a new run starts slow)
}

export function createCameraRig(
  camera: PerspectiveCamera,
  setFovOffset: (deg: number) => void,
  shake: Shake,
): CameraRig {
  let camTheta = 0 // smoothed orbit angle (small fraction of craft.theta)
  const camRadius = RIDE_RADIUS - CAMERA.RISE
  const lookRadius = RIDE_RADIUS
  const up = new Vector3()
  const right = new Vector3()
  const camUp = new Vector3()
  let fov = 0 // smoothed speed FOV offset (deg)
  let fovApplied = 0 // last offset handed to the projection

  return {
    update(craft: CraftState, frameDt: number, speed01: number): void {
      // Drive the small camera follows from sin(theta): a smooth, 2*PI-periodic
      // signal. It is zero at every bottom rest point (theta = k*2*PI), so
      // gravity stays locked to screen-down when settled, AND it is continuous
      // across the top (theta = PI) so loops are smooth - no jump. For small
      // swings sin(theta) ~= theta, so the everyday feel is unchanged.
      const s = Math.sin(craft.theta)

      // orbit only a little, smoothed (frame-rate independent)
      const k = smoothing(frameDt, CAMERA.FOLLOW_LAG)
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

      // speed FOV: smoothed, and the projection is rebuilt only when it moved
      const kf = smoothing(frameDt, CAMERA.FOV_LAG)
      fov += (CAMERA.FOV_SPEED * speed01 - fov) * kf
      if (Math.abs(fov - fovApplied) > 0.05) {
        fovApplied = fov
        setFovOffset(fov)
      }

      // shake: a small sideways / vertical slide of the eye and a roll about the
      // view axis, after lookAt so the view direction (the aim) is unchanged
      shake.update(frameDt)
      if (shake.trauma > 0) {
        right.set(1, 0, 0).applyQuaternion(camera.quaternion)
        camUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
        camera.position.addScaledVector(right, shake.x).addScaledVector(camUp, shake.y)
        camera.rotateZ(shake.roll)
      }
    },
    reset(): void {
      fov = 0
      fovApplied = 0
      setFovOffset(0)
      shake.reset()
    },
  }
}

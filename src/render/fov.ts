import { CAMERA } from '../config'

const DEG = Math.PI / 180

// Vertical FOV (degrees) for an aspect ratio and a speed widening `offsetDeg`
// (0..CAMERA.FOV_SPEED). Three's camera.fov is vertical, so a wide window would
// otherwise balloon the horizontal view and make the side walls race past: the
// horizontal FOV is capped at HFOV_MAX plus the same offset. On a narrow window
// the vertical FOV widens by offsetDeg; on a wide one the horizontal does.
export function verticalFov(aspect: number, offsetDeg: number): number {
  const v = (CAMERA.FOV + offsetDeg) * DEG
  const hCap = (CAMERA.HFOV_MAX + offsetDeg) * DEG
  const vFromHCap = 2 * Math.atan(Math.tan(hCap / 2) / aspect)
  return Math.min(v, vFromHCap) / DEG
}

// Horizontal FOV (degrees) that a vertical FOV gives at an aspect ratio.
export function horizontalFov(verticalDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((verticalDeg * DEG) / 2) * aspect)) / DEG
}

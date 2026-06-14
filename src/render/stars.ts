import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  AdditiveBlending,
  type PerspectiveCamera,
} from 'three'
import { BACKGROUND } from '../config'

// A world-space starfield on a large sphere that follows the camera POSITION
// (so distant stars show no parallax as you fly) but keeps its ORIENTATION (so
// they rotate correctly in view when the camera banks). Fog is disabled so the
// tube's distance fog does not erase them.
export interface Starfield {
  object: Points
  update(camera: PerspectiveCamera): void
}

export function createStarfield(): Starfield {
  const n = BACKGROUND.STARS
  const radius = 500
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)

  // Place stars in a forward cone around -Z (the view direction) so they land on
  // screen instead of being wasted behind/beside the camera. cos(theta) uniform
  // in [cos(spread), 1] gives an even spread across the cap.
  const cosMax = Math.cos((BACKGROUND.STAR_SPREAD_DEG * Math.PI) / 180)

  for (let i = 0; i < n; i++) {
    const cosT = cosMax + Math.random() * (1 - cosMax)
    const sinT = Math.sqrt(1 - cosT * cosT)
    const phi = Math.random() * Math.PI * 2
    pos[i * 3] = sinT * Math.cos(phi) * radius
    pos[i * 3 + 1] = sinT * Math.sin(phi) * radius
    pos[i * 3 + 2] = -cosT * radius // -Z = forward

    // brightness biased low (a few bright, many faint); cool blue-white tint
    const b = 0.3 + Math.random() * Math.random() * BACKGROUND.STAR_ALPHA
    col[i * 3] = b * 0.75
    col[i * 3 + 1] = b * 0.85
    col[i * 3 + 2] = b
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new Float32BufferAttribute(col, 3))

  const mat = new PointsMaterial({
    size: 1.8,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
  })

  const points = new Points(geo, mat)
  points.frustumCulled = false // we relocate it to the camera each frame

  return {
    object: points,
    update(camera: PerspectiveCamera): void {
      points.position.copy(camera.position)
    },
  }
}

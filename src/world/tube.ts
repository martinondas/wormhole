import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  AdditiveBlending,
  Color,
  Group,
} from 'three'
import { TUBE, RENDER, CAMERA } from '../config'

// A wireframe tube: evenly spaced cross-section rings plus longitudinal lines.
// The geometry is static; we scroll it toward the camera by ring-spacing and
// wrap, so it reads as an endless tube with zero per-frame allocation.
export interface Tube {
  object: Group
  update(distance: number): void
}

// point on the tube wall at angle a (0 = bottom)
function wallX(a: number): number { return Math.sin(a) * TUBE.RADIUS }
function wallY(a: number): number { return -Math.cos(a) * TUBE.RADIUS }

export function createTube(): Tube {
  const seg = TUBE.SEGMENTS_PER_RING
  const spacing = TUBE.RING_SPACING
  // Extend the field far enough behind the camera that the modulo wrap (and the
  // nearest-ring boundary) sit out of sight behind the lens. Rings then fly
  // through the camera smoothly with no pop/blink; the far boundary hides in fog.
  const behind = Math.ceil((CAMERA.BACK + spacing) / spacing) + 1
  const ahead = TUBE.RINGS_VISIBLE

  // --- rings ---
  const ringPos: number[] = []
  for (let i = -behind; i <= ahead; i++) {
    const z = -i * spacing
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2
      const a1 = ((s + 1) / seg) * Math.PI * 2
      ringPos.push(wallX(a0), wallY(a0), z, wallX(a1), wallY(a1), z)
    }
  }
  const ringGeo = new BufferGeometry()
  ringGeo.setAttribute('position', new Float32BufferAttribute(ringPos, 3))

  // --- longitudinal lines ---
  const longPos: number[] = []
  const L = TUBE.LONGITUDINAL_LINES
  for (let l = 0; l < L; l++) {
    const a = (l / L) * Math.PI * 2
    const x = wallX(a)
    const y = wallY(a)
    for (let i = -behind; i < ahead; i++) {
      longPos.push(x, y, -i * spacing, x, y, -(i + 1) * spacing)
    }
  }
  const longGeo = new BufferGeometry()
  longGeo.setAttribute('position', new Float32BufferAttribute(longPos, 3))

  const ringMat = new LineBasicMaterial({
    color: new Color().setRGB(...RENDER.RING_RGB),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const longMat = new LineBasicMaterial({
    color: new Color().setRGB(...RENDER.LONG_RGB),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })

  const group = new Group()
  group.add(new LineSegments(ringGeo, ringMat))
  group.add(new LineSegments(longGeo, longMat))

  return {
    object: group,
    update(distance: number): void {
      // scroll toward camera (+Z) and wrap every ring spacing
      group.position.z = ((distance % spacing) + spacing) % spacing
    },
  }
}

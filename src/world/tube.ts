import {
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  AdditiveBlending,
  DynamicDrawUsage,
  Group,
} from 'three'
import { TUBE, RENDER, CAMERA, FLIGHT } from '../config'

// A wireframe tube: evenly spaced cross-section rings plus longitudinal lines.
// The geometry is static; we scroll it toward the camera by ring-spacing and
// wrap, so it reads as an endless tube with zero per-frame allocation.
//
// Each ring is colored by the flight tier at its WORLD distance (slow=yellow,
// normal=green, fast=blue), so an upcoming section shows its color ahead of the
// craft and the boundary reads as a colored gate flowing toward you. Per-vertex
// colors are rewritten each frame from one preallocated buffer (no allocation).
export interface Tube {
  object: Group
  // tierIndexAt(worldDistance) -> 0 slow / 1 normal / 2 fast (see flight.ts).
  // mode is the current flight mode, used only as a cache key: the colors are a
  // pure function of (ring band, mode), so they are recomputed/re-uploaded only
  // when one of those changes - not every frame.
  update(distance: number, tierIndexAt: (worldDist: number) => number, mode: string): void
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

  // --- rings (one segment block per ring, in ascending depth index) ---
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
  // BufferAttribute (not Float32BufferAttribute) so the attribute REFERENCES our
  // array rather than copying it - we rewrite these colors every frame in place.
  const ringColors = new Float32Array(ringPos.length)
  const ringColorAttr = new BufferAttribute(ringColors, 3)
  ringColorAttr.setUsage(DynamicDrawUsage)
  ringGeo.setAttribute('color', ringColorAttr)

  // --- longitudinal lines (one segment per depth step, per line) ---
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
  const longColors = new Float32Array(longPos.length)
  const longColorAttr = new BufferAttribute(longColors, 3)
  longColorAttr.setUsage(DynamicDrawUsage)
  longGeo.setAttribute('color', longColorAttr)

  // vertexColors so each ring/segment carries its own tier color; material color
  // stays white so the vertex color passes through the additive blend unchanged.
  const ringMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const longMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })

  const group = new Group()
  group.add(new LineSegments(ringGeo, ringMat))
  group.add(new LineSegments(longGeo, longMat))

  // tier -> color (index 0 slow / 1 normal / 2 fast). Normal reuses the base
  // green; slow (yellow) and fast (blue) come from the flight config.
  const ringRGB = [FLIGHT.SLOW_RING_RGB, RENDER.RING_RGB, FLIGHT.FAST_RING_RGB]
  const longRGB = [FLIGHT.SLOW_LONG_RGB, RENDER.LONG_RGB, FLIGHT.FAST_LONG_RGB]
  const ringVertsPerRing = seg * 2 // two vertices per ring segment
  // tier index per visible ring slot, indexed by (i + behind). Filled once per
  // band rebuild so the ring + long color loops read an array instead of each
  // calling tierIndexAt() (~1000 calls/rebuild -> behind+ahead+1). Reused, no alloc.
  const tierByOffset = new Int8Array(behind + ahead + 1)
  let lastN = NaN // ring band of the last color rebuild (cache key with lastMode)
  let lastMode = ''

  return {
    object: group,
    update(distance: number, tierIndexAt: (worldDist: number) => number, mode: string): void {
      // scroll toward camera (+Z) and wrap every ring spacing
      group.position.z = ((distance % spacing) + spacing) % spacing

      // World distance depicted by ring slot i is (i + n) * spacing, where n is
      // the number of whole rings already passed. The colors depend only on
      // (n, mode), so skip the rewrite + GPU re-upload when neither changed -
      // most frames the band is unchanged (it steps ~6x/s, not 60).
      const n = Math.floor(distance / spacing)
      if (n === lastN && mode === lastMode) return
      lastN = n
      lastMode = mode

      // tier index for each visible ring slot, once (shared by both loops below)
      for (let i = -behind; i <= ahead; i++) tierByOffset[i + behind] = tierIndexAt((i + n) * spacing)

      // color each ring by its tier at that world distance
      let r = 0
      for (let i = -behind; i <= ahead; i++) {
        const c = ringRGB[tierByOffset[i + behind]!] ?? ringRGB[1]!
        for (let v = 0; v < ringVertsPerRing; v++) {
          ringColors[r++] = c[0]
          ringColors[r++] = c[1]
          ringColors[r++] = c[2]
        }
      }
      ringColorAttr.needsUpdate = true

      // long segment from depth i to i+1 takes the tier at its near end (i)
      let g = 0
      for (let l = 0; l < L; l++) {
        for (let i = -behind; i < ahead; i++) {
          const c = longRGB[tierByOffset[i + behind]!] ?? longRGB[1]!
          longColors[g++] = c[0]
          longColors[g++] = c[1]
          longColors[g++] = c[2]
          longColors[g++] = c[0]
          longColors[g++] = c[1]
          longColors[g++] = c[2]
        }
      }
      longColorAttr.needsUpdate = true
    },
  }
}

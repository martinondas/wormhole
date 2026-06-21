import { IcosahedronGeometry, CylinderGeometry, BufferGeometry, Group, Vector3, Quaternion } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HAZARD } from '../config'
import { type WallObject } from './wallObject'
import { createEdgeLitSolid } from './edgeLitSolid'

// A red naval contact mine: a big faceted core ball with 12 short cylindrical horns
// (the classic sea-mine silhouette - a dominant sphere, not a spiky virus). It is
// the ONLY red object on the tube, so it reads as danger on sight. Players AVOID it;
// a hit costs a life. It rides at the shared RIDE_RADIUS, so the angle-only
// proximity check works directly. Edge-lit solid - see createEdgeLitSolid.

// Unique radial spike directions = the 12 vertices of a unit icosahedron.
// The position buffer repeats vertices per face, so dedupe by distance.
function spikeDirs(): Vector3[] {
  const ico = new IcosahedronGeometry(1, 0)
  const pos = ico.getAttribute('position')
  const seen: Vector3[] = []
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    if (!seen.some((s) => s.distanceToSquared(v) < 1e-4)) seen.push(v.clone())
  }
  ico.dispose()
  return seen // 12 directions
}

function buildMine(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const cr = HAZARD.CORE_RADIUS

  // faceted core
  parts.push(new IcosahedronGeometry(cr, 1))

  const up = new Vector3(0, 1, 0)
  const q = new Quaternion()
  const base = cr * 0.85 // horn base sits slightly inside the surface for a solid join
  for (const dir of spikeDirs()) {
    // straight cylindrical Hertz horn (hex prism so the edges read as a rod), wider
    // at the base and slightly tapered to a flat tip - a real maritime mine horn,
    // not a pointed cone or a bulbed spike.
    const horn = new CylinderGeometry(HAZARD.SPIKE_TIP_R, HAZARD.SPIKE_BASE_R, HAZARD.SPIKE_LEN, 6)
    horn.translate(0, HAZARD.SPIKE_LEN / 2, 0) // base (wide end) at origin, tip up (+Y)
    q.setFromUnitVectors(up, dir)
    horn.applyQuaternion(q)
    horn.translate(dir.x * base, dir.y * base, dir.z * base)
    parts.push(horn)
  }

  // Normalize before merging: IcosahedronGeometry is non-indexed but Cylinder is
  // indexed, and mergeGeometries requires an index on ALL parts or NONE. Drop
  // every index so they are uniformly non-indexed.
  const flat = parts.map((p) => {
    const n = p.index ? p.toNonIndexed() : p
    if (n !== p) p.dispose()
    return n
  })
  const merged = mergeGeometries(flat, false)
  if (!merged) throw new Error('hazard: failed to merge mine geometry')
  flat.forEach((p) => p.dispose())
  return merged
}

export function createHazard(): WallObject {
  const solid = createEdgeLitSolid(buildMine(), HAZARD.EDGE_RGB, HAZARD.FILL_RGB, HAZARD.LINE_WIDTH, HAZARD.EDGE_THRESHOLD)
  const inner = solid.inner // spins + pulses; the outer group is positioned by the pool
  const object = new Group()
  object.add(inner)

  let t = 0
  return {
    object,
    update(dt: number): void {
      t += dt
      // slow, menacing tumble on two axes (no per-frame allocations)
      inner.rotation.y += HAZARD.SPIN_SPEED * dt
      inner.rotation.x += HAZARD.SPIN_SPEED * 0.45 * dt
      // base size (SCALE) with a subtle throb (scale only: cheap, never leaves
      // the ride radius). SCALE is the overall-size knob; PULSE_AMP breathes on top.
      const s = 1 + Math.sin(t * HAZARD.PULSE_SPEED) * HAZARD.PULSE_AMP
      inner.scale.setScalar(HAZARD.SCALE * s)
    },
    setResolution: solid.setResolution,
    setOpacity: solid.setOpacity,
  }
}

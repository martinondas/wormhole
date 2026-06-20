import {
  IcosahedronGeometry,
  CylinderGeometry,
  EdgesGeometry,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Group,
  Color,
  Vector3,
  Quaternion,
  FrontSide,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { HAZARD } from '../config'
import { type WallObject } from './wallObject'

// A red naval contact mine: a big faceted core ball with 12 short, stubby cone
// horns tipped by small bulbs (the classic sea-mine silhouette - a dominant
// sphere, not a spiky virus). Edge-lit solid: a near-black depth-writing fill
// under glowing red fat-line edges. It is the ONLY red object on the tube, so it
// reads as danger on sight. Players AVOID it; a hit costs a life. It rides at the
// same radius as the orb, so the existing proximity check works directly.

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
  const mine = buildMine()

  // dark, depth-writing fill so the mine reads as a solid edge-lit body
  // (transparent for the death-pop fade; opaque at rest with opacity 1, like the
  // orb and gem fills).
  const fillMat = new MeshBasicMaterial({
    color: new Color().setRGB(...HAZARD.FILL_RGB),
    side: FrontSide,
    transparent: true,
  })
  const fill = new Mesh(mine, fillMat)

  // glowing red edges (fat lines). NORMAL blend (depthTest) so the red edges
  // stay red over the fill; additive HDR red would bloom toward white/pink.
  const edgesGeo = new EdgesGeometry(mine, HAZARD.EDGE_THRESHOLD)
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo)
  const lineMat = new LineMaterial({
    color: new Color().setRGB(...HAZARD.EDGE_RGB).getHex(),
    linewidth: HAZARD.LINE_WIDTH,
    worldUnits: false,
    transparent: true,
    depthTest: true,
    fog: true, // fade in through the tube fog as it approaches
  })
  lineMat.color.setRGB(...HAZARD.EDGE_RGB) // keep HDR (>1) red for strong bloom
  const edges = new LineSegments2(lineGeo, lineMat)
  edges.computeLineDistances()
  edgesGeo.dispose()

  // inner group spins + pulses; the outer group is positioned by the pool
  const inner = new Group()
  inner.add(fill)
  inner.add(edges)
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
    setResolution(w: number, h: number): void {
      lineMat.resolution.set(w, h)
    },
    setOpacity(o: number): void {
      fillMat.opacity = o
      lineMat.opacity = o
    },
  }
}

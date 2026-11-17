import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  EdgesGeometry,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Group,
  Color,
  FrontSide,
  AdditiveBlending,
  Vector3,
  type PerspectiveCamera,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { SHIP, RENDER, RIDE_RADIUS } from '../config'
import { type CraftState } from '../craft'
import { createAttitude } from './attitude'

export type HullId = (typeof SHIP.HULLS)[number]['id']

export interface Ship {
  object: Group
  update(craft: CraftState, dt: number): void
  // Title-screen turntable: float the hull in front of the camera and spin it
  // slowly (SHIP.PREVIEW_*). update() fully re-poses the group, so switching back
  // to a run needs no cleanup.
  preview(camera: PerspectiveCamera, dt: number): void
  // Swap the visible hull (title-screen selector). COSMETIC ONLY: every hull
  // shares the same materials, scale, and (global) hit windows.
  setHull(id: HullId): void
  // momentary edge-color flash, decays over SHIP.FLASH_TIME. Defaults to the blue
  // orb-pickup tint; pass an RGB (e.g. the green extra-life color) to flash that.
  flash(rgb?: readonly [number, number, number]): void
  setResolution(w: number, h: number): void
}

// All hulls are built from primitives, nose pointing -Z (forward), and stay near
// the raptor's footprint (span ~5, length ~5) so the identical hit windows also
// LOOK fair between ships. Returned geometry feeds the dark fill and the edges.

// RAPTOR - the winged fighter (X-wing-ish): hexagonal fuselage, nose
// cone, canopy, four X-wings with engine pods and tip cannons.
function buildRaptorHull(): BufferGeometry {
  const parts: BufferGeometry[] = []

  // central fuselage: hexagonal prism along Z
  const fuse = new CylinderGeometry(0.5, 0.4, 3.2, 6, 1)
  fuse.rotateX(Math.PI / 2)
  parts.push(fuse)

  // nose cone, pointing forward (-Z)
  const nose = new ConeGeometry(0.46, 1.5, 6)
  nose.rotateX(-Math.PI / 2)
  nose.translate(0, 0, -2.35)
  parts.push(nose)

  // cockpit canopy, slightly up and forward
  const cockpit = new SphereGeometry(0.45, 8, 5)
  cockpit.scale(0.7, 0.55, 1.15)
  cockpit.translate(0, 0.32, -0.5)
  parts.push(cockpit)

  // four wings in an X, each with an engine pod and a tip cannon
  const wingAngles = [40, 140, 220, 320].map((d) => (d * Math.PI) / 180)
  for (const a of wingAngles) {
    const wing = new BoxGeometry(2.6, 0.07, 1.1)
    wing.translate(1.4, 0, 0.5) // push outward and slightly back
    wing.rotateZ(a)
    parts.push(wing)

    const tipX = Math.cos(a) * 2.6
    const tipY = Math.sin(a) * 2.6

    const pod = new CylinderGeometry(0.18, 0.16, 1.3, 10)
    pod.rotateX(Math.PI / 2)
    pod.translate(tipX, tipY, 0.5)
    parts.push(pod)

    const cannon = new CylinderGeometry(0.05, 0.05, 1.9, 6)
    cannon.rotateX(Math.PI / 2)
    cannon.translate(tipX, tipY, -0.7)
    parts.push(cannon)
  }

  return mergeHull(parts, 'raptor')
}

// FALCON - a saucer: faceted lens disc with a rim band, an offset cockpit tube on
// the starboard side, twin front mandibles, and a rear engine bar.
function buildFalconHull(): BufferGeometry {
  const parts: BufferGeometry[] = []

  // lens body: shallow cones up + down joined by a rim band (12 facets)
  const top = new ConeGeometry(2.2, 0.55, 12)
  top.translate(0, 0.35, 0)
  parts.push(top)
  const bottom = new ConeGeometry(2.2, 0.55, 12)
  bottom.rotateX(Math.PI)
  bottom.translate(0, -0.35, 0)
  parts.push(bottom)
  const rim = new CylinderGeometry(2.2, 2.2, 0.16, 12)
  parts.push(rim)

  // offset cockpit tube (starboard, reaching forward) with a rounded tip
  const cockpit = new CylinderGeometry(0.3, 0.26, 1.5, 8)
  cockpit.rotateX(Math.PI / 2)
  cockpit.translate(1.15, 0.14, -1.45)
  parts.push(cockpit)
  const canopy = new SphereGeometry(0.26, 8, 5)
  canopy.scale(1, 0.8, 1.1)
  canopy.translate(1.15, 0.16, -2.2)
  parts.push(canopy)

  // twin front mandibles (the forward prongs)
  for (const x of [-0.62, 0.62]) {
    const prong = new BoxGeometry(0.5, 0.3, 1.5)
    prong.translate(x, 0, -2.5)
    parts.push(prong)
  }

  // rear engine bar (the glow strip silhouette)
  const engines = new BoxGeometry(1.7, 0.24, 0.35)
  engines.translate(0, 0, 2.2)
  parts.push(engines)

  return mergeHull(parts, 'falcon')
}

// DELTA - a rebel-style arrowhead: one thin triangular wing plate, a raised
// spine + canopy, twin canted tail fins and twin underslung engines.
function buildDeltaHull(): BufferGeometry {
  const parts: BufferGeometry[] = []

  // main wing: a 3-sided prism (triangle in plan view), nose vertex forward
  const wing = new CylinderGeometry(2.1, 2.1, 0.24, 3)
  wing.rotateY(Math.PI) // put the leading vertex on -Z
  wing.scale(1, 1, 1.6) // stretch nose-to-tail into a slim arrow
  parts.push(wing)

  // central spine (raised fuselage ridge) + cockpit bubble
  const spine = new BoxGeometry(0.52, 0.4, 2.8)
  spine.translate(0, 0.26, 0.1)
  parts.push(spine)
  const cockpit = new SphereGeometry(0.4, 8, 5)
  cockpit.scale(0.75, 0.55, 1.25)
  cockpit.translate(0, 0.5, -0.65)
  parts.push(cockpit)

  // twin tail fins, canted slightly outward
  for (const side of [-1, 1]) {
    const fin = new BoxGeometry(0.07, 0.9, 1.05)
    fin.translate(0, 0.5, 0)
    fin.rotateZ(-side * 0.2)
    fin.translate(side * 1.15, 0.12, 1.25)
    parts.push(fin)
  }

  // twin engines under the trailing edge
  for (const side of [-1, 1]) {
    const engine = new CylinderGeometry(0.24, 0.21, 1.4, 8)
    engine.rotateX(Math.PI / 2)
    engine.translate(side * 0.85, -0.06, 1.55)
    parts.push(engine)
  }

  return mergeHull(parts, 'delta')
}

function mergeHull(parts: BufferGeometry[], name: string): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error(`ship: failed to merge ${name} hull geometry`)
  parts.forEach((p) => p.dispose())
  return merged
}

const BUILDERS: Record<HullId, () => BufferGeometry> = {
  raptor: buildRaptorHull,
  falcon: buildFalconHull,
  delta: buildDeltaHull,
}

export function createShip(): Ship {
  // one fill material + one fat-line material SHARED by all hulls, so the pickup
  // flash and the resolution updates apply to whichever hull is visible.
  const fillMat = new MeshBasicMaterial({
    color: new Color().setRGB(...RENDER.SHIP_FILL_RGB),
    side: FrontSide,
  })
  const lineMat = new LineMaterial({
    color: new Color().setRGB(...RENDER.SHIP_RGB).getHex(),
    linewidth: SHIP.LINE_WIDTH,
    worldUnits: false,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
  })
  // setRGB above can exceed 1; preserve the HDR values for strong bloom
  lineMat.color.setRGB(...RENDER.SHIP_RGB)

  // The outer group sits on the wall (position + roll with theta); the hull parts
  // hang in an inner pivot that carries the attitude (yaw into the slide, bank).
  const group = new Group()
  group.scale.setScalar(SHIP.SCALE)
  const pivot = new Group()
  pivot.rotation.order = 'YXZ' // heading first, then the bank about the hull's own nose axis
  group.add(pivot)
  const attitude = createAttitude()

  // build every hull once (small geometry); the selector just flips visibility.
  const hulls = new Map<HullId, Group>()
  for (const { id } of SHIP.HULLS) {
    const hull = BUILDERS[id]()
    const sub = new Group()
    sub.add(new Mesh(hull, fillMat))
    const edgesGeo = new EdgesGeometry(hull, 24)
    const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo)
    const edges = new LineSegments2(lineGeo, lineMat)
    edges.computeLineDistances()
    edgesGeo.dispose()
    sub.add(edges)
    sub.visible = false
    pivot.add(sub)
    hulls.set(id, sub)
  }
  const first = hulls.get(SHIP.HULLS[0]!.id)
  if (first) first.visible = true

  const shipRadius = RIDE_RADIUS

  // edge-color flash (pickups): tint toward flashColor, then decay back to base.
  // flashColor is set per call (blue for orbs, green for extra-life crosses).
  const baseColor = new Color().setRGB(...RENDER.SHIP_RGB)
  const flashColor = new Color().setRGB(...RENDER.SHIP_FLASH_RGB)
  let flashT = 0 // seconds of flash remaining

  // preview scratch (hoisted: no per-frame allocation)
  const pDir = new Vector3()
  const pRight = new Vector3()
  let pYaw = 0

  function tickFlash(dt: number): void {
    // hold at full for FLASH_HOLD, then fade over FLASH_TIME back to base
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt)
      const intensity = flashT >= SHIP.FLASH_TIME ? 1 : flashT / SHIP.FLASH_TIME
      lineMat.color.lerpColors(baseColor, flashColor, intensity)
    }
  }

  return {
    object: group,
    update(craft: CraftState, dt: number): void {
      group.position.set(
        Math.sin(craft.theta) * shipRadius,
        -Math.cos(craft.theta) * shipRadius,
        SHIP.Z,
      )
      // sit tangent on the wall (roll with theta). Full rotation.set (not just z):
      // it also clears a title-preview turntable pose.
      group.rotation.set(0, 0, craft.theta)
      // the nose turns toward the slide (+yaw = increasing theta = local +x; the nose
      // is -Z, so that is a negative turn about Y) and the hull banks into it
      attitude.update(craft.omega, craft.speed, craft.steerSignal, dt)
      pivot.rotation.set(0, -attitude.yaw, attitude.roll)
      tickFlash(dt)
    },
    preview(camera: PerspectiveCamera, dt: number): void {
      pYaw += SHIP.PREVIEW_SPIN * dt
      camera.getWorldDirection(pDir)
      pRight.crossVectors(pDir, camera.up).normalize()
      group.position
        .copy(camera.position)
        .addScaledVector(pDir, SHIP.PREVIEW_DIST)
        .addScaledVector(pRight, SHIP.PREVIEW_RIGHT)
      group.position.y -= SHIP.PREVIEW_DOWN
      group.rotation.set(SHIP.PREVIEW_TILT, pYaw, 0)
      pivot.rotation.set(0, 0, 0)
      attitude.reset()
      tickFlash(dt)
    },
    setHull(id: HullId): void {
      for (const [hullId, sub] of hulls) sub.visible = hullId === id
    },
    flash(rgb?: readonly [number, number, number]): void {
      flashColor.setRGB(...(rgb ?? RENDER.SHIP_FLASH_RGB))
      flashT = SHIP.FLASH_HOLD + SHIP.FLASH_TIME
    },
    setResolution(w: number, h: number): void {
      lineMat.resolution.set(w, h)
    },
  }
}

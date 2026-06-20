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
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { SHIP, RENDER, RIDE_RADIUS } from '../config'
import { type CraftState } from '../craft'

export interface Ship {
  object: Group
  update(craft: CraftState, dt: number): void
  flash(): void // momentary blue edge flash (orb pickup), decays over SHIP.FLASH_TIME
  setResolution(w: number, h: number): void
}

// Build the winged-fighter hull (X-wing-ish) from primitives. Nose points -Z
// (forward). Returned geometry feeds both the dark fill and the glowing edges.
function buildHull(): BufferGeometry {
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

  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('ship: failed to merge hull geometry')
  parts.forEach((p) => p.dispose())
  return merged
}

export function createShip(): Ship {
  const hull = buildHull()

  // dark, depth-writing fill so the craft reads as a solid edge-lit object
  const fill = new Mesh(
    hull,
    new MeshBasicMaterial({ color: new Color().setRGB(...RENDER.SHIP_FILL_RGB), side: FrontSide }),
  )

  // glowing edges via fat lines
  const edgesGeo = new EdgesGeometry(hull, 24)
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo)
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
  const edges = new LineSegments2(lineGeo, lineMat)
  edges.computeLineDistances()
  edgesGeo.dispose()

  const group = new Group()
  group.add(fill)
  group.add(edges)
  group.scale.setScalar(SHIP.SCALE)

  const shipRadius = RIDE_RADIUS

  // edge-color flash (orb pickup): tint toward blue, then decay back to base.
  const baseColor = new Color().setRGB(...RENDER.SHIP_RGB)
  const flashColor = new Color().setRGB(...RENDER.SHIP_FLASH_RGB)
  let flashT = 0 // seconds of flash remaining

  return {
    object: group,
    update(craft: CraftState, dt: number): void {
      group.position.set(
        Math.sin(craft.theta) * shipRadius,
        -Math.cos(craft.theta) * shipRadius,
        SHIP.Z,
      )
      // sit tangent on the wall (roll with theta), lean into the steer input
      group.rotation.z = craft.theta - SHIP.BANK * craft.steerSignal

      // hold at full for FLASH_HOLD, then fade over FLASH_TIME back to base
      if (flashT > 0) {
        flashT = Math.max(0, flashT - dt)
        const intensity = flashT >= SHIP.FLASH_TIME ? 1 : flashT / SHIP.FLASH_TIME
        lineMat.color.lerpColors(baseColor, flashColor, intensity)
      }
    },
    flash(): void {
      flashT = SHIP.FLASH_HOLD + SHIP.FLASH_TIME
    },
    setResolution(w: number, h: number): void {
      lineMat.resolution.set(w, h)
    },
  }
}

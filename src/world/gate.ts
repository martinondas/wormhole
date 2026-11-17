import { Group } from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { GATE, TUBE } from '../config'

// The level gate: a thin bright frame around the whole tunnel, drawn as two rings
// close to the wall joined by short ticks. The middle of the view stays open, so
// raiders, mines and gems behind the gate stay readable. It stands at a fixed world
// distance, so it comes out of the fog and grows as the craft flies toward it. It
// turns slowly about the tube axis, which sets it apart from the still rings of the
// tube. When the craft is through, it widens and fades around the ship.
//
// View only: the session decides where the gate is and when the level changes.
export interface Gate {
  object: Group
  open(worldDistance: number): void // show the gate at a distance along the tube
  pass(): void // the craft is through: widen and fade
  update(dt: number, craftDistance: number): void
  reset(): void // hide it (a new run)
  setResolution(w: number, h: number): void
}

export function createGate(): Gate {
  const outer = TUBE.RADIUS * GATE.RADIUS
  const inner = TUBE.RADIUS * GATE.INNER
  const positions: number[] = []
  const point = (r: number, a: number): void => {
    positions.push(Math.sin(a) * r, -Math.cos(a) * r, 0)
  }
  for (const r of [outer, inner]) {
    for (let s = 0; s < GATE.SEGMENTS; s++) {
      point(r, (s / GATE.SEGMENTS) * Math.PI * 2)
      point(r, ((s + 1) / GATE.SEGMENTS) * Math.PI * 2)
    }
  }
  // one short tick per longitudinal tube line joins the two rings
  const ticks = TUBE.LONGITUDINAL_LINES
  for (let s = 0; s < ticks; s++) {
    const a = (s / ticks) * Math.PI * 2
    point(inner, a)
    point(outer, a)
  }
  const geometry = new LineSegmentsGeometry().setPositions(positions)
  const material = new LineMaterial({
    linewidth: GATE.LINE_WIDTH,
    worldUnits: false,
    transparent: true,
    depthWrite: false,
    fog: true, // it fades in through the tube fog as it approaches
  })
  material.color.setRGB(...GATE.RGB) // components above 1 keep a light bloom
  const lines = new LineSegments2(geometry, material)
  const object = new Group()
  object.add(lines)
  object.visible = false

  let at = 0 // world distance where the gate stands
  let passT = -1 // 0..1 progress of the fade after the pass; below 0 before it

  return {
    object,
    open(worldDistance: number): void {
      at = worldDistance
      passT = -1
      object.visible = true
      object.scale.setScalar(1)
      material.opacity = 1
    },
    pass(): void {
      if (object.visible && passT < 0) passT = 0
    },
    update(dt: number, craftDistance: number): void {
      if (!object.visible) return
      object.rotation.z += GATE.SPIN * dt
      if (passT >= 0) {
        // the fade plays at the ship, so it stays in view at any speed
        passT += dt / GATE.PASS_TIME
        if (passT >= 1) {
          object.visible = false
          return
        }
        object.position.z = 0
        object.scale.setScalar(1 + (GATE.PASS_SCALE - 1) * passT)
        material.opacity = 1 - passT
        return
      }
      object.position.z = craftDistance - at
    },
    reset(): void {
      object.visible = false
      passT = -1
    },
    setResolution(w: number, h: number): void {
      material.resolution.set(w, h)
    },
  }
}

import { Shape, ExtrudeGeometry, Group } from 'three'
import { EXTRA_LIFE } from '../config'
import { type WallObject } from './wallObject'
import { createEdgeLitSolid } from './edgeLitSolid'

// A rare extra-life pickup: a bright-green medkit cross (a chunky 3D plus). The
// plus is the universal "health / +1" icon, so it reads instantly and stays
// shape-distinct from every other wall object (orb sphere / gem diamond / mine
// ball / raider dart) even though green is the theme color. Edge-lit solid (see
// createEdgeLitSolid). It rides at the shared RIDE_RADIUS like the others, so the
// angle-only proximity check works directly.

// A centered plus polygon extruded along z. ARM = arm half-length, THICK = arm
// half-thickness; 12 vertices trace the cross outline.
function buildCross(): ExtrudeGeometry {
  const a = EXTRA_LIFE.ARM
  const t = EXTRA_LIFE.THICK
  const s = new Shape()
  s.moveTo(-t, -a)
  s.lineTo(t, -a)
  s.lineTo(t, -t)
  s.lineTo(a, -t)
  s.lineTo(a, t)
  s.lineTo(t, t)
  s.lineTo(t, a)
  s.lineTo(-t, a)
  s.lineTo(-t, t)
  s.lineTo(-a, t)
  s.lineTo(-a, -t)
  s.lineTo(-t, -t)
  s.closePath()
  const geo = new ExtrudeGeometry(s, { depth: EXTRA_LIFE.DEPTH * 2, bevelEnabled: false })
  geo.translate(0, 0, -EXTRA_LIFE.DEPTH) // center the depth on z=0 (x/y already centered)
  return geo
}

export function createExtraLife(): WallObject {
  const solid = createEdgeLitSolid(buildCross(), EXTRA_LIFE.EDGE_RGB, EXTRA_LIFE.FILL_RGB, EXTRA_LIFE.LINE_WIDTH, EXTRA_LIFE.EDGE_THRESHOLD)
  const inner = solid.inner // spins + bobs + pulses; the outer group is positioned by the pool
  const object = new Group()
  object.add(inner)

  let t = 0
  return {
    object,
    update(dt: number): void {
      t += dt
      inner.rotation.y += EXTRA_LIFE.SPIN_SPEED * dt
      inner.position.y = Math.sin(t * EXTRA_LIFE.BOB_SPEED) * EXTRA_LIFE.BOB_AMP
      // beckoning pulse (scale only: cheap, never leaves the ride radius)
      const s = 1 + Math.sin(t * EXTRA_LIFE.PULSE_SPEED) * EXTRA_LIFE.PULSE_AMP
      inner.scale.setScalar(s)
    },
    setResolution: solid.setResolution,
    setOpacity: solid.setOpacity,
  }
}

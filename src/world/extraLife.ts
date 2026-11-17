import { Shape, ExtrudeGeometry, RingGeometry, Group } from 'three'
import { EXTRA_LIFE } from '../config'
import { type WallObject } from './wallObject'
import { createEdgeLitSolid } from './edgeLitSolid'

// The green cross: a bright-green medkit cross (a chunky 3D plus). The
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

// The cross at `scale`. With `ring`, a halo ring surrounds it: it faces the player,
// does not spin, and breathes against the cross's own pulse. The whole-life cross
// has the ring; the life shard is the bare cross, smaller.
export function createExtraLife(scale: number, ring = false): WallObject {
  const solid = createEdgeLitSolid(buildCross(), EXTRA_LIFE.EDGE_RGB, EXTRA_LIFE.FILL_RGB, EXTRA_LIFE.LINE_WIDTH, EXTRA_LIFE.EDGE_THRESHOLD)
  const inner = solid.inner // spins + bobs + pulses; the outer group is positioned by the pool
  const object = new Group()
  object.add(inner)

  const R = EXTRA_LIFE.RING
  const halo = ring
    ? createEdgeLitSolid(new RingGeometry(EXTRA_LIFE.ARM * R.INNER, EXTRA_LIFE.ARM * R.OUTER, 40), EXTRA_LIFE.EDGE_RGB, EXTRA_LIFE.FILL_RGB, R.LINE_WIDTH, EXTRA_LIFE.EDGE_THRESHOLD)
    : undefined
  if (halo) object.add(halo.inner)

  inner.scale.setScalar(scale)
  let t = 0
  return {
    object,
    update(dt: number): void {
      t += dt
      inner.rotation.y += EXTRA_LIFE.SPIN_SPEED * dt
      inner.position.y = Math.sin(t * EXTRA_LIFE.BOB_SPEED) * EXTRA_LIFE.BOB_AMP * scale
      // beckoning pulse (scale only: cheap, never leaves the ride radius)
      const pulse = Math.sin(t * EXTRA_LIFE.PULSE_SPEED)
      inner.scale.setScalar(scale * (1 + pulse * EXTRA_LIFE.PULSE_AMP))
      halo?.inner.scale.setScalar(scale * (1 - pulse * R.PULSE_AMP))
    },
    setResolution(w: number, h: number): void {
      solid.setResolution(w, h)
      halo?.setResolution(w, h)
    },
    setOpacity(o: number): void {
      solid.setOpacity(o)
      halo?.setOpacity(o)
    },
  }
}

import { BoxGeometry, ConeGeometry, CylinderGeometry, BufferGeometry, Group } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ENEMY } from '../config'
import { lerp } from '../util/math'
import { createEdgeLitSolid } from './edgeLitSolid'

// The magenta raider: a lean FORWARD-SWEPT DART, edge-lit like the ship/mine but
// hot magenta-violet on NORMAL blend (additive HDR magenta would wash to white).
// CRITICAL: the nose points toward +Z (toward the camera/player), the mirror of
// the player ship (nose -Z), because the raider flies ahead of you and shoots
// back. The pool (enemies.ts) owns the outer transform (position on the wall +
// bank); this object only throbs, fades (death pop), and brightens (charge tell).

export interface Enemy {
  object: Group
  update(dt: number): void
  setResolution(w: number, h: number): void
  setOpacity(o: number): void // 1 = normal; drives the death-pop fade
  setCharge(t01: number): void // 0 = idle magenta, 1 = white-hot (firing telegraph / hit flash)
}

function buildDart(): BufferGeometry {
  const parts: BufferGeometry[] = []

  // fuselage: pentagonal prism along Z, narrow at the +Z nose, fatter at the tail
  const fuse = new CylinderGeometry(0.3, 0.42, 2.4, 5)
  fuse.rotateX(Math.PI / 2) // +Y -> +Z, so radiusTop(0.3) sits at the +Z nose
  parts.push(fuse)

  // nose spike, apex toward +Z (pointing at the player)
  const nose = new ConeGeometry(0.3, 1.1, 5)
  nose.rotateX(Math.PI / 2)
  nose.translate(0, 0, 1.75)
  parts.push(nose)

  // a forward-swept delta: two flat wing blades whose tips rake toward the nose
  for (const side of [1, -1]) {
    const wing = new BoxGeometry(1.7, 0.05, 0.9)
    wing.translate(1.05 * side, 0, 0) // root near the fuselage, span out to ~1.9
    wing.rotateY(-0.3 * side) // sweep the outboard tip forward (+Z)
    parts.push(wing)

    // outboard cannon stub at the wing tip (also the muzzle anchor in spirit)
    const cannon = new CylinderGeometry(0.09, 0.07, 1.0, 5)
    cannon.rotateX(Math.PI / 2)
    cannon.translate(1.75 * side, 0, 0.2)
    parts.push(cannon)
  }

  // single dorsal tail fin (breaks the player's radial symmetry)
  const fin = new BoxGeometry(0.05, 0.7, 0.7)
  fin.translate(0, 0.35, -1.0)
  parts.push(fin)

  // Drop indices uniformly before merging (mergeGeometries needs all-or-none), as
  // hazard.ts does: mixed indexed/non-indexed parts cannot merge.
  const flat = parts.map((p) => {
    const n = p.index ? p.toNonIndexed() : p
    if (n !== p) p.dispose()
    return n
  })
  const merged = mergeGeometries(flat, false)
  if (!merged) throw new Error('enemy: failed to merge dart geometry')
  flat.forEach((p) => p.dispose())
  return merged
}

export function createEnemy(): Enemy {
  const solid = createEdgeLitSolid(buildDart(), ENEMY.EDGE_RGB, ENEMY.FILL_RGB, ENEMY.LINE_WIDTH, ENEMY.EDGE_THRESHOLD)
  const inner = solid.inner // throbs (scale); the pool owns the outer group's position + bank
  const lineMat = solid.lineMat
  const object = new Group()
  object.add(inner)

  let t = 0
  let lastCharge = -1 // skip the lerp + setRGB when the charge level is unchanged
  return {
    object,
    update(dt: number): void {
      t += dt
      const s = 1 + Math.sin(t * ENEMY.THROB_SPEED) * ENEMY.THROB_AMP
      inner.scale.setScalar(ENEMY.SCALE * s)
    },
    setResolution: solid.setResolution,
    setOpacity: solid.setOpacity,
    setCharge(t01: number): void {
      // Called every substep for every active enemy, but the level only changes
      // while charging or hit-flashing - an idle raider asks for the same value
      // each step. Skip the lerp + setRGB unless it actually changed.
      if (t01 === lastCharge) return
      lastCharge = t01
      // lerp the edge color from idle magenta toward white-hot as the shot charges
      lineMat.color.setRGB(
        lerp(ENEMY.EDGE_RGB[0], ENEMY.CHARGE_RGB[0], t01),
        lerp(ENEMY.EDGE_RGB[1], ENEMY.CHARGE_RGB[1], t01),
        lerp(ENEMY.EDGE_RGB[2], ENEMY.CHARGE_RGB[2], t01),
      )
    },
  }
}

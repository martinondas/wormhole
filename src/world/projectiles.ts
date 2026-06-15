import { Group, Color, NormalBlending } from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { PROJECTILE, GUN, RIDE_RADIUS } from '../config'
import { angleDiff } from '../util/math'

// ONE pooled bolt system for BOTH sides. A bolt is a small camera-facing diamond
// glyph; only the travel direction (z) and color differ:
//   player bolts travel -Z (forward, away down the tube) and try to kill enemies;
//   enemy bolts travel +Z (toward the ship plane at z=0) and can cost a life.
// (A bolt is seen nearly END-ON looking down the tube, so a Z-aligned streak would
//  foreshorten to an invisible dot. A fronto-parallel diamond in the XY plane stays
//  a crisp bright glyph that just shrinks with distance as it travels.)
// Bolt z is SHIP-RELATIVE (ship at z=0, like every wall object), advanced by the
// bolt's own speed; enemies recompute their ship-relative z each step too, so the
// angle-only hit tests line up. Fixed pools -> zero per-frame allocation.

export type BoltSide = 'player' | 'enemy'

// What the bolt update needs from the rest of the world, injected by main.ts so
// projectiles import neither enemies nor game directly.
export interface ProjectileCtx {
  tryKillEnemy(theta: number, z: number): boolean // true if the bolt struck an enemy (consume it)
  shipTheta: number
  onShipHit(): boolean // lethal hit on the ship (routes to game.hitHazard)
}

export interface Projectiles {
  object: Group
  spawn(side: BoltSide, theta: number, z: number, vz: number): void
  update(dt: number, ctx: ProjectileCtx): void
  setResolution(w: number, h: number): void
  reset(): void
}

interface Bolt {
  active: boolean
  side: BoltSide
  theta: number
  z: number
  vz: number
  ttl: number
  mesh: LineSegments2
}

// Enemy bolts only need to live long enough to cross the engagement band to the
// ship and a little past; a generous ceiling so a miss recycles rather than camps.
const ENEMY_BOLT_TTL = 1.6

function makeBoltMaterial(rgb: [number, number, number]): LineMaterial {
  const mat = new LineMaterial({
    color: new Color().setRGB(...rgb).getHex(),
    linewidth: PROJECTILE.LINE_WIDTH,
    worldUnits: false,
    transparent: true,
    depthTest: true,
    blending: NormalBlending, // keep the hue (additive HDR would wash to white)
    fog: true,
  })
  mat.color.setRGB(...rgb) // preserve HDR (>1) components for strong bloom
  return mat
}

export function createProjectiles(): Projectiles {
  const group = new Group()
  const radius = RIDE_RADIUS

  // ONE shared diamond geometry (XY plane, faces the camera) and ONE material per
  // side; every bolt mesh of a side reuses them.
  const geo = new LineSegmentsGeometry()
  const r = PROJECTILE.LENGTH / 2
  geo.setPositions([
    0, r, 0, r, 0, 0, // top -> right
    r, 0, 0, 0, -r, 0, // right -> bottom
    0, -r, 0, -r, 0, 0, // bottom -> left
    -r, 0, 0, 0, r, 0, // left -> top
  ])

  const playerMat = makeBoltMaterial(PROJECTILE.PLAYER_RGB)
  const enemyMat = makeBoltMaterial(PROJECTILE.ENEMY_RGB)

  function makePool(n: number, side: BoltSide, mat: LineMaterial): Bolt[] {
    const pool: Bolt[] = []
    for (let i = 0; i < n; i++) {
      // no computeLineDistances(): bolts are not dashed, so the instanceDistance
      // attributes it writes are never read (the diamond glyph, not line distances,
      // is what makes a forward bolt visible end-on - see the geometry note above).
      const mesh = new LineSegments2(geo, mat)
      mesh.visible = false
      group.add(mesh)
      pool.push({ active: false, side, theta: 0, z: 0, vz: 0, ttl: 0, mesh })
    }
    return pool
  }

  const playerBolts = makePool(PROJECTILE.MAX_PLAYER, 'player', playerMat)
  const enemyBolts = makePool(PROJECTILE.MAX_ENEMY, 'enemy', enemyMat)
  const all = [...playerBolts, ...enemyBolts]

  function place(b: Bolt): void {
    b.mesh.position.set(Math.sin(b.theta) * radius, -Math.cos(b.theta) * radius, b.z)
  }

  function deactivate(b: Bolt): void {
    b.active = false
    b.mesh.visible = false
  }

  return {
    object: group,

    spawn(side: BoltSide, theta: number, z: number, vz: number): void {
      const pool = side === 'player' ? playerBolts : enemyBolts
      // find a free bolt with a plain loop (no per-shot closure alloc). On
      // exhaustion DROP the shot rather than relocating a live bolt (a dropped
      // shot is far less jarring than a teleport). Pools are sized so this never
      // triggers in normal play - see PROJECTILE.MAX_*.
      let b: Bolt | undefined
      for (let i = 0; i < pool.length; i++) {
        if (!pool[i]!.active) {
          b = pool[i]
          break
        }
      }
      if (!b) return
      b.active = true
      b.theta = theta
      b.z = z
      b.vz = vz
      b.ttl = side === 'player' ? GUN.BOLT_TTL : ENEMY_BOLT_TTL
      b.mesh.visible = true
      place(b)
    },

    update(dt: number, ctx: ProjectileCtx): void {
      for (const b of all) {
        if (!b.active) continue
        b.z += b.vz * dt
        b.ttl -= dt

        let consumed = false
        if (b.side === 'player') {
          if (ctx.tryKillEnemy(b.theta, b.z)) consumed = true
        } else {
          // enemy bolt: lethal at the ship plane; if it sails past, it missed.
          if (
            Math.abs(b.z) < GUN.BULLET_HIT_Z &&
            Math.abs(angleDiff(ctx.shipTheta, b.theta)) < GUN.BULLET_HIT_ANGLE
          ) {
            ctx.onShipHit() // consume whether or not a life was lost (invuln guard inside game)
            consumed = true
          } else if (b.z > GUN.BULLET_HIT_Z) {
            consumed = true // passed the ship without hitting - a clean dodge
          }
        }

        if (consumed || b.ttl <= 0) {
          deactivate(b)
          continue
        }
        place(b)
      }
    },

    setResolution(w: number, h2: number): void {
      playerMat.resolution.set(w, h2)
      enemyMat.resolution.set(w, h2)
    },

    reset(): void {
      for (const b of all) deactivate(b)
    },
  }
}

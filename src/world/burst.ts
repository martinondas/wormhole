import { Group, NormalBlending } from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { BURST, CAMERA, RIDE_RADIUS } from '../config'
import { lerp } from '../util/math'

// A pooled IMPACT BURST: a white-hot flash that blooms out into glowing line shards
// flying outward and fading. Played on a real hit so the player SEES the impact, not
// just hears it. Mirrors projectiles.ts: a fixed pool (zero per-frame allocation) and
// a camera-facing glyph in the XY plane (reads end-on looking down the tube). One
// ragged starburst geometry is shared across the pool; each cell owns its own
// LineMaterial (color + width animate per burst). NORMAL blend keeps the shard hue
// (additive HDR would wash to white) - the white-hot START frame is the flash.
//
// TWO kinds (see config BURST):
//   'kill'   - magenta; FROZEN at its spawn z (stays framed) and distance-compensated
//              to a constant screen size, so a near or far kill blooms the same.
//   'damage' - big bright SHORT red; WORLD-ANCHORED (its z tracks a fixed world point,
//              so it recedes as the craft flies forward instead of hanging in front of
//              it); not distance-compensated, so it reads big right at the ship.

export type BurstKind = 'kill' | 'damage'

export interface Burst {
  object: Group
  // craftDist = craft.distance at the hit; a world-anchored ('damage') burst recedes
  // relative to it as the craft advances. Frozen ('kill') bursts ignore it.
  spawn(kind: BurstKind, theta: number, z: number, craftDist: number): void
  update(dt: number, craftDist: number): void
  setResolution(w: number, h: number): void
  reset(): void
}

const TAU = Math.PI * 2

// One shared starburst: SHARDS short segments radiating from a small inner radius,
// each with a slightly jittered angle and a varied length. Tip reach is normalized
// to <= 1.0, so a mesh scale of S puts the shard tips at radius S world units. Built
// once; per-spawn variety comes from a random roll on the mesh.
function buildStarburst(): LineSegmentsGeometry {
  const pos: number[] = []
  const inner = 0.12
  for (let i = 0; i < BURST.SHARDS; i++) {
    const a = (i / BURST.SHARDS) * TAU + (Math.random() - 0.5) * (TAU / BURST.SHARDS) * 0.8
    const reach = inner + (0.55 + Math.random() * 0.45) * (1 - inner) // tip radius in (inner, 1.0]
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    pos.push(ca * inner, sa * inner, 0, ca * reach, sa * reach, 0)
  }
  const geo = new LineSegmentsGeometry()
  geo.setPositions(pos)
  return geo
}

interface Cell {
  active: boolean
  t: number // 0..1 over `duration`
  mesh: LineSegments2
  mat: LineMaterial
  color: [number, number, number] // the kind color this burst fades toward
  spread: number // peak shard-tip radius for THIS burst (distance-scaled at spawn for kills)
  duration: number // lifetime (s) for THIS burst
  anchored: boolean // true = world-anchored (z recedes as the craft advances); false = frozen at spawn z
  z0: number // ship-relative z at spawn
  anchorDist: number // craft.distance at spawn (world anchor reference)
}

export function createBurst(): Burst {
  const group = new Group()
  const geo = buildStarburst()
  const cells: Cell[] = []

  for (let i = 0; i < BURST.POOL; i++) {
    const mat = new LineMaterial({
      linewidth: BURST.LINE_WIDTH,
      worldUnits: false,
      transparent: true,
      depthTest: true,
      depthWrite: false, // overlapping shards from one origin: don't depth-fight each other
      blending: NormalBlending, // keep the hue; the white-hot START frame is the flash, not additive
      fog: true, // sit in the scene depth like every other object
    })
    const mesh = new LineSegments2(geo, mat)
    mesh.visible = false
    group.add(mesh)
    cells.push({
      active: false,
      t: 0,
      mesh,
      mat,
      color: [1, 1, 1],
      spread: BURST.SPREAD,
      duration: BURST.DURATION,
      anchored: false,
      z0: 0,
      anchorDist: 0,
    })
  }

  return {
    object: group,

    spawn(kind: BurstKind, theta: number, z: number, craftDist: number): void {
      // first free cell; on exhaustion DROP the burst (like projectiles drop a bolt).
      let c: Cell | undefined
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i]!.active) {
          c = cells[i]
          break
        }
      }
      if (!c) return

      const dmg = kind === 'damage'
      const rgb = dmg ? BURST.DAMAGE_RGB : BURST.KILL_RGB
      const baseSpread = dmg ? BURST.DAMAGE_SPREAD : BURST.SPREAD
      // Distance-compensate kills only: scale to a constant screen size so a near or far
      // kill blooms alike (bloom is a fixed screen-space size). Damage bursts keep their
      // full size so they read big right at the ship. The chase camera sits ~CAMERA.BACK
      // ahead at +z; z<=0 is down the tube, so distance = BACK - z (clamped above 0).
      const dist = Math.max(6, CAMERA.BACK - z)
      const spread = dmg ? baseSpread : baseSpread * Math.min(1, dist / BURST.REF_DIST)

      c.active = true
      c.t = 0
      c.color[0] = rgb[0]
      c.color[1] = rgb[1]
      c.color[2] = rgb[2]
      c.spread = spread
      c.duration = dmg ? BURST.DAMAGE_DURATION : BURST.DURATION
      c.anchored = dmg
      c.z0 = z
      c.anchorDist = craftDist
      c.mat.linewidth = dmg ? BURST.DAMAGE_LINE_WIDTH : BURST.LINE_WIDTH
      c.mesh.position.set(Math.sin(theta) * RIDE_RADIUS, -Math.cos(theta) * RIDE_RADIUS, z)
      c.mesh.rotation.z = Math.random() * TAU
      c.mesh.scale.setScalar(spread * 0.22)
      c.mat.color.setRGB(BURST.FLASH_RGB[0], BURST.FLASH_RGB[1], BURST.FLASH_RGB[2])
      c.mat.opacity = 1
      c.mesh.visible = true
    },

    update(dt: number, craftDist: number): void {
      for (const c of cells) {
        if (!c.active) continue
        c.t += dt / c.duration
        const t = Math.min(c.t, 1)
        // easeOutCubic: the shards burst out fast then settle (an explosion, not a balloon).
        const inv = 1 - t
        const e = 1 - inv * inv * inv
        c.mesh.scale.setScalar(c.spread * (0.22 + 0.78 * e))
        // world-anchored bursts recede as the craft advances (z grows toward the camera,
        // so the burst stays put in space and you fly past it); frozen ones hold their z.
        if (c.anchored) c.mesh.position.z = c.z0 + (craftDist - c.anchorDist)
        // white-hot -> kind color on a FASTER curve than the fade: the core clamps to
        // white under NoToneMapping, so a hue tied to the (linear) fade would only show
        // once the shard is nearly gone. Resolving by FLASH_FRACTION of life makes the
        // red / magenta read while the shard is still bright.
        const ct = Math.min(1, c.t / BURST.FLASH_FRACTION)
        c.mat.color.setRGB(
          lerp(BURST.FLASH_RGB[0], c.color[0], ct),
          lerp(BURST.FLASH_RGB[1], c.color[1], ct),
          lerp(BURST.FLASH_RGB[2], c.color[2], ct),
        )
        c.mat.opacity = 1 - t
        if (c.t >= 1) {
          c.active = false
          c.mesh.visible = false
        }
      }
    },

    setResolution(w: number, h: number): void {
      for (const c of cells) c.mat.resolution.set(w, h)
    },

    reset(): void {
      for (const c of cells) {
        c.active = false
        c.mesh.visible = false
      }
    },
  }
}

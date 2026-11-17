import { Group, AdditiveBlending, type InterleavedBufferAttribute } from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { BLAST, BLAST_FX, HAZARD, RIDE_RADIUS, TUBE } from '../config'
import { angleDiff } from '../util/math'
import { createHazard } from './hazard'
import { farScale } from './farScale'
import { type WallObject } from './wallObject'

// The look of a mine blast (config BLAST_FX). Drawing only: the game has decided
// everything before any of this is shown, and all of it runs on one clock (the
// frame time the caller passes to update), also after the run has ended.
//
//   rim    - the outline of the blast on the wall, at exactly BLAST.RADIUS, drawn at
//            full size and full brightness in the frame of the shot, for every link
//            of a chain at once. That frame is the truth: what was inside the rim
//            then was hit. It is drawn twice, where the objects ride and on the tube
//            wall. Afterwards it only fades, anchored to the wall, and the ship may
//            fly through it: by then nothing is decided any more.
//   wave   - a ring that runs out from the mine to the rim: the motion of the blast.
//   mine   - a stand-in for the detonated mine (the game took it off the wall at
//            the shot). It stays on the wall until its link's turn, then pops.
//   shards - the mine's horns and shell flying apart as short hot streaks.
//   debris - what the blast destroyed: a few streaks in the object's own colour.
//            They stand where the object stood until the wave reaches them, then
//            fly away from the blast centre, faster the nearer they were.
// The links of a chain start one after another (BLAST_FX.RIPPLE).
//
// Everything is anchored to the wall (a world distance), so it scrolls past like the
// mine it came from. All lines of a kind are ONE LineSegments2 with per-segment
// colours, written straight into the geometry's buffers each frame: two draw calls
// for the lines of any number of blasts, plus each stand-in mine while it shows, and
// no allocation. Additive blend, so a fade is just a darker colour and an unused
// segment (black) draws nothing. The blast's own colours keep blue below 1, so bloom
// never clamps them to the white of a raider's firing tell.

export type RGB = readonly [number, number, number]

export interface BlastFx {
  object: Group
  // A mine went off at (theta, worldDistance) as chain link `link`: its rim shows
  // now, the rest waits for the link's turn in the ripple.
  detonate(theta: number, worldDistance: number, link: number): void
  // The blast of the last detonate() destroyed an object at (theta, worldDistance):
  // it breaks into `pieces` streaks of `rgb` that fly away from that blast's centre.
  debris(theta: number, worldDistance: number, rgb: RGB, pieces: number): void
  update(dt: number, craftDist: number): void
  setResolution(w: number, h: number): void
  reset(): void
}

// One LineSegments2 whose segments are written in place. The position and colour
// buffers hold 6 floats per segment (start xyz / rgb, end xyz / rgb).
interface Lines {
  mesh: LineSegments2
  mat: LineMaterial
  pos: Float32Array
  col: Float32Array
  flush(): void
}
function createLines(count: number, lineWidth: number): Lines {
  const geo = new LineSegmentsGeometry()
  geo.setPositions(new Float32Array(count * 6))
  geo.setColors(new Float32Array(count * 6))
  const posAttr = geo.getAttribute('instanceStart') as InterleavedBufferAttribute
  const colAttr = geo.getAttribute('instanceColorStart') as InterleavedBufferAttribute
  const mat = new LineMaterial({
    linewidth: lineWidth,
    worldUnits: false,
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  })
  const mesh = new LineSegments2(geo, mat)
  mesh.frustumCulled = false // the segments move every frame; the buffers carry no bounds
  return {
    mesh,
    mat,
    pos: posAttr.data.array as Float32Array,
    col: colAttr.data.array as Float32Array,
    flush(): void {
      posAttr.data.needsUpdate = true
      colAttr.data.needsUpdate = true
    },
  }
}

interface Ring {
  active: boolean
  t: number // s since the shot
  delay: number // its link's turn in the ripple (s): the wave and the mine's pop start then
  theta: number
  wd: number
  mine: WallObject // the stand-in for the detonated mine
  popping: boolean // its pop has started: popZ holds the place it plays at
  popZ: number // ship-relative z the pop plays at (frozen when it starts, like a field pop)
}

interface Piece {
  active: boolean
  t: number // s since it started to fly (below 0: waiting)
  shown: boolean // drawn while it waits (debris stands where its object stood)
  life: number
  x: number // position: x, y across the tube, wd along it
  y: number
  wd: number
  vx: number
  vy: number
  vwd: number
  len: number
  r: number
  g: number
  b: number
  hot: number // 0..1: how much of BLAST_FX.CORE_RGB it starts with
}

const TAU = Math.PI * 2
// one ring per mine of the mine pool, so a chain of every mine still draws each rim
const RINGS = HAZARD.COUNT
const RING_SEGS = BLAST_FX.RING_SEGMENTS
const RING_ROWS = 3 // the rim where the objects ride, the rim on the tube wall, the wave
// a cosmetic random value in lo..hi (Math.random: never the seeded gameplay generator)
const scatter = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)

export function createBlastFx(): BlastFx {
  const group = new Group()
  const ringLines = createLines(RINGS * RING_ROWS * RING_SEGS, BLAST_FX.RING_WIDTH)
  const pieceLines = createLines(BLAST_FX.PIECE_POOL, BLAST_FX.PIECE_WIDTH)
  group.add(ringLines.mesh, pieceLines.mesh)

  const rings: Ring[] = []
  for (let i = 0; i < RINGS; i++) {
    const mine = createHazard()
    mine.object.visible = false
    group.add(mine.object)
    rings.push({ active: false, t: 0, delay: 0, theta: 0, wd: 0, mine, popping: false, popZ: 0 })
  }
  const pieces: Piece[] = []
  for (let i = 0; i < BLAST_FX.PIECE_POOL; i++) {
    pieces.push({ active: false, t: 0, shown: false, life: 0, x: 0, y: 0, wd: 0, vx: 0, vy: 0, vwd: 0, len: 0, r: 0, g: 0, b: 0, hot: 0 })
  }
  // the blast debris() belongs to
  let lastTheta = 0
  let lastWd = 0
  let lastDelay = 0
  // nothing is active and the buffers already hold that: update() has nothing to do
  let idle = true
  group.visible = false

  // a ring is done when its rim has faded and its link's wave and pop have played
  const ringLife = (ring: Ring): number => Math.max(BLAST_FX.RIM_LIFE, ring.delay + Math.max(BLAST_FX.WAVE_TIME, HAZARD.POP_TIME))

  function freePiece(): Piece | undefined {
    for (const p of pieces) if (!p.active) return p
    return undefined // pool empty: the streak is dropped
  }

  // unit ring: where each ring point sits on the unrolled wall, per unit of radius
  const ringArc = new Float32Array(RING_SEGS + 1)
  const ringAlong = new Float32Array(RING_SEGS + 1)
  for (let k = 0; k <= RING_SEGS; k++) {
    ringArc[k] = Math.cos((k / RING_SEGS) * TAU)
    ringAlong[k] = Math.sin((k / RING_SEGS) * TAU)
  }
  const rowRadius = [RIDE_RADIUS, TUBE.RADIUS * TUBE.ON_WALL, RIDE_RADIUS]

  function writeRing(index: number, ring: Ring, craftDist: number): void {
    const { pos, col } = ringLines
    const base = index * RING_ROWS * RING_SEGS * 6
    // the rim: full size from the first frame, then it only fades (and stays dark
    // while a late link waits for its wave)
    const rimFade = ring.active ? Math.max(0, 1 - ring.t / BLAST_FX.RIM_LIFE) : 0
    const rim = rimFade * rimFade
    // the wave: out from the mine to the rim, fast then slowing, gone as it arrives
    const u = ring.active ? (ring.t - ring.delay) / BLAST_FX.WAVE_TIME : -1
    const waving = u >= 0 && u < 1
    for (let row = 0; row < RING_ROWS; row++) {
      const R = rowRadius[row]!
      const radius = row < 2 ? BLAST.RADIUS : waving ? BLAST.RADIUS * (1 - (1 - u) * (1 - u) * (1 - u)) : 0
      const g = row === 0 ? rim : row === 1 ? rim * BLAST_FX.RIM_WALL_GAIN : waving ? BLAST_FX.WAVE_GAIN * (1 - u * u) : 0
      const cr = BLAST_FX.RING_RGB[0] * g
      const cg = BLAST_FX.RING_RGB[1] * g
      const cb = BLAST_FX.RING_RGB[2] * g
      let o = base + row * RING_SEGS * 6
      // the arc is measured where the objects ride (the blast rule), so every row
      // spans the same angles
      let a = ring.theta + (radius * ringArc[0]!) / RIDE_RADIUS
      let px = Math.sin(a) * R
      let py = -Math.cos(a) * R
      let pz = craftDist - (ring.wd + radius * ringAlong[0]!)
      for (let k = 1; k <= RING_SEGS; k++) {
        a = ring.theta + (radius * ringArc[k]!) / RIDE_RADIUS
        const qx = Math.sin(a) * R
        const qy = -Math.cos(a) * R
        const qz = craftDist - (ring.wd + radius * ringAlong[k]!)
        pos[o] = px; pos[o + 1] = py; pos[o + 2] = pz
        pos[o + 3] = qx; pos[o + 4] = qy; pos[o + 5] = qz
        col[o] = cr; col[o + 1] = cg; col[o + 2] = cb
        col[o + 3] = cr; col[o + 4] = cg; col[o + 5] = cb
        px = qx; py = qy; pz = qz
        o += 6
      }
    }
  }

  // The stand-in mine: on the wall (scrolling, drawn like a field draws it) until its
  // link's turn, then the mine's own pop at the z it had reached.
  function drawMine(ring: Ring, dt: number, craftDist: number): void {
    const obj = ring.mine.object
    const popT = (ring.t - ring.delay) / HAZARD.POP_TIME
    if (!ring.active || popT >= 1) {
      obj.visible = false
      return
    }
    const z = craftDist - ring.wd
    // the first frame of the pop fixes its place: the z the mine has reached
    if (popT >= 0 && !ring.popping) {
      ring.popping = true
      ring.popZ = z
    }
    const at = ring.popping ? ring.popZ : z
    obj.visible = true
    obj.position.set(Math.sin(ring.theta) * RIDE_RADIUS, -Math.cos(ring.theta) * RIDE_RADIUS, at)
    obj.scale.setScalar(farScale(at) * (popT < 0 ? 1 : 1 + popT * (HAZARD.POP_SCALE - 1)))
    ring.mine.setOpacity(popT < 0 ? 1 : 1 - popT)
    ring.mine.update(dt)
  }

  function writePiece(index: number, p: Piece, craftDist: number): void {
    const { pos, col } = pieceLines
    const o = index * 6
    const flying = p.active && p.t >= 0
    if (!flying && !(p.active && p.shown)) {
      for (let k = 0; k < 6; k++) col[o + k] = 0
      return
    }
    // a streak: the head at the piece, the tail behind it along its flight
    const speed = Math.hypot(p.vx, p.vy, p.vwd) || 1
    const u = flying ? p.t / p.life : 0
    const len = p.len * (1 - 0.6 * u)
    const z = craftDist - p.wd
    pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = z
    pos[o + 3] = p.x - (p.vx / speed) * len
    pos[o + 4] = p.y - (p.vy / speed) * len
    pos[o + 5] = z + (p.vwd / speed) * len
    // the hot core colour cools to the piece's own colour early, then it fades out
    const hot = p.hot * Math.max(0, 1 - u / BLAST_FX.HOT_FRACTION)
    const fade = 1 - u * u // bright for most of its life, then gone quickly
    const r = (p.r + (BLAST_FX.CORE_RGB[0] - p.r) * hot) * fade
    const g = (p.g + (BLAST_FX.CORE_RGB[1] - p.g) * hot) * fade
    const b = (p.b + (BLAST_FX.CORE_RGB[2] - p.b) * hot) * fade
    col[o] = r; col[o + 1] = g; col[o + 2] = b
    // the tail is dimmer, so the streak has a direction
    col[o + 3] = r * 0.25; col[o + 4] = g * 0.25; col[o + 5] = b * 0.25
  }

  return {
    object: group,

    detonate(theta: number, worldDistance: number, link: number): void {
      idle = false
      lastTheta = theta
      lastWd = worldDistance
      lastDelay = link * BLAST_FX.RIPPLE
      for (const ring of rings) {
        if (ring.active) continue
        ring.active = true
        ring.t = 0
        ring.delay = lastDelay
        ring.theta = theta
        ring.wd = worldDistance
        ring.popping = false
        break
      }
      // the mine flies apart in every direction, a little more toward the open tube
      const cx = Math.sin(theta) * RIDE_RADIUS
      const cy = -Math.cos(theta) * RIDE_RADIUS
      for (let i = 0; i < BLAST_FX.MINE_SHARDS; i++) {
        const p = freePiece()
        if (!p) return
        const az = Math.random() * TAU
        const el = Math.acos(scatter(-1, 1))
        const speed = scatter(BLAST_FX.SHARD_SPEED[0], BLAST_FX.SHARD_SPEED[1])
        p.active = true
        p.shown = false
        p.t = -lastDelay
        p.life = scatter(BLAST_FX.SHARD_LIFE[0], BLAST_FX.SHARD_LIFE[1])
        p.x = cx
        p.y = cy
        p.wd = worldDistance
        p.vx = Math.sin(el) * Math.cos(az) * speed - Math.sin(theta) * BLAST_FX.SHARD_INWARD
        p.vy = Math.sin(el) * Math.sin(az) * speed + Math.cos(theta) * BLAST_FX.SHARD_INWARD
        p.vwd = Math.cos(el) * speed
        p.len = scatter(BLAST_FX.SHARD_LEN[0], BLAST_FX.SHARD_LEN[1])
        p.r = BLAST_FX.SHARD_RGB[0]
        p.g = BLAST_FX.SHARD_RGB[1]
        p.b = BLAST_FX.SHARD_RGB[2]
        p.hot = 1
      }
    },

    debris(theta: number, worldDistance: number, rgb: RGB, pieces: number): void {
      // away from the blast centre along the wall: around it (arc) and along the tube
      const arc = angleDiff(theta, lastTheta) * RIDE_RADIUS
      const along = worldDistance - lastWd
      const dist = Math.hypot(arc, along)
      const near = Math.max(0, 1 - dist / BLAST.RADIUS)
      const speed = BLAST_FX.DEBRIS_SPEED[0] + (BLAST_FX.DEBRIS_SPEED[1] - BLAST_FX.DEBRIS_SPEED[0]) * near
      const ux = dist > 1e-3 ? arc / dist : 0
      const ua = dist > 1e-3 ? along / dist : 1
      const cx = Math.sin(theta) * RIDE_RADIUS
      const cy = -Math.cos(theta) * RIDE_RADIUS
      // the wave reaches it this long after the shot
      const arrive = lastDelay + BLAST_FX.WAVE_TIME * (1 - Math.cbrt(Math.max(0, 1 - dist / BLAST.RADIUS)))
      for (let i = 0; i < pieces; i++) {
        const p = freePiece()
        if (!p) return
        const s = speed * scatter(0.6, 1.2)
        const spread = scatter(-BLAST_FX.DEBRIS_SPREAD, BLAST_FX.DEBRIS_SPREAD)
        const tx = ux * Math.cos(spread) - ua * Math.sin(spread) // the wall direction, fanned out
        const ta = ux * Math.sin(spread) + ua * Math.cos(spread)
        const inward = scatter(0, BLAST_FX.DEBRIS_INWARD) * s
        p.active = true
        p.shown = true
        p.t = -arrive
        p.life = scatter(BLAST_FX.DEBRIS_LIFE[0], BLAST_FX.DEBRIS_LIFE[1])
        p.x = cx + scatter(-0.4, 0.4)
        p.y = cy + scatter(-0.4, 0.4)
        p.wd = worldDistance + scatter(-0.4, 0.4)
        // tx runs along the wall tangent (cos, sin); inward points at the tube axis
        p.vx = tx * Math.cos(theta) * s - Math.sin(theta) * inward
        p.vy = tx * Math.sin(theta) * s + Math.cos(theta) * inward
        p.vwd = ta * s
        p.len = scatter(BLAST_FX.DEBRIS_LEN[0], BLAST_FX.DEBRIS_LEN[1])
        p.r = rgb[0]
        p.g = rgb[1]
        p.b = rgb[2]
        p.hot = 0
      }
    },

    update(dt: number, craftDist: number): void {
      if (idle) return
      let live = 0
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i]!
        if (ring.active) {
          ring.t += dt
          if (ring.t >= ringLife(ring)) ring.active = false
          else live++
        }
        writeRing(i, ring, craftDist)
        drawMine(ring, dt, craftDist)
      }
      const drag = Math.exp(-BLAST_FX.DRAG * dt)
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]!
        if (p.active) {
          p.t += dt
          if (p.t >= p.life) p.active = false
          else live++
          if (p.active && p.t >= 0) {
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.wd += p.vwd * dt
            p.vx *= drag
            p.vy *= drag
            p.vwd *= drag
          }
        }
        writePiece(i, p, craftDist)
      }
      ringLines.flush()
      pieceLines.flush()
      // the last blast has faded: this frame wrote every segment dark, so stop drawing
      idle = live === 0
      group.visible = !idle
    },

    setResolution(w: number, h: number): void {
      for (const ring of rings) ring.mine.setResolution(w, h)
      ringLines.mat.resolution.set(w, h)
      pieceLines.mat.resolution.set(w, h)
    },

    reset(): void {
      for (const ring of rings) {
        ring.active = false
        ring.mine.object.visible = false
      }
      for (const p of pieces) p.active = false
      idle = true
      group.visible = false
    },
  }
}

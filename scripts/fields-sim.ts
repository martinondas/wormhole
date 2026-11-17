// Headless behavior checks for the wall-field engine (npm run sim:fields): cross-field
// spawn de-confliction, pass / near-miss reporting, and feed mode.
// Drives the REAL field engine (three.js Groups construct fine without a renderer)
// with stub wall objects. Two fields wired with mutual `avoid` must never hold two
// objects inside the same SPAWN_CLEAR window - across the initial layout and
// hundreds of recycles. A control pair WITHOUT avoid must show overlaps under the
// same detector, so a silently-broken detector cannot pass vacuously. Every section
// seeds the gameplay generator, so a run is reproducible.
import { Group } from 'three'
import { PHYSICS, HAZARD, FEEL } from '../src/config'
import { createField, type Field } from '../src/world/field'
import { type WallObject } from '../src/world/wallObject'
import { type CraftState } from '../src/craft'
import { seedRng } from '../src/util/rng'
import { check, finish } from './sim-kit'

const stub = (): WallObject => ({
  object: new Group(),
  update: () => {},
  setResolution: () => {},
  setOpacity: () => {},
})

// Tight spacing vs SPAWN_CLEAR.DZ so unrelated streams WOULD overlap often.
function mk(opts: {
  avoid?: (worldDistance: number, theta: number) => boolean
  sampleTheta?: () => number
  spacing?: number
  jitter?: number
}): Field {
  return createField({
    create: stub,
    onHit: () => false, // never consumed; captureZ 0 below means never triggered anyway
    ...(opts.avoid ? { avoid: opts.avoid } : {}),
    ...(opts.sampleTheta ? { sampleTheta: opts.sampleTheta } : {}),
    count: 6,
    spawnStart: 30,
    spawnSpacing: opts.spacing ?? 25,
    spawnJitter: opts.jitter ?? 20,
    recycleBehind: 20,
    captureZ: 0,
    captureAngle: 0,
    popTime: 0.2,
  })
}

// Violation probe: reconstruct field A's live object positions from its scene
// graph (theta from x/y on the ride radius, worldDistance from the ship-relative
// z), then ask field B whether it occupies that spot. Positions more than 15u
// behind are skipped: a just-recycled slot's transform is stale for one step
// (place() runs on its next update), and everything back there is out of play.
function violations(a: Field, b: Field, craftDistance: number): number {
  let n = 0
  for (const o of a.object.children) {
    const z = o.position.z
    if (z > 15) continue
    const worldDistance = craftDistance - z
    const theta = Math.atan2(o.position.x, -o.position.y)
    if (b.occupies(worldDistance, theta)) n++
  }
  return n
}

// Fly a pair of fields forward for `seconds`, summing sampled violation counts.
function fly(a: Field, b: Field, seconds: number): number {
  const dt = 1 / PHYSICS.HZ
  const craft: CraftState = { theta: 0, omega: 0, steerSignal: 0, speed: 60, distance: 0 }
  let total = 0
  for (let i = 0; i < PHYSICS.HZ * seconds; i++) {
    craft.distance += craft.speed * dt
    a.update(craft, dt)
    b.update(craft, dt)
    total += violations(a, b, craft.distance) + violations(b, a, craft.distance)
  }
  return total
}

// ---- V1) mutually-avoiding pair: zero overlaps across layout + recycles ----
;(() => {
  seedRng(1)
  const pair: Field[] = []
  const nextAvoid = (): ((d: number, theta: number) => boolean) => {
    const self = pair.length
    return (d, theta) => pair.some((f, i) => i !== self && f.occupies(d, theta))
  }
  pair.push(mk({ avoid: nextAvoid() }))
  pair.push(mk({ avoid: nextAvoid() }))
  const v = fly(pair[0]!, pair[1]!, 60) // ~140 recycles per field at speed 60 / spacing 25
  check('V1 avoiding pair never overlaps', v === 0, `violation-samples=${v}`)
})()

// ---- V2) control pair (no avoid): the detector DOES see overlaps ----
;(() => {
  seedRng(2)
  const v = fly(mk({}), mk({}), 60)
  check('V2 control pair overlaps without avoid', v > 0, `violation-samples=${v}`)
})()

// ---- V3) nudge fallback: identical fixed angle, so only the z-nudge can help ----
;(() => {
  seedRng(3)
  const pair: Field[] = []
  const nextAvoid = (): ((d: number, theta: number) => boolean) => {
    const self = pair.length
    return (d, theta) => pair.some((f, i) => i !== self && f.occupies(d, theta))
  }
  // theta resamples always return the same angle: the second loop in arm() (the
  // forward nudge) is the only way out, and clear pockets exist (spacing 60 >> DZ).
  pair.push(mk({ avoid: nextAvoid(), sampleTheta: () => 0, spacing: 60, jitter: 0 }))
  pair.push(mk({ avoid: nextAvoid(), sampleTheta: () => 0, spacing: 60, jitter: 0 }))
  const v = fly(pair[0]!, pair[1]!, 60)
  check('V3 fixed-angle pair separates via the nudge', v === 0, `violation-samples=${v}`)
})()

// ---- P) pass events: onMiss once per uncollected object, onNear never on a hit ----
// One field per case, every object at one fixed angle, the craft parked at theta 0.
// The expected count is exact: every armed object that is already behind the
// capture window passed the ship once (arms minus those still ahead).
interface PassCase {
  theta: number
  consume: boolean // what onHit returns (false = declined, like a mine during i-frames)
}
function passRun(c: PassCase): { arms: number; passed: number; hits: number; misses: number; nears: number } {
  let arms = 0
  let hits = 0
  let misses = 0
  let nears = 0
  const field = createField({
    create: stub,
    onHit: () => {
      hits++
      return c.consume
    },
    onMiss: () => misses++,
    nearAngle: HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA,
    onNear: () => nears++,
    sampleTheta: () => {
      arms++
      return c.theta
    },
    count: 6,
    spawnStart: 30,
    spawnSpacing: 25,
    spawnJitter: 20,
    recycleBehind: HAZARD.RECYCLE_BEHIND,
    captureZ: HAZARD.CAPTURE_Z,
    captureAngle: HAZARD.CAPTURE_ANGLE,
    popTime: HAZARD.POP_TIME,
  })
  const dt = 1 / PHYSICS.HZ
  const craft: CraftState = { theta: 0, omega: 0, steerSignal: 0, speed: 60, distance: 0 }
  for (let i = 0; i < PHYSICS.HZ * 60; i++) {
    craft.distance += craft.speed * dt
    field.update(craft, dt)
  }
  let ahead = 0
  field.visit((_t, wd) => {
    if (craft.distance - wd < HAZARD.CAPTURE_Z) ahead++
  })
  // a consumed object pops and re-arms; one still popping holds no live slot
  return { arms, passed: arms - ahead, hits, misses, nears }
}
;(() => {
  seedRng(4)
  const near = HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA / 2 // inside the near band, outside the hit cone
  const far = HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA + 0.3
  const hit = passRun({ theta: 0, consume: true })
  check('P1 onMiss never fires for a collected object', hit.misses === 0 && hit.hits > 50, `hits=${hit.hits} misses=${hit.misses}`)
  const miss = passRun({ theta: far, consume: true })
  check('P2 onMiss fires once per uncollected object', miss.misses === miss.passed && miss.passed > 50 && miss.hits === 0, `passed=${miss.passed} misses=${miss.misses}`)
  const close = passRun({ theta: near, consume: true })
  check('P3 onNear fires once per close pass (and onMiss too)', close.nears === close.passed && close.misses === close.passed && close.passed > 50, `passed=${close.passed} nears=${close.nears}`)
  const declined = passRun({ theta: 0, consume: false })
  check('P4 onNear never fires on a slot that hit (declined hit)', declined.nears === 0 && declined.hits > 50 && declined.misses === 0, `hits=${declined.hits} nears=${declined.nears}`)
  const consumed = passRun({ theta: 0, consume: true })
  check('P5 onNear never fires on a slot that hit (consumed hit)', consumed.nears === 0, `nears=${consumed.nears}`)
  check('P6 onNear stays silent for a far pass', miss.nears === 0, `nears=${miss.nears}`)
})()

// ---- feed mode: the pool starts parked and is filled through spawn() ----
// (the gem and mine fields; see world/sequencer.ts)
;(() => {
  seedRng(5)
  let hits = 0
  let misses = 0
  let nears = 0
  let consume = true
  const field = createField({
    create: stub,
    feed: true,
    onHit: () => {
      hits++
      return consume
    },
    onMiss: () => misses++,
    nearAngle: HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA,
    onNear: () => nears++,
    count: 4,
    spawnStart: 30,
    spawnSpacing: 25,
    spawnJitter: 20,
    recycleBehind: HAZARD.RECYCLE_BEHIND,
    captureZ: HAZARD.CAPTURE_Z,
    captureAngle: HAZARD.CAPTURE_ANGLE,
    popTime: HAZARD.POP_TIME,
  })
  const live = (): number => {
    let n = 0
    field.visit(() => n++)
    return n
  }
  const shown = (): number => field.object.children.filter((o) => o.visible).length
  const dt = 1 / PHYSICS.HZ
  const craft: CraftState = { theta: 0, omega: 0, steerSignal: 0, speed: 60, distance: 0 }
  const fly = (seconds: number): void => {
    for (let i = 0; i < PHYSICS.HZ * seconds; i++) {
      craft.distance += craft.speed * dt
      field.update(craft, dt)
    }
  }
  fly(2)
  check('F1 a feed field starts parked: nothing live, nothing shown, nothing occupied', live() === 0 && shown() === 0 && !field.occupies(60, 0) && hits === 0)

  const near = HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA / 2
  const d0 = craft.distance
  const armed = [field.spawn(d0 + 40, 0), field.spawn(d0 + 80, 2.5), field.spawn(d0 + 120, near), field.spawn(d0 + 160, 0)]
  const placedAt = field.object.children.filter((o) => o.visible).map((o) => Math.round(-o.position.z)).sort((a, b) => a - b)
  check('F2 spawn arms a parked object at the exact place', armed.every(Boolean) && live() === 4 && shown() === 4 && placedAt.join(',') === '40,80,120,160', `placed ${placedAt.join(',')} units ahead`)
  check('F3 occupies sees a spawned object and nothing else', field.occupies(d0 + 40, 0.1) && field.occupies(d0 + 80, 2.5) && !field.occupies(d0 + 40, 2.5) && !field.occupies(d0 + 60, 0))
  const fifth = field.spawn(d0 + 200, 0)
  check('F4 spawn on an empty pool fails and is counted', !fifth && field.failedSpawns === 1, `failedSpawns=${field.failedSpawns}`)

  fly(1.5) // past the first (hit, consumed) and the second (far miss)
  check('F5 a hit pops and parks; a far pass reports onMiss once and no onNear', hits === 1 && misses === 1 && nears === 0, `hits=${hits} misses=${misses} nears=${nears}`)
  consume = false
  fly(2.2) // past the third (near miss) and the fourth (hit, declined) and beyond recycleBehind
  check('F6 a close pass reports onNear and onMiss; a declined hit reports neither', hits === 2 && misses === 2 && nears === 1, `hits=${hits} misses=${misses} nears=${nears}`)
  check('F7 objects that passed behind park again (nothing is recycled ahead)', live() === 0 && shown() === 0 && !field.occupies(d0 + 120, near))

  const again = field.spawn(craft.distance + 50, 1) && field.spawn(craft.distance + 90, 1)
  field.rescale(craft.distance + 70, 2)
  const wds: number[] = []
  field.visit((_t, wd) => wds.push(Math.round(wd - craft.distance)))
  check('F8 a parked object can be spawned again; rescale moves only what waits beyond the boundary', again && wds.sort((a, b) => a - b).join(',') === '50,110', wds.join(','))
  field.reset(craft.distance)
  check('F9 reset parks everything and clears the failed-spawn count', live() === 0 && shown() === 0 && field.failedSpawns === 0)
})()

finish('FIELDS SIM')

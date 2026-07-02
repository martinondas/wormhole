// Headless behavior checks for cross-field spawn de-confliction (npm run sim:fields).
// Drives the REAL field engine (three.js Groups construct fine without a renderer)
// with stub wall objects. Two fields wired with mutual `avoid` must never hold two
// objects inside the same SPAWN_CLEAR window - across the initial layout and
// hundreds of recycles. A control pair WITHOUT avoid must show overlaps under the
// same detector, so a silently-broken detector cannot pass vacuously.
import { Group } from 'three'
import { PHYSICS, SPAWN_CLEAR } from '../src/config'
import { createField, type Field } from '../src/world/field'
import { type WallObject } from '../src/world/wallObject'
import { type CraftState } from '../src/craft'

let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failed++
}

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
  const v = fly(mk({}), mk({}), 60)
  check('V2 control pair overlaps without avoid', v > 0, `violation-samples=${v}`)
})()

// ---- V3) nudge fallback: identical fixed angle, so only the z-nudge can help ----
;(() => {
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

console.log(failed === 0 ? '\nALL FIELDS SIM CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)

// Headless measurements of the swing itself (npm run sim:swing): how the craft
// answers a held key, a tap and a reversal in each gravity tier. Every number is
// taken twice, with the climb fade as configured (config CLIMB) and with
// CLIMB.FADE = 0, the swing with no fade.
//
//   A) low on the wall the two swings are the same: rest to 45 and 90 degrees,
//      a reversal near the bottom, the reach of a short tap, and the whole path of
//      any swing that stays at or below CLIMB.START (compared step by step);
//   B) high on the wall the fade decides what one held key does: in the slow tier it
//      hangs on the wall, in the normal and fast tiers it goes over the top;
//   C) the torque has no step anywhere around the tube.
//
// With CLIMB.FADE = 0 in config the B targets do not apply (they describe the fade);
// the numbers are still printed and the A and C checks still run.
//
// Optional: --fade/--start/--end/--soft <n> try other CLIMB values for one call.
import { stepSwing, type SwingState } from '../src/craft'
import { createFlight } from '../src/flight'
import { CLIMB, PHYSICS } from '../src/config'
import { angleDiff } from '../src/util/math'

const argv = process.argv.slice(2)
const arg = (name: string, fallback: number): number => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? Number(argv[i + 1]) : fallback
}
CLIMB.FADE = arg('fade', CLIMB.FADE)
CLIMB.START = arg('start', CLIMB.START)
CLIMB.END = arg('end', CLIMB.END)
CLIMB.UP_SOFT = arg('soft', CLIMB.UP_SOFT)

let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failed++
}

const DT = 1 / PHYSICS.HZ
const DEG = 180 / Math.PI
const TIER_NAMES = ['slow', 'normal', 'fast']
const flight = createFlight()
// steady gravity of each tier (tier-relative, so the same at every level)
const GRAVITY = [0, 1, 2].map((tier) => flight.gravityOf(0, flight.tierSpeedOf(0, tier)))

const rest = (): SwingState => ({ theta: 0, omega: 0, steerSignal: 0 })
const height = (s: SwingState): number => Math.abs(angleDiff(s.theta, 0))

/** Seconds a held key takes from rest to `rad` from the bottom (Infinity = never in 10 s). */
function timeTo(rad: number, gravity: number): number {
  const s = rest()
  for (let n = 1; n <= 10 * PHYSICS.HZ; n++) {
    stepSwing(s, 1, gravity, DT)
    if (Math.abs(s.theta) >= rad) return n * DT
  }
  return Infinity
}

/** Seconds until a craft at the bottom moving at `omega` turns around under the opposite key. */
function reversalTime(omega: number, gravity: number): number {
  const s: SwingState = { theta: 0, omega, steerSignal: 0 }
  for (let n = 1; n <= 5 * PHYSICS.HZ; n++) {
    stepSwing(s, -Math.sign(omega), gravity, DT)
    if (s.omega * omega <= 0) return n * DT
  }
  return Infinity
}

/** Highest angle (rad) a tap of `seconds` reaches before the craft comes back. */
function tapReach(seconds: number, gravity: number): number {
  const s = rest()
  let peak = 0
  for (let n = 1; n <= 4 * PHYSICS.HZ; n++) {
    stepSwing(s, n * DT <= seconds ? 1 : 0, gravity, DT)
    peak = Math.max(peak, Math.abs(s.theta))
  }
  return peak
}

interface Hold {
  crossAt: number // s until the craft first goes over the top (Infinity = it does not)
  firstPeak: number // rad from the bottom at the first turning point (PI when it crosses first)
  loops: number // full turns in the whole hold
  hang: number // mean angle from the bottom over the last 2 s
  hangSwing: number // spread (max - min) of that angle over the last 2 s
  topOmegaMin: number // slowest |omega| above 150 degrees before the first crossing (Infinity = never there)
}

/** One key held from rest for `seconds`, after an optional opposite hold to its first turning point. */
function hold(gravity: number, seconds: number, counterSwing = false): Hold {
  const s = rest()
  if (counterSwing) {
    // the counter-swing: the opposite key until the swing stops by itself, at most 1 s
    for (let n = 0; n < PHYSICS.HZ; n++) {
      const before = s.omega
      stepSwing(s, -1, gravity, DT)
      if (before < 0 && s.omega >= 0) break
    }
  }
  const out: Hold = { crossAt: Infinity, firstPeak: Math.PI, loops: 0, hang: 0, hangSwing: 0, topOmegaMin: Infinity }
  let peakSeen = false
  let lo = Infinity
  let hi = -Infinity
  let sum = 0
  let count = 0
  const steps = Math.round(seconds * PHYSICS.HZ)
  for (let n = 1; n <= steps; n++) {
    const before = s.omega
    stepSwing(s, 1, gravity, DT)
    if (s.theta >= Math.PI && out.crossAt === Infinity) out.crossAt = n * DT
    if (out.crossAt === Infinity && height(s) > 150 / DEG) out.topOmegaMin = Math.min(out.topOmegaMin, Math.abs(s.omega))
    if (!peakSeen && before > 0 && s.omega <= 0 && s.theta > 0) {
      peakSeen = true
      if (out.crossAt === Infinity) out.firstPeak = height(s)
    }
    if (n > steps - 2 * PHYSICS.HZ) {
      const h = height(s)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
      sum += h
      count++
    }
  }
  out.loops = Math.floor((s.theta + Math.PI) / (2 * Math.PI))
  out.hang = sum / count
  out.hangSwing = hi - lo
  return out
}

interface Numbers {
  to45: number[]
  to90: number[]
  reversal: number[]
  tap: number[]
  one: Hold[] // one hold from rest, 10 s
  counter: Hold // slow tier: one counter-swing, then the hold
}
function measure(): Numbers {
  return {
    to45: GRAVITY.map((g) => timeTo(45 / DEG, g)),
    to90: GRAVITY.map((g) => timeTo(90 / DEG, g)),
    reversal: GRAVITY.map((g) => reversalTime(5, g)),
    tap: GRAVITY.map((g) => tapReach(0.2, g)),
    one: GRAVITY.map((g) => hold(g, 10)),
    counter: hold(GRAVITY[0]!, 10, true),
  }
}

const configured = CLIMB.FADE
CLIMB.FADE = 0
const off = measure()
CLIMB.FADE = configured
const on = measure()

const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'never')
const deg = (rad: number): string => (rad * DEG).toFixed(0)
const per = (list: number[], fmt: (v: number) => string): string => list.map(fmt).join(' / ')
const describe = (h: Hold): string =>
  h.crossAt < Infinity
    ? `over the top in ${f2(h.crossAt)} s, ${h.loops} loops in 10 s`
    : `peaks at ${deg(h.firstPeak)} deg, hangs at ${deg(h.hang)} deg (moving ${deg(h.hangSwing)} deg), ${h.loops} loops`

console.log(`gravity per tier: ${per(GRAVITY, f2)}   CLIMB: FADE ${configured}, START ${CLIMB.START}, END ${CLIMB.END}, UP_SOFT ${CLIMB.UP_SOFT}\n`)
console.log('measurement (slow / normal / fast)            FADE = 0                as configured')
console.log(`rest to 45 deg, held key (s)                  ${per(off.to45, f2).padEnd(24)}${per(on.to45, f2)}`)
console.log(`rest to 90 deg, held key (s)                  ${per(off.to90, f2).padEnd(24)}${per(on.to90, f2)}`)
console.log(`reversal from 5 rad/s at the bottom (s)       ${per(off.reversal, f2).padEnd(24)}${per(on.reversal, f2)}`)
console.log(`reach of a 0.2 s tap (deg)                    ${per(off.tap, deg).padEnd(24)}${per(on.tap, deg)}`)
for (let tier = 0; tier < 3; tier++) {
  console.log(`${TIER_NAMES[tier]} tier, one hold from rest, FADE = 0:      ${describe(off.one[tier]!)}`)
  console.log(`${TIER_NAMES[tier]} tier, one hold from rest, as configured: ${describe(on.one[tier]!)}`)
}
console.log(`slow tier, counter-swing then hold, FADE = 0:      ${describe(off.counter)}`)
console.log(`slow tier, counter-swing then hold, as configured: ${describe(on.counter)}\n`)

// --- A) low on the wall the swing is the same with and without the fade ----------
const same = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 0.01 * Math.abs(b[i]!))
check('A1 rest to 45 degrees: the same in every tier (within 1%)', same(on.to45, off.to45), per(on.to45, f2))
check('A2 rest to 90 degrees: the same in every tier (within 1%)', same(on.to90, off.to90), per(on.to90, f2))
check('A3 reversal from 5 rad/s near the bottom: the same (within 1%)', same(on.reversal, off.reversal), per(on.reversal, f2))
check('A4 reach of a 0.2 s tap: the same in every tier (within 1%)', same(on.tap, off.tap), per(on.tap, deg))

// Any swing that stays at or below CLIMB.START is the same path, bit for bit. A
// seeded mix of taps, holds and reversals in every tier, played twice; the two
// crafts are compared up to the first step at which one of them is above START.
{
  let seed = 12345
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  let compared = 0
  let worst = 0
  for (let run = 0; run < 300; run++) {
    const gravity = GRAVITY[run % 3]!
    const a = rest()
    const b = rest()
    let steer = 0
    let left = 0
    for (let n = 0; n < 6 * PHYSICS.HZ; n++) {
      if (left <= 0) {
        steer = Math.floor(rand() * 3) - 1
        left = Math.round((0.05 + rand() * 0.45) * PHYSICS.HZ)
      }
      left--
      CLIMB.FADE = 0
      stepSwing(a, steer, gravity, DT)
      CLIMB.FADE = configured
      stepSwing(b, steer, gravity, DT)
      worst = Math.max(worst, Math.abs(a.theta - b.theta), Math.abs(a.omega - b.omega))
      compared++
      if (height(a) > CLIMB.START || height(b) > CLIMB.START) break
    }
  }
  check('A5 a swing that stays at or below CLIMB.START is identical step by step', worst === 0 && compared > 20000, `${compared} steps, largest difference ${worst}`)
}

// --- B) high on the wall (the targets describe the fade, so they need FADE > 0) --
if (configured > 0) {
  const slow = on.one[0]!
  check(
    'B1 slow tier, one hold from rest: peaks between 120 and 165 degrees and does not cross',
    slow.crossAt === Infinity && slow.firstPeak * DEG >= 120 && slow.firstPeak * DEG <= 165,
    describe(slow),
  )
  check(
    'B2 slow tier, key held for 10 s: no full loop, settles at a hang angle between 105 and 150 degrees',
    slow.loops === 0 && slow.hang * DEG >= 105 && slow.hang * DEG <= 150 && slow.hangSwing * DEG < 2,
    `${slow.loops} loops, hang ${deg(slow.hang)} deg, still moving ${(slow.hangSwing * DEG).toFixed(2)} deg`,
  )
  check('B3 slow tier, one counter-swing then hold: crosses the top', on.counter.crossAt < Infinity, describe(on.counter))
  const normal = on.one[1]!
  check('B4 normal tier, one hold from rest: crosses in 1.1 to 1.6 s', normal.crossAt >= 1.1 && normal.crossAt <= 1.6, f2(normal.crossAt))
  const fast = on.one[2]!
  check('B5 fast tier, one hold from rest: crosses in at most 1.2 s', fast.crossAt <= 1.2, f2(fast.crossAt))
  // no stall at the top: the craft keeps a clear pace through the last 30 degrees
  check(
    'B6 normal and fast tier: the hold never slows below 1.5 rad/s near the top',
    normal.topOmegaMin >= 1.5 && fast.topOmegaMin >= 1.5,
    `${f2(normal.topOmegaMin)} / ${f2(fast.topOmegaMin)} rad/s`,
  )
} else {
  console.log('CLIMB.FADE is 0: the high-wall targets (B) describe the fade and are not checked.')
}

// --- C) the torque is continuous around the whole tube ----------------------------
// The steering torque a full held key gives at rest, read back from one step, at
// every 0.1 degrees: neighbours never differ by more than a small share of the full torque.
{
  let worst = 0
  let last = NaN
  for (let i = -1800; i <= 1800; i++) {
    const theta = (i / 10 / 180) * Math.PI
    const s: SwingState = { theta, omega: 0, steerSignal: 1 }
    stepSwing(s, 1, 0, DT) // no gravity, no speed: omega / dt is the torque
    const torque = s.omega / DT
    if (!Number.isNaN(last)) worst = Math.max(worst, Math.abs(torque - last))
    last = torque
  }
  check('C1 the steering torque has no step anywhere around the tube', worst < 0.02 * PHYSICS.STEER_TORQUE, `largest change per 0.1 deg: ${worst.toFixed(3)} of ${PHYSICS.STEER_TORQUE}`)
}

console.log(failed ? `\n${failed} SWING SIM CHECK(S) FAILED` : '\nALL SWING SIM CHECKS PASSED')
process.exit(failed ? 1 : 0)

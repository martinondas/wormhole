// Bot players for the playtest harness. A bot only ever outputs what a human can:
// steer left / right / neither, and fire or not. It sees the world through delayed
// Snapshots (perception.ts), with human limits set by its profile:
//
//   reaction   - the bot acts on the world as it was `reaction` seconds ago. Static
//                wall objects are extrapolated exactly (they do not move); raiders are
//                extrapolated from their last seen angular speed, so a direction
//                change or a new bolt is noticed `reaction` seconds late.
//   lookAhead  - wall objects farther ahead than this are not seen yet (fog).
//   thetaNoise - misjudged angle of a far object; shrinks as the object comes closer.
//   aimError   - its judgement of where a raider is drifts by about this much (a
//                slowly wandering offset, so it cannot be averaged away).
//   attention  - how many upcoming wall objects it can keep in mind at once.
//   decisionHz - how often it re-plans; minHold - shortest key press it can make.
//   motorJitter- each key change lands a random bit late.
//   modelError - its feel for the swing is off: in each run it over- or under-rates
//                the steering push and the gravity pull by up to this fraction, so it
//                overshoots or stops short the way a player does.
//   lapse      - occasional short loss of attention (keys released).
//   topAversion- reluctance to hang upside down near the top of the tube. This is an
//                ASSUMPTION about human comfort, not a measured fact: without it the
//                bots loop over the top about 20 times a minute, because holding one
//                steer key is enough to go around.
//
// The steering "brain" is a short look-ahead search: for a few simple key plans
// (hold left for a moment then coast, left then right, ...) it rolls the REAL craft
// physics forward (updateCraft on a scratch state) and scores what the swing would
// collect, dodge and line up. That is a model of a practised player who knows how
// the craft swings; skill differences come from the limits above and from how many
// plans the profile can consider. The bot's own craft state (angle, spin) is read
// directly - a player feels their own craft.
import { type Session } from '../../src/session'
import { updateCraft, type CraftState } from '../../src/craft'
import { type InputState } from '../../src/input'
import { ENERGY, ENEMY, EXTRA_LIFE, GUN, HAZARD, LIVES, PICKUP, TREASURE } from '../../src/config'
import {
  createPerception,
  createSnapshot,
  type Perception,
  type Snapshot,
  KIND_GEM,
  KIND_LIFE,
  KIND_MINE,
  KIND_ORB,
  PHASE_DEPART,
} from './perception'

// |a - b| wrapped to [0, PI], without trig (this runs millions of times in the
// search; the game's own wrapped-angle helper in src/util/math uses atan2).
const TAU = Math.PI * 2
function gap(a: number, b: number): number {
  let d = (a - b) % TAU
  if (d < 0) d += TAU
  return d > Math.PI ? TAU - d : d
}
// signed wrapped difference a - b in (-PI, PI]
function signedGap(a: number, b: number): number {
  let d = (a - b) % TAU
  if (d > Math.PI) d -= TAU
  else if (d <= -Math.PI) d += TAU
  return d
}

export const TICK_HZ = 30 // perception / key-update rate (the bot's "frame rate")
const ROLL_DT = 1 / 30 // rollout step for the look-ahead search

export interface BotProfile {
  name: string
  about: string
  steers: boolean
  fires: boolean
  reaction: number // s
  decisionHz: number
  lookAhead: number // world units
  horizon: number // s the look-ahead search covers
  thetaNoise: number // rad, at the edge of lookAhead
  minHold: number // s
  motorJitter: number // s: a key change lands up to this much late (sloppy hands)
  modelError: number // fraction: how wrong its feel for the swing is (per run, up to +/- this)
  attention: number // wall objects considered at once
  planSet: 'simple' | 'medium' | 'rich'
  lead: number // 0..1 how well it leads a strafing raider
  fireTol: number // rad: fires when the predicted aim error is below this
  aimError: number // rad: how far off its judgement of a raider's angle wanders
  fireRange: number // units ahead it will shoot at
  lapsePerSec: number // chance per second of an attention lapse
  lapseMax: number // s
  keepOut: number // rad: camper keeps this far from every raider (0 = off)
  topAversion: number // cost per second spent near the top of the tube (upside down)
  wGem: number
  wAim: number
}

const base = {
  steers: true,
  fires: true,
  keepOut: 0,
  wGem: 100,
  wAim: 80,
}

export const PROFILES: Record<string, BotProfile> = {
  kid: {
    ...base,
    motorJitter: 0.05,
    modelError: 0.18,
    topAversion: 80,
    aimError: 0.3,
    name: 'kid',
    about: 'slow and sloppy: 350 ms reaction, short sight, sprays the gun, loses attention',
    reaction: 0.35,
    decisionHz: 5,
    lookAhead: 90,
    horizon: 1.1,
    thetaNoise: 0.22,
    minHold: 0.13,
    attention: 3,
    planSet: 'simple',
    lead: 0,
    fireTol: 0.36,
    fireRange: 55,
    lapsePerSec: 0.12,
    lapseMax: 0.9,
  },
  average: {
    ...base,
    motorJitter: 0.03,
    modelError: 0.1,
    topAversion: 50,
    aimError: 0.2,
    name: 'average',
    about: 'ordinary player: 250 ms reaction, plans one swing ahead, loose aim',
    reaction: 0.25,
    decisionHz: 8,
    lookAhead: 120,
    horizon: 1.4,
    thetaNoise: 0.13,
    minHold: 0.09,
    attention: 5,
    planSet: 'medium',
    lead: 0.2,
    fireTol: 0.24,
    fireRange: 60,
    lapsePerSec: 0.04,
    lapseMax: 0.6,
  },
  good: {
    ...base,
    motorJitter: 0.015,
    modelError: 0.05,
    topAversion: 20,
    aimError: 0.1,
    name: 'good',
    about: 'skilled player: 180 ms reaction, plans swings to collect, leads targets',
    reaction: 0.18,
    decisionHz: 12,
    lookAhead: 160,
    horizon: 1.8,
    thetaNoise: 0.06,
    minHold: 0.06,
    attention: 8,
    planSet: 'rich',
    lead: 0.6,
    fireTol: 0.16,
    fireRange: 75,
    lapsePerSec: 0.01,
    lapseMax: 0.4,
  },
  oracle: {
    ...base,
    motorJitter: 0,
    modelError: 0,
    topAversion: 0,
    aimError: 0,
    name: 'oracle',
    about: 'no delay, no error, sees everything spawned: its deaths approximate unfair situations',
    reaction: 0,
    decisionHz: 30,
    lookAhead: 400,
    horizon: 2.2,
    thetaNoise: 0,
    minHold: 0,
    attention: 40,
    planSet: 'rich',
    lead: 1,
    fireTol: 0.12,
    fireRange: 110,
    lapsePerSec: 0,
    lapseMax: 0,
  },
  camper: {
    ...base,
    motorJitter: 0.03,
    modelError: 0.1,
    topAversion: 50,
    aimError: 0.1,
    name: 'camper',
    about: 'average player who never shoots and parks away from raiders (safe-spot exploit), still collects gems',
    fires: false,
    reaction: 0.25,
    decisionHz: 8,
    lookAhead: 120,
    horizon: 1.4,
    thetaNoise: 0.13,
    minHold: 0.09,
    attention: 5,
    planSet: 'medium',
    lead: 0,
    fireTol: 0,
    fireRange: 0,
    lapsePerSec: 0.04,
    lapseMax: 0.6,
    keepOut: 1.3,
    wAim: 0,
  },
  passive: {
    ...base,
    motorJitter: 0,
    modelError: 0,
    topAversion: 0,
    aimError: 0,
    name: 'passive',
    about: 'no input at all: the craft hangs at the bottom',
    steers: false,
    fires: false,
    reaction: 0,
    decisionHz: 1,
    lookAhead: 0,
    horizon: 0,
    thetaNoise: 0,
    minHold: 0,
    attention: 0,
    planSet: 'simple',
    lead: 0,
    fireTol: 0,
    fireRange: 0,
    lapsePerSec: 0,
    lapseMax: 0,
  },
}

// A key plan: up to three (action, seconds) segments, then coast.
type Plan = [number, number, number, number, number, number]

function buildPlans(set: BotProfile['planSet'], horizon: number): Plan[] {
  const plans: Plan[] = [[0, 0, 0, 0, 0, 0]] // coast
  const push = (a1: number, d1: number, a2 = 0, d2 = 0, a3 = 0, d3 = 0): void => {
    plans.push([a1, d1, a2, d2, a3, d3])
  }
  const single = set === 'simple' ? [0.15, 0.4, 0.9] : set === 'medium' ? [0.12, 0.3, 0.6, horizon] : [0.08, 0.2, 0.35, 0.55, 0.9, horizon]
  for (const a of [-1, 1]) for (const d of single) push(a, d)
  if (set === 'simple') return plans
  // swing one way, then the other (the pump / a dodge-and-return)
  const d1s = set === 'medium' ? [0.2, 0.45] : [0.15, 0.3, 0.5, 0.8]
  const d2s = set === 'medium' ? [0.2, 0.45] : [0.15, 0.3, 0.5]
  for (const a of [-1, 1]) for (const d1 of d1s) for (const d2 of d2s) push(a, d1, -a, d2)
  if (set === 'medium') return plans
  // wait, then push (timing a late move)
  for (const a of [-1, 1]) for (const w of [0.2, 0.4, 0.7]) for (const d of [0.2, 0.5]) push(0, w, a, d)
  return plans
}

// Small seeded generator for the bot's own noise, separate from the gameplay
// randomness so a bot never shifts the spawn sequence.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

// Deterministic per-object error in [-1, 1] (roughly bell-shaped), keyed by the
// object's world distance: the same gem is misjudged the same way on every look.
function objectError(wd: number, salt: number): number {
  let h = (Math.floor(wd * 7.3) ^ salt) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h ^= h >>> 16
  const a = (h & 0xffff) / 0xffff
  const b = ((h >>> 16) & 0xffff) / 0xffff
  return a + b - 1
}

const MAX_EVENTS = 96
const MAX_STEPS = 80
const MAX_TARGETS = 8
const DEATH = 1000
const TOP_ZONE = (120 * Math.PI) / 180 // farther than this from the bottom counts as near the top

export interface Bot {
  profile: BotProfile
  steer: number // -1 / 0 / +1: the steer key state right now
  fire: boolean // the fire key state right now
  reset(seed: number): void
  tick(t: number): void // call at TICK_HZ with the sim time
}

export function createBot(profile: BotProfile, session: Session): Bot {
  const perception: Perception = createPerception(session)
  const ringSize = Math.ceil(profile.reaction * TICK_HZ) + 3
  const ring: Snapshot[] = []
  for (let i = 0; i < ringSize; i++) ring.push(createSnapshot())
  let head = -1
  let filled = 0

  const plans = buildPlans(profile.planSet, profile.horizon)
  const nSteps = Math.min(MAX_STEPS, Math.round(profile.horizon / ROLL_DT))
  const th = new Float64Array(MAX_STEPS + 1)
  const scratch: CraftState = { theta: 0, omega: 0, steerSignal: 0, speed: 0, distance: 0 }
  const scratchInput: InputState = { steerTarget: 0, fire: false }

  // upcoming events: t (s from now), angle, half-width, half time window, weight
  // (negative = threat), safety margin
  const evT = new Float64Array(MAX_EVENTS)
  const evTheta = new Float64Array(MAX_EVENTS)
  const evHw = new Float64Array(MAX_EVENTS)
  const evWin = new Float64Array(MAX_EVENTS)
  const evW = new Float64Array(MAX_EVENTS)
  const evMargin = new Float64Array(MAX_EVENTS)
  let nEv = 0
  // raiders worth aiming at / keeping away from
  const tgTheta = new Float64Array(MAX_TARGETS)
  const tgOm = new Float64Array(MAX_TARGETS)
  const tgTravel = new Float64Array(MAX_TARGETS)
  let nTg = 0

  let rng = makeRng(1)
  let salt = 1
  let nextDecision = 0
  let lapseUntil = -1
  let desired = 0
  let steerLock = 0
  let fireLock = 0
  let pendingAt = -1 // when a jittered key change is due (-1 = none pending)
  let aimOffset = 0 // wandering misjudgement of raider angles (rad)
  let torqueFeel = 1 // this run's misjudgement of the steering push (1 = exact)
  let gravityFeel = 1 // ... and of the gravity pull

  const bot: Bot = {
    profile,
    steer: 0,
    fire: false,

    reset(seed: number): void {
      rng = makeRng(seed ^ 0x9e3779b9)
      salt = (seed * 2654435761) >>> 0
      head = -1
      filled = 0
      nextDecision = 0
      lapseUntil = -1
      desired = 0
      steerLock = 0
      fireLock = 0
      pendingAt = -1
      aimOffset = 0
      torqueFeel = 1 + profile.modelError * (rng() * 2 - 1)
      gravityFeel = 1 + profile.modelError * (rng() * 2 - 1)
      bot.steer = 0
      bot.fire = false
    },

    tick(t: number): void {
      if (!profile.steers && !profile.fires) return
      head = (head + 1) % ringSize
      perception.capture(ring[head]!, t)
      if (filled < ringSize) filled++
      // the snapshot the bot is acting on, and the one before it (for velocities)
      const back = Math.min(filled - 1, Math.round(profile.reaction * TICK_HZ))
      const seen = ring[(head - back + ringSize * 2) % ringSize]!
      const prev = filled - 1 > back ? ring[(head - back - 1 + ringSize * 2) % ringSize]! : seen

      if (profile.lapsePerSec > 0 && t >= lapseUntil && rng() < profile.lapsePerSec / TICK_HZ) {
        lapseUntil = t + 0.25 + rng() * (profile.lapseMax - 0.25)
      }
      const lapsed = t < lapseUntil
      if (profile.aimError > 0) {
        // mean-reverting random walk: about 0.4 s of memory, spread ~ aimError
        const k = 1 / (0.4 * TICK_HZ)
        aimOffset += -aimOffset * k + profile.aimError * Math.sqrt(2 * k) * (rng() + rng() + rng() - 1.5) * 2
      }

      if (profile.steers) {
        if (lapsed) desired = 0
        else if (t >= nextDecision) {
          nextDecision = t + 1 / profile.decisionHz
          desired = decide(t, seen, prev)
        }
        if (desired !== bot.steer && t >= steerLock) {
          if (profile.motorJitter > 0 && pendingAt < 0) pendingAt = t + rng() * profile.motorJitter
          if (t >= pendingAt) {
            bot.steer = desired
            steerLock = t + profile.minHold
            pendingAt = -1
          }
        } else pendingAt = -1
      }

      if (profile.fires) {
        const want = !lapsed && wantsFire(t, seen, prev)
        if (want !== bot.fire && t >= fireLock) {
          bot.fire = want
          fireLock = t + profile.minHold
        }
      }
    },
  }

  // angular + closing speed of a raider, from the two snapshots (0 if just seen)
  let estOm = 0
  let estZVel = 0
  function estimate(seen: Snapshot, prev: Snapshot, i: number): void {
    estOm = 0
    estZVel = 0
    const dt = seen.t - prev.t
    if (dt <= 0) return
    const id = seen.enId[i]!
    for (let j = 0; j < prev.nEn; j++) {
      if (prev.enId[j] === id) {
        estOm = signedGap(seen.enTheta[i]!, prev.enTheta[j]!) / dt
        estZVel = (seen.enZ[i]! - prev.enZ[j]!) / dt
        return
      }
    }
  }

  function wantsFire(t: number, seen: Snapshot, prev: Snapshot): boolean {
    if (session.game.energy < GUN.COST) return false
    const age = t - seen.t
    const craft = session.craft
    for (let i = 0; i < seen.nEn; i++) {
      const z = seen.enZ[i]!
      if (z > -6 || z < -profile.fireRange) continue
      estimate(seen, prev, i)
      const om = seen.enCharge[i]! > 0.05 ? 0 : estOm // a charging raider holds its line
      const travel = -z / GUN.BOLT_SPEED
      const pred = seen.enTheta[i]! + aimOffset + om * (age + travel) * profile.lead
      if (gap(craft.theta, pred) < profile.fireTol) return true
    }
    return false
  }

  function addEvent(t: number, theta: number, hw: number, win: number, w: number, margin: number): void {
    if (nEv >= MAX_EVENTS || t < -win) return
    evT[nEv] = t
    evTheta[nEv] = theta
    evHw[nEv] = hw
    evWin[nEv] = win
    evW[nEv] = w
    evMargin[nEv] = margin
    nEv++
  }

  function buildEvents(t: number, seen: Snapshot, prev: Snapshot): void {
    nEv = 0
    nTg = 0
    const craft = session.craft
    const game = session.game
    const speed = Math.max(craft.speed, 1)
    const age = t - seen.t
    const death = DEATH * (game.lives <= 1 ? 2 : 1)
    const invuln = game.invuln

    // wall objects: keep only the `attention` nearest that were in sight
    const firstObj = nEv
    for (let i = 0; i < seen.nObj; i++) {
      const wd = seen.objWd[i]!
      if (wd - seen.dist > profile.lookAhead) continue // was still in the fog
      const ahead = wd - craft.distance
      const kind = seen.objKind[i]!
      const captureZ = kind === KIND_MINE ? HAZARD.CAPTURE_Z : kind === KIND_LIFE ? EXTRA_LIFE.CAPTURE_Z : PICKUP.CAPTURE_Z
      if (ahead < -captureZ) continue
      const tArr = ahead / speed
      const far = Math.min(1, Math.max(0, ahead / Math.max(profile.lookAhead, 1)))
      const theta = seen.objTheta[i]! + profile.thetaNoise * (0.25 + 0.75 * far) * objectError(wd, salt)
      const win = captureZ / speed
      if (kind === KIND_MINE) {
        if (tArr + win < invuln) continue // will pass while still flickering
        addEvent(tArr, theta, HAZARD.CAPTURE_ANGLE, win, -death, 0.3)
      } else if (kind === KIND_GEM) {
        addEvent(tArr, theta, TREASURE.CAPTURE_ANGLE * 0.85, win, profile.wGem, 0)
      } else if (kind === KIND_ORB) {
        const need = 1 - game.energy / ENERGY.MAX
        if (need > 0.05) addEvent(tArr, theta, PICKUP.CAPTURE_ANGLE * 0.85, win, 150 * need, 0)
      } else if (game.lives < LIVES.START) {
        addEvent(tArr, theta, EXTRA_LIFE.CAPTURE_ANGLE * 0.85, win, 300, 0)
      }
    }
    // attention limit: drop the farthest wall objects beyond what the bot can track
    while (nEv - firstObj > profile.attention) {
      let worst = firstObj
      for (let i = firstObj + 1; i < nEv; i++) if (evT[i]! > evT[worst]!) worst = i
      nEv--
      evT[worst] = evT[nEv]!
      evTheta[worst] = evTheta[nEv]!
      evHw[worst] = evHw[nEv]!
      evWin[worst] = evWin[nEv]!
      evW[worst] = evW[nEv]!
      evMargin[worst] = evMargin[nEv]!
    }

    // enemy bolts in flight: lethal at the ship plane
    for (let i = 0; i < seen.nBolt; i++) {
      const vz = seen.boltVz[i]!
      if (vz <= 0) continue
      const z = seen.boltZ[i]! + vz * age
      const tArr = -z / vz
      if (tArr < invuln) continue
      addEvent(tArr, seen.boltTheta[i]!, GUN.BULLET_HIT_ANGLE, GUN.BULLET_HIT_Z / vz + 0.02, -death, 0.2)
    }

    // raiders: the firing tell predicts a bolt down their line; one closing on the
    // ship plane is a ram threat; one in range is something to aim at (or avoid)
    for (let i = 0; i < seen.nEn; i++) {
      estimate(seen, prev, i)
      const z = seen.enZ[i]! + estZVel * age
      const theta = seen.enTheta[i]!
      const charge = seen.enCharge[i]!
      if (charge > 0.05 && z < -GUN.BULLET_HIT_Z) {
        const tFire = Math.max(0, (1 - charge) * ENEMY.CHARGE_TIME - age)
        const tArr = tFire + -z / ENEMY.BULLET_SPEED
        if (tArr >= invuln) addEvent(tArr, theta, GUN.BULLET_HIT_ANGLE, 0.06, -death, 0.2)
      }
      if (estZVel > 4 && z < ENEMY.RAM_Z) {
        const tArr = -z / estZVel
        if (tArr < 4 && tArr + ENEMY.RAM_Z / estZVel >= invuln) {
          addEvent(tArr, theta + estOm * Math.min(tArr, 0.3), ENEMY.RAM_ANGLE, ENEMY.RAM_Z / estZVel, -death, 0.25)
        }
      }
      const range = profile.keepOut > 0 ? 130 : profile.fireRange
      if (z < -6 && z > -range && nTg < MAX_TARGETS && (profile.keepOut > 0 || seen.enPhase[i] !== PHASE_DEPART)) {
        tgTheta[nTg] = theta + (profile.keepOut > 0 ? 0 : aimOffset)
        tgOm[nTg] = charge > 0.05 ? 0 : estOm * profile.lead
        tgTravel[nTg] = age + -z / GUN.BOLT_SPEED
        nTg++
      }
    }
  }

  function scorePlan(): number {
    let score = 0
    const H = nSteps * ROLL_DT
    const endTheta = th[nSteps]! + (th[nSteps]! - th[nSteps - 1]!) * 4 // drift ~0.13 s past the horizon
    for (let i = 0; i < nEv; i++) {
      const t = evT[i]!
      const w = evW[i]!
      const hw = evHw[i]!
      if (t <= H) {
        const win = evWin[i]!
        const k0 = Math.max(0, Math.floor((t - win) / ROLL_DT))
        const k1 = Math.min(nSteps, Math.ceil((t + win) / ROLL_DT))
        let minD = Math.PI
        for (let k = k0; k <= k1; k++) {
          const d = gap(th[k]!, evTheta[i]!)
          if (d < minD) minD = d
        }
        if (w < 0) {
          const margin = evMargin[i]!
          if (minD < hw) score += w
          else if (minD < hw + margin) score += w * 0.25 * (1 - (minD - hw) / margin)
        } else if (minD < hw) score += w * (1 - 0.15 * (t / H))
        else score += w * 0.2 * Math.max(0, 1 - (minD - hw) / 1.2)
      } else if (t < H + 1) {
        // just past the horizon: do not end the swing parked on a threat, and lean
        // toward the next thing worth collecting
        const f = 1 - (t - H)
        const d = gap(endTheta, evTheta[i]!)
        if (w < 0) {
          if (d < hw + evMargin[i]!) score += w * 0.3 * f
        } else score += w * 0.15 * f * Math.max(0, 1 - d / 1.5)
      }
    }
    if (profile.topAversion > 0) {
      for (let k = 1; k <= nSteps; k++) if (gap(th[k]!, 0) > TOP_ZONE) score -= profile.topAversion * ROLL_DT
    }
    if (nTg > 0) {
      const aimSteps = Math.min(nSteps, Math.round(0.7 / ROLL_DT))
      const canAim = profile.wAim > 0 && session.game.energy >= GUN.COST
      for (let k = 1; k <= nSteps; k++) {
        let best = Math.PI
        for (let j = 0; j < nTg; j++) {
          const lead = Math.max(-0.6, Math.min(0.6, tgOm[j]! * (k * ROLL_DT + tgTravel[j]!)))
          const d = gap(th[k]!, tgTheta[j]! + lead)
          if (d < best) best = d
        }
        if (profile.keepOut > 0) {
          if (best < profile.keepOut) score -= 60 * ROLL_DT * (1 - best / profile.keepOut)
        } else if (canAim && k <= aimSteps) {
          const unit = (profile.wAim * ROLL_DT) / 0.7
          if (best < GUN.HIT_ANGLE_KILL * 0.85) score += unit
          else score += unit * 0.2 * Math.max(0, 1 - best / 1.0)
        }
      }
    }
    return score
  }

  function decide(t: number, seen: Snapshot, prev: Snapshot): number {
    buildEvents(t, seen, prev)
    const craft = session.craft
    const g = session.gravity() * gravityFeel
    let bestScore = -Infinity
    let bestAction = 0
    for (const plan of plans) {
      scratch.theta = craft.theta
      scratch.omega = craft.omega
      scratch.steerSignal = craft.steerSignal * torqueFeel
      scratch.speed = craft.speed
      scratch.distance = 0
      th[0] = scratch.theta
      const e1 = plan[1]
      const e2 = e1 + plan[3]
      const e3 = e2 + plan[5]
      let effort = 0
      for (let k = 1; k <= nSteps; k++) {
        const tk = (k - 1) * ROLL_DT
        const a = tk < e1 ? plan[0] : tk < e2 ? plan[2] : tk < e3 ? plan[4] : 0
        scratchInput.steerTarget = a * torqueFeel
        updateCraft(scratch, scratchInput, craft.speed, g, 1e9, ROLL_DT)
        th[k] = scratch.theta
        if (a !== 0) effort += ROLL_DT
      }
      let score = scorePlan() - 1.5 * effort
      if (plan[0] === bot.steer && plan[1] > 0) score += 2 // do not flip keys for nothing
      if (plan[1] === 0 && bot.steer === 0) score += 2
      if (score > bestScore) {
        bestScore = score
        bestAction = plan[1] > 0 ? plan[0] : 0
      }
    }
    return bestAction
  }

  return bot
}

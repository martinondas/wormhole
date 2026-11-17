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
//   mineShots  - whether it shoots mines on purpose (a shot mine explodes, see config
//                BLAST). Every bot that fires, except the spinner (it holds the fire
//                key regardless), knows the blast rule (world/blast.ts) and tries not
//                to fire a bolt that would set a mine off inside the danger distance,
//                and the planning bots steer clear of the detonations their bolts in
//                flight will cause. It judges this through the limits above: the mines
//                and its own line as it saw them `reaction` ago, mine angles off by
//                thetaNoise and aimError, only the `attention` nearest wall objects in
//                mind, a fresh look only decisionHz times a second, and the fire key
//                held at least minHold. So a bot with limits is sometimes hurt by its
//                own blast; the oracle never is.
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
import { createRng } from '../../src/util/rng'
import { BLAST, ENERGY, ENEMY, EXTRA_LIFE, GUN, HAZARD, LIFE_SHARD, LIVES, PICKUP, RIDE_RADIUS, SHIP, TREASURE } from '../../src/config'
import { blastHalfAngle, boltHitsMine, chainLinks, wallDistance } from '../../src/world/blast'
import { raiderHitAngle } from '../../src/world/enemies'
import {
  createPerception,
  createSnapshot,
  type Perception,
  type Snapshot,
  KIND_GEM,
  KIND_LIFE,
  KIND_SHARD,
  KIND_MINE,
  KIND_ORB,
  PHASE_DEPART,
  PHASE_EXIT,
  MAX_ENEMIES,
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
  about: string
  // 'search' plans with the look-ahead search below; 'spinner' and 'tapper' are
  // scripted probes of one exploit or one failure case (see their profiles).
  brain: 'search' | 'spinner' | 'tapper'
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
  // 'never': a mine is hit only by a bolt meant for a raider. 'cornered': it also
  // shoots the mine on its line when its best plan still ends in a mine. 'all': it
  // shoots every mine on its line. Always only outside the danger distance.
  mineShots: 'never' | 'cornered' | 'all'
  topAversion: number // cost per second spent near the top of the tube (upside down)
  wGem: number
  wAim: number
  nearBias: number // 0..1: how much less a pickup at the end of the look-ahead counts than one right now
}

const base = {
  brain: 'search' as BotProfile['brain'],
  steers: true,
  fires: true,
  keepOut: 0,
  mineShots: 'never' as BotProfile['mineShots'],
  wGem: 100,
  wAim: 80,
  nearBias: 0.15,
}

// The scripted bots (spinner, tapper, passive) do not plan, aim or err: every
// limit of the look-ahead search is zero for them.
const scripted = {
  ...base,
  reaction: 0,
  decisionHz: 1,
  lookAhead: 0,
  horizon: 0,
  thetaNoise: 0,
  minHold: 0,
  motorJitter: 0,
  modelError: 0,
  attention: 0,
  planSet: 'simple' as BotProfile['planSet'],
  lead: 0,
  fireTol: 0,
  aimError: 0,
  fireRange: 0,
  lapsePerSec: 0,
  lapseMax: 0,
  topAversion: 0,
}

export const PROFILES: Record<string, BotProfile> = {
  kid: {
    ...base,
    motorJitter: 0.05,
    modelError: 0.18,
    topAversion: 80,
    aimError: 0.3,
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
    about: 'no delay, no error, sees everything spawned: its deaths approximate unfair situations',
    // It sees a whole gem line at once and its key plans are coarse, so with the
    // default bias it gives up the next gem for a plan that looks richer and is not
    // (the good bot, which sees less far, collected those gems). A strong bias toward
    // the next pickup fixes that; dodging is not affected.
    nearBias: 0.9,
    mineShots: 'cornered',
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
  // Holds one steer key (right or left, by seed) for the whole run and holds fire:
  // measures what an endless spin earns and costs.
  spinner: {
    ...scripted,
    brain: 'spinner',
    about: 'holds one steer key for the whole run and fires constantly (endless-spin exploit)',
  },
  // Rests at the bottom and collects nothing. It shoots a raider on its line, and
  // when a raider on its line shows the firing tell it waits 250 ms (its reaction),
  // taps 150 ms away and lets go. Its bolt hits are the "I dodged and it still hit
  // me" case: the pendulum carries the craft back onto the line before the bolt lands.
  tapper: {
    ...scripted,
    brain: 'tapper',
    about: 'rests at the bottom, shoots raiders on its line, answers a tell on its line with one 150 ms tap away',
    reaction: 0.25,
    decisionHz: 30,
    fireTol: GUN.HIT_ANGLE,
    fireRange: 110,
  },
  passive: {
    ...scripted,
    about: 'no input at all: the craft hangs at the bottom',
    steers: false,
    fires: false,
  },
}

// The good player who also shoots every mine on its line: the upper limit of how
// much shooting mines helps.
PROFILES.miner = {
  ...PROFILES.good!,
  about: 'the good player, and it shoots every mine on its line that is outside the danger distance',
  mineShots: 'all',
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
const TAP_SECONDS = 0.15 // tapper: length of its dodge tap
const TOP_ZONE = (120 * Math.PI) / 180 // farther than this from the bottom counts as near the top
// The danger distance of a mine blast is BLAST.RADIUS plus this margin (u), for the
// craft's own swing between the shot and the blast.
const BLAST_CLEARANCE = 2
const BLAST_WINDOW = 0.05 // s: half time window of a predicted detonation (it is one instant)

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
  const evMine = new Uint8Array(MAX_EVENTS) // 1 = a mine on the wall (what a 'cornered' bot shoots)
  let nEv = 0
  // mines in sight, and the detonations one player bolt would set off among them
  const mnTheta = new Float64Array(HAZARD.COUNT)
  const mnWd = new Float64Array(HAZARD.COUNT)
  const mnLink = new Int8Array(HAZARD.COUNT) // predictBlast: its chain link (-1 = it does not go off)
  const mnOrder = new Uint8Array(HAZARD.COUNT)
  let nMn = 0
  let mnFirst = -1 // predictBlast: the mine the bolt reaches (-1 = none)
  let blastT = 0 // predictBlast: s from now until the bolt lands and the whole chain goes off
  let blast: 'none' | 'safe' | 'unsafe' = 'none' // what a bolt fired now would do, as judged at the last look
  let blastTargetWd = 0 // ... and the mine it would reach
  let nextBlastLook = 0
  let cornered = false // the plan chosen last still rides into a mine
  // raiders worth aiming at / keeping away from
  const tgTheta = new Float64Array(MAX_TARGETS)
  const tgOm = new Float64Array(MAX_TARGETS)
  const tgTravel = new Float64Array(MAX_TARGETS)
  let nTg = 0

  let rng = createRng(1) // the bot's own noise, separate from the gameplay randomness so a bot never shifts the spawn sequence
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
  let spinDir = 1 // spinner: the key it holds
  let tapUntil = -1 // tapper: end of the current dodge tap
  let tapDir = 0
  const answered = new Uint8Array(MAX_ENEMIES) // tapper: raider ids whose current tell it already answered

  const bot: Bot = {
    profile,
    steer: 0,
    fire: false,

    reset(seed: number): void {
      rng = createRng(seed ^ 0x9e3779b9)
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
      spinDir = seed % 2 === 0 ? -1 : 1 // by seed parity: drawing from rng would shift every bot's noise
      tapUntil = -1
      tapDir = 0
      cornered = false
      blast = 'none'
      nextBlastLook = 0
      answered.fill(0)
      bot.steer = 0
      bot.fire = false
    },

    tick(t: number): void {
      if (!profile.steers && !profile.fires) return
      if (profile.brain === 'spinner') {
        bot.steer = spinDir
        bot.fire = true
        return
      }
      head = (head + 1) % ringSize
      perception.capture(ring[head]!, t)
      if (filled < ringSize) filled++
      // the snapshot the bot is acting on, and the one before it (for velocities)
      const back = Math.min(filled - 1, Math.round(profile.reaction * TICK_HZ))
      const seen = ring[(head - back + ringSize * 2) % ringSize]!
      const prev = filled - 1 > back ? ring[(head - back - 1 + ringSize * 2) % ringSize]! : seen
      if (profile.brain === 'tapper') {
        tapperTick(t, seen)
        return
      }

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
          desired = decide(t, seen, prev, ring[head]!)
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
        // it looks at the mines on its line as often as it re-plans, not every tick
        if (t >= nextBlastLook) {
          nextBlastLook = t + 1 / profile.decisionHz
          blast = shotBlast(t, seen, prev)
        }
        const want = !lapsed && blast !== 'unsafe' && wantsFire(t, seen, prev, ring[head]!, blast === 'safe')
        if (want !== bot.fire && t >= fireLock) {
          bot.fire = want
          fireLock = t + profile.minHold
        }
      }
    },
  }

  // Tapper: one tap away from each tell it sees on its own line, else rest and
  // shoot whatever sits on its line.
  function tapperTick(t: number, seen: Snapshot): void {
    const craft = session.craft
    let onLine = false
    for (let i = 0; i < seen.nEn; i++) {
      const id = seen.enId[i]!
      const z = seen.enZ[i]!
      const d = gap(craft.theta, seen.enTheta[i]!)
      if (seen.enCharge[i]! <= 0.05) {
        answered[id] = 0
      } else if (!answered[id] && d < GUN.BULLET_HIT_ANGLE && t >= tapUntil) {
        answered[id] = 1
        const away = signedGap(craft.theta, seen.enTheta[i]!)
        tapDir = away >= 0 ? 1 : -1
        tapUntil = t + TAP_SECONDS
      }
      if (z < -6 && z > -profile.fireRange && d < profile.fireTol) onLine = true
    }
    bot.steer = t < tapUntil ? tapDir : 0
    bot.fire = onLine && session.game.energy >= GUN.COST && shotBlast(t, seen, seen) !== 'unsafe'
  }

  // The mines the bot has in mind, where it judges them to be: in sight `reaction`
  // ago, among the `attention` nearest wall objects still ahead, each angle off by
  // its thetaNoise error and by the wandering aimError.
  function gatherMines(seen: Snapshot): void {
    nMn = 0
    const dist = session.craft.distance
    for (let i = 0; i < seen.nObj && nMn < HAZARD.COUNT; i++) {
      const wd = seen.objWd[i]!
      if (seen.objKind[i] !== KIND_MINE || !inMind(seen, wd)) continue
      let nearer = 0
      for (let k = 0; k < seen.nObj; k++) if (seen.objWd[k]! < wd && inMind(seen, seen.objWd[k]!)) nearer++
      if (nearer >= profile.attention) continue
      const far = Math.min(1, Math.max(0, (wd - dist) / Math.max(profile.lookAhead, 1)))
      mnTheta[nMn] = seen.objTheta[i]! + profile.thetaNoise * (0.25 + 0.75 * far) * objectError(wd, salt) + aimOffset
      mnWd[nMn] = wd
      nMn++
    }
  }
  // a wall object at `wd` was out of the fog in `seen` and has not passed the ship
  function inMind(seen: Snapshot, wd: number): boolean {
    return wd - seen.dist <= profile.lookAhead && wd - session.craft.distance >= -HAZARD.CAPTURE_Z
  }

  // What a player bolt at ship-relative `boltZ` down `boltTheta`, with `ttl` seconds
  // left, sets off among the gathered mines, by the game's own rules (world/blast.ts)
  // applied to the judged positions: the first mine it touches (mnFirst), after
  // blastT seconds, and with it the whole chain (mnLink). A raider it reaches first
  // takes the bolt. `sweep` (rad) also tries the line that far to the side. Returns
  // whether any mine goes off.
  function predictBlast(t: number, seen: Snapshot, prev: Snapshot, boltTheta: number, boltZ: number, ttl: number, sweep = 0): boolean {
    const craft = session.craft
    const closing = GUN.BOLT_SPEED + craft.speed // the mine comes toward the bolt at the craft's speed
    mnFirst = -1
    blastT = Math.max(ttl, 0)
    for (let i = 0; i < nMn; i++) {
      const z = craft.distance - mnWd[i]! // ship-relative now
      const hitT = (boltZ - z) / closing
      if (hitT < 0 || hitT > blastT) continue
      const zHit = z + craft.speed * hitT
      if (!boltHitsMine(boltTheta, mnTheta[i]!, 0, zHit) && !(sweep !== 0 && boltHitsMine(boltTheta + sweep, mnTheta[i]!, 0, zHit))) continue
      mnFirst = i
      blastT = hitT
    }
    if (mnFirst < 0) return false
    // raiders hold their depth ahead of the ship, so the bolt closes on one at its own speed
    const age = t - seen.t
    for (let i = 0; i < seen.nEn; i++) {
      estimate(seen, prev, i)
      const z = seen.enZ[i]! + estZVel * age
      const hitT = (boltZ - z) / GUN.BOLT_SPEED
      if (hitT < 0 || hitT >= blastT) continue
      const om = seen.enCharge[i]! > 0.05 ? 0 : estOm // a charging raider holds its line
      const theta = seen.enTheta[i]! + aimOffset + om * (age + hitT) * profile.lead
      if (gap(boltTheta, theta) < raiderHitAngle(z)) return false
    }
    chainLinks(mnTheta, mnWd, nMn, mnFirst, mnLink, mnOrder)
    return true
  }

  // A bolt fired before the next tick: 'none' if it reaches no mine, 'unsafe' if a
  // detonation it sets off would be inside the danger distance of the craft, else
  // 'safe'. The bot judges its own line as it saw it `reaction` ago, carried on at
  // the spin it had then, and swept by how far the craft swings until the next tick.
  function shotBlast(t: number, seen: Snapshot, prev: Snapshot): 'none' | 'safe' | 'unsafe' {
    gatherMines(seen)
    const craft = session.craft
    const line = seen.theta + seen.omega * (t - seen.t)
    if (!predictBlast(t, seen, prev, line, SHIP.Z, GUN.BOLT_TTL, seen.omega / TICK_HZ)) return 'none'
    blastTargetWd = mnWd[mnFirst]!
    for (let i = 0; i < nMn; i++) {
      if (mnLink[i]! < 0) continue
      const z = craft.distance + craft.speed * blastT - mnWd[i]! // ship-relative when the bolt lands
      if (wallDistance(line, mnTheta[i]!, z - SHIP.Z) < BLAST.RADIUS + BLAST_CLEARANCE) return 'unsafe'
    }
    return 'safe'
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

  function raiderOnLine(t: number, seen: Snapshot, prev: Snapshot): boolean {
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

  // Fire at a raider on the line, or (by profile) at the mine a bolt fired now would
  // reach (`mineOnLine`: the last look found one at a safe distance), unless one of
  // its own bolts (`own`, the newest snapshot) is already on its way to that mine.
  function wantsFire(t: number, seen: Snapshot, prev: Snapshot, own: Snapshot, mineOnLine: boolean): boolean {
    if (session.game.energy < GUN.COST) return false
    if (raiderOnLine(t, seen, prev)) return true
    if (!mineOnLine || profile.mineShots === 'never' || (profile.mineShots === 'cornered' && !cornered)) return false
    gatherMines(seen)
    for (let i = 0; i < own.nShot; i++) {
      const z = own.shotZ[i]! - GUN.BOLT_SPEED * (t - own.t)
      if (predictBlast(t, seen, prev, own.shotTheta[i]!, z, GUN.BOLT_TTL - (SHIP.Z - z) / GUN.BOLT_SPEED) && mnWd[mnFirst] === blastTargetWd) return false
    }
    return true
  }

  function addEvent(t: number, theta: number, hw: number, win: number, w: number, margin: number, mine = false): void {
    if (nEv >= MAX_EVENTS || t < -win) return
    evMine[nEv] = mine ? 1 : 0
    evT[nEv] = t
    evTheta[nEv] = theta
    evHw[nEv] = hw
    evWin[nEv] = win
    evW[nEv] = w
    evMargin[nEv] = margin
    nEv++
  }

  // `own` is the newest snapshot: the bot knows where its own bolts are, like it
  // feels its own craft.
  function buildEvents(t: number, seen: Snapshot, prev: Snapshot, own: Snapshot): void {
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
      const captureZ = kind === KIND_MINE ? HAZARD.CAPTURE_Z : kind === KIND_LIFE ? EXTRA_LIFE.CAPTURE_Z : kind === KIND_SHARD ? LIFE_SHARD.CAPTURE_Z : PICKUP.CAPTURE_Z
      if (ahead < -captureZ) continue
      const tArr = ahead / speed
      const far = Math.min(1, Math.max(0, ahead / Math.max(profile.lookAhead, 1)))
      const theta = seen.objTheta[i]! + profile.thetaNoise * (0.25 + 0.75 * far) * objectError(wd, salt)
      const win = captureZ / speed
      if (kind === KIND_MINE) {
        if (tArr + win < invuln) continue // will pass while still flickering
        addEvent(tArr, theta, HAZARD.CAPTURE_ANGLE, win, -death, 0.3, true)
      } else if (kind === KIND_GEM) {
        addEvent(tArr, theta, TREASURE.CAPTURE_ANGLE * 0.85, win, profile.wGem, 0)
      } else if (kind === KIND_ORB) {
        const need = 1 - game.energy / ENERGY.MAX
        if (need > 0.05) addEvent(tArr, theta, PICKUP.CAPTURE_ANGLE * 0.85, win, 150 * need, 0)
      } else if (kind === KIND_SHARD) {
        // a piece of a life: wanted whenever a life is missing, more the closer the set is to full
        // at full lives it pays one gem's worth of score
        const w = game.lives < LIVES.START ? 200 + (100 * (game.shards + 1)) / game.shardsPerLife : profile.wGem
        addEvent(tArr, theta, LIFE_SHARD.CAPTURE_ANGLE * 0.85, win, w, 0)
      } else {
        // a whole life; at full lives it pays a kill's worth of score
        addEvent(tArr, theta, EXTRA_LIFE.CAPTURE_ANGLE * 0.85, win, game.lives < LIVES.START ? 300 : profile.wGem * 2, 0)
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
      evMine[worst] = evMine[nEv]!
    }

    // its own bolts in flight: when one lands on a mine, every mine of the chain goes
    // off, lethal inside the blast radius, which at a mine's depth then is a stretch
    // of the wall around it
    gatherMines(seen)
    for (let i = 0; i < own.nShot; i++) {
      const z = own.shotZ[i]! - GUN.BOLT_SPEED * (t - own.t)
      if (!predictBlast(t, seen, prev, own.shotTheta[i]!, z, GUN.BOLT_TTL - (SHIP.Z - z) / GUN.BOLT_SPEED) || blastT < invuln) continue
      for (let j = 0; j < nMn; j++) {
        if (mnLink[j]! < 0) continue
        const mineZ = craft.distance + craft.speed * blastT - mnWd[j]! // ship-relative when the bolt lands
        const halfAngle = blastHalfAngle(mineZ - SHIP.Z)
        if (halfAngle === 0) continue
        addEvent(blastT, mnTheta[j]!, halfAngle, BLAST_WINDOW, -death, BLAST_CLEARANCE / RIDE_RADIUS)
      }
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
      // a raider leaving forward is harmless and not worth a shot or a detour
      if (seen.enPhase[i] === PHASE_EXIT) continue
      if (z < -6 && z > -range && nTg < MAX_TARGETS && (profile.keepOut > 0 || seen.enPhase[i] !== PHASE_DEPART)) {
        tgTheta[nTg] = theta + (profile.keepOut > 0 ? 0 : aimOffset)
        tgOm[nTg] = charge > 0.05 ? 0 : estOm * profile.lead
        tgTravel[nTg] = age + -z / GUN.BOLT_SPEED
        nTg++
      }
    }
  }

  let planMine = false // scorePlan: the plan just scored rides into a mine
  function scorePlan(): number {
    let score = 0
    planMine = false
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
          if (minD < hw) {
            score += w
            if (evMine[i]) planMine = true
          } else if (minD < hw + margin) score += w * 0.25 * (1 - (minD - hw) / margin)
        } else if (minD < hw) score += w * (1 - profile.nearBias * (t / H))
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

  function decide(t: number, seen: Snapshot, prev: Snapshot, own: Snapshot): number {
    buildEvents(t, seen, prev, own)
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
        cornered = planMine
      }
    }
    return bestAction
  }

  return bot
}

// Headless checks for the gem lines (npm run sim:sequence): the phrase library
// (world/phrases.ts), the ghost, and the director (world/sequencer.ts). Bundled with
// esbuild, like the other sims.
//
//   A) every scripted phrase, in every tier it may appear in, at tuning levels 0 to
//      20, mirrored and not, in every difficulty mode: a replay of its script through
//      stepSwing collects every gem and touches no mine, every mine keeps MINE_CLEAR
//      from the ghost through its capture window, and the path does not depend on
//      the level; the loop's hold carries the ghost over the top in every tier it
//      appears in, and arc and pump reach above the horizontal;
//   B) the director over 200 cycles per mode in the real session: no phrase crosses
//      a section boundary or starts inside BOUNDARY_CLEAR, the gem budget holds, the
//      mine budget holds in nearly every section, no spawn fails, and when a level
//      gate opens the tube beyond it is timed for the next level: the waiting
//      phrases still fit a replay, and later phrases are laid out at its speeds;
//   C) an open-loop input-jitter model on arc and pump (a grade of the phrases
//      against each other, not a prediction of human catch rates);
//   D) the title screen, the pressure signal, and a difficulty or flight-mode change.
import { createSession, type Session, type SessionFx } from '../src/session'
import { createFlight, TIERS, type Flight } from '../src/flight'
import { stepSwing, type SwingState } from '../src/craft'
import { PHRASES, buildTrace, segmentSeconds, type Phrase, type Trace } from '../src/world/phrases'
import { createRng, seedRng } from '../src/util/rng'
import { angleDiff, DEG } from '../src/util/math'
import { DIFFICULTY, HAZARD, LEVELS, PHYSICS, SEQUENCE, SPEED, TREASURE } from '../src/config'
import { check, finish, driveSession, flyOntoGems, STEP_DT as DT } from './sim-kit'

const IDLE = { steerTarget: 0, fire: false } // the craft rests at the bottom
const scripted = PHRASES.filter((p) => p.script.length > 0)
const modeNames = DIFFICULTY.MODES.map((m) => m.name)

// Plays a phrase's script from rest at the bottom (or with jittered timing) and
// reports what it collects and touches. Items: ghost time + angle, at tier speed.
interface Replay {
  collected: number
  mineHits: number
  minMineGap: number // closest angle to a mine inside the mine's capture window
  maxPathDiff: number // against `reference`, when given
}
function replay(
  phrase: Phrase,
  tier: number,
  gemT: ArrayLike<number>,
  gemTheta: ArrayLike<number>,
  nGems: number,
  mineT: ArrayLike<number>,
  mineTheta: ArrayLike<number>,
  nMines: number,
  speed: number,
  gravity: number,
  mirror: number,
  reference?: Trace,
  jitter?: () => number, // seconds added to the start and to every duration
): Replay {
  const ghost: SwingState = { theta: 0, omega: 0, steerSignal: 0 }
  const got = new Uint8Array(nGems)
  const hit = new Uint8Array(nMines)
  const out: Replay = { collected: 0, mineHits: 0, minMineGap: Math.PI, maxPathDiff: 0 }
  let t = jitter ? jitter() : 0 // a late (or early) start: the craft is already past ghost time 0
  const touch = (): void => {
    const d = speed * t
    for (let i = 0; i < nGems; i++) {
      if (got[i] || Math.abs(d - speed * gemT[i]!) >= TREASURE.CAPTURE_Z) continue
      if (Math.abs(angleDiff(ghost.theta, mirror * gemTheta[i]!)) < TREASURE.CAPTURE_ANGLE) got[i] = 1
    }
    for (let i = 0; i < nMines; i++) {
      if (Math.abs(d - speed * mineT[i]!) >= HAZARD.CAPTURE_Z) continue
      const gap = Math.abs(angleDiff(ghost.theta, mirror * mineTheta[i]!))
      if (gap < out.minMineGap) out.minMineGap = gap
      if (gap < HAZARD.CAPTURE_ANGLE) hit[i] = 1
    }
    if (reference && t <= reference.duration) out.maxPathDiff = Math.max(out.maxPathDiff, Math.abs(ghost.theta - mirror * reference.thetaAt(t)))
  }
  for (const seg of phrase.script) {
    const j = jitter ? jitter() : 0
    const seconds = seg.untilDeg ? segmentSeconds(seg, tier) : Math.max(0, segmentSeconds(seg, tier) + j)
    const steps = Math.round(seconds * PHYSICS.HZ)
    const target = seg.untilDeg ? seg.untilDeg[tier]! * DEG : 0
    let extra = Math.round(Math.max(0, j) * PHYSICS.HZ) // a late release: hold on this many steps past the angle
    for (let k = 0; k < steps; k++) {
      // an early release lets go when the angle is still |j| seconds away
      if (seg.untilDeg && Math.abs(ghost.theta) >= target + Math.min(0, j) * Math.abs(ghost.omega) && extra-- <= 0) break
      stepSwing(ghost, seg.steer * mirror, gravity, DT)
      t += DT
      touch()
    }
  }
  // coast on a little, so an item at the very end of the phrase is passed
  for (let k = 0; k < PHYSICS.HZ * 0.3; k++) {
    stepSwing(ghost, 0, gravity, DT)
    t += DT
    touch()
  }
  for (let i = 0; i < nGems; i++) out.collected += got[i]!
  for (let i = 0; i < nMines; i++) out.mineHits += hit[i]!
  return out
}

// The level a mode plays tuning level T at (may be fractional; null when the mode
// starts above T).
const levelFor = (f: Flight, mode: number, T: number): number | null => {
  const m = DIFFICULTY.MODES[mode]!
  const level = (T - m.offset) / m.slope
  return level < 0 || Math.abs(f.tuned(level) - T) > 1e-9 ? null : level
}

// ---- A) the library: replay, mine clearance, level independence ----
;(() => {
  let cases = 0
  let missed = ''
  let touched = ''
  let tight = ''
  let worstGap = Math.PI
  let worstDiff = 0
  let spacing = ''
  let loopShort = ''
  let low = ''
  let peaks = ''
  for (let mode = 0; mode < DIFFICULTY.MODES.length; mode++) {
    const f = createFlight()
    f.setDifficulty(mode)
    for (const phrase of scripted) {
      for (const tier of TIERS) {
        const unlock = phrase.unlock[tier]
        if (unlock === null || unlock === undefined) continue
        const trace = buildTrace(phrase, tier, f.gravityOf(0, f.tierSpeedOf(0, tier)))
        for (let i = 1; i < trace.nGems; i++) {
          if (trace.gemT[i]! - trace.gemT[i - 1]! < SEQUENCE.GEM_EVERY_MIN - 1e-6) spacing += ` ${phrase.id}/t${tier}`
        }
        // how far from the bottom the path gets (unwrapped: above 180 = over the top)
        let peak = 0
        for (let t = 0; t <= trace.duration; t += DT) peak = Math.max(peak, Math.abs(trace.thetaAt(t)))
        const peakDeg = peak / DEG
        if (mode === 0) peaks += ` ${phrase.id}/t${tier} ${peakDeg.toFixed(0)}`
        // a ring: over the top and down to the horizontal on the far side at least
        if (phrase.id === 'loop' && peakDeg < 270) loopShort += ` ${modeNames[mode]}/t${tier}:${peakDeg.toFixed(0)}`
        if ((phrase.id === 'arc' || phrase.id === 'pump') && peakDeg <= 90) low += ` ${modeNames[mode]}/${phrase.id}/t${tier}:${peakDeg.toFixed(0)}`
        for (let T = 0; T <= 20; T++) {
          const level = levelFor(f, mode, T)
          if (level === null) continue
          const speed = f.tierSpeedOf(level, tier)
          const gravity = f.gravityOf(level, speed)
          // the mines present at this tuning level (every variant: the budget can only remove some)
          const mT: number[] = []
          const mTheta: number[] = []
          for (let i = 0; i < trace.nMines; i++) {
            if (T >= trace.mineMinTuned[i]!) {
              mT.push(trace.mineT[i]!)
              mTheta.push(trace.mineTheta[i]!)
            }
          }
          for (const mirror of [1, -1]) {
            const r = replay(phrase, tier, trace.gemT, trace.gemTheta, trace.nGems, mT, mTheta, mT.length, speed, gravity, mirror, trace)
            cases++
            const tag = ` ${modeNames[mode]}/${phrase.id}/t${tier}/T${T}/${mirror > 0 ? 'R' : 'L'}`
            if (r.collected !== trace.nGems) missed += `${tag}:${r.collected}/${trace.nGems}`
            if (r.mineHits > 0) touched += tag
            if (r.minMineGap < SEQUENCE.MINE_CLEAR) tight += `${tag}:${r.minMineGap.toFixed(2)}`
            if (r.minMineGap < worstGap) worstGap = r.minMineGap
            if (r.maxPathDiff > worstDiff) worstDiff = r.maxPathDiff
          }
        }
      }
    }
  }
  check('A1 a replay of the script collects every gem', missed === '', missed ? missed.slice(0, 300) : `${cases} cases`)
  check('A2 a replay of the script touches no mine', touched === '', touched.slice(0, 300))
  check('A3 every mine keeps MINE_CLEAR from the ghost through its capture window', tight === '', tight ? tight.slice(0, 300) : `closest ${worstGap.toFixed(2)} rad (MINE_CLEAR ${SEQUENCE.MINE_CLEAR})`)
  check('A4 the path at tuning level 0 and 20 differs by less than 0.01 rad', worstDiff < 0.01, `worst ${worstDiff.toExponential(2)} rad over levels 0..20`)
  check('A5 gems on a path are at least GEM_EVERY_MIN apart', spacing === '', spacing)
  check("A7 the loop's hold carries the ghost over the top and around in every tier it appears in", loopShort === '', loopShort || `degrees from the bottom reached:${peaks}`)
  check('A8 arc and pump reach above the horizontal in every tier', low === '', low)
  check('A6 LEVELS.GRAVITY_MODE is "tier" (one trace per phrase and tier assumes it)', LEVELS.GRAVITY_MODE === 'tier')
})()

// ---- B) the director in the real session: 200 cycles per mode ----
// I-frames are held on and the craft is put on every gem, so the quotas are met by
// collecting and the level gates open at every place in the section cycle.
interface Rec {
  id: Phrase['id']
  tier: number
  mirror: boolean
  start: number
  end: number
  speed: number
  gems: number
  cycle: number
}
function runDirector(mode: number, cycles: number, seed: number) {
  const recs: Rec[] = []
  const stats = {
    phrases: 0, crossing: 0, inClear: 0, wrongTier: 0, repeats3: 0,
    cycleGems: [] as number[], sections: 0, mineOff: 0, mineWorst: 0, worstMine: '',
    perTier: [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()],
    gates: 0, rescaleChecked: 0, rescaleMissed: 0, straddling: 0, wrongSpeed: 0, restMin: Infinity, quietMax: 0,
    failedSpawns: 0, gemsLive: 0, minesLive: 0, restSum: 0, rests: 0, restsOver4: 0,
    warmupMines: 0,
  }
  let lastEnd = -1
  let knownGate = Infinity // the open gate this sim has heard of (quotaReached)
  // The tube's tier speed at a distance ahead of the craft (the next level's beyond an
  // open gate), and the seconds of steady flight between two such distances.
  const BASE = [SPEED.SLOW, SPEED.NORMAL, SPEED.FAST]
  const speedAt = (d: number): number => session.flight.speedRatioAt(d) * BASE[session.flight.tierIndexAt(d)]!
  const REST_STEP = 0.25
  const secondsBetween = (from: number, to: number): number => {
    let s = 0
    for (let d = from; d < to; d += REST_STEP) s += Math.min(REST_STEP, to - d) / speedAt(d)
    return s
  }
  let warmupInSection = false
  let prevId = ''
  let prevPrevId = ''
  let session!: Session
  const fx: SessionFx = {
    phrasePlaced: (p) => {
      if (!session) return // the layout made while the session is built is replaced by reset()
      stats.phrases++
      if (stats.phrases <= SEQUENCE.WARMUP_PHRASES) {
        stats.warmupMines += p.mines
        warmupInSection = true
      }
      if (p.end > p.sectionEnd + 1e-6) stats.crossing++
      if (p.start < p.clearEnd - 1e-6) stats.inClear++
      const f = session.flight
      if (f.tierIndexAt(p.start) !== p.tier || f.tierIndexAt(p.end - 1e-3) !== p.tier) stats.wrongTier++
      // too soon: one of the last two phrases, unless the phrase's spacing allows it
      const spacing = PHRASES.find((x) => x.id === p.id)!.spacing?.[p.tier] ?? 2
      if ((p.id === prevId && spacing >= 1) || (p.id === prevPrevId && spacing >= 2)) stats.repeats3++
      prevPrevId = prevId
      prevId = p.id
      const m = stats.perTier[p.tier]!
      m.set(p.id, (m.get(p.id) ?? 0) + 1)
      // A phrase is laid out at the speed of its tier at the level of the tube there.
      // One placed while a gate is opening still has the current level's speed: its
      // items move to the next level's timing right after (checked by the replay below).
      const opening = f.gateAt < Infinity && f.gateAt !== knownGate
      if (Math.abs(p.speed - (opening ? f.tierSpeedOf(f.level, p.tier) : speedAt(p.start + 1e-3))) > 1e-6) stats.wrongSpeed++
      if (lastEnd >= 0) {
        const rest = secondsBetween(lastEnd, p.start)
        stats.restSum += rest
        stats.rests++
        if (rest > 4) stats.restsOver4++
        if (rest < stats.restMin) stats.restMin = rest
        if (rest > stats.quietMax) stats.quietMax = rest
      }
      lastEnd = p.end
      recs.push({ id: p.id, tier: p.tier, mirror: p.mirror, start: p.start, end: p.end, speed: p.speed, gems: p.gems, cycle: p.cycle })
      if (recs.length > 12) recs.shift()
    },
    sectionPlanned: (tier, mines, budget) => {
      if (!session) return
      if (warmupInSection) {
        // a section that holds the mine-free opening of the run is under its budget by design
        warmupInSection = false
        return
      }
      stats.sections++
      const off = Math.abs(mines - budget)
      if (off > 1 + 1e-9) stats.mineOff++
      if (off > stats.mineWorst) {
        stats.mineWorst = off
        stats.worstMine = `tier ${tier}: ${mines} mines, budget ${budget.toFixed(2)}`
      }
    },
    cyclePlanned: (_cycle, gems) => {
      if (session) stats.cycleGems.push(gems)
    },
    quotaReached: () => {
      stats.gates++
      // The gate just opened. Every phrase waiting beyond it was moved to keep its
      // times at the next level's speed: a replay must still collect all its gems. A
      // phrase the gate cuts through is replayed with the time each gem takes to reach.
      const f = session.flight
      const gate = f.gateAt
      knownGate = gate
      const ratio = speedAt(gate + 1e-3) / speedAt(gate - 1e-3)
      const move = (d: number): number => (d > gate ? gate + (d - gate) * ratio : d)
      if (lastEnd > gate) lastEnd = move(lastEnd)
      for (const r of recs) {
        if (r.end <= gate) continue
        const cut = r.start < gate
        r.start = move(r.start)
        r.end = move(r.end)
        const phrase = PHRASES.find((p) => p.id === r.id)!
        // a phrase the craft is already in has lost gems to it: not a waiting phrase
        if (phrase.script.length === 0 || r.start < session.craft.distance + TREASURE.CAPTURE_Z) continue
        if (cut) stats.straddling++
        const speed = speedAt(r.start + 1e-3)
        const gravity = f.gravityOf(f.level, f.tierSpeedOf(f.level, r.tier))
        const gT: number[] = []
        const gTheta: number[] = []
        const mirror = r.mirror ? -1 : 1
        session.fieldByKind.gem.visit((theta, wd) => {
          if (wd >= r.start - 0.5 && wd <= r.end + 0.5) {
            gT.push(secondsBetween(r.start, wd))
            gTheta.push(mirror * theta) // back to the unmirrored phrase; the replay mirrors it again
          }
        })
        const got = replay(phrase, r.tier, gT, gTheta, gT.length, [], [], 0, speed, gravity, mirror).collected
        stats.rescaleChecked++
        if (gT.length !== r.gems || got !== r.gems) stats.rescaleMissed++
      }
    },
  }
  session = createSession(fx)
  session.flight.setDifficulty(mode)
  seedRng(seed)
  session.reset()
  session.begin()
  const advance = driveSession(session, IDLE, {
    invulnerable: true,
    beforeFrame: flyOntoGems(session),
  })
  for (let steps = 0; stats.cycleGems.length < cycles && steps < PHYSICS.HZ * 60 * cycles; steps++) advance()
  stats.failedSpawns = session.fieldByKind.gem.failedSpawns + session.fieldByKind.mine.failedSpawns
  session.fieldByKind.gem.visit(() => stats.gemsLive++)
  session.fieldByKind.mine.visit(() => stats.minesLive++)
  return { stats, session }
}

const CYCLES = 200
for (let mode = 0; mode < DIFFICULTY.MODES.length; mode++) {
  const name = modeNames[mode]!
  const { stats, session } = runDirector(mode, CYCLES, 100 + mode)
  const gems = stats.cycleGems
  const lo = Math.min(...gems)
  const hi = Math.max(...gems)
  const mean = gems.reduce((a, b) => a + b, 0) / Math.max(1, gems.length)
  const mix = stats.perTier
    .map((m, tier) => {
      const total = [...m.values()].reduce((a, b) => a + b, 0)
      return `t${tier}: ` + [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${Math.round((100 * n) / total)}%`).join(' ')
    })
    .join(' | ')
  console.log(`      ${name}: ${stats.phrases} phrases in ${gems.length} cycles, level ${session.flight.level + 1}, ${mix}`)
  check(`B1 ${name}: no phrase crosses a section boundary`, stats.crossing === 0 && stats.wrongTier === 0, `crossing=${stats.crossing} wrong tier=${stats.wrongTier}`)
  check(`B2 ${name}: no phrase starts inside BOUNDARY_CLEAR`, stats.inClear === 0, `${stats.inClear}`)
  check(
    `B3 ${name}: gems per cycle within [${SEQUENCE.GEMS_PER_CYCLE}, ${SEQUENCE.GEMS_PER_CYCLE + SEQUENCE.GEMS_EXTRA_MAX}]`,
    gems.length >= CYCLES - 1 && lo >= SEQUENCE.GEMS_PER_CYCLE && hi <= SEQUENCE.GEMS_PER_CYCLE + SEQUENCE.GEMS_EXTRA_MAX,
    `min ${lo} mean ${mean.toFixed(1)} max ${hi}`,
  )
  // A mine that would sit on an orb is left out, and the no-repeat rule can leave a
  // section without a mine phrase, so a few sections miss the window by a little.
  check(
    `B4 ${name}: mines per section within one of the budget in at least 97% of sections, never more than 3 off`,
    stats.mineOff <= stats.sections * 0.03 && stats.mineWorst <= 3,
    `${stats.mineOff} of ${stats.sections} sections off, worst: ${stats.worstMine}`,
  )
  check(`B5 ${name}: no failed spawn`, stats.failedSpawns === 0, `${stats.failedSpawns}`)
  check(`B5b ${name}: the first ${SEQUENCE.WARMUP_PHRASES} phrases of a run carry no mines`, stats.warmupMines === 0, `${stats.warmupMines}`)
  check(`B6 ${name}: when a gate opens, the phrases waiting beyond it still collect every gem`, stats.gates > CYCLES / 2 && stats.straddling > 0 && stats.rescaleMissed === 0, `${stats.gates} gates, ${stats.rescaleChecked} phrases replayed (${stats.straddling} cut by the gate), ${stats.rescaleMissed} short`)
  check(`B6b ${name}: every phrase is laid out at the speed of the tube where it starts, the next level's beyond a gate`, stats.wrongSpeed === 0, `${stats.wrongSpeed} of ${stats.phrases}`)
  check(`B7 ${name}: no phrase comes back sooner than its spacing allows, rest between phrases at least GAP`, stats.repeats3 === 0 && stats.restMin >= SEQUENCE.GAP[1] - 0.02, `repeats=${stats.repeats3} shortest rest ${stats.restMin.toFixed(2)}s, mean ${(stats.restSum / stats.rests).toFixed(2)}s, longest ${stats.quietMax.toFixed(2)}s, over 4 s: ${stats.restsOver4}`)
}

// ---- C) open-loop input jitter on arc and pump ----
;(() => {
  const f = createFlight()
  const rnd = createRng(12345)
  const jitter = (): number => (rnd() * 2 - 1) * 0.08
  let worst = 1
  let line = ''
  for (const id of ['arc', 'pump', 'jump', 'weave', 'loop'] as const) {
    const phrase = PHRASES.find((p) => p.id === id)!
    for (const tier of TIERS) {
      if (phrase.unlock[tier] === null) continue
      const speed = f.tierSpeedOf(0, tier)
      const gravity = f.gravityOf(0, speed)
      const trace = buildTrace(phrase, tier, gravity)
      let got = 0
      const N = 400
      for (let k = 0; k < N; k++) got += replay(phrase, tier, trace.gemT, trace.gemTheta, trace.nGems, [], [], 0, speed, gravity, 1, undefined, jitter).collected
      const share = got / (N * trace.nGems)
      line += ` ${id}/t${tier} ${Math.round(share * 100)}%`
      if ((id === 'arc' || id === 'pump') && share < worst) worst = share
    }
  }
  check('C1 +/-80 ms input jitter still collects at least 75% of the gems of arc and pump', worst >= 0.75, `worst ${Math.round(worst * 100)}% |${line}`)
})()

// ---- D) title screen, pressure, and a difficulty or flight-mode change ----
;(() => {
  let firstId = ''
  let firstMirror = true
  let firstStart = 0
  const loads: { start: number; end: number; load: number }[] = []
  const session = createSession({
    phrasePlaced: (p) => {
      if (!firstId) {
        firstId = p.id
        firstMirror = p.mirror
        firstStart = p.start
      }
      loads.push({ start: p.start, end: p.end, load: p.load })
    },
  })
  seedRng(7)
  firstId = ''
  loads.length = 0
  session.reset()
  let gems = 0
  let farthest = 0
  let rightSide = 0
  session.fieldByKind.gem.visit((theta, wd) => {
    gems++
    farthest = Math.max(farthest, wd)
    if (wd < SEQUENCE.FIRST_AT + 60 && theta > 0) rightSide++
  })
  check('D1 the title screen shows a filled tube', gems >= 6 && farthest > SEQUENCE.HORIZON * 0.6, `${gems} gems out to ${farthest.toFixed(0)}`)
  check('D2 a run opens with an arc up the right wall at FIRST_AT', firstId === 'arc' && !firstMirror && Math.abs(firstStart - SEQUENCE.FIRST_AT) < 1e-6 && rightSide === 4, `${firstId} at ${firstStart} mirror=${firstMirror} gems on the right=${rightSide}`)
  let wrong = 0
  for (const l of loads) {
    const mid = (l.start + l.end) / 2
    if (session.sequencer.pressureAt(mid) !== l.load) wrong++
    if (session.sequencer.pressureAt(l.start - 0.5) !== 0 && !loads.some((o) => o !== l && o.start <= l.start - 0.5 && o.end >= l.start - 0.5)) wrong++
  }
  check('D3 pressureAt gives the load inside a phrase and 0 between phrases', loads.length > 1 && wrong === 0, `${loads.length} phrases, ${wrong} wrong`)

  // a difficulty change on the title screen lays the tube out again for the new speeds
  const quasar = DIFFICULTY.MODES.findIndex((m) => m.name === 'QUASAR')
  session.flight.setDifficulty(quasar)
  const staleBefore = session.sequencer.stale()
  session.replan()
  check('D4 a difficulty change on the title screen re-lays the gem lines', staleBefore && !session.sequencer.stale())
  session.flight.setDifficulty(DIFFICULTY.DEFAULT)

  // a pinned flight mode (the testing key) mid-run: the tube ahead is planned again
  // for that one tier, and again for the sections when the mode returns
  seedRng(9)
  session.reset()
  session.begin()
  const advance = driveSession(session, IDLE, { invulnerable: true })
  const fly = (seconds: number): void => {
    for (let k = 0; k < PHYSICS.HZ * seconds; k++) advance()
  }
  fly(5)
  session.flight.mode = 'fast'
  fly(1)
  loads.length = 0
  const tiers = new Set<number>()
  let crossing = 0
  const before = loads.length
  fly(25)
  for (const l of loads.slice(before)) if (l.end < l.start) crossing++
  session.fieldByKind.gem.visit((_theta, wd) => tiers.add(session.flight.tierIndexAt(wd)))
  let liveGems = 0
  session.fieldByKind.gem.visit(() => liveGems++)
  const pinnedOk = loads.length > 4 && crossing === 0 && liveGems > 0 && tiers.size === 1 && tiers.has(2)
  session.flight.mode = 'sections'
  fly(12)
  let gemsAfter = 0
  session.fieldByKind.gem.visit(() => gemsAfter++)
  check('D4b a flight mode switched mid-run keeps the gem lines coming', pinnedOk && gemsAfter > 0 && !session.sequencer.stale(), `${loads.length} phrases while pinned fast, ${liveGems} gems live, ${gemsAfter} after the switch back`)
})()

finish('SEQUENCE SIM')

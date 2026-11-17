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
//      mine budget holds in nearly every section, no spawn fails, and after a
//      level-up the waiting phrases still fit a replay at the new speed;
//   C) an open-loop input-jitter model on arc and pump (a grade of the phrases
//      against each other, not a prediction of human catch rates);
//   D) the title screen, the pressure signal, a difficulty or flight-mode change,
//      and the game with gem lines off.
import { createSession, type Session } from '../src/session'
import { createFlight, type Flight } from '../src/flight'
import { stepSwing, type SwingState } from '../src/craft'
import { PHRASES, buildTrace, segmentSeconds, type Phrase, type Trace } from '../src/world/phrases'
import { seedRng } from '../src/util/rng'
import { angleDiff } from '../src/util/math'
import { CLIMB, DIFFICULTY, FLIGHT, HAZARD, LEVELS, PHYSICS, SEQUENCE, TREASURE } from '../src/config'

// --climb-fade <n>: run every check with another CLIMB.FADE (0 = the swing with no climb
// fade), to show the gem lines are flyable with the fade on and off.
{
  const i = process.argv.indexOf('--climb-fade')
  if (i >= 0) CLIMB.FADE = Number(process.argv[i + 1])
  console.log(`CLIMB.FADE = ${CLIMB.FADE}`)
}

let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failed++
}

const DT = 1 / PHYSICS.HZ
const TIERS = [0, 1, 2]
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
    const target = seg.untilDeg ? (seg.untilDeg[tier]! * Math.PI) / 180 : 0
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
        const peakDeg = (peak * 180) / Math.PI
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
// The craft rests at the bottom with i-frames held on; the gem count is forced so
// two cycles of three end with a level-up (and one repeats).
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
    levelUps: 0, rescaleChecked: 0, rescaleMissed: 0, restMin: Infinity, quietMax: 0,
    failedSpawns: 0, gemsLive: 0, minesLive: 0, restSum: 0, rests: 0, restsOver4: 0,
    warmupMines: 0,
  }
  let lastEnd = -1
  let lastSpeed = 0
  let warmupInSection = false
  let prevId = ''
  let prevPrevId = ''
  let session!: Session
  const fx = {
    phrasePlaced: (p: Rec & { sectionStart: number; sectionEnd: number; clearEnd: number; level: number; mines: number }) => {
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
      if (lastEnd >= 0) {
        // seconds from the last phrase to this one (steady tier speeds; the speed ease
        // after a boundary is short against the rests measured here)
        const rest = p.sectionStart > lastEnd ? (p.sectionStart - lastEnd) / lastSpeed + (p.start - p.sectionStart) / p.speed : (p.start - lastEnd) / p.speed
        stats.restSum += rest
        stats.rests++
        if (rest > 4) stats.restsOver4++
        if (rest < stats.restMin) stats.restMin = rest
        if (rest > stats.quietMax) stats.quietMax = rest
      }
      lastEnd = p.end
      lastSpeed = p.speed
      recs.push({ id: p.id, tier: p.tier, mirror: p.mirror, start: p.start, end: p.end, speed: p.speed, gems: p.gems, cycle: p.cycle })
      if (recs.length > 12) recs.shift()
    },
    sectionPlanned: (tier: number, mines: number, budget: number) => {
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
    cyclePlanned: (_cycle: number, gems: number) => {
      if (session) stats.cycleGems.push(gems)
    },
    levelUp: () => {
      stats.levelUps++
      // Every scripted phrase waiting beyond the boundary was moved to the new slow
      // speed: a replay at that speed must still collect all its gems.
      const f = session.flight
      const boundary = f.cycleStart()
      const speed = f.tierSpeedOf(f.level, 0)
      const gravity = f.gravityOf(f.level, speed)
      for (const r of recs) {
        if (r.start <= boundary) continue
        const phrase = PHRASES.find((p) => p.id === r.id)!
        if (phrase.script.length === 0) continue
        const start = boundary + ((r.start - boundary) * speed) / r.speed
        const end = boundary + ((r.end - boundary) * speed) / r.speed
        const gT: number[] = []
        const gTheta: number[] = []
        const mirror = r.mirror ? -1 : 1
        session.fields[1]!.visit((theta, wd) => {
          if (wd >= start - 0.5 && wd <= end + 0.5) {
            gT.push((wd - start) / speed)
            gTheta.push(mirror * theta) // back to the unmirrored phrase; the replay mirrors it again
          }
        })
        const got = replay(phrase, 0, gT, gTheta, gT.length, [], [], 0, speed, gravity, mirror).collected
        stats.rescaleChecked++
        if (gT.length !== r.gems || got !== r.gems) stats.rescaleMissed++
      }
    },
  }
  session = createSession(fx as never)
  session.flight.setDifficulty(mode)
  seedRng(seed)
  session.reset()
  session.begin()
  const input = { steerTarget: 0, fire: false }
  let steps = 0
  while (session.flight.cycles < cycles && steps < PHYSICS.HZ * 60 * cycles) {
    if (steps % 2 === 0) {
      const advance = session.flight.cycles % 3 !== 2
      session.game.gemsThisLevel = advance ? session.flight.gemQuota(session.flight.level) : 0
      session.preUpdate()
    }
    session.game.invuln = 1e9
    session.game.lives = 3
    session.step(input, DT)
    steps++
  }
  stats.failedSpawns = session.fields[1]!.failedSpawns + session.fields[2]!.failedSpawns
  session.fields[1]!.visit(() => stats.gemsLive++)
  session.fields[2]!.visit(() => stats.minesLive++)
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
  check(`B6 ${name}: after a level-up the waiting phrases still collect every gem`, stats.levelUps > CYCLES / 2 && stats.rescaleChecked > 0 && stats.rescaleMissed === 0, `${stats.levelUps} level-ups, ${stats.rescaleChecked} phrases replayed, ${stats.rescaleMissed} short`)
  check(`B7 ${name}: no phrase comes back sooner than its spacing allows, rest between phrases at least GAP`, stats.repeats3 === 0 && stats.restMin >= SEQUENCE.GAP[1]! - 1e-6, `repeats=${stats.repeats3} shortest rest ${stats.restMin.toFixed(2)}s, mean ${(stats.restSum / stats.rests).toFixed(2)}s, longest ${stats.quietMax.toFixed(2)}s, over 4 s: ${stats.restsOver4}`)
}

// ---- C) open-loop input jitter on arc and pump ----
;(() => {
  const f = createFlight()
  let s = 12345
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
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

// ---- D) title screen, pressure, and the game with gem lines off ----
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
  session.fields[1]!.visit((theta, wd) => {
    gems++
    farthest = Math.max(farthest, wd)
    if (wd < SEQUENCE.FIRST_AT + 60 && theta > 0) rightSide++
  })
  check('D1 the title screen shows a filled tube', gems >= 6 && farthest > SEQUENCE.HORIZON * 0.6, `${gems} gems out to ${farthest.toFixed(0)}`)
  check('D2 a run opens with an arc up the right wall at FIRST_AT', firstId === 'arc' && !firstMirror && Math.abs(firstStart - SEQUENCE.FIRST_AT) < 1e-6 && rightSide === 4, `${firstId} at ${firstStart} mirror=${firstMirror} gems on the right=${rightSide}`)
  let wrong = 0
  for (const l of loads) {
    const mid = (l.start + l.end) / 2
    if (session.sequencer!.pressureAt(mid) !== l.load) wrong++
    if (session.sequencer!.pressureAt(l.start - 0.5) !== 0 && !loads.some((o) => o !== l && o.start <= l.start - 0.5 && o.end >= l.start - 0.5)) wrong++
  }
  check('D3 pressureAt gives the load inside a phrase and 0 between phrases', loads.length > 1 && wrong === 0, `${loads.length} phrases, ${wrong} wrong`)

  // a difficulty change on the title screen lays the tube out again for the new speeds
  const quasar = DIFFICULTY.MODES.findIndex((m) => m.name === 'QUASAR')
  session.flight.setDifficulty(quasar)
  const staleBefore = session.sequencer!.stale()
  session.replan()
  check('D4 a difficulty change on the title screen re-lays the gem lines', staleBefore && !session.sequencer!.stale())
  session.flight.setDifficulty(DIFFICULTY.DEFAULT)

  // a pinned flight mode (the testing key) mid-run: the tube ahead is planned again
  // for that one tier, and again for the sections when the mode returns
  seedRng(9)
  session.reset()
  session.begin()
  const input = { steerTarget: 0, fire: false }
  const fly = (seconds: number): void => {
    for (let k = 0; k < PHYSICS.HZ * seconds; k++) {
      if (k % 2 === 0) session.preUpdate()
      session.game.invuln = 1e9
      session.step(input, DT)
    }
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
  session.fields[1]!.visit((_theta, wd) => tiers.add(session.flight.tierIndexAt(wd)))
  let liveGems = 0
  session.fields[1]!.visit(() => liveGems++)
  const pinnedOk = loads.length > 4 && crossing === 0 && liveGems > 0 && tiers.size === 1 && tiers.has(2)
  session.flight.mode = 'sections'
  fly(12)
  let gemsAfter = 0
  session.fields[1]!.visit(() => gemsAfter++)
  check('D4b a flight mode switched mid-run keeps the gem lines coming', pinnedOk && gemsAfter > 0 && !session.sequencer!.stale(), `${loads.length} phrases while pinned fast, ${liveGems} gems live, ${gemsAfter} after the switch back`)
})()
;(() => {
  SEQUENCE.ENABLED = false
  const session = createSession()
  seedRng(3)
  session.reset()
  session.begin()
  let gems = 0
  let mines = 0
  session.fields[1]!.visit(() => gems++)
  session.fields[2]!.visit(() => mines++)
  const input = { steerTarget: 0, fire: false }
  let offered = 0
  const s2 = createSession({ gemMissed: () => offered++, gemCollected: () => offered++ })
  seedRng(3)
  s2.reset()
  s2.begin()
  for (let k = 0; k < PHYSICS.HZ * 40; k++) {
    if (k % 2 === 0) s2.preUpdate()
    s2.game.invuln = 1e9
    s2.step(input, DT)
  }
  const f = session.flight
  const cycleLen = (f.tierSpeedOf(0, 0) + f.tierSpeedOf(0, 1) + f.tierSpeedOf(0, 2)) * FLIGHT.SECTION_SECONDS
  const oldQuota = Math.round((cycleLen / TREASURE.SPAWN_SPACING) * LEVELS.GEM_QUOTA_FRACTION)
  check('D5 gem lines off: random gem and mine fields, no director', session.sequencer === undefined && gems === TREASURE.RANDOM_COUNT && mines === HAZARD.RANDOM_COUNT && offered > 5, `${gems} gems, ${mines} mines laid out, ${offered} gems passed in 40 s`)
  check('D6 gem lines off: the quota comes from the cycle length', f.gemQuota(0) === oldQuota, `${f.gemQuota(0)} vs ${oldQuota}`)
  SEQUENCE.ENABLED = true
})()

if (failed) {
  console.error(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL SEQUENCE SIM CHECKS PASSED')

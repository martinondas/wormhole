// Headless behavior checks for the level / difficulty system (npm run sim:levels).
// Exercises src/flight.ts directly (no DOM): the gem-gated level progression, per-
// level tier speeds, the score multiplier, the two gravity modes, the level speed
// cap, tier/level lookups for tube + field scaling, and edge cases (distance 0,
// negative, pinned modes). Bundled with esbuild, like combat-sim.ts.
//
// The level is GATED on gems now, so it is no longer a pure function of distance:
// you must call update() incrementally with a running gem count. flyTo() simulates
// flying forward feeding a fixed gem count per step - a large count is an "active"
// player who always meets the quota (levels then advance at every cycle boundary,
// exactly the old pure-distance behavior, which the speed/gravity checks rely on);
// a count of 0 is a "passive" player who never advances.
import { createFlight, type Flight } from '../src/flight'
import { createSession } from '../src/session'
import { createLevelTuning, waveRoster, waveAliveCap, waveHunters, aggression, deepPressure, fireCooldown, bombMult } from '../src/levels'
import { PHRASES } from '../src/world/phrases'
import { SPEED, PHYSICS, FLIGHT, LEVELS, PICKUP, HAZARD, TREASURE, DIFFICULTY, ENEMY, SEQUENCE } from '../src/config'

let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failed++
}
const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

// Derived expectations (mirror flight.ts math, computed independently here).
const secs = FLIGHT.SECTION_SECONDS
const step = LEVELS.SCORE_MULT_STEP
const base = [SPEED.SLOW, SPEED.NORMAL, SPEED.FAST]
// banded, decaying-but-never-zero per-level speed bonus (mirror of flight.ts speedBonus)
const earlyN = LEVELS.SPEED_BAND.EARLY_UNTIL - 1
const midN = LEVELS.SPEED_BAND.MID_UNTIL - LEVELS.SPEED_BAND.EARLY_UNTIL
const speedBonus = (lvl: number): number => {
  const { EARLY, MID, LATE } = LEVELS.SPEED_STEP
  const early = Math.min(lvl, earlyN)
  const mid = Math.max(0, Math.min(lvl - earlyN, midN))
  const late = Math.max(0, lvl - earlyN - midN)
  return early * EARLY + mid * MID + late * LATE
}
const tierSpeed = (lvl: number, t: number): number => base[t]! + speedBonus(lvl)
const cycleLen = (lvl: number): number => (tierSpeed(lvl, 0) + tierSpeed(lvl, 1) + tierSpeed(lvl, 2)) * secs
// gem quota at a TUNING level with gem lines on (mirror of flight.ts), and with them off
const quotaAt = (T: number, modeMax = 1): number =>
  Math.round(SEQUENCE.GEMS_PER_CYCLE * Math.min(LEVELS.QUOTA_FRACTION_MAX, modeMax, LEVELS.GEM_QUOTA_FRACTION + LEVELS.QUOTA_FRACTION_STEP * T))
const gemQuota = (lvl: number): number => quotaAt(lvl) // ORION: the tuning level is the level
const randomQuota = (lvl: number): number => Math.round((cycleLen(lvl) / TREASURE.SPAWN_SPACING) * LEVELS.GEM_QUOTA_FRACTION)

// cumulative distance where level L begins, assuming every cycle advanced (active player)
function cumStart(L: number): number {
  let s = 0
  for (let k = 0; k < L; k++) s += cycleLen(k)
  return s
}

// Fly a fresh flight forward to `distance`, feeding `gems` each step. Small steps
// keep at most one cycle boundary per update() call (so the per-call gem count is
// applied to each boundary in turn).
function flyTo(distance: number, gems: number, stepSize = 20, difficulty?: number): Flight {
  const f = createFlight()
  if (difficulty !== undefined) f.setDifficulty(difficulty)
  f.update(0, gems)
  let d = 0
  while (d < distance) {
    d = Math.min(distance, d + stepSize)
    f.update(d, gems)
  }
  return f
}
const ACTIVE = 100000 // gems >> any quota: always meets the gate (advances every cycle)

// level/speed/multiplier/cap at a distance for an ACTIVE player (old distance model)
function at(distance: number): { level: number; target: number; mult: number; speedMax: number } {
  const f = flyTo(distance, ACTIVE)
  return { level: f.level, target: f.targetSpeed(), mult: f.scoreMultiplier, speedMax: f.speedMax() }
}

// ---- A) level boundaries by distance (active player, always meets the quota) ----
;(() => {
  const c1 = cumStart(1) // 1570 with defaults
  const c2 = cumStart(2)
  const c3 = cumStart(3)
  check('A1 distance 0 -> level 0', at(0).level === 0)
  check('A2 just below c1 -> level 0', at(c1 - 1).level === 0, `c1=${c1}`)
  check('A3 at c1 -> level 1', at(c1).level === 1)
  check('A4 just below c2 -> level 1', at(c2 - 1).level === 1, `c2=${c2}`)
  check('A5 at c2 -> level 2', at(c2).level === 2)
  check('A6 at c3 -> level 3', at(c3).level === 3, `c3=${c3}`)
  // edge: negative distance clamps to level 0 (never NaN / negative level)
  check('A7 negative distance -> level 0', at(-500).level === 0)
})()

// ---- B) per-level tier speeds (target speed in each section) ----
;(() => {
  // level 0 sections: slow [0,300) normal [300,820) fast [820,1570)
  check('B1 L0 slow target', approx(at(100).target, tierSpeed(0, 0)), `${at(100).target}`)
  check('B2 L0 normal target', approx(at(400).target, tierSpeed(0, 1)), `${at(400).target}`)
  check('B3 L0 fast target', approx(at(1000).target, tierSpeed(0, 2)), `${at(1000).target}`)
  // level 1 starts at cumStart(1)=1570; slow len = 35*10=350 -> [1570,1920)
  const c1 = cumStart(1)
  check('B4 L1 slow target = base+inc', approx(at(c1 + 50).target, tierSpeed(1, 0)), `${at(c1 + 50).target}`)
  check('B5 L1 fast target = base+inc', approx(at(c1 + 1000).target, tierSpeed(1, 2)), `${at(c1 + 1000).target}`)
  // speeds strictly increase level over level
  check('B6 speeds ramp per level', tierSpeed(2, 0) > tierSpeed(1, 0) && tierSpeed(1, 0) > tierSpeed(0, 0))
})()

// ---- C) score multiplier = 1 + level*step ----
;(() => {
  check('C1 L0 multiplier = 1.0', approx(at(100).mult, 1))
  check('C2 L1 multiplier', approx(at(cumStart(1) + 50).mult, 1 + 1 * step), `${at(cumStart(1) + 50).mult}`)
  check('C3 L2 multiplier', approx(at(cumStart(2) + 50).mult, 1 + 2 * step), `${at(cumStart(2) + 50).mult}`)
})()

// ---- D) speed cap follows the level (replaces the old fixed SPEED.FAST clamp) ----
;(() => {
  check('D1 L0 speedMax = L0 fast', approx(at(100).speedMax, tierSpeed(0, 2)), `${at(100).speedMax}`)
  check('D2 L1 speedMax = L1 fast > L0 fast', at(cumStart(1) + 50).speedMax > tierSpeed(0, 2))
  // target never exceeds speedMax at the same distance (the clamp can always be reached)
  for (const d of [100, 400, 1000, cumStart(1) + 50, cumStart(2) + 900]) {
    const s = at(d)
    if (s.target > s.speedMax + 1e-9) check(`D-extra target<=speedMax at ${d}`, false, `${s.target} > ${s.speedMax}`)
  }
  check('D3 target<=speedMax across sampled distances', true)
})()

// ---- E) gravity: tier mode preserves feel; absolute mode does not ----
;(() => {
  const modeWas = LEVELS.GRAVITY_MODE
  // tier mode: full gravity at the LEVEL's own slow speed, the floor at its own fast
  LEVELS.GRAVITY_MODE = 'tier'
  const f = flyTo(cumStart(1) + 50, ACTIVE) // level 1, slow section
  check('E1 tier: full gravity at L1 slow speed', approx(f.gravityForSpeed(tierSpeed(1, 0)), PHYSICS.GRAVITY_K), `${f.gravityForSpeed(tierSpeed(1, 0))}`)
  check('E2 tier: floor gravity at L1 fast speed', approx(f.gravityForSpeed(tierSpeed(1, 2)), PHYSICS.GRAVITY_K * FLIGHT.GRAVITY_FLOOR), `${f.gravityForSpeed(tierSpeed(1, 2))}`)
  check('E3 tier: gravity monotonic decreasing in speed', f.gravityForSpeed(tierSpeed(1, 0)) > f.gravityForSpeed(tierSpeed(1, 1)) && f.gravityForSpeed(tierSpeed(1, 1)) > f.gravityForSpeed(tierSpeed(1, 2)))
  // absolute mode: at L1 slow speed gravity is already < full (lighter than tier mode)
  LEVELS.GRAVITY_MODE = 'absolute'
  const g = flyTo(cumStart(1) + 50, ACTIVE)
  check('E4 absolute: L1 slow gravity < full (lighter)', g.gravityForSpeed(tierSpeed(1, 0)) < PHYSICS.GRAVITY_K - 1e-6, `${g.gravityForSpeed(tierSpeed(1, 0))}`)
  check('E5 gravity clamped to [0, K]', g.gravityForSpeed(0) <= PHYSICS.GRAVITY_K + 1e-9 && g.gravityForSpeed(9999) >= -1e-9)
  LEVELS.GRAVITY_MODE = modeWas
})()

// ---- L) difficulty modes: one slope/offset mapping drives every lookup ----
// ORION (the default) is the identity mapping, so every other section already
// validates it. Here: the mapping itself, the speeds/multiplier it produces, and
// the density normalization staying referenced to the UNTUNED base speed.
;(() => {
  const dflt = DIFFICULTY.MODES[DIFFICULTY.DEFAULT]!
  check('L1 default mode is the identity (ORION)', dflt.slope === 1 && dflt.offset === 0, dflt.name)

  // MILKY WAY (index 0): played display L5 (0-based 4) tunes to slope * 4, so its
  // slow speed is the one of that (fractional) ORION level.
  const easyMode = DIFFICULTY.MODES[0]!
  const easy = createFlight()
  easy.setDifficulty(0)
  check('L2 milky way tuned(4) = offset + slope * 4, below the ORION level', approx(easy.tuned(4), easyMode.offset + easyMode.slope * 4) && easy.tuned(4) < 4, `${easy.tuned(4)}`)
  // fly to its display L5 under its own (shorter) cycle lengths and check the speed
  const easyCum = (L: number): number => {
    let s = 0
    for (let k = 0; k < L; k++) s += (SPEED.SLOW + SPEED.NORMAL + SPEED.FAST + 3 * speedBonus(easyMode.slope * k)) * secs
    return s
  }
  const easyAtL5 = flyTo(easyCum(4) + 50, ACTIVE, 20, 0)
  check('L3 milky way L5 slow speed = base + bonus(tuned(4))', approx(easyAtL5.targetSpeed(), SPEED.SLOW + speedBonus(easy.tuned(4))), `${easyAtL5.targetSpeed()}`)

  // QUASAR (index 2, offset 2.5): starts around ORION L3.5 - faster, higher
  // multiplier, and density normalization referenced to the untuned base.
  const hard = flyTo(100, ACTIVE, 20, 2) // its level 0, slow section
  const hardSlow = SPEED.SLOW + speedBonus(2.5)
  check('L4 quasar L1 slow speed = base + bonus(2.5)', approx(hard.targetSpeed(), hardSlow), `${hard.targetSpeed()}`)
  check('L5 quasar L1 multiplier follows the tuning level', approx(hard.scoreMultiplier, 1 + 2.5 * step), `${hard.scoreMultiplier}`)
  check('L6 speed ratio normalizes vs the untuned base', approx(hard.speedRatioAt(100), hardSlow / SPEED.SLOW), `${hard.speedRatioAt(100)}`)
})()

// ---- F) tier/level lookups used by tube coloring + field scaling (GATED) ----
;(() => {
  const f = createFlight() // fresh: gated at level 0 (nothing collected yet)
  // section tiers within level 0
  check('F1 tierIndexAt L0 slow', f.tierIndexAt(0) === 0)
  check('F2 tierIndexAt L0 normal', f.tierIndexAt(400) === 1)
  check('F3 tierIndexAt L0 fast', f.tierIndexAt(1000) === 2)
  // GATED: a distance a "level ahead" still reports the CURRENT level (the gate
  // holds the next level until the quota is met) and the cycle's colors just repeat.
  check('F4 levelAt ahead stays current level (gate holds)', f.levelAt(cumStart(1) + 10) === 0)
  check('F5 tierIndexAt wraps to slow past one cycle', f.tierIndexAt(cycleLen(0) + 10) === 0)
  check('F6 tierIndexAt wraps the cycle (normal again)', f.tierIndexAt(cycleLen(0) + 400) === 1)
})()

// ---- G) pinned modes: no level progression, no gate, fixed tier ----
;(() => {
  const f = createFlight()
  f.mode = 'slow'
  f.update(99999, 0)
  check('G1 pinned slow: level stays 0', f.level === 0)
  check('G2 pinned slow: multiplier 1', approx(f.scoreMultiplier, 1))
  check('G3 pinned slow: target = base slow', approx(f.targetSpeed(), SPEED.SLOW))
  check('G4 pinned slow: tierIndexAt = 0 everywhere', f.tierIndexAt(0) === 0 && f.tierIndexAt(99999) === 0)
  f.mode = 'fast'
  f.update(99999, 0)
  check('G5 pinned fast: target = base fast, level 0', approx(f.targetSpeed(), SPEED.FAST) && f.level === 0)
})()

// ---- H) speed-normalized density levers (orbs flat per second; bombs tighten) ----
;(() => {
  const f1 = createFlight() // gated level 0: ratios are 1
  check('H1 speedRatio = 1 at level 1', approx(f1.speedRatioAt(100), 1))
  check('H2 speedRatio = 1 at level 1 (any tier)', approx(f1.speedRatioAt(1000), 1))
  // L5 = 0-based level 4; its normal section sits after its slow section
  const c4 = cumStart(4)
  const slowLenL5 = (base[0]! + speedBonus(4)) * secs
  const dNormalL5 = c4 + slowLenL5 + 50
  const f5 = flyTo(dNormalL5, ACTIVE) // active player reaches level 4 by this distance
  check('H3 speedRatio L5 normal tier = (52+20)/52', approx(f5.speedRatioAt(dNormalL5), (base[1]! + speedBonus(4)) / base[1]!), `${f5.speedRatioAt(dNormalL5)}`)

  // Encounter rate per second = tierSpeed / (baseSpacing * mult * speedRatio).
  // Design: orbs are FLAT per second across levels (rising speed already makes them
  // harder to catch, so they do not also thin out), while bombs get DENSER per second
  // as bombSpacingMult falls. Both vs level 1.
  const orbRate = (f: Flight, lvl: number, dist: number): number => {
    const mult = LEVELS.TABLE[Math.min(lvl, LEVELS.TABLE.length - 1)]!.orbSpacingMult
    return tierSpeed(lvl, 1) / (PICKUP.SPAWN_SPACING * mult * f.speedRatioAt(dist))
  }
  const bombRate = (f: Flight, lvl: number, dist: number): number => {
    const mult = LEVELS.TABLE[Math.min(lvl, LEVELS.TABLE.length - 1)]!.bombSpacingMult
    return tierSpeed(lvl, 1) / (HAZARD.SPAWN_SPACING * mult * f.speedRatioAt(dist))
  }
  const orbL1 = orbRate(f1, 0, 400) // L1 normal section
  const orbL5 = orbRate(f5, 4, dNormalL5)
  check('H4 orb rate is FLAT L1 -> L5 (count unchanged; speed makes catching harder)', approx(orbL5, orbL1), `L1 ${orbL1.toFixed(3)}/s -> L5 ${orbL5.toFixed(3)}/s`)
  const bombL1 = bombRate(f1, 0, 400)
  const bombL5 = bombRate(f5, 4, dNormalL5)
  check('H5 bomb rate RISES L1 -> L5 (denser, as intended)', bombL5 > bombL1, `L1 ${bombL1.toFixed(3)}/s -> L5 ${bombL5.toFixed(3)}/s`)
})()

// ---- J) speed curve: per-level increment decays across bands but never plateaus ----
;(() => {
  const incAt = (lvl: number): number => tierSpeed(lvl, 2) - tierSpeed(lvl - 1, 2) // increment INTO level lvl
  // 0-based: lvl 1..9 are EARLY, 10..14 MID, 15+ LATE
  check('J1 EARLY band increment = SPEED_STEP.EARLY', approx(incAt(9), LEVELS.SPEED_STEP.EARLY), `${incAt(9)}`)
  check('J2 MID band increment = SPEED_STEP.MID', approx(incAt(10), LEVELS.SPEED_STEP.MID), `${incAt(10)}`)
  check('J3 LATE band increment = SPEED_STEP.LATE', approx(incAt(15), LEVELS.SPEED_STEP.LATE), `${incAt(15)}`)
  check('J4 increment decays EARLY > MID > LATE', incAt(9) > incAt(10) && incAt(10) > incAt(15))
  check('J5 never plateaus (every increment > 0)', incAt(40) > 0, `${incAt(40)}`)
  // L17 fast (0-based 16) lands where the design says (~138), well below the old linear 155
  check('J6 L17 fast ~ 138 (tamed from old 155)', approx(tierSpeed(16, 2), 138), `${tierSpeed(16, 2)}`)
})()

// ---- K) mine density: tightens past the table to a floor (mirror of levels.ts bombMult) ----
;(() => {
  const bombMult = (lvl: number): number => {
    const t = LEVELS.TABLE
    if (lvl < t.length) return t[lvl]!.bombSpacingMult
    const last = t[t.length - 1]!.bombSpacingMult
    return Math.max(LEVELS.BOMB_MULT_FLOOR, last - (lvl - (t.length - 1)) * LEVELS.BOMB_MULT_STEP)
  }
  check('K1 past-table mines denser than L5', bombMult(8) < LEVELS.TABLE[LEVELS.TABLE.length - 1]!.bombSpacingMult, `${bombMult(8)}`)
  check('K2 mine multiplier floored (playable)', approx(bombMult(99), LEVELS.BOMB_MULT_FLOOR), `${bombMult(99)}`)
  check('K3 floor never goes below config floor', bombMult(99) >= LEVELS.BOMB_MULT_FLOOR - 1e-9)
})()

// ---- I) gem gate: quota scaling + advance / replay behavior ----
;(() => {
  const f = createFlight()
  // per level and mode: round(GEMS_PER_CYCLE * fraction), the fraction rising with the tuning level
  let bad = ''
  let line = ''
  let highest = 0 // the largest quota of any level in any mode
  DIFFICULTY.MODES.forEach((m, i) => {
    const g = createFlight()
    g.setDifficulty(i)
    const qs: number[] = []
    for (let l = 0; l <= 40; l++) {
      const want = quotaAt(Math.max(0, m.offset + m.slope * l), m.quotaMax)
      highest = Math.max(highest, g.gemQuota(l))
      if (g.gemQuota(l) !== want) bad += ` ${m.name} L${l + 1}: ${g.gemQuota(l)} vs ${want}`
      if (l === 0 || l === 4 || l === 9 || l === 19 || l === 39) qs.push(g.gemQuota(l))
    }
    line += ` ${m.name} L1/5/10/20/40: ${qs.join(',')};`
  })
  check('I1 gemQuota per level and mode matches round(GEMS_PER_CYCLE * fraction)', bad === '', bad || line)
  const quotas = [...Array(41).keys()].map((l) => f.gemQuota(l))
  const nonDecreasing = quotas.every((q, i) => i === 0 || q >= quotas[i - 1]!)
  const cap = Math.round(SEQUENCE.GEMS_PER_CYCLE * LEVELS.QUOTA_FRACTION_MAX)
  check('I2 gemQuota never falls, starts at half a cycle of gems, ends at the capped fraction', nonDecreasing && f.gemQuota(0) === Math.round(SEQUENCE.GEMS_PER_CYCLE * LEVELS.GEM_QUOTA_FRACTION) && f.gemQuota(40) === cap, `L1 ${quotas[0]} ... L41 ${quotas[40]} (cap ${cap})`)
  check('I2b every quota stays at least 3 gems under the fewest a cycle offers', highest <= SEQUENCE.GEMS_PER_CYCLE - 3, `${highest} of at least ${SEQUENCE.GEMS_PER_CYCLE}`)
  // gem lines off: the quota is a fraction of the gems one cycle's length holds
  SEQUENCE.ENABLED = false
  const offQuotas = [0, 1, 2, 3, 4, 5].map((l) => f.gemQuota(l))
  SEQUENCE.ENABLED = true
  check('I2c gem lines off: gemQuota follows the cycle length', offQuotas.every((q, l) => q === randomQuota(l)) && offQuotas[5]! > offQuotas[0]!, offQuotas.join(','))

  // passive player (0 gems) never advances, however far they fly; the cycle still
  // flows (speeds stay level 0, tiers keep cycling) - just no level-up.
  const passive = flyTo(cumStart(4), 0)
  check('I3 passive (0 gems) stuck at level 0', passive.level === 0, `level=${passive.level}`)
  check('I4 passive speedMax stays level 0', approx(passive.speedMax(), tierSpeed(0, 2)))

  // meeting the quota advances at the boundary; one short replays the same level
  const q0 = gemQuota(0)
  check('I5 quota met -> advance to level 1', flyTo(cumStart(1), q0).level === 1, `q0=${q0}`)
  check('I6 one short -> stays level 0 (replays)', flyTo(cumStart(1), q0 - 1).level === 0)
})()

// ---- M) session cycle events: cycleEnded once per cycle, advanced iff the level rose ----
// Drives the real session (no renderer) with the craft resting at the bottom and
// i-frames held on so a mine never ends the run. The gem count is forced each frame
// from a script: a cycle meets its quota or falls short exactly as scripted.
;(() => {
  const plan = [true, false, false, true, false, true, true, false] // quota met per cycle
  let ended = 0
  let advancedCount = 0
  let repeats = 0
  let levelUps = 0
  let mismatch = 0
  let gemsShort = 0
  const session = createSession({
    cycleEnded: (advanced, gems, quota) => {
      if (advanced !== plan[ended]) mismatch++
      if (advanced !== gems >= quota) mismatch++
      if (!advanced && gems < quota) gemsShort++
      ended++
      if (advanced) advancedCount++
      else repeats++
    },
    levelUp: () => levelUps++,
  })
  session.reset()
  session.begin()
  const dt = 1 / PHYSICS.HZ
  const input = { steerTarget: 0, fire: false }
  let steps = 0
  while (session.flight.cycles < plan.length && steps < PHYSICS.HZ * 900) {
    if (steps % 2 === 0) {
      // the cycle in progress is number `cycles`: force its gem count from the plan
      session.game.gemsThisLevel = plan[session.flight.cycles] ? session.flight.gemQuota(session.flight.level) : 0
      session.preUpdate()
    }
    session.game.invuln = 1e9
    session.step(input, dt)
    steps++
  }
  const f = session.flight
  check('M1 cycleEnded fires once per cycle', ended === f.cycles && ended === plan.length, `events=${ended} cycles=${f.cycles}`)
  check('M2 advanced is true exactly when the level rose', mismatch === 0 && advancedCount === f.level && levelUps === f.level, `mismatches=${mismatch} advanced=${advancedCount} level=${f.level} levelUps=${levelUps}`)
  check('M3 repeats = cycles - level in a quota-short run', repeats === f.cycles - f.level && gemsShort === repeats, `repeats=${repeats} cycles-level=${f.cycles - f.level}`)
})()

// ---- N) raider waves: roster, alive cap, hunters per tuning level and per mode ----
;(() => {
  // the wave table by tuning level T: [roster, alive cap, hunters]
  const want: Record<number, [number, number, number]> = {
    0: [2, 2, 0], 1: [3, 2, 0], 2: [3, 3, 1], 3: [4, 3, 1], 4: [5, 3, 1], 5: [5, 3, 1], 6: [6, 3, 1],
    7: [6, 4, 1], 8: [7, 4, 1], 9: [7, 4, 2], 10: [8, 4, 2], 12: [9, 4, 2], 20: [9, 4, 2], 40: [9, 4, 2],
  }
  let bad = ''
  for (const [k, [roster, cap, hunters]] of Object.entries(want)) {
    const T = Number(k)
    if (waveRoster(T) !== roster || waveAliveCap(T) !== cap || waveHunters(T) !== hunters) {
      bad += ` T${T}: ${waveRoster(T)}/${waveAliveCap(T)}/${waveHunters(T)}`
    }
  }
  check('N1 wave table: roster / alive cap / hunters by tuning level', bad === '', bad || 'T0..T40 as specified')
  let capMax = 0
  for (let T = 0; T < 60; T++) capMax = Math.max(capMax, waveAliveCap(T))
  check('N2 alive cap never exceeds MAX_ENEMIES_CAP (4)', capMax === LEVELS.MAX_ENEMIES_CAP && LEVELS.MAX_ENEMIES_CAP === 4, `max=${capMax}`)
  check('N3 aggression: 0 up to AGGRESSION_FROM, 0.5 halfway, 1 from the end of the span', aggression(0) === 0 && aggression(LEVELS.AGGRESSION_FROM) === 0 && approx(aggression(LEVELS.AGGRESSION_FROM + LEVELS.AGGRESSION_SPAN / 2), 0.5) && aggression(LEVELS.AGGRESSION_FROM + LEVELS.AGGRESSION_SPAN) === 1 && aggression(30) === 1, `from T${LEVELS.AGGRESSION_FROM} over ${LEVELS.AGGRESSION_SPAN} levels`)

  check('N3b fire cooldown: EARLY at T0, FIRE_COOLDOWN at AGGRESSION_FROM, DEEP x the deep-pressure factor at full aggression, DEEP x DEEP_COOLDOWN_K at full deep pressure, never rising, no deep pressure up to DEEP_FROM', approx(fireCooldown(0), ENEMY.FIRE_COOLDOWN_EARLY) && approx(fireCooldown(LEVELS.AGGRESSION_FROM), ENEMY.FIRE_COOLDOWN) && approx(fireCooldown(LEVELS.AGGRESSION_FROM + LEVELS.AGGRESSION_SPAN), ENEMY.FIRE_COOLDOWN_DEEP * (1 + (ENEMY.DEEP_COOLDOWN_K - 1) * deepPressure(LEVELS.AGGRESSION_FROM + LEVELS.AGGRESSION_SPAN))) && approx(fireCooldown(30), ENEMY.FIRE_COOLDOWN_DEEP * ENEMY.DEEP_COOLDOWN_K) && deepPressure(LEVELS.DEEP_FROM) === 0 && deepPressure(LEVELS.DEEP_FROM + LEVELS.DEEP_SPAN) === 1 && [...Array(30).keys()].every((T) => fireCooldown(T + 1) <= fireCooldown(T) + 1e-9), `T0 ${fireCooldown(0)} T1 ${fireCooldown(1)} T2 ${fireCooldown(2)} T8 ${fireCooldown(8).toFixed(2)} T14 ${fireCooldown(14)}`)

  // per mode: the played (display) level a wave size is reached at
  const capAt = (difficulty: number, displayLevel: number): number => {
    const f = createFlight()
    f.setDifficulty(difficulty)
    return createLevelTuning(f).enemyMax(displayLevel - 1)
  }
  const tAt = (difficulty: number, displayLevel: number): number => {
    const f = createFlight()
    f.setDifficulty(difficulty)
    return createLevelTuning(f).tuningLevel(displayLevel - 1)
  }
  const idx = (name: string): number => DIFFICULTY.MODES.findIndex((m) => m.name === name)
  const orion = idx('ORION')
  const milky = idx('MILKY WAY')
  const quasar = idx('QUASAR')
  check('N4 ORION: L1-2 two alive, L3 three alive with a hunter, L8 four alive', capAt(orion, 1) === 2 && capAt(orion, 2) === 2 && capAt(orion, 3) === 3 && waveHunters(tAt(orion, 2)) === 0 && waveHunters(tAt(orion, 3)) === 1 && capAt(orion, 7) === 3 && capAt(orion, 8) === 4, `caps L1..L8: ${[1, 2, 3, 4, 5, 6, 7, 8].map((l) => capAt(orion, l)).join(',')}`)
  check('N5 ORION L1 is two weavers (roster 2, no hunter)', waveRoster(tAt(orion, 1)) === 2 && waveHunters(tAt(orion, 1)) === 0)
  const firstHunter = (difficulty: number): number => [...Array(40).keys()].map((k) => k + 1).find((l) => waveHunters(tAt(difficulty, l)) > 0) ?? Infinity
  check('N6 MILKY WAY reaches each wave size later than ORION', tAt(milky, 1) === 0 && [...Array(20).keys()].every((k) => tAt(milky, k + 1) <= tAt(orion, k + 1)) && waveHunters(tAt(milky, 3)) === 0 && firstHunter(milky) > firstHunter(orion) && capAt(milky, 8) <= 3, `T at L1..L8: ${[1, 2, 3, 4, 5, 6, 7, 8].map((l) => tAt(milky, l)).join(',')}`)
  check('N7 QUASAR starts with a squad of four, three alive, one hunter', waveRoster(tAt(quasar, 1)) === 4 && capAt(quasar, 1) === 3 && waveHunters(tAt(quasar, 1)) === 1, `T at L1 = ${tAt(quasar, 1)}`)
  const eases = DIFFICULTY.MODES.map((m) => m.ease)
  check('N8 ease: MILKY WAY above 1, ORION 1, QUASAR 1', eases[milky]! > 1 && eases[orion] === 1 && eases[quasar] === 1, eases.join(','))
  const f = createFlight()
  f.setDifficulty(milky)
  check('N9 flight.ease() follows the selected mode', f.ease() === eases[milky])

  // The three steps in pressure land on three different ORION levels: the hunter at
  // level 3, the extra mines of the phrases at level 4, the aggression ramp after it.
  const extraMineT = Math.min(...PHRASES.flatMap((p) => (p.mines ?? []).map((m) => m.minTuned ?? 0)).filter((t) => t > 0))
  const hunterLevel = firstHunter(orion)
  const mineLevel = extraMineT + 1
  const aggressionLevel = [...Array(40).keys()].map((k) => k + 1).find((l) => aggression(tAt(orion, l)) > 0) ?? Infinity
  check('N10 ORION: hunter at level 3, extra phrase mines at level 4, aggression rises from level 4', hunterLevel === 3 && mineLevel === 4 && aggressionLevel === 4 && SEQUENCE.SCATTER.MINES_3_FROM === extraMineT, `hunter L${hunterLevel}, mines L${mineLevel}, aggression L${aggressionLevel}`)
  check('N11 levels 1 and 2 are the warm-up: slow fire, no hunter, the lightest mine budgets', fireCooldown(1) > 1.5 * ENEMY.FIRE_COOLDOWN && waveHunters(1) === 0 && bombMult(0) === 1 && bombMult(1) >= 0.9 && bombMult(2) > bombMult(3), `cooldown T0 ${fireCooldown(0)} T1 ${fireCooldown(1).toFixed(2)} T2 ${fireCooldown(2)}; mine mult ${[0, 1, 2, 3, 4].map((T) => bombMult(T)).join(' ')}`)
})()

if (failed) {
  console.error(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL LEVEL SIM CHECKS PASSED')

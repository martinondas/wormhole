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
import { SPEED, PHYSICS, FLIGHT, LEVELS, PICKUP, HAZARD, TREASURE } from '../src/config'

let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failed++
}
const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

// Derived expectations (mirror flight.ts math, computed independently here).
const secs = FLIGHT.SECTION_SECONDS
const inc = LEVELS.SPEED_INCREMENT
const step = LEVELS.SCORE_MULT_STEP
const base = [SPEED.SLOW, SPEED.NORMAL, SPEED.FAST]
const tierSpeed = (lvl: number, t: number): number => base[t]! + lvl * inc
const cycleLen = (lvl: number): number => (tierSpeed(lvl, 0) + tierSpeed(lvl, 1) + tierSpeed(lvl, 2)) * secs
const gemQuota = (lvl: number): number => Math.round((cycleLen(lvl) / TREASURE.SPAWN_SPACING) * LEVELS.GEM_QUOTA_FRACTION)

// cumulative distance where level L begins, assuming every cycle advanced (active player)
function cumStart(L: number): number {
  let s = 0
  for (let k = 0; k < L; k++) s += cycleLen(k)
  return s
}

// Fly a fresh flight forward to `distance`, feeding `gems` each step. Small steps
// keep at most one cycle boundary per update() call (so the per-call gem count is
// applied to each boundary in turn).
function flyTo(distance: number, gems: number, stepSize = 20): Flight {
  const f = createFlight()
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
  // tier mode: full gravity at the LEVEL's own slow speed, zero at its own fast
  LEVELS.GRAVITY_MODE = 'tier'
  const f = flyTo(cumStart(1) + 50, ACTIVE) // level 1, slow section
  check('E1 tier: full gravity at L1 slow speed', approx(f.gravityForSpeed(tierSpeed(1, 0)), PHYSICS.GRAVITY_K), `${f.gravityForSpeed(tierSpeed(1, 0))}`)
  check('E2 tier: zero gravity at L1 fast speed', approx(f.gravityForSpeed(tierSpeed(1, 2)), 0), `${f.gravityForSpeed(tierSpeed(1, 2))}`)
  check('E3 tier: gravity monotonic decreasing in speed', f.gravityForSpeed(tierSpeed(1, 0)) > f.gravityForSpeed(tierSpeed(1, 1)) && f.gravityForSpeed(tierSpeed(1, 1)) > f.gravityForSpeed(tierSpeed(1, 2)))
  // absolute mode: at L1 slow speed gravity is already < full (lighter than tier mode)
  LEVELS.GRAVITY_MODE = 'absolute'
  const g = flyTo(cumStart(1) + 50, ACTIVE)
  check('E4 absolute: L1 slow gravity < full (lighter)', g.gravityForSpeed(tierSpeed(1, 0)) < PHYSICS.GRAVITY_K - 1e-6, `${g.gravityForSpeed(tierSpeed(1, 0))}`)
  check('E5 gravity clamped to [0, K]', g.gravityForSpeed(0) <= PHYSICS.GRAVITY_K + 1e-9 && g.gravityForSpeed(9999) >= -1e-9)
  LEVELS.GRAVITY_MODE = modeWas
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

// ---- H) speed-normalized density levers (orb rarity must tighten, not loosen) ----
;(() => {
  const f1 = createFlight() // gated level 0: ratios are 1
  check('H1 speedRatio = 1 at level 1', approx(f1.speedRatioAt(100), 1))
  check('H2 speedRatio = 1 at level 1 (any tier)', approx(f1.speedRatioAt(1000), 1))
  // L5 = 0-based level 4; its normal section sits after its slow section
  const c4 = cumStart(4)
  const slowLenL5 = (base[0]! + 4 * inc) * secs
  const dNormalL5 = c4 + slowLenL5 + 50
  const f5 = flyTo(dNormalL5, ACTIVE) // active player reaches level 4 by this distance
  check('H3 speedRatio L5 normal tier = (52+20)/52', approx(f5.speedRatioAt(dNormalL5), (base[1]! + 4 * inc) / base[1]!), `${f5.speedRatioAt(dNormalL5)}`)

  // Encounter rate per second = tierSpeed / (baseSpacing * mult * speedRatio).
  // The fix: this must FALL for orbs as orbSpacingMult rises (energy gets harder),
  // and RISE for bombs as bombSpacingMult falls (more bombs/s) - both vs level 1.
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
  check('H4 orb rate FALLS L1 -> L5 (energy harder, fix works)', orbL5 < orbL1, `L1 ${orbL1.toFixed(3)}/s -> L5 ${orbL5.toFixed(3)}/s`)
  const bombL1 = bombRate(f1, 0, 400)
  const bombL5 = bombRate(f5, 4, dNormalL5)
  check('H5 bomb rate RISES L1 -> L5 (denser, as intended)', bombL5 > bombL1, `L1 ${bombL1.toFixed(3)}/s -> L5 ${bombL5.toFixed(3)}/s`)
})()

// ---- I) gem gate: quota scaling + advance / replay behavior ----
;(() => {
  const f = createFlight()
  check('I1 gemQuota matches the derived formula (L0)', f.gemQuota(0) === gemQuota(0), `${f.gemQuota(0)} vs ${gemQuota(0)}`)
  // non-decreasing per level (rounding plateaus, e.g. 7,7,8,8,9,10) and genuinely larger deeper
  const quotas = [0, 1, 2, 3, 4, 5].map((l) => f.gemQuota(l))
  const nonDecreasing = quotas.every((q, i) => i === 0 || q >= quotas[i - 1]!)
  check('I2 gemQuota rises with level (non-decreasing, larger deeper)', nonDecreasing && f.gemQuota(5) > f.gemQuota(0), quotas.join(','))

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

if (failed) {
  console.error(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL LEVEL SIM CHECKS PASSED')

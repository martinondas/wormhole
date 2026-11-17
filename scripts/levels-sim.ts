// Headless behavior checks for the level / difficulty system (npm run sim:levels).
// Exercises src/flight.ts and src/levels.ts directly (no DOM): the level gate, the
// per-level tier speeds, the score multiplier, the two gravity modes, the level
// speed cap, tier/level lookups for tube + field scaling, the raider wave tables,
// and edge cases (distance 0, negative, pinned modes). The last gate checks drive
// the real session.
//
// A level changes only at a gate, so it is not a pure function of distance. flyTo()
// flies a flight forward; an "active" flight opens a gate at the end of every
// section cycle (the level then changes at every cycle boundary, which the speed and
// gravity checks rely on), a passive one never opens a gate.
import { createFlight, type Flight } from '../src/flight'
import { createSession } from '../src/session'
import { createLevelTuning, waveRoster, waveAliveCap, waveHunters, aggression, deepPressure, fireCooldown, bombMult } from '../src/levels'
import { PHRASES } from '../src/world/phrases'
import { SPEED, PHYSICS, FLIGHT, LEVELS, PICKUP, DIFFICULTY, ENEMY, SEQUENCE, GATE, TUBE } from '../src/config'
import { check, finish, withConfig, driveSession, flyOntoGems } from './sim-kit'

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

// cumulative distance where level L begins, with a gate at the end of every cycle (active flight)
function cumStart(L: number): number {
  let s = 0
  for (let k = 0; k < L; k++) s += cycleLen(k)
  return s
}

// Fly a fresh flight forward to `distance` in small steps. An active flight opens a
// gate at the end of the cycle it is in whenever none is open.
function flyTo(distance: number, active: boolean, stepSize = 20, difficulty?: number): Flight {
  const f = createFlight()
  if (difficulty !== undefined) f.setDifficulty(difficulty)
  const gate = (d: number): void => {
    if (!active || f.gateAt < Infinity) return
    let len = 0
    for (let t = 0; t < 3; t++) len += f.tierSpeedOf(f.level, t) * secs
    const at = f.cycleStartAt(d) + len
    f.openGate(at > d + 1e-6 ? at : at + len) // rounding can put `d` at the very end of the cycle before
  }
  f.update(0)
  gate(0)
  let d = 0
  while (d < distance) {
    d = Math.min(distance, d + stepSize, f.gateAt)
    f.update(d)
    gate(d)
  }
  return f
}
const ACTIVE = true
const PASSIVE = false

// level/speed/multiplier/cap at a distance for an ACTIVE player
function at(distance: number): { level: number; target: number; mult: number; speedMax: number } {
  const f = flyTo(distance, ACTIVE)
  return { level: f.level, target: f.targetSpeed(), mult: f.scoreMultiplier, speedMax: f.speedMax() }
}

// ---- A) level boundaries by distance (active flight: a gate at the end of every cycle) ----
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

// ---- D) speed cap follows the level ----
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
// tier mode: full gravity at the LEVEL's own slow speed, the floor at its own fast
withConfig(LEVELS, { GRAVITY_MODE: 'tier' }, () => {
  const f = flyTo(cumStart(1) + 50, ACTIVE) // level 1, slow section
  check('E1 tier: full gravity at L1 slow speed', approx(f.gravityForSpeed(tierSpeed(1, 0)), PHYSICS.GRAVITY_K), `${f.gravityForSpeed(tierSpeed(1, 0))}`)
  check('E2 tier: floor gravity at L1 fast speed', approx(f.gravityForSpeed(tierSpeed(1, 2)), PHYSICS.GRAVITY_K * FLIGHT.GRAVITY_FLOOR), `${f.gravityForSpeed(tierSpeed(1, 2))}`)
  check('E3 tier: gravity monotonic decreasing in speed', f.gravityForSpeed(tierSpeed(1, 0)) > f.gravityForSpeed(tierSpeed(1, 1)) && f.gravityForSpeed(tierSpeed(1, 1)) > f.gravityForSpeed(tierSpeed(1, 2)))
})
// absolute mode: at L1 slow speed gravity is already < full (lighter than tier mode)
withConfig(LEVELS, { GRAVITY_MODE: 'absolute' }, () => {
  const g = flyTo(cumStart(1) + 50, ACTIVE)
  check('E4 absolute: L1 slow gravity < full (lighter)', g.gravityForSpeed(tierSpeed(1, 0)) < PHYSICS.GRAVITY_K - 1e-6, `${g.gravityForSpeed(tierSpeed(1, 0))}`)
  check('E5 gravity clamped to [0, K]', g.gravityForSpeed(0) <= PHYSICS.GRAVITY_K + 1e-9 && g.gravityForSpeed(9999) >= -1e-9)
})

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

// ---- F) tier lookups used by tube coloring + field scaling ----
;(() => {
  const f = createFlight() // fresh: level 0, no gate open
  // section tiers within level 0
  check('F1 tierIndexAt L0 slow', f.tierIndexAt(0) === 0)
  check('F2 tierIndexAt L0 normal', f.tierIndexAt(400) === 1)
  check('F3 tierIndexAt L0 fast', f.tierIndexAt(1000) === 2)
  // with no gate open the sections of the current level repeat
  check('F5 tierIndexAt wraps to slow past one cycle', f.tierIndexAt(cycleLen(0) + 10) === 0)
  check('F6 tierIndexAt wraps the cycle (normal again)', f.tierIndexAt(cycleLen(0) + 400) === 1)
})()

// ---- G) pinned modes: no level progression, no gate, fixed tier ----
;(() => {
  const f = createFlight()
  f.mode = 'slow'
  f.openGate(500)
  f.update(99999)
  check('G1 pinned slow: level stays 0, also past a gate distance', f.level === 0)
  check('G2 pinned slow: multiplier 1', approx(f.scoreMultiplier, 1))
  check('G3 pinned slow: target = base slow', approx(f.targetSpeed(), SPEED.SLOW))
  check('G4 pinned slow: tierIndexAt = 0 everywhere', f.tierIndexAt(0) === 0 && f.tierIndexAt(99999) === 0)
  f.mode = 'fast'
  f.update(99999)
  check('G5 pinned fast: target = base fast, level 0', approx(f.targetSpeed(), SPEED.FAST) && f.level === 0)
})()

// ---- H) speed-normalized orb spacing (orbs flat per second) ----
;(() => {
  const f1 = createFlight() // level 0: ratios are 1
  check('H1 speedRatio = 1 at level 1', approx(f1.speedRatioAt(100), 1))
  check('H2 speedRatio = 1 at level 1 (any tier)', approx(f1.speedRatioAt(1000), 1))
  // L5 = 0-based level 4; its normal section sits after its slow section
  const c4 = cumStart(4)
  const slowLenL5 = (base[0]! + speedBonus(4)) * secs
  const dNormalL5 = c4 + slowLenL5 + 50
  const f5 = flyTo(dNormalL5, ACTIVE) // the active flight reaches level 4 by this distance
  check('H3 speedRatio L5 normal tier = (52+20)/52', approx(f5.speedRatioAt(dNormalL5), (base[1]! + speedBonus(4)) / base[1]!), `${f5.speedRatioAt(dNormalL5)}`)

  // Encounter rate per second = tierSpeed / (baseSpacing * speedRatio).
  // Design: orbs are FLAT per second across levels (rising speed already makes them
  // harder to catch, so they do not also thin out).
  const orbRate = (f: Flight, lvl: number, dist: number): number =>
    tierSpeed(lvl, 1) / (PICKUP.SPAWN_SPACING * f.speedRatioAt(dist))
  const orbL1 = orbRate(f1, 0, 400) // L1 normal section
  const orbL5 = orbRate(f5, 4, dNormalL5)
  check('H4 orb rate is FLAT L1 -> L5 (count unchanged; speed makes catching harder)', approx(orbL5, orbL1), `L1 ${orbL1.toFixed(3)}/s -> L5 ${orbL5.toFixed(3)}/s`)
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
  // L17 fast (0-based 16) lands where the design says (~138)
  check('J6 L17 fast ~ 138', approx(tierSpeed(16, 2), 138), `${tierSpeed(16, 2)}`)
})()

// ---- K) mine density (levels.ts bombMult): tightens past the table to a floor ----
;(() => {
  check('K1 past-table mines denser than L5', bombMult(8) < LEVELS.TABLE[LEVELS.TABLE.length - 1]!.bombSpacingMult, `${bombMult(8)}`)
  check('K2 mine multiplier floored (playable)', approx(bombMult(99), LEVELS.BOMB_MULT_FLOOR), `${bombMult(99)}`)
  check('K3 floor never goes below config floor', bombMult(99) >= LEVELS.BOMB_MULT_FLOOR - 1e-9)
})()

// ---- I) gem quota and the level gate (flight alone) ----
;(() => {
  const idx = (name: string): number => DIFFICULTY.MODES.findIndex((m) => m.name === name)
  const f = createFlight()
  const quotas = [...Array(41).keys()].map((l) => f.gemQuota(l))
  const nonDecreasing = quotas.every((q, i) => i === 0 || q >= quotas[i - 1]!)
  check('I1 ORION quota never falls, starts at GEM_QUOTA_START, ends at GEM_QUOTA_MAX', nonDecreasing && quotas[0] === LEVELS.GEM_QUOTA_START && quotas[40] === LEVELS.GEM_QUOTA_MAX, `L1 ${quotas[0]} ... L41 ${quotas[40]}`)
  let capsOk = true
  let line = ''
  DIFFICULTY.MODES.forEach((m, i) => {
    const g = createFlight()
    g.setDifficulty(i)
    const top = Math.max(...[...Array(61).keys()].map((l) => g.gemQuota(l)))
    if (top > Math.min(m.quotaCap, LEVELS.GEM_QUOTA_MAX) || g.gemQuota(0) < 1) capsOk = false
    line += ` ${m.name} ${g.gemQuota(0)}..${top}`
  })
  check('I2 no mode asks for more than its quota cap or GEM_QUOTA_MAX, and every quota is at least one gem', capsOk, line)
  check('I2b the easiest mode has a cap below GEM_QUOTA_MAX', DIFFICULTY.MODES[idx('MILKY WAY')]!.quotaCap < LEVELS.GEM_QUOTA_MAX)

  // without a gate the level never changes, however far the craft flies
  const passive = flyTo(cumStart(4), PASSIVE)
  check('I3 no gate: the level stays 0 over four cycles', passive.level === 0 && passive.gateAt === Infinity, `level=${passive.level}`)
  check('I4 no gate: speedMax stays level 0', approx(passive.speedMax(), tierSpeed(0, 2)))

  // a gate in the middle of the normal section of level 0
  const g = createFlight()
  const slowEnd = tierSpeed(0, 0) * secs
  const gate = slowEnd + 200
  g.update(0)
  g.openGate(gate)
  g.update(gate - 0.01)
  const before = g.level
  const speedBefore = g.targetSpeed()
  g.update(gate)
  check('I5 the level changes exactly at the gate, and the gate closes', before === 0 && g.level === 1 && g.gateAt === Infinity && approx(speedBefore, tierSpeed(0, 1)) && approx(g.targetSpeed(), tierSpeed(1, 1)), `before ${before}, at the gate ${g.level}`)
  check('I5b the score multiplier steps with it', approx(g.scoreMultiplier, 1 + step))
  // the section that holds the gate keeps its seconds: the part before the gate at
  // the old speed, the rest at the new one
  const h = createFlight()
  h.openGate(gate)
  const endOf = (from: number, tier: number): number => {
    let d = from
    while (h.tierIndexAt(d) === tier) d += 0.01
    return d
  }
  const normalEnd = endOf(gate, 1)
  const seconds = (gate - slowEnd) / tierSpeed(0, 1) + (normalEnd - gate) / tierSpeed(1, 1)
  check('I6 the section around the gate lasts SECTION_SECONDS', h.tierIndexAt(gate - 0.01) === 1 && h.tierIndexAt(gate) === 1 && Math.abs(seconds - secs) < 0.01, `${seconds.toFixed(3)} s`)
  const fastEnd = endOf(normalEnd, 2)
  const slowEnd2 = endOf(fastEnd, 0)
  check('I7 the sections beyond the gate have the next level\'s lengths', Math.abs(fastEnd - normalEnd - tierSpeed(1, 2) * secs) < 0.05 && Math.abs(slowEnd2 - fastEnd - tierSpeed(1, 0) * secs) < 0.05, `fast ${(fastEnd - normalEnd).toFixed(1)}, slow ${(slowEnd2 - fastEnd).toFixed(1)}`)
  check('I8 the speed ratio is the current level\'s before the gate and the next level\'s beyond it', approx(h.speedRatioAt(gate - 1), 1) && approx(h.speedRatioAt(gate + 1), tierSpeed(1, 1) / base[1]!), `${h.speedRatioAt(gate + 1)}`)
  // the fast-to-slow boundary (the raiders hold fire there): with a gate inside the
  // cycle it is where the next level's fast section ends
  check('I8b cycleEndAt is the end of the fast section, also across an open gate', Math.abs(h.cycleEndAt(10) - fastEnd) < 0.05 && Math.abs(h.cycleEndAt(gate + 1) - fastEnd) < 0.05 && approx(passive.cycleEndAt(10), cycleLen(0)), `${h.cycleEndAt(10).toFixed(1)} against ${fastEnd.toFixed(1)}`)
  h.reset()
  check('I9 reset closes an open gate', h.gateAt === Infinity && h.level === 0 && h.tierIndexAt(gate + 400) === passive.tierIndexAt(gate + 400))
})()

// ---- M) the gate in the real session ----
// Drives the real session (no renderer) with i-frames held on. The craft is put on
// every gem, so quotas are met by collecting, as in play.
;(() => {
  const LEVELS_TO_PLAY = 8
  const frameTravel = (speed: number): number => (speed / 60) * 1.01 + 1e-6 // the level is refreshed once per frame
  let opened = 0
  let passed = 0
  let bad = ''
  let gateOpen = false
  let gemsWhileOpen = 0
  let gateDistance = 0
  let session = createSession()
  const fx = {
    quotaReached: () => {
      const f = session.flight
      opened++
      if (gateOpen) bad += ` L${f.level + 1}: a second gate opened`
      gateOpen = true
      gateDistance = f.gateAt
      if (Math.abs(f.gateAt - session.craft.distance - GATE.AHEAD) > 1e-6) bad += ` L${f.level + 1}: gate ${(f.gateAt - session.craft.distance).toFixed(1)} ahead`
      if (session.game.gemsThisLevel !== f.gemQuota(f.level)) bad += ` L${f.level + 1}: opened at ${session.game.gemsThisLevel} gems`
    },
    gemCollected: () => {
      if (!gateOpen) return
      gemsWhileOpen++
      const f = session.flight
      if (session.game.gemsThisLevel !== f.gemQuota(f.level)) bad += ` L${f.level + 1}: the count moved while the gate was open`
    },
    levelUp: (level: number) => {
      passed++
      if (!gateOpen) bad += ` L${level + 1}: level-up without a gate`
      gateOpen = false
      const past = session.craft.distance - gateDistance
      if (past < 0 || past > frameTravel(session.craft.speed)) bad += ` L${level + 1}: changed ${past.toFixed(2)} past the gate`
      if (session.game.gemsThisLevel !== 0) bad += ` L${level + 1}: starts with ${session.game.gemsThisLevel} gems`
      if (session.flight.gateAt !== Infinity) bad += ` L${level + 1}: the gate stayed open`
    },
  }
  session = createSession(fx)
  session.reset()
  session.begin()
  const advance = driveSession(session, { steerTarget: 0, fire: false }, { invulnerable: true, beforeFrame: flyOntoGems(session) })
  for (let steps = 0; passed < LEVELS_TO_PLAY && steps < PHYSICS.HZ * 900; steps++) advance()
  const f = session.flight
  check('M1 every gate opens GATE.AHEAD in front of the craft at exactly the quota, one at a time', opened >= LEVELS_TO_PLAY && bad === '', bad || `${opened} gates`)
  check('M2 the level changes at the gate and nowhere else; the new level starts with zero gems', passed === LEVELS_TO_PLAY && f.level === LEVELS_TO_PLAY && bad === '', `level ${f.level + 1} after ${passed} gates`)
  check('M3 gems collected while the gate is open do not count', gemsWhileOpen > 0 && bad === '', `${gemsWhileOpen} gems`)
  check('M4 GATE.AHEAD is past the drawn rings and the planning horizon', GATE.AHEAD >= SEQUENCE.HORIZON && GATE.AHEAD >= TUBE.RINGS_VISIBLE * TUBE.RING_SPACING, `${GATE.AHEAD} against ${SEQUENCE.HORIZON} and ${TUBE.RINGS_VISIBLE * TUBE.RING_SPACING}`)

  // a restart with a gate open: fly until the next gate opens, then reset
  for (let steps = 0; !gateOpen && steps < PHYSICS.HZ * 120; steps++) advance()
  const wasOpen = gateOpen && f.gateAt < Infinity
  session.reset()
  gateOpen = false
  check('M5 a restart closes the gate and starts level 1 with zero gems', wasOpen && f.gateAt === Infinity && f.level === 0 && session.game.gemsThisLevel === 0)

  // a pinned mode has no levels: collecting opens no gate
  const before = opened
  f.mode = 'slow'
  session.begin()
  for (let steps = 0; steps < PHYSICS.HZ * 60; steps++) advance()
  check('M6 a pinned mode opens no gate and stays at level 1', opened === before && f.gateAt === Infinity && f.level === 0 && session.fieldByKind.gem.consumed > 0, `${session.fieldByKind.gem.consumed} gems collected`)
  f.mode = 'sections'
})()

// ---- P) around the gate: the fire hold, no tier cue, a flight-mode switch ----
;(() => {
  let now = 0 // seconds of play
  let passedAt = -Infinity
  let passes = 0
  let tells = 0
  let tellsHeld = 0 // firing tells that started inside the hold around a gate
  let tellsLater = 0 // ... and after the hold, before the next gate opened
  let tierUps = 0
  let tierUpsAtGate = 0
  let levelEdge = false // a level-up fired in the frame in progress
  let session = createSession()
  const frame = 1 / 60 // the hold is refreshed once per frame
  const fx = {
    levelUp: () => {
      passes++
      passedAt = now
      levelEdge = true
    },
    tierUp: () => {
      tierUps++
      if (levelEdge) tierUpsAtGate++
    },
    enemyChargeStarted: () => {
      tells++
      const f = session.flight
      const toGate = (f.gateAt - session.craft.distance) / session.craft.speed
      const since = now - passedAt
      if (toGate < ENEMY.HOLD_FIRE.BEFORE - frame || since < ENEMY.HOLD_FIRE.AFTER - frame) tellsHeld++
      else if (f.gateAt === Infinity && passes > 0) tellsLater++
    },
  }
  session = createSession(fx)
  session.reset()
  session.begin()
  const onGems = flyOntoGems(session)
  const advance = driveSession(session, { steerTarget: 0, fire: false }, {
    invulnerable: true,
    beforeFrame: () => {
      levelEdge = false
      onGems()
    },
  })
  const fly = (until: () => boolean, seconds: number): void => {
    for (let steps = 0; !until() && steps < PHYSICS.HZ * seconds; steps++) {
      advance()
      now += 1 / PHYSICS.HZ
    }
  }
  fly(() => passes >= 10, 900)
  check('P1 no firing tell starts from HOLD_FIRE.BEFORE ahead of a gate until HOLD_FIRE.AFTER past it, and the fire returns after', passes >= 10 && tellsHeld === 0 && tellsLater > 0, `${tells} tells over ${passes} gates, ${tellsHeld} inside the hold, ${tellsLater} after it`)
  check('P2 the speed step at a gate fires no tierUp; the section changes still do', tierUpsAtGate === 0 && tierUps > passes, `${tierUps} tierUp events, ${tierUpsAtGate} at a gate`)

  // a flight-mode switch (the testing key) while a gate is open
  const f = session.flight
  fly(() => f.gateAt < Infinity, 120)
  const open = f.gateAt < Infinity
  const level = f.level
  const before = passes
  f.cycle() // sections -> a pinned mode
  const closed = f.gateAt === Infinity
  fly(() => false, 12) // well past where the gate stood
  while (f.mode !== 'sections') f.cycle()
  fly(() => false, 0.5)
  check('P3 leaving the sections mode closes an open gate, and the round trip changes no level', open && closed && passes === before && f.level === level, `gate open ${open}, closed ${closed}, level ${level + 1} -> ${f.level + 1}`)
  fly(() => passes > before, 120)
  check('P4 back in the sections mode the next gem opens a new gate, and the level rises by one there', passes === before + 1 && f.level === level + 1)
})()

// ---- N) raider waves: roster, alive cap, hunters per tuning level and per mode ----
;(() => {
  const Ts = [...Array(60).keys()]
  const neverFalls = (f: (T: number) => number): boolean => Ts.every((T) => T === 0 || f(T) >= f(T - 1))
  let bad = ''
  LEVELS.WAVES.forEach((row, T) => {
    const capOk = T >= LEVELS.WAVE_CAP4_FROM || waveAliveCap(T) === row.cap
    const huntersOk = T >= LEVELS.WAVE_HUNTERS2_FROM || waveHunters(T) === row.hunters
    if (waveRoster(T) !== row.roster || !capOk || !huntersOk) bad += ` T${T}: ${waveRoster(T)}/${waveAliveCap(T)}/${waveHunters(T)}`
  })
  check('N1 roster / alive cap / hunters match the LEVELS.WAVES rows', bad === '', bad || `T0..T${LEVELS.WAVES.length - 1}`)
  check('N1b roster, alive cap and hunters never fall with the level; the roster ends at WAVE_ROSTER_MAX', neverFalls(waveRoster) && neverFalls(waveAliveCap) && neverFalls(waveHunters) && waveRoster(59) === LEVELS.WAVE_ROSTER_MAX, `T59: ${waveRoster(59)}/${waveAliveCap(59)}/${waveHunters(59)}`)
  const over = Ts.filter((T) => waveHunters(T) > waveAliveCap(T) || waveAliveCap(T) > waveRoster(T))
  check('N1c hunters never exceed the alive cap, the alive cap never exceeds the roster', over.length === 0, over.map((T) => `T${T}`).join(' '))
  const capMax = Math.max(...Ts.map(waveAliveCap))
  check('N2 the alive cap reaches MAX_ENEMIES_CAP and never exceeds it', capMax === LEVELS.MAX_ENEMIES_CAP, `max=${capMax}`)
  check('N3 aggression: 0 up to AGGRESSION_FROM, 0.5 halfway, 1 from the end of the span', aggression(0) === 0 && aggression(LEVELS.AGGRESSION_FROM) === 0 && approx(aggression(LEVELS.AGGRESSION_FROM + LEVELS.AGGRESSION_SPAN / 2), 0.5) && aggression(LEVELS.AGGRESSION_FROM + LEVELS.AGGRESSION_SPAN) === 1 && aggression(30) === 1, `from T${LEVELS.AGGRESSION_FROM} over ${LEVELS.AGGRESSION_SPAN} levels`)

  const fullAggression = LEVELS.AGGRESSION_FROM + LEVELS.AGGRESSION_SPAN
  check('N3b fire cooldown: FIRE_COOLDOWN_EARLY at T0, FIRE_COOLDOWN at AGGRESSION_FROM', approx(fireCooldown(0), ENEMY.FIRE_COOLDOWN_EARLY) && approx(fireCooldown(LEVELS.AGGRESSION_FROM), ENEMY.FIRE_COOLDOWN), `T0 ${fireCooldown(0)} T${LEVELS.AGGRESSION_FROM} ${fireCooldown(LEVELS.AGGRESSION_FROM)}`)
  check('N3c fire cooldown at full aggression: FIRE_COOLDOWN_DEEP x the deep-pressure factor', approx(fireCooldown(fullAggression), ENEMY.FIRE_COOLDOWN_DEEP * (1 + (ENEMY.DEEP_COOLDOWN_K - 1) * deepPressure(fullAggression))), `T${fullAggression} ${fireCooldown(fullAggression).toFixed(2)}`)
  check('N3d fire cooldown at full deep pressure: FIRE_COOLDOWN_DEEP x DEEP_COOLDOWN_K', approx(fireCooldown(30), ENEMY.FIRE_COOLDOWN_DEEP * ENEMY.DEEP_COOLDOWN_K), `T30 ${fireCooldown(30).toFixed(2)}`)
  check('N3e fire cooldown never rises with the level', [...Array(30).keys()].every((T) => fireCooldown(T + 1) <= fireCooldown(T) + 1e-9), `T1 ${fireCooldown(1)} T8 ${fireCooldown(8).toFixed(2)} T14 ${fireCooldown(14).toFixed(2)}`)
  check('N3f deep pressure: 0 up to DEEP_FROM, 1 from DEEP_FROM + DEEP_SPAN', deepPressure(LEVELS.DEEP_FROM) === 0 && deepPressure(LEVELS.DEEP_FROM + LEVELS.DEEP_SPAN) === 1)

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
  // ORION is the identity mapping: level L plays the wave of tuning level L - 1
  const rows = LEVELS.WAVES.map((_row, T) => T + 1)
  check('N4 ORION plays the wave table as written: level L has the tuning level and the alive cap of T = L - 1', rows.every((l) => tAt(orion, l) === l - 1 && capAt(orion, l) === waveAliveCap(l - 1)), `caps L1..L${rows.length}: ${rows.map((l) => capAt(orion, l)).join(',')}`)
  const firstHunter = (difficulty: number): number => [...Array(40).keys()].map((k) => k + 1).find((l) => waveHunters(tAt(difficulty, l)) > 0) ?? Infinity
  check('N6 MILKY WAY reaches each wave size later than ORION', tAt(milky, 1) === 0 && [...Array(20).keys()].every((k) => tAt(milky, k + 1) <= tAt(orion, k + 1)) && waveHunters(tAt(milky, 3)) === 0 && firstHunter(milky) > firstHunter(orion) && capAt(milky, 8) <= 3, `T at L1..L8: ${[1, 2, 3, 4, 5, 6, 7, 8].map((l) => tAt(milky, l)).join(',')}`)
  const quasarT = tAt(quasar, 1)
  check('N7 QUASAR starts on the wave of its offset, a larger squad than the first of ORION', quasarT === Math.round(DIFFICULTY.MODES[quasar]!.offset) && waveRoster(quasarT) > waveRoster(tAt(orion, 1)) && capAt(quasar, 1) >= capAt(orion, 1), `T at L1 = ${quasarT}: roster ${waveRoster(quasarT)}, alive ${capAt(quasar, 1)}, hunters ${waveHunters(quasarT)}`)
  const eases = DIFFICULTY.MODES.map((m) => m.ease)
  check('N8 ease: MILKY WAY above 1, ORION 1, QUASAR 1', eases[milky]! > 1 && eases[orion] === 1 && eases[quasar] === 1, eases.join(','))
  const f = createFlight()
  f.setDifficulty(milky)
  check('N9 flight.ease() follows the selected mode', f.ease() === eases[milky])

  // The hunter is the first step in pressure on ORION: it arrives before the extra
  // mines of the phrases and before the aggression ramp.
  const extraMineT = Math.min(...PHRASES.flatMap((p) => (p.mines ?? []).map((m) => m.minTuned ?? 0)).filter((t) => t > 0))
  const hunterLevel = firstHunter(orion)
  const mineLevel = extraMineT + 1
  const aggressionLevel = [...Array(40).keys()].map((k) => k + 1).find((l) => aggression(tAt(orion, l)) > 0) ?? Infinity
  check('N10 ORION: the first hunter arrives before the extra phrase mines and before the aggression ramp', hunterLevel < mineLevel && hunterLevel < aggressionLevel, `hunter L${hunterLevel}, mines L${mineLevel}, aggression L${aggressionLevel}`)
  check('N10b the extra mines of the phrases start at SCATTER.MINES_3_FROM', SEQUENCE.SCATTER.MINES_3_FROM === extraMineT, `phrases T${extraMineT}, scatter T${SEQUENCE.SCATTER.MINES_3_FROM}`)
  // the warm-up: the tuning levels below AGGRESSION_FROM
  const warmUp = [...Array(LEVELS.AGGRESSION_FROM).keys()]
  const mults = [...Array(40).keys()].map(bombMult)
  check('N11 the warm-up levels fire slower than FIRE_COOLDOWN and have no hunter; the mine multiplier starts at 1 and never rises', warmUp.every((T) => fireCooldown(T) > ENEMY.FIRE_COOLDOWN && waveHunters(T) === 0) && mults[0] === 1 && mults.every((m, T) => T === 0 || m <= mults[T - 1]!), `cooldown ${warmUp.map((T) => fireCooldown(T).toFixed(2)).join(' ')}; mine mult ${mults.slice(0, 5).join(' ')}`)
})()

finish('LEVEL SIM')

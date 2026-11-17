import { PHYSICS, SPEED, FLIGHT, LEVELS, DIFFICULTY, type FlightMode } from './config'
import { clamp } from './util/math'

// Runtime-switchable flight mode + the difficulty-by-level model. Speed is the
// single driver: the current tube section picks a target speed, gravity is tied
// to that speed (heavier when slow), and the level shifts every tier speed up and
// raises the score multiplier as you go deeper.
//
// The tube is a cycle of three sections (slow, normal, fast). Each section length =
// its tier speed x SECTION_SECONDS, so every section is equal in TIME however fast
// the tiers get.
//
// LEVEL GATE (sections mode): a level lasts until its gem quota is collected. The
// session then opens a gate ahead of the craft (openGate). The tube beyond the gate
// belongs to the next level from that moment: its sections keep their place on the
// section clock and take the next level's speeds. The level itself changes when the
// craft passes the gate (update).
//
// Levels only progress in 'sections' mode (the game). Pinned slow/normal/fast
// (G-key, for feel testing) hold a single tier at level 1 with multiplier 1 and no
// gate: a gate that is open closes when the mode leaves 'sections'.

export const TIERS = [0, 1, 2] as const // slow, normal, fast
const BASE = [SPEED.SLOW, SPEED.NORMAL, SPEED.FAST]
const ORDER: FlightMode[] = ['slow', 'normal', 'fast', 'sections'] // G-key cycle
export const N_TIERS = TIERS.length

// The tier a pinned mode holds (slow / normal / fast force one tier; 'sections' cycles them).
export const pinnedTier = (mode: FlightMode): number => (mode === 'slow' ? 0 : mode === 'fast' ? 2 : 1)

export interface Flight {
  mode: FlightMode
  level: number // current level, 0-based (display as level + 1); 0 in pinned modes
  scoreMultiplier: number // 1 + tuning level * SCORE_MULT_STEP (1 in pinned modes)
  gateAt: number // distance of the open level gate; Infinity while none is open
  update(distance: number): void // refresh the level / section state once per frame; the level rises past the gate
  // The gem quota is met: the level changes at `distance`, and the tube beyond it
  // takes the next level's speeds.
  openGate(distance: number): void
  targetSpeed(): number // speed the craft eases toward (cached from update)
  speedMax(): number // upper clamp for craft speed at the current level
  speed01(speed: number): number // 0 at the current level's slow-tier speed, 1 at its fast-tier speed (clamped)
  gravityForSpeed(speed: number): number // pendulum strength for the current level
  tierIndexAt(distance: number): number // 0/1/2 at a world distance (tube coloring)
  // Speed of the tier at a world distance, relative to that same tier at level 1.
  // Field spacing is in DISTANCE but encounter rate = speed / spacing, so density
  // levers must scale spacing by this to mean a time-rate ("twice as rare") rather
  // than drift with the rising per-level speed. 1 at level 1 and in pinned modes.
  speedRatioAt(distance: number): number
  gemQuota(level: number): number // gems that open the gate of a level
  // Pure lookups for a given level, independent of where the craft is: what
  // targetSpeed() returns in that level's tier, and what gravityForSpeed() returns
  // at that level for a speed. The gem-line director plans the tube ahead with them.
  tierSpeedOf(level: number, tier: number): number
  gravityOf(level: number, speed: number): number
  cycleStartAt(distance: number): number // where the section cycle that holds `distance` begins (its slow section)
  cycleEndAt(distance: number): number // where it ends: the next fast-to-slow boundary (Infinity in pinned modes)
  // Difficulty (see config DIFFICULTY): tuned() maps a played 0-based level to the
  // tuning level every difficulty lookup derives from; setDifficulty picks the mode
  // (survives reset(), so it holds across runs until re-selected on the title).
  tuned(level: number): number
  ease(): number // the mode's ease factor (1 = as tuned; above 1 = slower raider fire, longer breathers)
  setDifficulty(index: number): void
  reset(): void // back to level 0 at distance 0 (game-over -> title)
  cycle(): FlightMode // advance to the next mode (returns it), for live testing
}

export function createFlight(): Flight {
  const secs = FLIGHT.SECTION_SECONDS
  const step = LEVELS.SCORE_MULT_STEP

  // Per-level speed bonus added to every tier: a decaying-but-never-zero increment
  // across three bands by (0-based) level (config LEVELS.SPEED_STEP / SPEED_BAND).
  // earlyN counts the EARLY increments, midN the MID ones.
  const earlyN = LEVELS.SPEED_BAND.EARLY_UNTIL - 1
  const midN = LEVELS.SPEED_BAND.MID_UNTIL - LEVELS.SPEED_BAND.EARLY_UNTIL
  const speedBonus = (level: number): number => {
    const { EARLY, MID, LATE } = LEVELS.SPEED_STEP
    const early = Math.min(level, earlyN)
    const mid = clamp(level - earlyN, 0, midN)
    const late = Math.max(level - earlyN - midN, 0)
    return early * EARLY + mid * MID + late * LATE
  }

  // Difficulty mapping (config DIFFICULTY): the played level becomes a (possibly
  // fractional) tuning level; speedBonus is piecewise-linear, so fractions work.
  // Applied INSIDE tierSpeed, so every derived quantity (section length, gravity
  // span, speed cap, score multiplier) follows the mode automatically.
  let mode = DIFFICULTY.MODES[DIFFICULTY.DEFAULT]!
  const tuned = (level: number): number => Math.max(0, mode.offset + mode.slope * level)

  // tier speed at a level, and the distance length of one section / one section cycle.
  const tierSpeed = (level: number, tier: number): number => (BASE[tier] ?? SPEED.NORMAL) + speedBonus(tuned(level))
  const sectionLen = (level: number, tier: number): number => tierSpeed(level, tier) * secs
  const cycleLen = (level: number): number => {
    let s = 0
    for (let t = 0; t < N_TIERS; t++) s += sectionLen(level, t)
    return s
  }

  // Section tier (0/1/2) at an offset into a section cycle of a given level.
  function sectionTierAt(offsetInCycle: number, level: number): number {
    let d = offsetInCycle
    for (let t = 0; t < N_TIERS; t++) {
      const len = sectionLen(level, t)
      if (d < len) return t
      d -= len
    }
    return N_TIERS - 1 // numeric guard (offset should always land above)
  }

  // Gems that open a level's gate: a count that rises with the tuning level up to a
  // cap (the mode may cap it lower).
  const gemQuota = (level: number): number =>
    Math.round(Math.min(LEVELS.GEM_QUOTA_MAX, mode.quotaCap, LEVELS.GEM_QUOTA_START + LEVELS.GEM_QUOTA_STEP * tuned(level)))

  // Pendulum strength at `level` for a forward speed (see gravityForSpeed below).
  const gravityOf = (level: number, speed: number): number => {
    const lo = LEVELS.GRAVITY_MODE === 'absolute' ? SPEED.SLOW : tierSpeed(level, 0)
    const hi = LEVELS.GRAVITY_MODE === 'absolute' ? SPEED.FAST : tierSpeed(level, N_TIERS - 1)
    const span = hi - lo
    if (span <= 0) return 0
    const t = clamp((hi - speed) / span, 0, 1) // 1 at the slow tier, 0 at the fast tier
    const floor = FLIGHT.GRAVITY_FLOOR
    return PHYSICS.GRAVITY_K * (floor + (1 - floor) * Math.pow(t, FLIGHT.GRAVITY_CURVE))
  }

  // Progression state (sections mode). `origin` is a distance where a section cycle
  // of the current level starts; the sections repeat from there. While a gate is
  // open, `nextOrigin` is the same for the next level's sections beyond the gate.
  let level = 0
  let origin = 0
  let nextOrigin = 0

  // Cached once per frame in update(), reused by the substeps + score/HUD reads.
  let curTargetSpeed = SPEED.NORMAL

  // Offset of a distance into the section cycle that starts at `from`, for `lvl`.
  const cycleOffset = (distance: number, from: number, lvl: number): number => {
    const len = cycleLen(lvl)
    return (((distance - from) % len) + len) % len
  }
  // Level and section tier of the tube at a world distance (the next level beyond an open gate).
  const levelAt = (distance: number): number => (distance >= flight.gateAt ? level + 1 : level)
  const tierAt = (distance: number): number =>
    distance >= flight.gateAt
      ? sectionTierAt(cycleOffset(distance, nextOrigin, level + 1), level + 1)
      : sectionTierAt(cycleOffset(distance, origin, level), level)

  const flight: Flight = {
    mode: FLIGHT.MODE,
    level: 0,
    scoreMultiplier: 1,
    gateAt: Infinity,

    update(distance: number): void {
      if (this.mode !== 'sections') {
        // pinned tier: fixed speed, no level progression, no gate (also when the
        // mode was set directly, not through cycle())
        this.gateAt = Infinity
        curTargetSpeed = tierSpeed(0, pinnedTier(this.mode))
        this.level = 0
        this.scoreMultiplier = 1
        return
      }
      if (distance >= this.gateAt) {
        level++
        origin = nextOrigin
        this.gateAt = Infinity
      }
      curTargetSpeed = tierSpeed(level, tierAt(distance))
      this.level = level
      this.scoreMultiplier = 1 + tuned(level) * step
    },

    // The section that holds the gate keeps the seconds it has left: the offset into
    // the next level's cycle is the same time into the same tier, at that level's speeds.
    openGate(distance: number): void {
      let tier = 0
      let into = cycleOffset(distance, origin, level)
      while (tier < N_TIERS - 1 && into >= sectionLen(level, tier)) into -= sectionLen(level, tier++)
      let offset = (into / tierSpeed(level, tier)) * tierSpeed(level + 1, tier)
      for (let t = 0; t < tier; t++) offset += sectionLen(level + 1, t)
      nextOrigin = distance - offset
      this.gateAt = distance
    },

    targetSpeed(): number {
      return curTargetSpeed
    },

    // The craft never needs to exceed the current level's fast-tier speed.
    speedMax(): number {
      return tierSpeed(this.level, N_TIERS - 1)
    },

    speed01(speed: number): number {
      const lo = tierSpeed(this.level, 0)
      const span = tierSpeed(this.level, N_TIERS - 1) - lo
      return span > 0 ? clamp((speed - lo) / span, 0, 1) : 0
    },

    // 'tier': full GRAVITY_K at the current level's slow speed, fading to the
    // GRAVITY_FLOOR at its fast speed - each section keeps its feel as the level
    // speeds up, and even the fast tier keeps a light pendulum pull (never a free
    // rotor). GRAVITY_CURVE shapes the fade (1 = linear; see config FLIGHT).
    // 'absolute': the same mapping referenced to the global SPEED.SLOW..FAST span.
    gravityForSpeed(speed: number): number {
      return gravityOf(this.level, speed)
    },

    tierSpeedOf: tierSpeed,
    gravityOf,
    cycleStartAt(distance: number): number {
      const next = distance >= this.gateAt
      return distance - (next ? cycleOffset(distance, nextOrigin, level + 1) : cycleOffset(distance, origin, level))
    },

    cycleEndAt(distance: number): number {
      if (this.mode !== 'sections') return Infinity
      const end = this.cycleStartAt(distance) + cycleLen(levelAt(distance))
      // a gate inside the cycle: its end is the end of the next level's cycle around the gate
      return distance < this.gateAt && end > this.gateAt ? this.cycleStartAt(this.gateAt) + cycleLen(level + 1) : end
    },

    tierIndexAt(distance: number): number {
      if (this.mode !== 'sections') return pinnedTier(this.mode)
      return tierAt(distance)
    },

    speedRatioAt(distance: number): number {
      if (this.mode !== 'sections') return 1
      // vs the UNTUNED base speed: SPAWN_SPACING values are calibrated at the
      // level-1 ORION speeds, so density normalization must reference those even
      // when a difficulty offset makes this mode's own level 1 faster.
      const tier = tierAt(distance)
      return tierSpeed(levelAt(distance), tier) / (BASE[tier] ?? SPEED.NORMAL)
    },

    gemQuota,

    tuned,

    ease: (): number => mode.ease,

    setDifficulty(index: number): void {
      mode = DIFFICULTY.MODES[Math.max(0, Math.min(DIFFICULTY.MODES.length - 1, index))] ?? mode
    },

    reset(): void {
      level = 0
      origin = 0
      curTargetSpeed = SPEED.NORMAL
      this.gateAt = Infinity
      this.level = 0
      this.scoreMultiplier = 1
    },

    cycle(): FlightMode {
      this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] ?? 'normal'
      if (this.mode !== 'sections') this.gateAt = Infinity
      return this.mode
    },
  }
  return flight
}

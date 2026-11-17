import { PHYSICS, SPEED, FLIGHT, LEVELS, DIFFICULTY, SEQUENCE, type FlightMode } from './config'
import { clamp } from './util/math'

// Runtime-switchable flight mode + the difficulty-by-level model. Speed is the
// single driver: the current tube section picks a target speed, gravity is tied
// to that speed (heavier when slow), and the level (one slow->normal->fast cycle)
// shifts every tier speed up and raises the score multiplier as you go deeper.
//
// A level occupies a stretch of tube whose length is the sum of its three section
// lengths, and each section length = its tier speed x SECTION_SECONDS, so every
// section is equal in TIME regardless of how fast the tiers get. Levels grow longer
// in distance as they speed up.
//
// GEM GATE (sections mode): a level does NOT advance on distance alone. At each
// cycle boundary it advances only if you have collected the level's gem quota
// (gemQuota, derived from the cycle length); fall short and the SAME level's cycle
// repeats - same speeds, same three tier colors, no LEVEL banner, no speed bump -
// until you qualify. So progression is gated on active collecting, not coasting,
// while forward motion never stops (more flying always means more gems). The state
// is therefore stateful, not a pure function of distance.
//
// Levels only progress in 'sections' mode (the game). Pinned slow/normal/fast
// (G-key, for feel testing) hold a single tier at level 1 with multiplier 1 and no gate.

export const TIERS = [0, 1, 2] as const // slow, normal, fast
const BASE = [SPEED.SLOW, SPEED.NORMAL, SPEED.FAST]
const ORDER: FlightMode[] = ['slow', 'normal', 'fast', 'sections'] // G-key cycle
export const N_TIERS = TIERS.length

// The tier a pinned mode holds (slow / normal / fast force one tier; 'sections' cycles them).
export const pinnedTier = (mode: FlightMode): number => (mode === 'slow' ? 0 : mode === 'fast' ? 2 : 1)

export interface Flight {
  mode: FlightMode
  level: number // current level, 0-based (display as level + 1); 0 in pinned modes
  scoreMultiplier: number // 1 + level * SCORE_MULT_STEP (1 in pinned modes)
  cycles: number // cycle boundaries crossed this run; cycles - level = level repeats (gem-gate misses)
  update(distance: number, gemsThisLevel: number): void // refresh gated level/section state once per frame
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
  gemQuota(level: number): number // gems needed to clear a level (known at the start of the level)
  // Pure lookups for a given level, independent of where the craft is: what
  // targetSpeed() returns in that level's tier, and what gravityForSpeed() returns
  // at that level for a speed. The gem-line director plans the tube ahead with them.
  tierSpeedOf(level: number, tier: number): number
  gravityOf(level: number, speed: number): number
  cycleStart(): number // distance where the current cycle began (the last boundary crossed)
  cycleEnd(): number // distance of the next cycle boundary (Infinity in pinned modes)
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
  // Applied INSIDE tierSpeed, so every derived quantity (cycle length, gem quota,
  // gravity span, speed cap, score multiplier) follows the mode automatically.
  let mode = DIFFICULTY.MODES[DIFFICULTY.DEFAULT]!
  const tuned = (level: number): number => Math.max(0, mode.offset + mode.slope * level)

  // tier speed at a level, and the distance length of one section / a full level.
  const tierSpeed = (level: number, tier: number): number => (BASE[tier] ?? SPEED.NORMAL) + speedBonus(tuned(level))
  const sectionLen = (level: number, tier: number): number => tierSpeed(level, tier) * secs
  const cycleLen = (level: number): number => {
    let s = 0
    for (let t = 0; t < N_TIERS; t++) s += sectionLen(level, t)
    return s
  }

  // Section tier (0/1/2) at an OFFSET into a given level.
  function sectionTierAt(offsetInLevel: number, level: number): number {
    let d = offsetInLevel
    for (let t = 0; t < N_TIERS; t++) {
      const len = sectionLen(level, t)
      if (d < len) return t
      d -= len
    }
    return N_TIERS - 1 // numeric guard (offset should always land above)
  }

  // Gems required to clear a level. Every cycle offers at least
  // SEQUENCE.GEMS_PER_CYCLE gems, so the quota is a fraction of that count, and the
  // fraction rises with the tuning level up to a cap (the mode may cap it lower).
  const gemQuota = (level: number): number => {
    const fraction = Math.min(LEVELS.QUOTA_FRACTION_MAX, mode.quotaMax, LEVELS.GEM_QUOTA_FRACTION + LEVELS.QUOTA_FRACTION_STEP * tuned(level))
    return Math.round(SEQUENCE.GEMS_PER_CYCLE * fraction)
  }

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

  // Gated progression state (sections mode). gatedLevel only advances when a cycle
  // ends with the gem quota met; levelStartDistance marks where the current cycle
  // began (it jumps forward one cycle on every boundary, advance or replay alike).
  let gatedLevel = 0
  let levelStartDistance = 0

  // Cached once per frame in update(), reused by the substeps + score/HUD reads.
  let curLevel = 0
  let curTargetSpeed = SPEED.NORMAL

  // Tier at a world distance within the CURRENT gated level, wrapping the cycle so
  // the tube ahead keeps cycling this level's colors (it never shows a not-yet-earned
  // level). Used by the *At() lookups for rings + spawns ahead of the craft.
  const tierAtGated = (distance: number): number => {
    const len = cycleLen(gatedLevel)
    if (len <= 0) return 0
    const off = (((distance - levelStartDistance) % len) + len) % len
    return sectionTierAt(off, gatedLevel)
  }

  const flight: Flight = {
    mode: FLIGHT.MODE,
    level: 0,
    scoreMultiplier: 1,
    cycles: 0,

    update(distance: number, gemsThisLevel: number): void {
      if (this.mode !== 'sections') {
        // pinned tier: fixed speed, no level progression, no gate
        curLevel = 0
        curTargetSpeed = tierSpeed(0, pinnedTier(this.mode))
        this.level = 0
        this.scoreMultiplier = 1
        return
      }
      // Cross any completed cycles (in practice <= 1 per frame). On each boundary the
      // cycle window moves forward; the level advances ONLY if the quota was met, else
      // it replays. After an advance the new level starts with no gems counted yet
      // (the session resets the live counter on the level-up edge), so `gems` drops to 0 here
      // to keep a same-frame second boundary from advancing twice on stale gems.
      let gems = gemsThisLevel
      let len = cycleLen(gatedLevel)
      while (len > 0 && distance - levelStartDistance >= len) {
        levelStartDistance += len
        this.cycles++
        if (gems >= gemQuota(gatedLevel)) {
          gatedLevel++
          gems = 0
        }
        // else: same level, cycle repeats; the live gem count carries over.
        len = cycleLen(gatedLevel)
      }
      curLevel = gatedLevel
      curTargetSpeed = tierSpeed(gatedLevel, sectionTierAt(distance - levelStartDistance, gatedLevel))
      this.level = gatedLevel
      this.scoreMultiplier = 1 + tuned(gatedLevel) * step
    },

    targetSpeed(): number {
      return curTargetSpeed
    },

    // The craft never needs to exceed the current level's fast-tier speed.
    speedMax(): number {
      return tierSpeed(curLevel, N_TIERS - 1)
    },

    speed01(speed: number): number {
      const lo = tierSpeed(curLevel, 0)
      const span = tierSpeed(curLevel, N_TIERS - 1) - lo
      return span > 0 ? clamp((speed - lo) / span, 0, 1) : 0
    },

    // 'tier': full GRAVITY_K at the current level's slow speed, fading to the
    // GRAVITY_FLOOR at its fast speed - each section keeps its feel as the level
    // speeds up, and even the fast tier keeps a light pendulum pull (never a free
    // rotor). GRAVITY_CURVE shapes the fade (1 = linear; see config FLIGHT).
    // 'absolute': the same mapping referenced to the global SPEED.SLOW..FAST span.
    gravityForSpeed(speed: number): number {
      return gravityOf(curLevel, speed)
    },

    tierSpeedOf: tierSpeed,
    gravityOf,
    cycleStart: (): number => levelStartDistance,
    cycleEnd(): number {
      return this.mode === 'sections' ? levelStartDistance + cycleLen(gatedLevel) : Infinity
    },

    tierIndexAt(distance: number): number {
      if (this.mode !== 'sections') return pinnedTier(this.mode)
      return tierAtGated(distance)
    },

    speedRatioAt(distance: number): number {
      if (this.mode !== 'sections') return 1
      const tier = tierAtGated(distance)
      // vs the UNTUNED base speed: SPAWN_SPACING values are calibrated at the
      // level-1 ORION speeds, so density normalization must reference those even
      // when a difficulty offset makes this mode's own level 1 faster.
      return tierSpeed(gatedLevel, tier) / (BASE[tier] ?? SPEED.NORMAL)
    },

    gemQuota,

    tuned,

    ease: (): number => mode.ease,

    setDifficulty(index: number): void {
      mode = DIFFICULTY.MODES[Math.max(0, Math.min(DIFFICULTY.MODES.length - 1, index))] ?? mode
    },

    reset(): void {
      gatedLevel = 0
      levelStartDistance = 0
      curLevel = 0
      curTargetSpeed = SPEED.NORMAL
      this.level = 0
      this.scoreMultiplier = 1
      this.cycles = 0
    },

    cycle(): FlightMode {
      this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] ?? 'normal'
      return this.mode
    },
  }
  return flight
}

import { PHYSICS, SPEED, FLIGHT, LEVELS, type FlightMode } from './config'
import { clamp } from './util/math'

// Runtime-switchable flight mode + the difficulty-by-level model. Speed is the
// single driver: the current tube section picks a target speed, gravity is tied
// to that speed (heavier when slow), and the level (one slow->normal->fast cycle)
// shifts every tier speed up and raises the score multiplier as you go deeper.
//
// Everything is DISTANCE-based (like the tube it colors): a level occupies a
// stretch of tube whose length is the sum of its three section lengths, and each
// section length = its tier speed x SECTION_SECONDS, so every section is equal in
// TIME (~10s) and a level is ~30s regardless of how fast the tiers get. Levels
// grow longer in distance as they speed up.
//
// Levels only progress in 'sections' mode (the game). Pinned slow/normal/fast
// (G-key, for feel testing) hold a single tier at level 1 with multiplier 1.

const TIERS = [0, 1, 2] as const // slow, normal, fast
const BASE = [SPEED.SLOW, SPEED.NORMAL, SPEED.FAST]
const ORDER: FlightMode[] = ['slow', 'normal', 'fast', 'sections'] // G-key cycle
const N_TIERS = TIERS.length

export interface Flight {
  mode: FlightMode
  level: number // current level, 0-based (display as level + 1); 0 in pinned modes
  scoreMultiplier: number // 1 + level * SCORE_MULT_STEP (1 in pinned modes)
  update(distance: number): void // refresh cached level/section state once per frame
  targetSpeed(): number // speed the craft eases toward (cached from update)
  speedMax(): number // upper clamp for craft speed at the current level
  gravityForSpeed(speed: number): number // pendulum strength for the current level
  tierIndexAt(distance: number): number // 0/1/2 at a world distance (tube coloring)
  levelAt(distance: number): number // level (0-based) at a world distance (field scaling)
  // Speed of the tier at a world distance, relative to that same tier at level 1.
  // Field spacing is in DISTANCE but encounter rate = speed / spacing, so density
  // levers must scale spacing by this to mean a time-rate ("twice as rare") rather
  // than drift with the rising per-level speed. 1 at level 1 and in pinned modes.
  speedRatioAt(distance: number): number
  cycle(): FlightMode // advance to the next mode (returns it), for live testing
}

export function createFlight(): Flight {
  const secs = FLIGHT.SECTION_SECONDS
  const inc = LEVELS.SPEED_INCREMENT
  const step = LEVELS.SCORE_MULT_STEP

  // tier speed at a level, and the distance length of one section / a full level.
  const tierSpeed = (level: number, tier: number): number => (BASE[tier] ?? SPEED.NORMAL) + level * inc
  const sectionLen = (level: number, tier: number): number => tierSpeed(level, tier) * secs
  const cycleLen = (level: number): number => {
    let s = 0
    for (let t = 0; t < N_TIERS; t++) s += sectionLen(level, t)
    return s
  }

  // Locate the level + its start distance containing a world distance. Levels get
  // longer as they speed up, so accumulate from 0 (a long run is a few dozen
  // levels; the guard only trips on a misconfig that makes cycleLen non-positive).
  function locate(distance: number): { level: number; start: number } {
    let level = 0
    let start = 0
    const d = distance > 0 ? distance : 0
    for (let guard = 0; guard < 100000; guard++) {
      const len = cycleLen(level)
      if (len <= 0 || d < start + len) break
      start += len
      level++
    }
    return { level, start }
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

  // Pinned-mode tier (slow/normal/fast force one tier; sections cycles them).
  const pinnedTier = (mode: FlightMode): number => (mode === 'slow' ? 0 : mode === 'fast' ? 2 : 1)

  // Cached once per frame in update(), reused by the substeps + score/HUD reads.
  let curLevel = 0
  let curTargetSpeed = SPEED.NORMAL

  const flight: Flight = {
    mode: FLIGHT.MODE,
    level: 0,
    scoreMultiplier: 1,

    update(distance: number): void {
      if (this.mode !== 'sections') {
        // pinned tier: fixed speed, no level progression
        curLevel = 0
        curTargetSpeed = tierSpeed(0, pinnedTier(this.mode))
        this.level = 0
        this.scoreMultiplier = 1
        return
      }
      const loc = locate(distance)
      curLevel = loc.level
      const tier = sectionTierAt(distance - loc.start, loc.level)
      curTargetSpeed = tierSpeed(loc.level, tier)
      this.level = loc.level
      this.scoreMultiplier = 1 + loc.level * step
    },

    targetSpeed(): number {
      return curTargetSpeed
    },

    // The craft never needs to exceed the current level's fast-tier speed; this
    // replaces the old fixed SPEED.FAST clamp so high levels can actually speed up.
    speedMax(): number {
      return tierSpeed(curLevel, N_TIERS - 1)
    },

    // 'tier': full GRAVITY_K at the current level's slow speed, fading to 0 at its
    // fast speed - each section keeps its feel as the level speeds up. 'absolute':
    // the original model referenced to the global SPEED.SLOW..FAST span.
    gravityForSpeed(speed: number): number {
      const lo = LEVELS.GRAVITY_MODE === 'absolute' ? SPEED.SLOW : tierSpeed(curLevel, 0)
      const hi = LEVELS.GRAVITY_MODE === 'absolute' ? SPEED.FAST : tierSpeed(curLevel, N_TIERS - 1)
      const span = hi - lo
      if (span <= 0) return 0
      return PHYSICS.GRAVITY_K * clamp((hi - speed) / span, 0, 1)
    },

    tierIndexAt(distance: number): number {
      if (this.mode !== 'sections') return pinnedTier(this.mode)
      const loc = locate(distance)
      return sectionTierAt(distance - loc.start, loc.level)
    },

    levelAt(distance: number): number {
      if (this.mode !== 'sections') return 0
      return locate(distance).level
    },

    speedRatioAt(distance: number): number {
      if (this.mode !== 'sections') return 1
      const loc = locate(distance)
      const tier = sectionTierAt(distance - loc.start, loc.level)
      return tierSpeed(loc.level, tier) / tierSpeed(0, tier) // tierSpeed(0,*) = base, always > 0
    },

    cycle(): FlightMode {
      this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] ?? 'normal'
      return this.mode
    },
  }
  return flight
}

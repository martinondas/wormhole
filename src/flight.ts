import { PHYSICS, SPEED, FLIGHT, LEVELS, TREASURE, type FlightMode } from './config'
import { clamp } from './util/math'

// Runtime-switchable flight mode + the difficulty-by-level model. Speed is the
// single driver: the current tube section picks a target speed, gravity is tied
// to that speed (heavier when slow), and the level (one slow->normal->fast cycle)
// shifts every tier speed up and raises the score multiplier as you go deeper.
//
// A level occupies a stretch of tube whose length is the sum of its three section
// lengths, and each section length = its tier speed x SECTION_SECONDS, so every
// section is equal in TIME (~10s) and a level is ~30s regardless of how fast the
// tiers get. Levels grow longer in distance as they speed up.
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

const TIERS = [0, 1, 2] as const // slow, normal, fast
const BASE = [SPEED.SLOW, SPEED.NORMAL, SPEED.FAST]
const ORDER: FlightMode[] = ['slow', 'normal', 'fast', 'sections'] // G-key cycle
const N_TIERS = TIERS.length

export interface Flight {
  mode: FlightMode
  level: number // current level, 0-based (display as level + 1); 0 in pinned modes
  scoreMultiplier: number // 1 + level * SCORE_MULT_STEP (1 in pinned modes)
  update(distance: number, gemsThisLevel: number): void // refresh gated level/section state once per frame
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
  gemQuota(level: number): number // gems needed to clear a level (derived; scales with cycle length)
  reset(): void // back to level 0 at distance 0 (game-over -> title)
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

  // Gems required to clear a level: a fraction of the gems that pass in one cycle.
  // Gems have no per-level density scaling, so nominal-per-cycle = cycleLen / spacing;
  // cycleLen grows as tiers speed up, so the quota rises on its own per level.
  const gemQuota = (level: number): number =>
    Math.round((cycleLen(level) / TREASURE.SPAWN_SPACING) * LEVELS.GEM_QUOTA_FRACTION)

  // Pinned-mode tier (slow/normal/fast force one tier; sections cycles them).
  const pinnedTier = (mode: FlightMode): number => (mode === 'slow' ? 0 : mode === 'fast' ? 2 : 1)

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
      // (main resets the live counter on the level-up edge), so `gems` drops to 0 here
      // to keep a same-frame second boundary from advancing twice on stale gems.
      let gems = gemsThisLevel
      let len = cycleLen(gatedLevel)
      while (len > 0 && distance - levelStartDistance >= len) {
        levelStartDistance += len
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
      this.scoreMultiplier = 1 + gatedLevel * step
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
      return tierAtGated(distance)
    },

    levelAt(_distance: number): number {
      if (this.mode !== 'sections') return 0
      return gatedLevel // gated: the tube ahead is the current level until you qualify
    },

    speedRatioAt(distance: number): number {
      if (this.mode !== 'sections') return 1
      const tier = tierAtGated(distance)
      return tierSpeed(gatedLevel, tier) / tierSpeed(0, tier) // tierSpeed(0,*) = base, always > 0
    },

    gemQuota,

    reset(): void {
      gatedLevel = 0
      levelStartDistance = 0
      curLevel = 0
      curTargetSpeed = SPEED.NORMAL
      this.level = 0
      this.scoreMultiplier = 1
    },

    cycle(): FlightMode {
      this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] ?? 'normal'
      return this.mode
    },
  }
  return flight
}

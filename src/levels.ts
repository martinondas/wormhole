import { LEVELS, HAZARD } from './config'
import { type Flight } from './flight'

// Per-level difficulty tuning derived from the level model: the enemy cap and the
// field spacing (density) multipliers. Kept out of main.ts (the wiring point) so
// the level -> tuning math sits in one focused place.
//
// Spacing is in DISTANCE but the field scrolls at craft speed, so encounter rate =
// speed / spacing. Multiplying by flight.speedRatioAt makes the multipliers mean a
// per-second rate vs level 1 (bombSpacingMult 0.75 = 33% denser per second) rather
// than drifting as the per-level speed rises. All lookups read the live level / tier
// at the spawn distance, so slots placed a level ahead still pack right.
export interface LevelTuning {
  enemyMax(level: number): number // max raiders alive at once for a level
  orbSpacingScale(worldDistance: number): number // orb spacing multiplier at a distance
  mineSpacingScale(worldDistance: number): number // mine spacing multiplier at a distance
}

// The TABLE row for a level (clamped to the last row beyond the table).
const levelRow = (level: number): (typeof LEVELS.TABLE)[number] =>
  LEVELS.TABLE[Math.min(level, LEVELS.TABLE.length - 1)] ?? LEVELS.TABLE[LEVELS.TABLE.length - 1]!

// Mine density multiplier (smaller = denser per second): the TABLE value, then a
// gentle procedural ramp past the table - it keeps tightening by BOMB_MULT_STEP per
// level down to BOMB_MULT_FLOOR, so deep levels get a few more mines but stay playable
// (mines are the secondary threat; enemies carry the unbounded difficulty).
const bombMult = (level: number): number => {
  const t = LEVELS.TABLE
  if (level < t.length) return t[level]!.bombSpacingMult
  const last = t[t.length - 1]!.bombSpacingMult
  const denser = (level - (t.length - 1)) * LEVELS.BOMB_MULT_STEP
  return Math.max(LEVELS.BOMB_MULT_FLOOR, last - denser)
}

export function createLevelTuning(flight: Flight): LevelTuning {
  return {
    // table value, then a procedural ramp (+1 every BEYOND_ENEMY_LEVELS) once past
    // the table, capped at MAX_ENEMIES_CAP.
    enemyMax(level: number): number {
      const t = LEVELS.TABLE
      if (level < t.length) return t[level]!.enemyMax
      const last = t[t.length - 1]!
      const extra = Math.floor((level - (t.length - 1)) / LEVELS.BEYOND_ENEMY_LEVELS)
      return Math.min(LEVELS.MAX_ENEMIES_CAP, last.enemyMax + extra)
    },
    orbSpacingScale: (wd: number): number =>
      levelRow(flight.levelAt(wd)).orbSpacingMult * flight.speedRatioAt(wd),
    // mines are denser still in slow (yellow) sections, scaled by 1 / SLOW_DENSITY.
    mineSpacingScale: (wd: number): number => {
      const slow = flight.tierIndexAt(wd) === 0 ? 1 / HAZARD.SLOW_DENSITY : 1
      return slow * bombMult(flight.levelAt(wd)) * flight.speedRatioAt(wd)
    },
  }
}

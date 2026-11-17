import { LEVELS, HAZARD, ENEMY } from './config'
import { type Flight } from './flight'

// Per-level difficulty tuning derived from the level model: the raider waves (roster,
// alive cap, hunters, aggression) and the field spacing (density) multipliers. Kept out of main.ts (the wiring point) so
// the level -> tuning math sits in one focused place.
//
// Spacing is in DISTANCE but the field scrolls at craft speed, so encounter rate =
// speed / spacing. Multiplying by flight.speedRatioAt makes the multipliers mean a
// per-second rate vs level 1 (bombSpacingMult 0.75 = 33% denser per second) rather
// than drifting as the per-level speed rises. All lookups read the live level / tier
// at the spawn distance, so slots placed a level ahead still pack right.
export interface LevelTuning {
  tuningLevel(level: number): number // the rounded tuning level T of a played level (for Enemies.setLevel)
  enemyMax(level: number): number // max raiders alive at once for a level (the wave's alive cap)
  orbSpacingScale(worldDistance: number): number // orb spacing multiplier at a distance
  mineSpacingScale(worldDistance: number): number // mine spacing multiplier at a distance
}

// --- raider waves by tuning level T (pure functions; world/enemies.ts reads them) ---
// The LEVELS.WAVES rows, then a formula past the table.
const waveRow = (T: number): (typeof LEVELS.WAVES)[number] | undefined => LEVELS.WAVES[Math.max(0, Math.floor(T))]
const lastWaveT = LEVELS.WAVES.length - 1

/** Raiders in one wave. */
export const waveRoster = (T: number): number => {
  const row = waveRow(T)
  if (row) return row.roster
  const grown = LEVELS.WAVES[lastWaveT]!.roster + Math.floor((T - lastWaveT) / LEVELS.WAVE_ROSTER_EVERY)
  return Math.min(LEVELS.WAVE_ROSTER_MAX, grown)
}
/** Raiders alive at once. */
export const waveAliveCap = (T: number): number =>
  T >= LEVELS.WAVE_CAP4_FROM ? LEVELS.MAX_ENEMIES_CAP : (waveRow(T) ?? LEVELS.WAVES[lastWaveT]!).cap
/** Members of the squad that hunt the player's line. */
export const waveHunters = (T: number): number =>
  T >= LEVELS.WAVE_HUNTERS2_FROM ? 2 : (waveRow(T) ?? LEVELS.WAVES[lastWaveT]!).hunters
/** 0..1: how hard the raiders press (fire cooldown, hunter slide, breather). */
export const aggression = (T: number): number =>
  Math.min(1, Math.max(0, (T - LEVELS.AGGRESSION_FROM) / LEVELS.AGGRESSION_SPAN))

/** 0..1: the second ramp, past the wave table (see config LEVELS.DEEP_FROM). */
export const deepPressure = (T: number): number =>
  Math.min(1, Math.max(0, (T - LEVELS.DEEP_FROM) / LEVELS.DEEP_SPAN))

/** Seconds between a raider's shots: slow for the first squads, FIRE_COOLDOWN at
 *  AGGRESSION_FROM, then down to FIRE_COOLDOWN_DEEP as the aggression rises. */
export const fireCooldown = (T: number): number => {
  const from = LEVELS.AGGRESSION_FROM
  if (T < from) return ENEMY.FIRE_COOLDOWN_EARLY + (ENEMY.FIRE_COOLDOWN - ENEMY.FIRE_COOLDOWN_EARLY) * (Math.max(0, T) / from)
  const base = ENEMY.FIRE_COOLDOWN + (ENEMY.FIRE_COOLDOWN_DEEP - ENEMY.FIRE_COOLDOWN) * aggression(T)
  return base * (1 + (ENEMY.DEEP_COOLDOWN_K - 1) * deepPressure(T))
}

// The TABLE row for a level (clamped to the last row beyond the table).
const levelRow = (level: number): (typeof LEVELS.TABLE)[number] =>
  LEVELS.TABLE[Math.min(level, LEVELS.TABLE.length - 1)] ?? LEVELS.TABLE[LEVELS.TABLE.length - 1]!

// Mine density multiplier (smaller = denser per second): the TABLE value, then a
// gentle procedural ramp past the table - it keeps tightening by BOMB_MULT_STEP per
// level down to BOMB_MULT_FLOOR, so deep levels get a few more mines but stay playable
// (mines are the secondary threat; enemies carry the unbounded difficulty).
export const bombMult = (level: number): number => {
  const t = LEVELS.TABLE
  if (level < t.length) return t[level]!.bombSpacingMult
  const last = t[t.length - 1]!.bombSpacingMult
  const denser = (level - (t.length - 1)) * LEVELS.BOMB_MULT_STEP
  return Math.max(LEVELS.BOMB_MULT_FLOOR, last - denser)
}

export function createLevelTuning(flight: Flight): LevelTuning {
  // All lookups run on the difficulty-mapped TUNING level (flight.tuned, see config
  // DIFFICULTY), rounded because the table and the ramps are integer-keyed. Callers
  // keep passing the PLAYED level; the mode's slope/offset is applied here.
  const tunedInt = (level: number): number => Math.round(flight.tuned(level))
  return {
    tuningLevel: tunedInt,
    enemyMax: (level: number): number => waveAliveCap(tunedInt(level)),
    orbSpacingScale: (wd: number): number =>
      levelRow(tunedInt(flight.levelAt(wd))).orbSpacingMult * flight.speedRatioAt(wd),
    // mines are denser still in slow (yellow) sections, scaled by 1 / SLOW_DENSITY.
    mineSpacingScale: (wd: number): number => {
      const slow = flight.tierIndexAt(wd) === 0 ? 1 / HAZARD.SLOW_DENSITY : 1
      return slow * bombMult(tunedInt(flight.levelAt(wd))) * flight.speedRatioAt(wd)
    },
  }
}

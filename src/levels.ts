import { LEVELS, ENEMY, EXTRA_LIFE, LIFE_SHARD } from './config'
import { type Flight } from './flight'
import { clamp } from './util/math'

// Per-level difficulty tuning derived from the level model: the raider waves (roster,
// alive cap, hunters, aggression, fire timing), the life rewards (shard set, squad
// cross) and the mine density multiplier. session.ts (the wiring point) and
// world/enemies.ts call these; the level model itself (speeds, gem quota) is flight.ts.
export interface LevelTuning {
  tuningLevel(level: number): number // the rounded tuning level T of a played level (for Enemies.setLevel)
  enemyMax(level: number): number // max raiders alive at once for a level (the wave's alive cap)
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
export const aggression = (T: number): number => clamp((T - LEVELS.AGGRESSION_FROM) / LEVELS.AGGRESSION_SPAN, 0, 1)

/** 0..1: the second ramp, past the wave table (see config LEVELS.DEEP_FROM). */
export const deepPressure = (T: number): number => clamp((T - LEVELS.DEEP_FROM) / LEVELS.DEEP_SPAN, 0, 1)

/** Seconds between a raider's shots: slow for the first squads, FIRE_COOLDOWN at
 *  AGGRESSION_FROM, then down to FIRE_COOLDOWN_DEEP as the aggression rises. */
export const fireCooldown = (T: number): number => {
  const from = LEVELS.AGGRESSION_FROM
  if (T < from) return ENEMY.FIRE_COOLDOWN_EARLY + (ENEMY.FIRE_COOLDOWN - ENEMY.FIRE_COOLDOWN_EARLY) * (Math.max(0, T) / from)
  const base = ENEMY.FIRE_COOLDOWN + (ENEMY.FIRE_COOLDOWN_DEEP - ENEMY.FIRE_COOLDOWN) * aggression(T)
  return base * (1 + (ENEMY.DEEP_COOLDOWN_K - 1) * deepPressure(T))
}

/** Least seconds between two charge starts: FIRE_STAGGER, shorter as the deep pressure rises. */
export const fireStagger = (T: number): number => ENEMY.FIRE_STAGGER * (1 + (ENEMY.DEEP_STAGGER_K - 1) * deepPressure(T))

/** Life shards that restore one life (config LIFE_SHARD). */
export const shardsPerLife = (T: number): number =>
  Math.min(LIFE_SHARD.PER_LIFE_MAX, Math.round(LIFE_SHARD.PER_LIFE + LIFE_SHARD.PER_LIFE_STEP * Math.max(0, T - LIFE_SHARD.PER_LIFE_HOLD)))

/** Every this many fully destroyed squads, the last raider leaves a whole-life cross (config EXTRA_LIFE). */
export const squadEvery = (T: number): number =>
  Math.min(EXTRA_LIFE.SQUAD_EVERY_MAX, Math.round(EXTRA_LIFE.SQUAD_EVERY + EXTRA_LIFE.SQUAD_EVERY_STEP * T))

// Mine density multiplier (smaller = denser per second): the TABLE value, then
// BOMB_MULT_STEP less per level past the table, down to BOMB_MULT_FLOOR (mines are
// the secondary threat; raiders carry the deep difficulty).
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
  }
}

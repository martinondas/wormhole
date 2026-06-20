import { PHYSICS, SPEED, FLIGHT, type FlightMode } from './config'
import { clamp } from './util/math'

// Runtime-switchable flight mode (experimental, for tuning feel). Speed is the
// single driver: the mode (or the current tube section) picks a target speed,
// and gravity is tied to that speed - full at SLOW, zero at FAST - so faster
// flight is lighter and more agile. Imports only config; main.ts asks it for a
// target speed + gravity each step and a speed factor for the tube color.
const TIERS: FlightMode[] = ['slow', 'normal', 'fast'] // 'sections' cycles these
const ORDER: FlightMode[] = ['slow', 'normal', 'fast', 'sections'] // G-key cycle

function tierSpeed(tier: FlightMode): number {
  if (tier === 'slow') return SPEED.SLOW
  if (tier === 'fast') return SPEED.FAST
  return SPEED.NORMAL
}

export interface Flight {
  mode: FlightMode
  targetSpeedAt(distance: number): number // speed the craft eases toward this step
  gravityForSpeed(speed: number): number // pendulum strength, tied to current speed
  tierIndexAt(distance: number): number // 0 slow / 1 normal / 2 fast at a world distance (tube color)
  cycle(): FlightMode // advance to the next mode (returns it), for live testing
}

export function createFlight(): Flight {
  const span = SPEED.FAST - SPEED.SLOW
  // 'sections' mode: each section lasts SECTION_SECONDS at ITS OWN tier speed, so
  // every section is equal in TIME. Its distance length therefore scales with its
  // speed (slow sections are short in distance, fast sections long), and one full
  // slow->normal->fast cycle spans cycleLen.
  const secs = FLIGHT.SECTION_SECONDS
  const lens = TIERS.map((t) => tierSpeed(t) * secs)
  const cycleLen = lens.reduce((a, b) => a + b, 0)

  // Which tier the cyclic section sequence is in at a world distance (0/1/2).
  function sectionTier(distance: number): number {
    let d = ((distance % cycleLen) + cycleLen) % cycleLen
    for (let i = 0; i < TIERS.length; i++) {
      const len = lens[i] ?? 0
      if (d < len) return i
      d -= len
    }
    return TIERS.length - 1 // numeric guard (d should always land above)
  }

  // The tier in force at a world distance: the section's tier in 'sections' mode,
  // otherwise the fixed mode's own tier. Index into TIERS (0 slow, 1 normal, 2 fast).
  function tierIndexFor(mode: FlightMode, distance: number): number {
    if (mode === 'sections') return sectionTier(distance)
    return mode === 'slow' ? 0 : mode === 'fast' ? 2 : 1
  }

  return {
    mode: FLIGHT.MODE,

    targetSpeedAt(distance: number): number {
      return tierSpeed(TIERS[tierIndexFor(this.mode, distance)] ?? 'normal')
    },

    // tie gravity to speed: full GRAVITY_K at SLOW, fading linearly to 0 at FAST
    gravityForSpeed(speed: number): number {
      return PHYSICS.GRAVITY_K * clamp((SPEED.FAST - speed) / span, 0, 1)
    },

    tierIndexAt(distance: number): number {
      return tierIndexFor(this.mode, distance)
    },

    cycle(): FlightMode {
      this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] ?? 'normal'
      return this.mode
    },
  }
}

import { GUN } from './config'
import { type CraftState } from './craft'
import { type Game } from './game'

// The forward gun's trigger logic: a cooldown + the energy spend. It decides
// WHEN a shot happens and at WHAT angle, but it does not own the projectile pool
// or the scene - main.ts takes the returned intent and spawns the bolt. Keeping
// it dependency-free (no import of projectiles/scene) leaves main.ts the single
// wiring point, mirroring how field onHit effects are injected there.
//
// Hold-or-tap both fall out of the cooldown: the trigger fires at most once per
// GUN.COOLDOWN while `fireHeld` is true. If energy is below GUN.COST the trigger
// is inert (no shot). A shot can spend your last energy down to exactly 0; firing
// never calls endRun itself, but game.update() then finalizes game-over on the
// next step the same way the drain clock does (the gun disarms you, it does not
// special-case death).
export interface FireIntent {
  fire: boolean
  theta: number // craft angle at fire time; the bolt rides down -Z at this theta
}

export interface Gun {
  tryFire(craft: CraftState, game: Game, dt: number, fireHeld: boolean): FireIntent
  reset(): void
}

export function createGun(): Gun {
  let cd = 0 // seconds until the next shot is allowed
  const intent: FireIntent = { fire: false, theta: 0 } // reused, not re-allocated per step

  return {
    tryFire(craft: CraftState, game: Game, dt: number, fireHeld: boolean): FireIntent {
      if (cd > 0) cd = Math.max(0, cd - dt)
      intent.theta = craft.theta
      intent.fire = false
      if (fireHeld && cd <= 0 && game.canFire()) {
        game.spendEnergy(GUN.COST)
        cd = GUN.COOLDOWN
        intent.fire = true
      }
      return intent
    },
    reset(): void {
      cd = 0
    },
  }
}

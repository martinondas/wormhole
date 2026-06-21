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
// GUN.COOLDOWN while `fireHeld` is true. With less than GUN.COST charge the gun
// cannot fire - the trigger instead reports `dry` (so main.ts plays a dull empty
// click), throttled on the same cooldown so a held key does not machine-gun the
// click. A shot can spend the last of the charge to exactly 0; that just disarms
// the gun, it is never a fail condition (see game.spendEnergy).
export interface FireIntent {
  fire: boolean
  dry: boolean // fire was requested but there was not enough charge (empty click)
  theta: number // craft angle at fire time; the bolt rides down -Z at this theta
}

export interface Gun {
  tryFire(craft: CraftState, game: Game, dt: number, fireHeld: boolean): FireIntent
  reset(): void
}

export function createGun(): Gun {
  let cd = 0 // seconds until the next shot is allowed
  const intent: FireIntent = { fire: false, dry: false, theta: 0 } // reused, not re-allocated per step

  return {
    tryFire(craft: CraftState, game: Game, dt: number, fireHeld: boolean): FireIntent {
      if (cd > 0) cd = Math.max(0, cd - dt)
      intent.theta = craft.theta
      intent.fire = false
      intent.dry = false
      if (fireHeld && cd <= 0) {
        if (game.canFire()) {
          game.spendEnergy(GUN.COST)
          intent.fire = true
        } else {
          intent.dry = true // not enough charge: report an empty click instead
        }
        cd = GUN.COOLDOWN // throttle both shots and empty clicks to the fire cadence
      }
      return intent
    },
    reset(): void {
      cd = 0
    },
  }
}

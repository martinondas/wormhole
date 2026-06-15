import { ENERGY, SCORE, LIVES, GUN } from './config'

// Run state. Two independent fail conditions:
//  - energy drains over time (refilled by orbs); hitting zero ends the run.
//  - lives are spent by hazard hits; hitting zero ends the run.
// Score grows with distance plus treasure bonuses. Best persists in localStorage.
const BEST_KEY = 'wormhole.best'

export interface Game {
  energy: number
  lives: number
  invuln: number // seconds of invulnerability remaining (0 = vulnerable)
  scoreBonus: number // points from treasures etc. (distance is added on top)
  over: boolean
  best: number
  score(distance: number): number
  addEnergy(n: number): void
  addScore(n: number): void
  canFire(): boolean // enough energy (and not over) to fire one shot
  spendEnergy(n: number): void // gun cost; clamps at 0 but NEVER ends the run (only update() does)
  hitHazard(): boolean // true if the hit landed (a life was lost); false if invulnerable / over
  update(dt: number, distance: number): void
  restart(): void
}

function loadBest(): number {
  try {
    return parseInt(localStorage.getItem(BEST_KEY) ?? '0', 10) || 0
  } catch {
    return 0
  }
}

function saveBest(n: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(n))
  } catch {
    /* storage unavailable (private mode) - ignore */
  }
}

export function createGame(): Game {
  function endRun(self: Game, distance: number): void {
    if (self.over) return
    self.over = true
    const final = self.score(distance)
    if (final > self.best) {
      self.best = final
      saveBest(final)
    }
  }

  return {
    energy: ENERGY.START,
    lives: LIVES.START,
    invuln: 0,
    scoreBonus: 0,
    over: false,
    best: loadBest(),

    score(distance: number): number {
      return Math.floor(distance * SCORE.DIST_RATE) + this.scoreBonus
    },

    addEnergy(n: number): void {
      this.energy = Math.min(ENERGY.MAX, this.energy + n)
    },

    addScore(n: number): void {
      this.scoreBonus += n
    },

    canFire(): boolean {
      return !this.over && this.energy >= GUN.COST
    },

    // Spend energy on a shot. Clamp at 0 but do NOT call endRun here: firing must
    // never be a fail condition. If a shot empties the meter, update() finalizes
    // game-over on the next step exactly like the drain clock does.
    spendEnergy(n: number): void {
      this.energy = Math.max(0, this.energy - n)
    },

    // Check invuln FIRST, before spending a life: if two mines overlap the ship
    // in the same fixed step, the first sets invuln and the second is a no-op,
    // so a single encounter can only ever cost one life.
    hitHazard(): boolean {
      if (this.over || this.invuln > 0) return false
      this.lives -= 1
      this.invuln = LIVES.INVULN_TIME
      // game-over is finalized in update() against the live distance; here we
      // just leave lives at <= 0 for update() to see on the next step.
      return true
    },

    update(dt: number, distance: number): void {
      if (this.over) return
      if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt)
      this.energy -= ENERGY.DRAIN * dt
      if (this.energy <= 0) {
        this.energy = 0
        endRun(this, distance)
        return
      }
      if (this.lives <= 0) endRun(this, distance)
    },

    restart(): void {
      this.energy = ENERGY.START
      this.lives = LIVES.START
      this.invuln = 0
      this.scoreBonus = 0
      this.over = false
    },
  }
}

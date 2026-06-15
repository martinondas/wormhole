import { ENERGY, SCORE } from './config'

// Run state: energy drains over time and is refilled by orbs; score grows with
// distance (treasures will add bonus later). Energy at zero ends the run; the
// best score persists in localStorage.
const BEST_KEY = 'wormhole.best'

export interface Game {
  energy: number
  scoreBonus: number // points from treasures etc. (distance is added on top)
  over: boolean
  best: number
  score(distance: number): number
  addEnergy(n: number): void
  addScore(n: number): void
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
  return {
    energy: ENERGY.START,
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

    update(dt: number, distance: number): void {
      if (this.over) return
      this.energy -= ENERGY.DRAIN * dt
      if (this.energy <= 0) {
        this.energy = 0
        this.over = true
        const final = this.score(distance)
        if (final > this.best) {
          this.best = final
          saveBest(final)
        }
      }
    },

    restart(): void {
      this.energy = ENERGY.START
      this.scoreBonus = 0
      this.over = false
    },
  }
}

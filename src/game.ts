import { ENERGY, LIVES, GUN } from './config'

// Run state. ONE fail condition: lives are spent by hazard / enemy / ram hits;
// hitting zero ends the run. Weapon charge (`energy`) is the gun's ammo - it is
// spent by firing and refilled by orbs / kills, but it NEVER ends the run (at
// zero the gun just goes inert). Score comes ONLY from active play - gems and
// kills, each scaled by the level multiplier; there is no passive distance
// baseline, so a pure dodger scores nothing. `elapsed` is the run timer (HUD +
// game-over) and the level reached captures how far you got. Best persists locally.
const BEST_KEY = 'wormhole.best'

export interface Game {
  energy: number // weapon charge (ammo); player-facing label is WEAPON
  lives: number
  invuln: number // seconds of invulnerability remaining (0 = vulnerable)
  scoreBonus: number // the run score: gem + kill points (each scaled by level at award time)
  gemsThisLevel: number // gems collected toward the current level's gate quota (reset on level-up)
  elapsed: number // seconds of active play this run (paused/over freeze it)
  started: boolean // false on the title screen; true once the first run begins (stays true)
  over: boolean
  best: number
  score(): number
  addEnergy(n: number): boolean // true if any charge was added (false if already full)
  addScore(n: number): void
  addGem(): void // count one collected gem toward the level gate (separate from its score)
  canFire(): boolean // enough charge (and not over) to fire one shot
  spendEnergy(n: number): void // gun cost; clamps at 0, never ends the run
  addLife(): boolean // extra-life pickup; true if a life was actually added (false at full lives / over)
  hitHazard(): boolean // true if the hit landed (a life was lost); false if invulnerable / over
  start(): void // leave the title screen and begin the first run
  update(dt: number): void
  toTitle(): void // reset the run and return to the title screen (game-over -> intro)
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
  function endRun(self: Game): void {
    if (self.over) return
    self.over = true
    const final = self.score()
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
    gemsThisLevel: 0,
    elapsed: 0,
    started: false,
    over: false,
    best: loadBest(),

    // The run score is just the accumulated gem + kill points (already level-scaled
    // at award time). No distance term: passive flying earns nothing.
    score(): number {
      return this.scoreBonus
    },

    // Refill weapon charge. Returns false (no-op) when already full, so the orb
    // field declines the pickup and lets a full-charge orb sail past untouched
    // (no pop / no sound) - the same not-consumed path as a grazed mine.
    addEnergy(n: number): boolean {
      if (this.energy >= ENERGY.MAX) return false
      this.energy = Math.min(ENERGY.MAX, this.energy + n)
      return true
    },

    addScore(n: number): void {
      this.scoreBonus += n
    },

    // Count a collected gem toward the current level's gate. main resets this to 0
    // on the level-up edge (when flight advances the level) and toTitle clears it.
    addGem(): void {
      this.gemsThisLevel += 1
    },

    canFire(): boolean {
      return !this.over && this.energy >= GUN.COST
    },

    // Spend weapon charge on a shot. Clamps at 0. Running the bar to empty just
    // disarms the gun (canFire() goes false) - it is never a fail condition, so
    // there is no endRun path here at all.
    spendEnergy(n: number): void {
      this.energy = Math.max(0, this.energy - n)
    },

    // Extra-life pickup: grant a life only when below the starting max (the cap =
    // 100% of lives). Returns true only if a life was actually added, so the field
    // consumes + pops the cross only then; at full lives it passes through.
    //
    // INTENTIONAL: not gated on `lives <= 0`. A fatal hazard hit drops lives to 0
    // but only latches `over` later in update(); the extra-life field runs after
    // the mine field in the same fixed step, so flying through a cross at the
    // instant a mine kills you revives the run (lives 0 -> 1) before update() sees
    // it. That lucky same-tick save is a deliberate gameplay choice, not a bug -
    // do NOT add a `lives <= 0` guard here.
    addLife(): boolean {
      if (this.over || this.lives >= LIVES.START) return false
      this.lives += 1
      return true
    },

    // Check invuln FIRST, before spending a life: if two mines overlap the ship
    // in the same fixed step, the first sets invuln and the second is a no-op,
    // so a single encounter can only ever cost one life.
    hitHazard(): boolean {
      if (this.over || this.invuln > 0) return false
      this.lives -= 1
      this.invuln = LIVES.INVULN_TIME
      // game-over is finalized in update(); here we just leave lives at <= 0 for
      // update() to see on the next step.
      return true
    },

    start(): void {
      this.started = true
    },

    // Called LAST in the fixed step, and only during active play (main.ts gates
    // the whole step on started/!paused/!over). Ticks i-frames + the run timer and
    // finalizes game-over the instant lives reach zero. Weapon charge is not
    // touched here - it changes only on a shot (spendEnergy) or a refill (addEnergy).
    update(dt: number): void {
      if (this.over) return
      if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt)
      this.elapsed += dt
      if (this.lives <= 0) endRun(this)
    },

    // Reset the run and return to the title screen. The next run begins from the
    // title on Space/Enter (beginRun), so a game-over leads back through the intro
    // + instructions rather than dropping straight into a fresh run.
    toTitle(): void {
      this.energy = ENERGY.START
      this.lives = LIVES.START
      this.invuln = 0
      this.scoreBonus = 0
      this.gemsThisLevel = 0
      this.elapsed = 0
      this.started = false
      this.over = false
    },
  }
}

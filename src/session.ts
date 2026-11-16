import { createField, biasedAngle, type Field } from './world/field'
import { type WallObject } from './world/wallObject'
import { createPickup } from './world/pickup'
import { createTreasure } from './world/treasure'
import { createHazard } from './world/hazard'
import { createExtraLife } from './world/extraLife'
import { createProjectiles, type Projectiles } from './world/projectiles'
import { createEnemies, type Enemies } from './world/enemies'
import { type InputState } from './input'
import { createCraft, updateCraft, resetCraft, type CraftState } from './craft'
import { createFlight, type Flight } from './flight'
import { createLevelTuning, type LevelTuning } from './levels'
import { createGame, type Game } from './game'
import { createGun, type Gun } from './gun'
import { SPEED, SHIP, PICKUP, TREASURE, HAZARD, EXTRA_LIFE, ENERGY, GUN, ENEMY } from './config'

// The gameplay session: every system that decides what happens in a run (craft,
// flight/levels, the four wall fields, gun, raiders, bolts, run state) wired
// together in ONE place, with the fixed-step order. It knows nothing about
// rendering, audio, the HUD, or the DOM - those are injected as SessionFx
// callbacks. main.ts (the browser game) and scripts/playtest.ts (headless bot
// playtests) both run this same module, so a playtest plays the real game.
//
// Call order for a caller:
//   begin()                      once, to start a run
//   preUpdate()                  once per rendered frame, before the substeps
//   step(input, dt)              once per fixed substep
//   reset()                      game-over -> title (fresh fields, level 1)
// The caller owns the gating (title screen, pause, game-over): it simply does not
// call preUpdate/step while the run is not live.

export type DamageCause = 'mine' | 'bolt' | 'ram'
export type FieldKind = 'orb' | 'gem' | 'mine' | 'life'

// Presentation + observation hooks. All optional; (theta, z) is where it happened
// (z is ship-relative). The browser plays sounds / flashes / bursts here; the
// playtest harness counts events.
export interface SessionFx {
  orbCollected?(): void
  gemCollected?(points: number): void
  lifeCollected?(): void
  damaged?(cause: DamageCause, theta: number, z: number): void // a life was lost
  hitBlocked?(cause: DamageCause): void // contact during i-frames: no life lost
  enemyFired?(theta: number, z: number): void
  enemyKilled?(theta: number, z: number): void
  playerFired?(theta: number): void
  playerBoltHit?(): void // a player bolt struck a raider (a chip or the kill)
  dryFired?(): void // trigger pulled with no charge
  tierUp?(): void // the flight tier stepped up (target speed increased)
  levelUp?(level: number): void // gem gate cleared; `level` is the new 0-based level
}

export interface Session {
  craft: CraftState
  flight: Flight
  game: Game
  levels: LevelTuning
  fields: Field[] // one per kind, in fieldKinds order
  fieldKinds: readonly FieldKind[]
  gun: Gun
  projectiles: Projectiles
  enemies: Enemies
  gravity(): number // pendulum gravity in effect this frame (set by preUpdate)
  begin(): void
  preUpdate(): void
  step(input: InputState, dt: number): void
  reset(): void
}

interface FieldConsts {
  COUNT: number
  SPAWN_START: number
  SPAWN_SPACING: number
  SPAWN_JITTER: number
  RECYCLE_BEHIND: number
  CAPTURE_Z: number
  CAPTURE_ANGLE: number
  POP_TIME: number
  POP_SCALE: number
}
interface FieldOpts {
  sampleTheta?: () => number
  spacingScaleAt?: (worldDistance: number) => number
  avoid?: (worldDistance: number, theta: number) => boolean
}
function makeField(
  create: () => WallObject,
  c: FieldConsts,
  onHit: (theta: number, z: number) => boolean,
  opts: FieldOpts = {},
): Field {
  return createField({
    create,
    onHit,
    ...opts,
    count: c.COUNT,
    spawnStart: c.SPAWN_START,
    spawnSpacing: c.SPAWN_SPACING,
    spawnJitter: c.SPAWN_JITTER,
    recycleBehind: c.RECYCLE_BEHIND,
    captureZ: c.CAPTURE_Z,
    captureAngle: c.CAPTURE_ANGLE,
    popTime: c.POP_TIME,
    popScale: c.POP_SCALE,
  })
}

export function createSession(fx: SessionFx = {}): Session {
  const craft = createCraft()
  const flight = createFlight()
  const game = createGame()
  // Per-level difficulty tuning (enemy cap + field density) lives in levels.ts.
  const levels = createLevelTuning(flight)

  // A hazard / ram / bolt contact: spend a life unless i-frames (or game-over)
  // block it, and report which. Returns whether a life was lost.
  const takeHit = (cause: DamageCause, theta: number, z: number): boolean => {
    const lost = game.hitHazard()
    if (lost) fx.damaged?.(cause, theta, z)
    else fx.hitBlocked?.(cause)
    return lost
  }

  // --- wall objects: orbs (weapon charge), gems (score), mines, extra life ----
  // All are pools of WallObjects on the tube wall, driven by one generic field;
  // only the onHit effect differs.
  //
  // Cross-field spawn de-confliction: every (re)spawn asks the OTHER fields whether
  // the spot is taken (see config SPAWN_CLEAR), so kinds cannot stack at nearly the
  // same (z, theta) - a mine hiding inside a gem read as a luck death in playtest.
  // nextAvoid() captures the index its field is about to occupy, so the fields must
  // be pushed ONE AT A TIME (a single multi-arg push would evaluate every closure at
  // length 0). While the array is still filling, each initial layout de-conflicts
  // against the kinds created before it; every later recycle checks all of them.
  // reset() re-lays the fields in the same order with the same rule (laidOut limits
  // the check to the kinds already re-laid), so a reset session is identical to a
  // freshly built one and a seeded run does not depend on the run before it.
  const fields: Field[] = []
  let laidOut = Infinity // fields below this index hold a current layout
  const nextAvoid = (): ((worldDistance: number, theta: number) => boolean) => {
    const self = fields.length
    return (worldDistance, theta) =>
      fields.some((f, i) => i !== self && i < laidOut && f.occupies(worldDistance, theta))
  }
  // orbs favor mid-wall (swing up for charge); gems anywhere; mines hug the bottom.
  fields.push(
    makeField(
      createPickup,
      PICKUP,
      () => {
        if (!game.addEnergy(ENERGY.PER_ORB)) return false // full charge: orb sails past, no pop/sound
        fx.orbCollected?.()
        return true
      },
      { sampleTheta: biasedAngle(PICKUP.SPAWN_ANGLE), spacingScaleAt: levels.orbSpacingScale, avoid: nextAvoid() },
    ),
  )
  // gems: the level multiplier scales the points at award time (frequency is constant).
  // addGem() also counts it toward the level gate (collect the quota to advance).
  fields.push(
    makeField(
      createTreasure,
      TREASURE,
      () => {
        const points = Math.round(TREASURE.SCORE * flight.scoreMultiplier)
        game.addScore(points)
        game.addGem()
        fx.gemCollected?.(points)
        return true
      },
      { avoid: nextAvoid() },
    ),
  )
  // mines: a life is lost only outside i-frames (hitHazard returns false then), so
  // an invuln graze is not consumed and stays silent. (theta, z) is the mine's own
  // position - the detonation blooms where the mine was.
  fields.push(
    makeField(createHazard, HAZARD, (theta, z) => takeHit('mine', theta, z), {
      sampleTheta: biasedAngle(HAZARD.SPAWN_ANGLE),
      spacingScaleAt: levels.mineSpacingScale,
      avoid: nextAvoid(),
    }),
  )
  // extra life: a rare bright-green cross. game.addLife() caps at LIVES.START, so
  // at full lives it returns false and the cross passes through (no pop / no sound).
  fields.push(
    makeField(
      createExtraLife,
      EXTRA_LIFE,
      () => {
        if (!game.addLife()) return false
        fx.lifeCollected?.()
        return true
      },
      { sampleTheta: biasedAngle(EXTRA_LIFE.SPAWN_ANGLE), avoid: nextAvoid() },
    ),
  )
  const fieldKinds: readonly FieldKind[] = ['orb', 'gem', 'mine', 'life']

  // --- combat: forward gun + pooled bolts + magenta raiders -------------------
  // projectiles is one shared pool (player + enemy bolts). enemies is a sibling of
  // the fields - NOT a Field, because raiders fly in / hold station / peel off (own
  // worldDistance). Both are dependency-injected here (the single wiring point), so
  // they import neither game nor each other: enemy fire, rams, kills, and bolt hits
  // all call back through these closures, exactly like field onHit effects do.
  const projectiles = createProjectiles()
  const gun = createGun()
  const enemies = createEnemies({
    spawnEnemyBolt: (theta, z, vz) => {
      fx.enemyFired?.(theta, z)
      projectiles.spawn('enemy', theta, z, vz)
    },
    // lethal hull contact (the raider survives); the hit lands on the ship
    onRam: () => takeHit('ram', craft.theta, SHIP.Z),
    onKill: (theta, z) => {
      game.addScore(Math.round(ENEMY.SCORE * flight.scoreMultiplier))
      game.addEnergy(ENEMY.ENERGY_REFUND) // charge refund is NOT score-multiplied
      fx.enemyKilled?.(theta, z)
    },
  })

  // Hoisted projectile-update context (mutated each step, not re-allocated) so the
  // fixed update does no per-frame allocation; the two callbacks are stable.
  const projCtx = {
    tryKillEnemy: (theta: number, z: number): boolean => {
      const struck = enemies.tryKill(theta, z)
      if (struck) fx.playerBoltHit?.()
      return struck
    },
    shipTheta: 0,
    onShipHit: (): boolean => takeHit('bolt', craft.theta, SHIP.Z),
  }

  let lastTargetSpeed = SPEED.NORMAL // detects flight-tier step-ups -> tierUp
  let lastFlightLevel = 0 // detects the gem-gated level-up edge -> reset the per-level gem counter
  // Flight inputs are stable within a frame, so preUpdate computes them once per
  // frame and the fixed substeps reuse these.
  let frameTargetSpeed = SPEED.NORMAL
  let frameGravity = flight.gravityForSpeed(SPEED.NORMAL)
  let frameSpeedMax = SPEED.FAST // upper speed clamp for the current level (grows with the level)

  return {
    craft,
    flight,
    game,
    levels,
    fields,
    fieldKinds,
    gun,
    projectiles,
    enemies,

    gravity: () => frameGravity,

    begin(): void {
      game.start()
      flight.update(craft.distance, game.gemsThisLevel)
      lastTargetSpeed = flight.targetSpeed() // no tierUp on the first step
      lastFlightLevel = flight.level // start tracking the gem-gate level edge from level 0
    },

    // Once per frame, before the fixed substeps: refresh the flight/level state,
    // then cache the target speed, speed-tied gravity, and level speed cap (all
    // stable across a frame, so they are not recomputed every substep). The enemy
    // cap follows the level here too (level changes slowly, once per frame is fine).
    preUpdate(): void {
      // flight gates the level-up on the gem quota, so it needs the live count; on a
      // level-up edge reset the counter so the next level starts its quota from zero.
      flight.update(craft.distance, game.gemsThisLevel)
      if (flight.level > lastFlightLevel) {
        game.gemsThisLevel = 0
        fx.levelUp?.(flight.level)
      }
      lastFlightLevel = flight.level
      frameTargetSpeed = flight.targetSpeed()
      if (frameTargetSpeed > lastTargetSpeed) fx.tierUp?.()
      lastTargetSpeed = frameTargetSpeed
      frameGravity = flight.gravityForSpeed(craft.speed)
      frameSpeedMax = flight.speedMax()
      enemies.setMaxActive(levels.enemyMax(flight.level))
    },

    step(input: InputState, dt: number): void {
      // targetSpeed + speed-tied gravity + the level's speed cap are computed once
      // per frame (preUpdate) and reused across this frame's substeps.
      updateCraft(craft, input, frameTargetSpeed, frameGravity, frameSpeedMax, dt)
      // collection / hits live in the fixed step so a fast pass never skips the
      // window; game.update runs LAST so a hazard / enemy hit this step ends the
      // run this step (lives <= 0 -> over), with no one-frame lag.
      for (const f of fields) f.update(craft, dt)
      // gun: spend charge + emit a forward bolt at the craft's current theta.
      const shot = gun.tryFire(craft, game, dt, input.fire)
      if (shot.fire) {
        projectiles.spawn('player', shot.theta, SHIP.Z, -GUN.BOLT_SPEED)
        fx.playerFired?.(shot.theta)
      } else if (shot.dry) {
        fx.dryFired?.() // trigger pulled with no charge (throttled in gun.ts)
      }
      // enemies move + fire + ram BEFORE projectiles, so a bolt fired/spawned this
      // step and a raider's new position are both resolved in projectiles.update.
      enemies.update(craft, dt)
      projCtx.shipTheta = craft.theta
      projectiles.update(dt, projCtx)
      game.update(dt)
    },

    // Game-over -> title: reset the run so the next one starts fresh.
    reset(): void {
      resetCraft(craft)
      // flight.reset() MUST run before the field reset: field layout() calls the
      // spacingScaleAt hooks, which read flight's stateful level / speed-ratio.
      // Reset flight first so the title-screen and next-run fields lay out at level-0
      // density, not the stale density of whatever level the run ended on.
      flight.reset() // back to level 0 at distance 0 so the HUD reads LEVEL 1
      lastFlightLevel = 0
      for (let i = 0; i < fields.length; i++) {
        laidOut = i
        fields[i]!.reset(craft.distance)
      }
      laidOut = Infinity
      projectiles.reset()
      gun.reset()
      enemies.reset(craft.distance)
      game.toTitle()
    },
  }
}

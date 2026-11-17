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
import { createLevelTuning, bombMult, type LevelTuning } from './levels'
import { createSequencer, type Sequencer, type PlacedPhrase } from './world/sequencer'
import { createGame, type Game } from './game'
import { createGun, type Gun } from './gun'
import { SPEED, SHIP, PICKUP, TREASURE, HAZARD, EXTRA_LIFE, LIFE_SHARD, SPAWN_CLEAR, ENERGY, GUN, ENEMY, FEEL, SEQUENCE } from './config'

// The gameplay session: every system that decides what happens in a run (craft,
// flight/levels, the wall fields, the gem-line director, gun, raiders, bolts, run state) wired
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
export type FieldKind = 'orb' | 'gem' | 'mine' | 'life' | 'shard'

// Presentation + observation hooks. All optional; (theta, z) is where it happened
// (z is ship-relative). The browser plays sounds / flashes / bursts here; the
// playtest harness counts events.
export interface SessionFx {
  orbCollected?(): void
  gemCollected?(points: number, chain: number): void // chain = consecutive gems without a miss, this one included
  gemMissed?(): void // a gem passed the ship uncollected; the chain is 0 after it
  quotaReached?(): void // the level's gem quota was just met (fires before that gem's gemCollected)
  lifeCollected?(): void // a life was restored (the last shard of a set, or an extra-life cross)
  shardDropped?(theta: number, z: number): void // a killed raider left a life shard on the wall
  shardCollected?(count: number, restored: boolean): void // count = shards of the current set, this one included (restored: the set is full)
  shardMissed?(): void // a life shard passed the ship uncaught
  bonusCollected?(big: boolean): void // a shard (big: a cross) caught at full lives paid score instead
  crossDropped?(theta: number, z: number): void // the last raider of a destroyed squad left a whole-life cross
  damaged?(cause: DamageCause, theta: number, z: number): void // a life was lost
  hitBlocked?(cause: DamageCause): void // contact during i-frames: no life lost
  enemyFired?(theta: number, z: number): void
  enemyKilled?(theta: number, z: number): void
  playerFired?(theta: number): void
  playerBoltHit?(): void // a player bolt struck a raider (a chip or the kill)
  dryFired?(): void // trigger pulled with no charge
  tierUp?(): void // the flight tier stepped up (target speed increased)
  tierDown?(): void // the flight tier stepped down (target speed decreased)
  // A cycle (slow -> normal -> fast) ended: advanced says whether the gem gate let
  // the level rise; gems / quota are the count and target of the cycle that ended.
  // Fires before levelUp.
  cycleEnded?(advanced: boolean, gems: number, quota: number): void
  levelUp?(level: number): void // gem gate cleared; `level` is the new 0-based level
  loopCompleted?(): void // the craft went over the top of the tube (either way)
  mineNearMiss?(theta: number): void // a mine passed just outside the hit cone while the ship was vulnerable
  enemyChargeStarted?(theta: number, z: number): void // a raider started its firing tell down `theta`
  enemyChipped?(theta: number, z: number): void // a player bolt hit a raider without killing it
  waveCleared?(): void // every raider of a wave was destroyed; a breather follows
  // Observation only (gem lines): the director placed a phrase on the tube ahead
  // (the object is reused - copy what you keep), and the craft is about to reach one.
  phrasePlaced?(p: PlacedPhrase): void
  phraseAhead?(id: string, tier: number): void
  sectionPlanned?(tier: number, mines: number, budget: number): void // a section's mines against its budget
  cyclePlanned?(cycle: number, gems: number): void // the gems one whole cycle offers
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
  sequencer: Sequencer | undefined // the gem-line director (undefined with SEQUENCE.ENABLED false)
  gravity(): number // pendulum gravity in effect this frame (set by preUpdate)
  begin(): void
  replan(): void // title screen only: lay the gem lines out again (the difficulty changed)
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
  growTime?: number
  count?: number
  feed?: boolean
  sampleTheta?: () => number
  spacingScaleAt?: (worldDistance: number) => number
  avoid?: (worldDistance: number, theta: number) => boolean
  onMiss?: () => void
  nearAngle?: number
  onNear?: (theta: number) => void
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
    count: c.COUNT,
    ...opts,
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

// Which trip around the tube the craft is on: 0 while it swings within half a turn
// of the bottom, +1 / -1 after one trip over the top either way.
const windingOf = (theta: number): number => Math.floor((theta + Math.PI) / (2 * Math.PI))

export function createSession(fx: SessionFx = {}): Session {
  const flight = createFlight()
  // the speed of the tier the run starts in (the first section at level 1)
  const startSpeed = (): number => {
    flight.update(0, 0)
    return flight.targetSpeed()
  }
  const craft = createCraft(startSpeed())
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
  // only the onHit effect differs. With gem lines (SEQUENCE.ENABLED) the gem and mine
  // fields are feed fields filled by the director below; orbs and the extra life are
  // always random fields, and with gem lines off the gems and mines are too.
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
  let gemChain = 0 // consecutive gems collected without a miss
  let lastNearT = -Infinity // game time of the last reported mine near miss
  let laidOut = Infinity // fields below this index hold a current layout
  const lines = SEQUENCE.ENABLED
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
        gemChain++
        if (flight.mode === 'sections' && game.gemsThisLevel === flight.gemQuota(flight.level)) fx.quotaReached?.()
        fx.gemCollected?.(points, gemChain)
        return true
      },
      {
        ...(lines ? { feed: true } : { count: TREASURE.RANDOM_COUNT, avoid: nextAvoid() }),
        onMiss: () => {
          gemChain = 0
          fx.gemMissed?.()
        },
      },
    ),
  )
  // mines: a life is lost only outside i-frames (hitHazard returns false then), so
  // an invuln graze is not consumed and stays silent. (theta, z) is the mine's own
  // position - the detonation blooms where the mine was.
  fields.push(
    makeField(createHazard, HAZARD, (theta, z) => takeHit('mine', theta, z), {
      ...(lines
        ? { feed: true }
        : {
            count: HAZARD.RANDOM_COUNT,
            sampleTheta: biasedAngle(HAZARD.SPAWN_ANGLE),
            spacingScaleAt: levels.mineSpacingScale,
            avoid: nextAvoid(),
          }),
      // a near miss counts only while the ship can be hurt, and at most one per
      // NEAR_THROTTLE so a dense stretch does not stack cues
      nearAngle: HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA,
      onNear: (theta) => {
        if (game.invuln > 0 || game.elapsed - lastNearT < FEEL.NEAR_THROTTLE) return
        lastNearT = game.elapsed
        fx.mineNearMiss?.(theta)
      },
    }),
  )
  // extra life: a bright-green cross worth a whole life. game.addLife() caps at
  // LIVES.START; at full lives the cross pays score instead. With EXTRA_LIFE.ENABLED
  // off it is a feed field filled by destroyed squads (dropShard below).
  fields.push(
    makeField(
      createExtraLife,
      EXTRA_LIFE,
      () => {
        if (game.over) return false
        game.addEnergy(EXTRA_LIFE.CHARGE)
        if (game.addLife()) fx.lifeCollected?.()
        else {
          game.addScore(Math.round(EXTRA_LIFE.FULL_SCORE * flight.scoreMultiplier))
          fx.bonusCollected?.(true)
        }
        return true
      },
      EXTRA_LIFE.ENABLED
        ? { count: EXTRA_LIFE.COUNT, sampleTheta: biasedAngle(EXTRA_LIFE.SPAWN_ANGLE), avoid: nextAvoid() }
        : { count: 2, feed: true, growTime: EXTRA_LIFE.GROW_TIME },
    ),
  )
  // life shards: a feed field filled by raider kills (dropShard below). A caught
  // shard counts toward the next missing life; at full lives game.addShard()
  // declines and the shard pays score instead, so it is always worth catching.
  fields.push(
    createField({
      create: () => createExtraLife(LIFE_SHARD.SCALE),
      feed: true,
      count: LIFE_SHARD.COUNT,
      spawnStart: 0,
      spawnSpacing: 0,
      spawnJitter: 0,
      recycleBehind: LIFE_SHARD.RECYCLE_BEHIND,
      captureZ: LIFE_SHARD.CAPTURE_Z,
      captureAngle: LIFE_SHARD.CAPTURE_ANGLE,
      popTime: LIFE_SHARD.POP_TIME,
      popScale: LIFE_SHARD.POP_SCALE,
      growTime: LIFE_SHARD.GROW_TIME,
      onHit: () => {
        if (game.over) return false
        game.addEnergy(LIFE_SHARD.CHARGE)
        const got = game.addShard()
        if (got === 0) {
          game.addScore(Math.round(LIFE_SHARD.FULL_SCORE * flight.scoreMultiplier))
          fx.bonusCollected?.(false)
          return true
        }
        fx.shardCollected?.(got === 2 ? game.shardsPerLife : game.shards, got === 2)
        if (got === 2) fx.lifeCollected?.()
        return true
      },
      onMiss: () => fx.shardMissed?.(),
    }),
  )
  const fieldKinds: readonly FieldKind[] = ['orb', 'gem', 'mine', 'life', 'shard']
  const [orbs, gems, mines, crosses, shards] = fields as [Field, Field, Field, Field, Field]

  // A raider killed at (theta, z) leaves a shard there, on
  // the line the player shot along. It is never closer than LEAD_SECONDS of flight
  // (a kill at close range or at high speed puts it farther down the same line), and
  // it steps forward off a mine. With the pool empty the kill drops nothing.
  let squadsCleared = 0 // fully destroyed squads since the last cross
  const squadEvery = (): number =>
    Math.min(EXTRA_LIFE.SQUAD_EVERY_MAX, Math.round(EXTRA_LIFE.SQUAD_EVERY + EXTRA_LIFE.SQUAD_EVERY_STEP * levels.tuningLevel(flight.level)))
  const dropShard = (theta: number, z: number, last: boolean): void => {
    if (game.over) return
    let wd = craft.distance + Math.max(-z, craft.speed * LIFE_SHARD.LEAD_SECONDS)
    for (let i = 0; i < SPAWN_CLEAR.TRIES && mines.occupies(wd, theta); i++) wd += SPAWN_CLEAR.NUDGE
    // the last raider of every Nth destroyed squad leaves a whole-life cross
    if (last && !EXTRA_LIFE.ENABLED && ++squadsCleared >= squadEvery() && crosses.spawn(wd, theta)) {
      squadsCleared = 0
      fx.crossDropped?.(theta, craft.distance - wd)
      return
    }
    if (shards.spawn(wd, theta)) fx.shardDropped?.(theta, craft.distance - wd)
  }

  // --- gem lines: the director feeds the gem and mine fields with phrases ------
  const sequencer = lines
    ? createSequencer({
        flight,
        bombMult,
        spawnGem: (wd, theta) => gems.spawn(wd, theta),
        spawnMine: (wd, theta) => mines.spawn(wd, theta),
        // a phrase never lands on a random find (an orb or an extra life)
        blocked: (wd, theta) => orbs.occupies(wd, theta) || crosses.occupies(wd, theta) || shards.occupies(wd, theta),
        rescaleItems: (boundary, ratio) => {
          gems.rescale(boundary, ratio)
          mines.rescale(boundary, ratio)
        },
        clearItems: () => {
          gems.reset(craft.distance)
          mines.reset(craft.distance)
        },
        onPhrase: (p) => fx.phrasePlaced?.(p),
        onPhraseAhead: (id, tier) => fx.phraseAhead?.(id, tier),
        onSection: (tier, n, budget) => fx.sectionPlanned?.(tier, n, budget),
        onCycle: (cycle, n) => fx.cyclePlanned?.(cycle, n),
      })
    : undefined
  sequencer?.reset() // the title screen shows a filled tube

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
    onKill: (theta, z, last) => {
      game.addScore(Math.round(ENEMY.SCORE * flight.scoreMultiplier))
      game.addEnergy(ENEMY.ENERGY_REFUND) // charge refund is NOT score-multiplied
      fx.enemyKilled?.(theta, z)
      dropShard(theta, z, last)
    },
    onChargeStart: (theta, z) => fx.enemyChargeStarted?.(theta, z),
    onChip: (theta, z) => fx.enemyChipped?.(theta, z),
    onWaveClear: () => fx.waveCleared?.(),
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
  let lastCycles = 0 // detects a cycle boundary -> cycleEnded
  let sinceBoundary = Infinity // seconds of play since the last cycle boundary
  let winding = 0 // floor((theta + PI) / 2PI): changes once per trip over the top
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
    sequencer,

    gravity: () => frameGravity,

    begin(): void {
      game.start()
      flight.update(craft.distance, game.gemsThisLevel)
      // the difficulty may have changed on the title screen since the reset
      if (craft.distance === 0) {
        craft.speed = flight.targetSpeed()
        if (sequencer?.stale()) sequencer.reset()
      }
      lastTargetSpeed = flight.targetSpeed() // no tierUp on the first step
      lastFlightLevel = flight.level // start tracking the gem-gate level edge from level 0
      lastCycles = flight.cycles
      sinceBoundary = Infinity
      winding = windingOf(craft.theta)
      gemChain = 0
      lastNearT = -Infinity
    },

    replan(): void {
      if (craft.distance === 0 && sequencer?.stale()) sequencer.reset()
    },

    // Once per frame, before the fixed substeps: refresh the flight/level state,
    // then cache the target speed, speed-tied gravity, and level speed cap (all
    // stable across a frame, so they are not recomputed every substep). The raider
    // waves follow the level here too (level changes slowly, once per frame is fine).
    preUpdate(): void {
      // flight gates the level-up on the gem quota, so it needs the live count; on a
      // level-up edge reset the counter so the next level starts its quota from zero.
      flight.update(craft.distance, game.gemsThisLevel)
      const advanced = flight.level > lastFlightLevel
      if (flight.cycles > lastCycles) {
        fx.cycleEnded?.(advanced, game.gemsThisLevel, flight.gemQuota(lastFlightLevel))
        lastCycles = flight.cycles
        sinceBoundary = 0
      }
      if (advanced) {
        game.gemsThisLevel = 0
        sequencer?.levelUp() // the tube beyond the boundary was planned for the old level's speeds
        fx.levelUp?.(flight.level)
      }
      sequencer?.update(craft.distance)
      lastFlightLevel = flight.level
      frameTargetSpeed = flight.targetSpeed()
      if (frameTargetSpeed > lastTargetSpeed) fx.tierUp?.()
      else if (frameTargetSpeed < lastTargetSpeed) fx.tierDown?.()
      lastTargetSpeed = frameTargetSpeed
      frameGravity = flight.gravityForSpeed(craft.speed)
      frameSpeedMax = flight.speedMax()
      // the shard set a life costs follows the tuning level (config LIFE_SHARD); a set
      // already started keeps its size, so the HUD bar never moves backward
      if (game.shards === 0) {
        game.shardsPerLife = Math.min(
          LIFE_SHARD.PER_LIFE_MAX,
          Math.round(LIFE_SHARD.PER_LIFE + LIFE_SHARD.PER_LIFE_STEP * Math.max(0, levels.tuningLevel(flight.level) - LIFE_SHARD.PER_LIFE_HOLD)),
        )
      }
      enemies.setMaxActive(levels.enemyMax(flight.level))
      enemies.setLevel(levels.tuningLevel(flight.level), flight.ease())
      // a busy phrase under the craft makes the raiders ease off
      enemies.setPressure(sequencer ? sequencer.pressureAt(craft.distance) : 0)
      // the raiders hold their fire across a cycle boundary (config ENEMY.BOUNDARY_HOLD)
      const toBoundary = (flight.cycleEnd() - craft.distance) / craft.speed
      enemies.setHoldFire(toBoundary < ENEMY.BOUNDARY_HOLD.BEFORE || sinceBoundary < ENEMY.BOUNDARY_HOLD.AFTER)
    },

    step(input: InputState, dt: number): void {
      // targetSpeed + speed-tied gravity + the level's speed cap are computed once
      // per frame (preUpdate) and reused across this frame's substeps.
      updateCraft(craft, input, frameTargetSpeed, frameGravity, frameSpeedMax, dt)
      sinceBoundary += dt
      const w = windingOf(craft.theta)
      if (w !== winding) {
        winding = w
        fx.loopCompleted?.()
      }
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
      squadsCleared = 0
      // flight.reset() MUST run before the field reset: field layout() calls the
      // spacingScaleAt hooks, which read flight's stateful level / speed-ratio.
      // Reset flight first so the title-screen and next-run fields lay out at level-0
      // density, not the stale density of whatever level the run ended on.
      flight.reset() // back to level 0 at distance 0 so the HUD reads LEVEL 1
      resetCraft(craft, startSpeed())
      lastFlightLevel = 0
      lastCycles = 0
      sinceBoundary = Infinity
      winding = 0
      gemChain = 0
      for (let i = 0; i < fields.length; i++) {
        laidOut = i
        fields[i]!.reset(craft.distance)
      }
      laidOut = Infinity
      sequencer?.reset() // after the random fields: a phrase keeps clear of orbs and the extra life
      projectiles.reset()
      gun.reset()
      enemies.reset(craft.distance)
      game.toTitle()
    },
  }
}

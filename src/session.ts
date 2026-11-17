import { createField, biasedAngle, type Field, type FieldConfig } from './world/field'
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
import { createLevelTuning, bombMult, shardsPerLife, squadEvery, type LevelTuning } from './levels'
import { createSequencer, type Sequencer, type PlacedPhrase } from './world/sequencer'
import { createGame, type Game } from './game'
import { createGun, type Gun } from './gun'
import { randRange } from './util/rng'
import { SPEED, SHIP, PICKUP, TREASURE, HAZARD, EXTRA_LIFE, LIFE_SHARD, SPAWN_CLEAR, ENERGY, GUN, ENEMY, FEEL } from './config'

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
  bonusCollected?(big: boolean): void // a shard (big: a cross) caught at full lives paid score instead
  // a whole-life cross appeared: left by the last raider of a destroyed squad, or (bonus) on its own
  crossDropped?(theta: number, z: number, bonus: boolean): void
  damaged?(cause: DamageCause, theta: number, z: number): void // a life was lost
  hitBlocked?(cause: DamageCause): void // contact during i-frames: no life lost
  enemyFired?(theta: number, z: number): void
  enemyKilled?(theta: number, z: number): void
  playerFired?(theta: number): void
  playerBoltHit?(): void // a player bolt struck a raider (a chip or the kill)
  dryFired?(): void // trigger pulled with no charge
  tierUp?(): void // the flight tier stepped up (target speed increased)
  // A cycle (slow -> normal -> fast) ended: advanced says whether the gem gate let
  // the level rise; gems / quota are the count and target of the cycle that ended.
  // Fires before levelUp.
  cycleEnded?(advanced: boolean, gems: number, quota: number): void
  levelUp?(level: number): void // gem gate cleared; `level` is the new 0-based level
  loopCompleted?(): void // the craft went over the top of the tube (either way)
  mineNearMiss?(theta: number): void // a mine passed just outside the hit cone while the ship was vulnerable
  enemyChargeStarted?(theta: number, z: number): void // a raider started its firing tell down `theta`
  enemyChipped?(theta: number, z: number): void // a player bolt hit a raider without killing it
  waveCleared?(): void // the last raider of a squad was destroyed and none got away
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
  fields: Field[] // one per kind, in fieldKinds order (the update order)
  fieldKinds: readonly FieldKind[]
  fieldByKind: Record<FieldKind, Field>
  gun: Gun
  projectiles: Projectiles
  enemies: Enemies
  sequencer: Sequencer // the gem-line director
  gravity(): number // pendulum gravity in effect this frame (set by preUpdate)
  begin(): void
  replan(): void // title screen only: lay the gem lines out again if the difficulty changed
  preUpdate(): void
  step(input: InputState, dt: number): void
  reset(): void
}

interface FieldConsts {
  COUNT: number
  // the layout of a random field; a feed field has none
  SPAWN_START?: number
  SPAWN_SPACING?: number
  SPAWN_JITTER?: number
  RECYCLE_BEHIND: number
  CAPTURE_Z: number
  CAPTURE_ANGLE: number
  POP_TIME: number
  POP_SCALE: number
}
type FieldOpts = Partial<
  Pick<FieldConfig, 'growTime' | 'count' | 'feed' | 'sampleTheta' | 'spacingScaleAt' | 'avoid' | 'onMiss' | 'nearAngle' | 'onNear'>
>
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
    spawnStart: c.SPAWN_START ?? 0,
    spawnSpacing: c.SPAWN_SPACING ?? 0,
    spawnJitter: c.SPAWN_JITTER ?? 0,
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
  // Per-level difficulty tuning (the raider waves, the life rewards) lives in levels.ts.
  const levels = createLevelTuning(flight)

  // A hazard / ram / bolt contact: spend a life unless i-frames (or game-over)
  // block it, and report which. Returns whether a life was lost.
  const takeHit = (cause: DamageCause, theta: number, z: number): boolean => {
    const lost = game.hitHazard()
    if (lost) fx.damaged?.(cause, theta, z)
    else fx.hitBlocked?.(cause)
    return lost
  }

  // --- wall objects: orbs (weapon charge), gems (score), mines, crosses, shards ----
  // Pools of WallObjects on the tube wall, driven by one generic field; only the
  // onHit effect differs. The orbs are a random field. The gem and mine fields are
  // feed fields filled by the director below, and the shard field by raider kills.
  //
  // A random (re)spawn avoids the OTHER fields' objects (see config SPAWN_CLEAR).
  // nextAvoid() captures the index its field is about to take in `fields`, so each
  // field is pushed right after it is created. The first layout and reset() lay the
  // fields out in this order, each against the kinds laid out before it (laidOut), so
  // a reset session is identical to a freshly built one.
  const fields: Field[] = []
  let gemChain = 0 // consecutive gems collected without a miss
  let lastNearT = -Infinity // game time of the last reported mine near miss
  let laidOut = Infinity // fields below this index hold a current layout
  const nextAvoid = (): ((worldDistance: number, theta: number) => boolean) => {
    const self = fields.length
    return (worldDistance, theta) =>
      fields.some((f, i) => i !== self && i < laidOut && f.occupies(worldDistance, theta))
  }
  // orbs favor mid-wall (swing up for charge). Their spacing follows the speed, so
  // the orbs per second stay the same at every level.
  const orbs = makeField(
    createPickup,
    PICKUP,
    () => {
      if (!game.addEnergy(ENERGY.PER_ORB)) return false // full charge: orb sails past, no pop/sound
      fx.orbCollected?.()
      return true
    },
    { sampleTheta: biasedAngle(PICKUP.SPAWN_ANGLE), spacingScaleAt: (wd) => flight.speedRatioAt(wd), avoid: nextAvoid() },
  )
  fields.push(orbs)
  // gems: the level multiplier scales the points at award time (frequency is constant).
  // addGem() also counts it toward the level gate (collect the quota to advance).
  const gems = makeField(
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
      feed: true,
      onMiss: () => {
        gemChain = 0
        fx.gemMissed?.()
      },
    },
  )
  fields.push(gems)
  // mines: a life is lost only outside i-frames (hitHazard returns false then), so
  // an invuln graze is not consumed and stays silent. (theta, z) is the mine's own
  // position - the detonation blooms where the mine was.
  const mines = makeField(createHazard, HAZARD, (theta, z) => takeHit('mine', theta, z), {
    feed: true,
    // a near miss counts only while the ship can be hurt, and at most one per
    // NEAR_THROTTLE so a dense stretch does not stack cues
    nearAngle: HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA,
    onNear: (theta) => {
      if (game.invuln > 0 || game.elapsed - lastNearT < FEEL.NEAR_THROTTLE) return
      lastNearT = game.elapsed
      fx.mineNearMiss?.(theta)
    },
  })
  fields.push(mines)
  // extra life: a bright-green cross worth a whole life. game.addLife() caps at
  // LIVES.START; at full lives the cross pays score instead. A feed field, filled by
  // destroyed squads (dropShard) and by the bonus cross (dropBonus).
  const crosses = makeField(
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
    { feed: true, growTime: EXTRA_LIFE.GROW_TIME },
  )
  fields.push(crosses)
  // life shards: a feed field filled by raider kills (dropShard below). A caught
  // shard counts toward the next missing life; at full lives game.addShard()
  // declines and the shard pays score instead, so it is always worth catching.
  const shards = makeField(
    () => createExtraLife(LIFE_SHARD.SCALE),
    LIFE_SHARD,
    () => {
      if (game.over) return false
      game.addEnergy(LIFE_SHARD.CHARGE)
      const got = game.addShard()
      if (got === 'declined') {
        game.addScore(Math.round(LIFE_SHARD.FULL_SCORE * flight.scoreMultiplier))
        fx.bonusCollected?.(false)
        return true
      }
      const restored = got === 'restored'
      fx.shardCollected?.(restored ? game.shardsPerLife : game.shards, restored)
      if (restored) fx.lifeCollected?.()
      return true
    },
    { feed: true, growTime: LIFE_SHARD.GROW_TIME },
  )
  fields.push(shards)
  const fieldKinds: readonly FieldKind[] = ['orb', 'gem', 'mine', 'life', 'shard']
  const fieldByKind: Record<FieldKind, Field> = { orb: orbs, gem: gems, mine: mines, life: crosses, shard: shards }

  // A raider killed at (theta, z) leaves a shard there, on
  // the line the player shot along. It is never closer than LEAD_SECONDS of flight
  // (a kill at close range or at high speed puts it farther down the same line), and
  // it steps forward off a mine. With the pool empty the kill drops nothing.
  let squadsCleared = 0 // fully destroyed squads since the last cross
  const dropShard = (theta: number, z: number, last: boolean): void => {
    if (game.over) return
    let wd = craft.distance + Math.max(-z, craft.speed * LIFE_SHARD.LEAD_SECONDS)
    for (let i = 0; i < SPAWN_CLEAR.TRIES && mines.occupies(wd, theta); i++) wd += SPAWN_CLEAR.NUDGE
    // the last raider of every Nth destroyed squad leaves a whole-life cross
    if (last && ++squadsCleared >= squadEvery(levels.tuningLevel(flight.level)) && crosses.spawn(wd, theta)) {
      squadsCleared = 0
      fx.crossDropped?.(theta, craft.distance - wd, false)
      return
    }
    if (shards.spawn(wd, theta)) fx.shardDropped?.(theta, craft.distance - wd)
  }

  // The bonus cross: now and then a whole-life cross appears on the wall on its own,
  // far enough ahead to be seen coming, clear of every other object. It is rare, so
  // it cannot replace fighting.
  const bonusAngle = biasedAngle(EXTRA_LIFE.SPAWN_ANGLE)
  const nextBonus = (): number => game.elapsed + randRange(EXTRA_LIFE.BONUS_EVERY[0], EXTRA_LIFE.BONUS_EVERY[1])
  let bonusAt = Infinity // run time of the next bonus cross
  const dropBonus = (): void => {
    bonusAt = nextBonus()
    // measured at the level's top speed, so a speed-up on the way never shortens the warning
    let wd = craft.distance + frameSpeedMax * EXTRA_LIFE.BONUS_LEAD_SECONDS
    let theta = bonusAngle()
    const taken = (): boolean => fields.some((f) => f.occupies(wd, theta))
    // another angle first, then farther down the tube, like any other spawn
    for (let i = 0; i < SPAWN_CLEAR.TRIES && taken(); i++) theta = bonusAngle()
    for (let i = 0; i < SPAWN_CLEAR.TRIES && taken(); i++) wd += SPAWN_CLEAR.NUDGE
    if (crosses.spawn(wd, theta)) fx.crossDropped?.(theta, craft.distance - wd, true)
  }

  // an orb, a cross or a shard sits there: a phrase item never shares its spot
  const pickupAt = (wd: number, theta: number): boolean =>
    orbs.occupies(wd, theta) || crosses.occupies(wd, theta) || shards.occupies(wd, theta)

  // --- gem lines: the director feeds the gem and mine fields with phrases ------
  const sequencer = createSequencer({
    flight,
    bombMult,
    spawnGem: (wd, theta) => gems.spawn(wd, theta),
    spawnMine: (wd, theta) => mines.spawn(wd, theta),
    // a phrase never lands on an orb, a cross or a shard
    blocked: pickupAt,
    rescaleItems: (boundary, ratio) => {
      gems.rescale(boundary, ratio)
      mines.rescale(boundary, ratio, pickupAt) // a moved mine must not land on a pickup
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
  sequencer.reset() // the title screen shows a filled tube

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
      if (last) fx.waveCleared?.()
      dropShard(theta, z, last)
    },
    onChargeStart: (theta, z) => fx.enemyChargeStarted?.(theta, z),
    onChip: (theta, z) => fx.enemyChipped?.(theta, z),
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

  // Title screen only: lay the tube out again when it was planned for another
  // difficulty. Orbs first, because a phrase keeps clear of them.
  const replan = (): void => {
    if (craft.distance !== 0 || !sequencer.stale()) return
    laidOut = 0 // the orbs keep clear of nothing: the old plan's gems and mines are about to go
    orbs.reset(craft.distance)
    laidOut = Infinity
    sequencer.reset()
  }

  return {
    craft,
    flight,
    game,
    levels,
    fields,
    fieldKinds,
    fieldByKind,
    gun,
    projectiles,
    enemies,
    sequencer,

    gravity: () => frameGravity,

    begin(): void {
      game.start()
      flight.update(craft.distance, game.gemsThisLevel)
      // the difficulty may have changed on the title screen since the reset
      if (craft.distance === 0) craft.speed = flight.targetSpeed()
      replan()
      lastTargetSpeed = flight.targetSpeed() // no tierUp on the first step
      lastFlightLevel = flight.level // start tracking the gem-gate level edge from level 0
      lastCycles = flight.cycles
      sinceBoundary = Infinity
      winding = windingOf(craft.theta)
      gemChain = 0
      lastNearT = -Infinity
      bonusAt = nextBonus()
    },

    replan,

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
        sequencer.levelUp() // the tube beyond the boundary was planned for the old level's speeds
        fx.levelUp?.(flight.level)
      }
      sequencer.update(craft.distance)
      lastFlightLevel = flight.level
      frameTargetSpeed = flight.targetSpeed()
      if (frameTargetSpeed > lastTargetSpeed) fx.tierUp?.()
      lastTargetSpeed = frameTargetSpeed
      frameGravity = flight.gravityForSpeed(craft.speed)
      frameSpeedMax = flight.speedMax()
      // the shard set a life costs follows the tuning level (config LIFE_SHARD); a set
      // already started keeps its size, so the HUD bar never moves backward
      if (game.shards === 0) game.shardsPerLife = shardsPerLife(levels.tuningLevel(flight.level))
      enemies.setMaxActive(levels.enemyMax(flight.level))
      enemies.setLevel(levels.tuningLevel(flight.level), flight.ease())
      // a busy phrase under the craft makes the raiders ease off
      enemies.setPressure(sequencer.pressureAt(craft.distance))
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
      if (!game.over && game.elapsed >= bonusAt) dropBonus()
    },

    // Game-over -> title: reset the run so the next one starts fresh.
    reset(): void {
      squadsCleared = 0
      bonusAt = Infinity
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
      sequencer.reset() // after the random fields: a phrase keeps clear of their objects
      projectiles.reset()
      gun.reset()
      enemies.reset(craft.distance)
      game.toTitle()
    },
  }
}

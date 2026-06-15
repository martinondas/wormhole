import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createStarfield } from './render/stars'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { createField, biasedAngle, type Field } from './world/field'
import { type WallObject } from './world/wallObject'
import { createPickup } from './world/pickup'
import { createTreasure } from './world/treasure'
import { createHazard } from './world/hazard'
import { createProjectiles } from './world/projectiles'
import { createEnemies } from './world/enemies'
import { Input } from './input'
import { createCraft, updateCraft, resetCraft } from './craft'
import { createGame } from './game'
import { createGun } from './gun'
import { createHud } from './hud'
import { startLoop } from './loop'
import { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BACKGROUND, ENERGY, LIVES, SCORE, GUN, ENEMY, PROJECTILE } from './config'

const container = document.getElementById('app')
if (!container) throw new Error('#app container not found')

const stage = createStage(container)

const stars = createStarfield()
stage.scene.add(stars.object)

const tube = createTube()
stage.scene.add(tube.object)

const ship = createShip()
stage.scene.add(ship.object)
stage.onResize((w, h) => ship.setResolution(w, h))

const rig = createCameraRig(stage.camera)
const input = new Input()
const craft = createCraft()
const game = createGame()
const hud = createHud()

// --- wall objects: orbs (energy), gems (score), mines (a hit costs a life) --
// All three are pools of WallObjects on the tube wall, driven by one generic
// field; only the onHit effect differs. The per-kind config blocks share these
// field-constant names, so one mapping builds all three.
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
function makeField(
  create: () => WallObject,
  c: FieldConsts,
  onHit: () => boolean,
  sampleTheta?: () => number,
): Field {
  return createField({
    create,
    onHit,
    sampleTheta,
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

const fields: Field[] = [
  // orbs favor mid-wall (swing up for energy); gems anywhere; mines hug the bottom.
  makeField(
    createPickup,
    PICKUP,
    () => {
      game.addEnergy(ENERGY.PER_ORB)
      return true
    },
    biasedAngle(PICKUP.SPAWN_ANGLE),
  ),
  makeField(createTreasure, TREASURE, () => {
    game.addScore(TREASURE.SCORE)
    return true
  }),
  makeField(createHazard, HAZARD, () => game.hitHazard(), biasedAngle(HAZARD.SPAWN_ANGLE)),
]
for (const f of fields) {
  stage.scene.add(f.object)
  stage.onResize((w, h) => f.setResolution(w, h))
}

// --- combat: forward gun + pooled bolts + magenta raiders -------------------
// projectiles is one shared pool (player + enemy bolts). enemies is a sibling of
// the fields - NOT a Field, because raiders fly in / hold station / peel off (own
// worldDistance). Both are dependency-injected here (the single wiring point), so
// they import neither game nor each other: enemy fire, rams, kills, and bolt hits
// all call back through these closures, exactly like field onHit effects do.
const projectiles = createProjectiles()
const gun = createGun()
const enemies = createEnemies({
  spawnEnemyBolt: (theta, z, vz) => projectiles.spawn('enemy', theta, z, vz),
  onRam: () => game.hitHazard(), // lethal hull contact (enemy survives)
  onKill: () => {
    game.addScore(ENEMY.SCORE)
    game.addEnergy(ENEMY.ENERGY_REFUND)
  },
})
for (const sys of [enemies, projectiles]) {
  stage.scene.add(sys.object)
  stage.onResize((w, h) => sys.setResolution(w, h))
}

// Hoisted projectile-update context (mutated each step, not re-allocated) so the
// fixed update does no per-frame allocation; the two callbacks are stable.
const projCtx = {
  tryKillEnemy: (theta: number, z: number): boolean => enemies.tryKill(theta, z),
  shipTheta: 0,
  onShipHit: (): boolean => game.hitHazard(),
}

function restart(): void {
  resetCraft(craft)
  for (const f of fields) f.reset(craft.distance)
  projectiles.reset()
  gun.reset()
  enemies.reset(craft.distance)
  game.restart()
  input.releaseFireKeys() // a Space held to restart must not auto-fire on step 1
}

// restart from the game-over screen
window.addEventListener('keydown', (e) => {
  if (game.over && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault()
    restart()
  }
})

const fixedDt = 1 / PHYSICS.HZ
const debug = { paused: false } // freeze physics (rendering continues) for poses

startLoop(
  fixedDt,
  (dt) => {
    if (debug.paused || game.over) return
    updateCraft(craft, input.state, dt)
    // collection / hits live in the fixed step so a fast pass never skips the
    // window; game.update runs LAST so a hazard / enemy hit this step ends the
    // run this step (lives <= 0 -> over), with no one-frame lag.
    for (const f of fields) f.update(craft, dt)
    // gun: spend energy + emit a forward bolt at the craft's current theta.
    const shot = gun.tryFire(craft, game, dt, input.state.fire)
    if (shot.fire) projectiles.spawn('player', shot.theta, SHIP.Z, -GUN.BOLT_SPEED)
    // enemies move + fire + ram BEFORE projectiles, so a bolt fired/spawned this
    // step and a raider's new position are both resolved in projectiles.update.
    enemies.update(craft, dt)
    projCtx.shipTheta = craft.theta
    projectiles.update(dt, projCtx)
    game.update(dt, craft.distance)
  },
  (frameDt) => {
    ship.update(craft)
    // i-frame flicker: blink the ship while invulnerable so a hit reads clearly
    // (and so losing a life never feels random). Always visible once the run is
    // over or invulnerability has lapsed.
    ship.object.visible = game.over || game.invuln <= 0 || Math.floor(game.invuln * 12) % 2 === 0
    rig.update(craft, frameDt)
    stars.update(stage.camera)
    tube.update(craft.distance)
    stage.render()
    hud.update({
      score: game.score(craft.distance),
      distance: craft.distance,
      speed: craft.speed,
      energy01: game.energy / ENERGY.MAX,
      lives: game.lives,
      over: game.over,
      best: game.best,
    })
  },
)

// Live tuning handle: tweak constants from the console, e.g.
//   WH.config.PHYSICS.STEER_TORQUE = 22
//   WH.craft.theta            // inspect current state
//   WH.game.lives             // inspect run state
//   WH.fields[1].object       // the treasure field's group
;(window as unknown as { WH: unknown }).WH = {
  craft,
  debug,
  fields,
  enemies,
  projectiles,
  gun,
  game,
  config: { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BACKGROUND, ENERGY, LIVES, SCORE, GUN, ENEMY, PROJECTILE },
}

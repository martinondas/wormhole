import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createStarfield } from './render/stars'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { createField, type Field } from './world/field'
import { type WallObject } from './world/wallObject'
import { createPickup } from './world/pickup'
import { createTreasure } from './world/treasure'
import { createHazard } from './world/hazard'
import { Input } from './input'
import { createCraft, updateCraft, resetCraft } from './craft'
import { createGame } from './game'
import { createHud } from './hud'
import { startLoop } from './loop'
import { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BACKGROUND, ENERGY, LIVES, SCORE } from './config'

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
function makeField(create: () => WallObject, c: FieldConsts, onHit: () => boolean): Field {
  return createField({
    create,
    onHit,
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
  makeField(createPickup, PICKUP, () => {
    game.addEnergy(ENERGY.PER_ORB)
    return true
  }),
  makeField(createTreasure, TREASURE, () => {
    game.addScore(TREASURE.SCORE)
    return true
  }),
  makeField(createHazard, HAZARD, () => game.hitHazard()),
]
for (const f of fields) {
  stage.scene.add(f.object)
  stage.onResize((w, h) => f.setResolution(w, h))
}

function restart(): void {
  resetCraft(craft)
  for (const f of fields) f.reset(craft.distance)
  game.restart()
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
    // window; game.update runs LAST so a hazard hit this step ends the run this
    // step (lives <= 0 -> over), with no one-frame lag.
    for (const f of fields) f.update(craft, dt)
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
  game,
  config: { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BACKGROUND, ENERGY, LIVES, SCORE },
}

import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createStarfield } from './render/stars'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { createPickups } from './world/pickups'
import { Input } from './input'
import { createCraft, updateCraft, resetCraft } from './craft'
import { createGame } from './game'
import { createHud } from './hud'
import { startLoop } from './loop'
import { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, BACKGROUND, ENERGY, SCORE } from './config'

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

const pickups = createPickups(() => game.addEnergy(ENERGY.PER_ORB))
stage.scene.add(pickups.object)
stage.onResize((w, h) => pickups.setResolution(w, h))

function restart(): void {
  resetCraft(craft)
  pickups.reset(craft.distance)
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
    // collection lives in the fixed step so a fast pass never skips the window
    pickups.update(craft, dt)
    game.update(dt, craft.distance)
  },
  (frameDt) => {
    ship.update(craft)
    rig.update(craft, frameDt)
    stars.update(stage.camera)
    tube.update(craft.distance)
    stage.render()
    hud.update({
      score: game.score(craft.distance),
      distance: craft.distance,
      speed: craft.speed,
      energy01: game.energy / ENERGY.MAX,
      over: game.over,
      best: game.best,
    })
  },
)

// Live tuning handle: tweak constants from the console, e.g.
//   WH.config.PHYSICS.STEER_TORQUE = 22
//   WH.craft.theta   // inspect current state
;(window as unknown as { WH: unknown }).WH = {
  craft,
  debug,
  pickups,
  game,
  config: { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, BACKGROUND, ENERGY, SCORE },
}

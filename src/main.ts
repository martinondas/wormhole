import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createStarfield } from './render/stars'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { createPickups } from './world/pickups'
import { Input } from './input'
import { createCraft, updateCraft } from './craft'
import { startLoop } from './loop'
import { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, BACKGROUND } from './config'

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

const pickups = createPickups()
stage.scene.add(pickups.object)
stage.onResize((w, h) => pickups.setResolution(w, h))

const fixedDt = 1 / PHYSICS.HZ
const debug = { paused: false } // freeze physics (rendering continues) for poses

startLoop(
  fixedDt,
  (dt) => {
    if (debug.paused) return
    updateCraft(craft, input.state, dt)
    // collection lives in the fixed step so a fast pass never skips the window
    pickups.update(craft, dt)
  },
  (frameDt) => {
    ship.update(craft)
    rig.update(craft, frameDt)
    stars.update(stage.camera)
    tube.update(craft.distance)
    stage.render()
  },
)

// Live tuning handle: tweak constants from the console, e.g.
//   WH.config.PHYSICS.STEER_TORQUE = 22
//   WH.craft.theta   // inspect current state
;(window as unknown as { WH: unknown }).WH = {
  craft,
  debug,
  pickups,
  config: { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, BACKGROUND },
}

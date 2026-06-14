import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { Input } from './input'
import { createCraft, updateCraft } from './craft'
import { startLoop } from './loop'
import { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER } from './config'

const container = document.getElementById('app')
if (!container) throw new Error('#app container not found')

const stage = createStage(container)

const tube = createTube()
stage.scene.add(tube.object)

const ship = createShip()
stage.scene.add(ship.object)
stage.onResize((w, h) => ship.setResolution(w, h))

const rig = createCameraRig(stage.camera)
const input = new Input()
const craft = createCraft()

const fixedDt = 1 / PHYSICS.HZ

startLoop(
  fixedDt,
  (dt) => updateCraft(craft, input.state, dt),
  (frameDt) => {
    ship.update(craft)
    rig.update(craft, frameDt)
    tube.update(craft.distance)
    stage.render()
  },
)

// Live tuning handle: tweak constants from the console, e.g.
//   WH.config.PHYSICS.STEER_TORQUE = 22
//   WH.craft.theta   // inspect current state
;(window as unknown as { WH: unknown }).WH = {
  craft,
  config: { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER },
}

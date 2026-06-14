import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createStarfield } from './render/stars'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { createPickup } from './world/pickup'
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

// TEMP (M2 slice 1): static orbs to tune the pickup look; replaced by a spawner.
const testPickups = [
  createPickup(),
  createPickup(),
  createPickup(),
]
const testPositions: [number, number, number][] = [
  [-2.6, -1.2, -4],
  [3.0, -2.6, -9],
  [0.0, 3.0, -16],
]
testPickups.forEach((p, i) => {
  const pos = testPositions[i]!
  p.object.position.set(pos[0], pos[1], pos[2])
  stage.scene.add(p.object)
  stage.onResize((w, h) => p.setResolution(w, h))
})

const fixedDt = 1 / PHYSICS.HZ
const debug = { paused: false } // freeze physics (rendering continues) for poses

startLoop(
  fixedDt,
  (dt) => {
    if (!debug.paused) updateCraft(craft, input.state, dt)
  },
  (frameDt) => {
    ship.update(craft)
    rig.update(craft, frameDt)
    stars.update(stage.camera)
    tube.update(craft.distance)
    for (const p of testPickups) p.update(frameDt)
    stage.render()
  },
)

// Live tuning handle: tweak constants from the console, e.g.
//   WH.config.PHYSICS.STEER_TORQUE = 22
//   WH.craft.theta   // inspect current state
;(window as unknown as { WH: unknown }).WH = {
  craft,
  debug,
  config: { PHYSICS, SPEED, CAMERA, TUBE, SHIP, RENDER, PICKUP, BACKGROUND },
}

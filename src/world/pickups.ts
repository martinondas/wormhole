import { Group } from 'three'
import { createPickup, type Pickup } from './pickup'
import { PICKUP, TUBE, SHIP } from '../config'
import { type CraftState } from '../craft'

// Manages a pool of orbs fixed to the tube wall at increasing distances. Forward
// motion scrolls them toward the ship; once one passes behind (or is collected)
// it is recycled to the far end with a fresh angle. A catch fires when the ship's
// angle lines up with an orb's as it reaches the ship plane.
export interface Pickups {
  object: Group
  update(craft: CraftState, dt: number): void
  setResolution(w: number, h: number): void
  reset(craftDistance: number): void
  readonly count: number
}

interface Slot {
  pickup: Pickup
  theta: number // angle around the tube
  worldDistance: number // absolute distance along the tube where it sits
  collected: boolean
  popT: number // 0..1 collect-pop progress
}

// smallest signed difference between two angles
function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

export function createPickups(onCollect?: () => void): Pickups {
  const group = new Group()
  const radius = TUBE.RADIUS - SHIP.RADIAL_OFFSET // orbs ride where the ship rides
  const slots: Slot[] = []
  let collected = 0
  let farthest = PICKUP.SPAWN_START

  const randTheta = (): number => Math.random() * Math.PI * 2

  for (let i = 0; i < PICKUP.COUNT; i++) {
    const pickup = createPickup()
    group.add(pickup.object)
    const worldDistance = PICKUP.SPAWN_START + i * PICKUP.SPAWN_SPACING + Math.random() * PICKUP.SPAWN_JITTER
    farthest = Math.max(farthest, worldDistance)
    slots.push({ pickup, theta: randTheta(), worldDistance, collected: false, popT: 0 })
  }

  function recycle(slot: Slot): void {
    farthest += PICKUP.SPAWN_SPACING
    slot.worldDistance = farthest + Math.random() * PICKUP.SPAWN_JITTER
    slot.theta = randTheta()
    slot.collected = false
    slot.popT = 0
    slot.pickup.object.scale.setScalar(1)
    slot.pickup.setOpacity(1)
  }

  return {
    object: group,
    update(craft: CraftState, dt: number): void {
      for (const slot of slots) {
        const z = craft.distance - slot.worldDistance // ship plane is z = 0; +z is behind
        if (z > PICKUP.RECYCLE_BEHIND) recycle(slot)

        const obj = slot.pickup.object
        obj.position.set(Math.sin(slot.theta) * radius, -Math.cos(slot.theta) * radius, craft.distance - slot.worldDistance)
        slot.pickup.update(dt)

        if (slot.collected) {
          slot.popT += dt / PICKUP.POP_TIME
          const t = Math.min(slot.popT, 1)
          obj.scale.setScalar(1 + t * 0.8)
          slot.pickup.setOpacity(1 - t)
          if (t >= 1) recycle(slot)
          continue
        }

        // catch: at the ship plane and aligned in angle
        if (Math.abs(z) < PICKUP.CAPTURE_Z && Math.abs(angleDiff(craft.theta, slot.theta)) < PICKUP.CAPTURE_ANGLE) {
          slot.collected = true
          slot.popT = 0
          collected += 1
          onCollect?.()
        }
      }
    },
    setResolution(w: number, h: number): void {
      for (const slot of slots) slot.pickup.setResolution(w, h)
    },
    reset(craftDistance: number): void {
      collected = 0
      farthest = craftDistance + PICKUP.SPAWN_START
      slots.forEach((slot, i) => {
        slot.worldDistance =
          craftDistance + PICKUP.SPAWN_START + i * PICKUP.SPAWN_SPACING + Math.random() * PICKUP.SPAWN_JITTER
        farthest = Math.max(farthest, slot.worldDistance)
        slot.theta = randTheta()
        slot.collected = false
        slot.popT = 0
        slot.pickup.object.scale.setScalar(1)
        slot.pickup.setOpacity(1)
      })
    },
    get count(): number {
      return collected
    },
  }
}

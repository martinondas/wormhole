import { Group } from 'three'
import { RIDE_RADIUS } from '../config'
import { type CraftState } from '../craft'
import { type WallObject } from './wallObject'

// A generic "wall field": a pool of WallObjects fixed to the tube wall at
// increasing distances. Forward motion scrolls them toward the ship; once one
// passes behind (or is consumed) it recycles to the far end with a fresh angle.
// A hit fires when the ship's angle lines up with an object's as it reaches the
// ship plane. Parameterized per kind (orb -> energy, gem -> score, mine ->
// damage); the only behavioral difference is the onHit callback.
//
// onHit() returns whether the object was CONSUMED:
//   true  -> collected / a real hit: play the pop (expand + fade), then recycle.
//   false -> e.g. a mine touched while invulnerable: leave it; it scrolls past
//            and recycles behind. `triggered` prevents it re-firing meanwhile.
export interface FieldConfig {
  create: () => WallObject
  count: number
  spawnStart: number
  spawnSpacing: number
  spawnJitter: number
  recycleBehind: number
  captureZ: number
  captureAngle: number
  popTime: number
  popScale?: number // peak scale of the expand-and-fade pop (default 1.8)
  onHit: () => boolean
}

export interface Field {
  object: Group
  update(craft: CraftState, dt: number): void
  setResolution(w: number, h: number): void
  reset(craftDistance: number): void
  readonly consumed: number // items consumed this run (debug / feel only)
}

type SlotState = 'idle' | 'popping'
interface Slot {
  obj: WallObject
  theta: number // angle around the tube (0 = bottom)
  worldDistance: number // absolute distance along the tube where it sits
  triggered: boolean // armed once per encounter; cleared only on recycle/reset
  state: SlotState
  popT: number // 0..1 pop progress
}

// smallest signed difference between two angles
function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

export function createField(cfg: FieldConfig): Field {
  const group = new Group()
  // All wall objects sit exactly where the ship rides (RIDE_RADIUS), so the
  // angle-only hit test (compare craft.theta to slot.theta) is valid.
  const radius = RIDE_RADIUS
  const popScale = cfg.popScale ?? 1.8
  const slots: Slot[] = []
  let consumed = 0
  let farthest = cfg.spawnStart

  const randTheta = (): number => Math.random() * Math.PI * 2

  // Place a slot at a distance and re-arm it: clears triggered + state + the
  // pop transform. Both initial spawn and recycle/reset funnel through here, so
  // `triggered` can never be left stuck on across a recycle or a restart.
  function arm(slot: Slot, worldDistance: number): void {
    slot.worldDistance = worldDistance
    slot.theta = randTheta()
    slot.triggered = false
    slot.state = 'idle'
    slot.popT = 0
    slot.obj.object.scale.setScalar(1)
    slot.obj.setOpacity(1)
  }

  for (let i = 0; i < cfg.count; i++) {
    const obj = cfg.create()
    group.add(obj.object)
    const slot: Slot = { obj, theta: 0, worldDistance: 0, triggered: false, state: 'idle', popT: 0 }
    const wd = cfg.spawnStart + i * cfg.spawnSpacing + Math.random() * cfg.spawnJitter
    farthest = Math.max(farthest, wd)
    arm(slot, wd)
    slots.push(slot)
  }

  function recycle(slot: Slot): void {
    farthest += cfg.spawnSpacing
    arm(slot, farthest + Math.random() * cfg.spawnJitter)
  }

  function place(slot: Slot, z: number): void {
    slot.obj.object.position.set(Math.sin(slot.theta) * radius, -Math.cos(slot.theta) * radius, z)
  }

  return {
    object: group,
    update(craft: CraftState, dt: number): void {
      for (const slot of slots) {
        // (1) popping: own the slot until the pop completes, then recycle.
        if (slot.state === 'popping') {
          slot.popT += dt / cfg.popTime
          const t = Math.min(slot.popT, 1)
          slot.obj.object.scale.setScalar(1 + t * (popScale - 1))
          slot.obj.setOpacity(1 - t)
          place(slot, craft.distance - slot.worldDistance)
          slot.obj.update(dt)
          if (t >= 1) recycle(slot)
          continue
        }

        // (2) recycle once well behind the ship (do not collision-test the
        //     just-recycled far instance this step).
        const z = craft.distance - slot.worldDistance // +z = behind the ship
        if (z > cfg.recycleBehind) {
          recycle(slot)
          continue
        }

        // (3) place on the wall + idle spin/bob/pulse
        place(slot, z)
        slot.obj.update(dt)

        // (4) proximity: at the ship plane and aligned in angle, fire once.
        if (
          !slot.triggered &&
          Math.abs(z) < cfg.captureZ &&
          Math.abs(angleDiff(craft.theta, slot.theta)) < cfg.captureAngle
        ) {
          slot.triggered = true
          if (cfg.onHit()) {
            consumed += 1
            slot.state = 'popping'
            slot.popT = 0
          }
          // else: not consumed (e.g. invulnerable) - leave it; `triggered`
          // prevents re-fire, it scrolls past and recycles behind.
        }
      }
    },
    setResolution(w: number, h: number): void {
      for (const slot of slots) slot.obj.setResolution(w, h)
    },
    reset(craftDistance: number): void {
      consumed = 0
      farthest = craftDistance + cfg.spawnStart
      slots.forEach((slot, i) => {
        const wd = craftDistance + cfg.spawnStart + i * cfg.spawnSpacing + Math.random() * cfg.spawnJitter
        farthest = Math.max(farthest, wd)
        arm(slot, wd)
      })
    },
    get consumed(): number {
      return consumed
    },
  }
}

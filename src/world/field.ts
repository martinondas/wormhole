import { Group } from 'three'
import { RIDE_RADIUS } from '../config'
import { type CraftState } from '../craft'
import { angleDiff } from '../util/math'
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
  sampleTheta?: () => number // spawn-angle distribution (default: uniform 0..2pi)
  // Optional per-section spacing multiplier keyed by world distance: the gap
  // BEFORE an object becomes spawnSpacing * spacingScaleAt(distance). A value < 1
  // packs objects denser over that stretch (e.g. more mines in slow sections).
  // Default: 1 everywhere (uniform spacing).
  spacingScaleAt?: (worldDistance: number) => number
  onHit: () => boolean
}

// Spawn-angle bias keyed by "angle from the bottom" (0 deg = bottom where the
// craft rests, 180 deg = top). Most spawns land in the favored `band`, the rest
// in `rest`; the left/right side is always uniform. Lets orbs sit mid-wall (you
// must swing up for energy) and mines hug the bottom (you must swing away).
export interface AngleBias {
  band: [number, number] // favored range, degrees from bottom
  bias: number // probability of landing in the band (0..1)
  rest: [number, number] // fallback range, degrees from bottom
}

const DEG = Math.PI / 180

export function biasedAngle(b: AngleBias): () => number {
  return () => {
    const [lo, hi] = Math.random() < b.bias ? b.band : b.rest
    const phi = (lo + Math.random() * (hi - lo)) * DEG
    return (Math.random() < 0.5 ? 1 : -1) * phi
  }
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
  popZ: number // z (frozen at collection) the pop plays at, so it stays in view
}

export function createField(cfg: FieldConfig): Field {
  const group = new Group()
  // All wall objects sit exactly where the ship rides (RIDE_RADIUS), so the
  // angle-only hit test (compare craft.theta to slot.theta) is valid.
  const radius = RIDE_RADIUS
  const popScale = cfg.popScale ?? 1.8
  const slots: Slot[] = []
  let consumed = 0
  let farthest = cfg.spawnStart // last placed slot's base distance (pre-jitter)

  const sampleTheta = cfg.sampleTheta ?? ((): number => Math.random() * Math.PI * 2)
  // Per-section spacing scale (default 1): the gap before each object is
  // spawnSpacing * scaleAt(farthest). Applied identically in the initial layout,
  // recycle, and reset so density is consistent across the run.
  const scaleAt = cfg.spacingScaleAt ?? ((): number => 1)

  // Place a slot at a distance and re-arm it: clears triggered + state + the
  // pop transform. Both initial spawn and recycle/reset funnel through here, so
  // `triggered` can never be left stuck on across a recycle or a restart.
  function arm(slot: Slot, worldDistance: number): void {
    slot.worldDistance = worldDistance
    slot.theta = sampleTheta()
    slot.triggered = false
    slot.state = 'idle'
    slot.popT = 0
    slot.popZ = 0
    slot.obj.object.scale.setScalar(1)
    slot.obj.setOpacity(1)
  }

  // Lay every slot out ahead of `base`: the first sits at base+spawnStart, each
  // next one a scaled gap farther on. `farthest` tracks the running base.
  function layout(base: number): void {
    slots.forEach((slot, i) => {
      farthest = i === 0 ? base + cfg.spawnStart : farthest + cfg.spawnSpacing * scaleAt(farthest)
      arm(slot, farthest + Math.random() * cfg.spawnJitter)
    })
  }

  for (let i = 0; i < cfg.count; i++) {
    const obj = cfg.create()
    group.add(obj.object)
    slots.push({ obj, theta: 0, worldDistance: 0, triggered: false, state: 'idle', popT: 0, popZ: 0 })
  }
  layout(0)

  function recycle(slot: Slot): void {
    farthest += cfg.spawnSpacing * scaleAt(farthest)
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
          // Play the pop at the frozen capture z, NOT the scrolling world z:
          // otherwise at high speed the object races past the camera before the
          // pop finishes and the flash is never seen.
          place(slot, slot.popZ)
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
            slot.popZ = z // freeze the pop at the ship plane where it was caught
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
      layout(craftDistance)
    },
    get consumed(): number {
      return consumed
    },
  }
}

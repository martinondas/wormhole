import { Group } from 'three'
import { RIDE_RADIUS, SPAWN_CLEAR } from '../config'
import { type CraftState } from '../craft'
import { angleDiff } from '../util/math'
import { rand } from '../util/rng'
import { type WallObject } from './wallObject'
import { farScale } from './farScale'

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
//
// Two ways a field gets its objects:
//   random (default) - the field lays its pool out itself at spaced distances and
//            sampled angles, and recycles each object to the far end.
//   feed   - the pool starts parked (hidden). spawn(worldDistance, theta) arms a
//            parked object at an exact place; it parks again once it has passed
//            behind the ship or finished its pop. The gem-line director
//            (world/sequencer.ts) feeds the gem and mine fields this way.
// The hit test, pops, onHit declining, onMiss, onNear, occupies and visit behave
// the same in both.
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
  growTime?: number // feed mode: a spawned object grows in over this long (s); unset = it appears at full size
  sampleTheta?: () => number // spawn-angle distribution (default: uniform 0..2pi)
  // Optional per-section spacing multiplier keyed by world distance: the gap
  // BEFORE an object becomes spawnSpacing * spacingScaleAt(distance). A value < 1
  // packs objects denser over that stretch (e.g. more mines in slow sections).
  // Default: 1 everywhere (uniform spacing).
  spacingScaleAt?: (worldDistance: number) => number
  // Fired once when the ship reaches an armed object; (theta, z) is where the
  // object sits at that moment, so an effect (e.g. an impact burst) can play at
  // the contact point. Returns whether the object was CONSUMED (see above).
  onHit: (theta: number, z: number) => boolean
  // Cross-field de-confliction: returns true when (worldDistance, theta) is too
  // close to another kind's object (see config SPAWN_CLEAR). A (re)spawn then
  // resamples its angle, and nudges forward as a last resort. Default: no check
  // (a field never conflicts with itself - its own spacing handles that).
  avoid?: (worldDistance: number, theta: number) => boolean
  // Fired once when an object leaves the capture window behind the ship without
  // having been triggered (a gem the player did not collect).
  onMiss?: () => void
  // Fired once when an object leaves the capture window behind the ship without
  // having been triggered, after the ship passed it closer than nearAngle (rad) at
  // some point inside the window (a mine that only just missed). Never fires for a
  // slot that hit.
  nearAngle?: number
  onNear?: (theta: number) => void
  // Feed mode (see the header): nothing is laid out or recycled by the field itself.
  feed?: boolean
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
    const [lo, hi] = rand() < b.bias ? b.band : b.rest
    const phi = (lo + rand() * (hi - lo)) * DEG
    return (rand() < 0.5 ? 1 : -1) * phi
  }
}

export interface Field {
  object: Group
  update(craft: CraftState, dt: number): void
  setResolution(w: number, h: number): void
  reset(craftDistance: number): void
  // True when one of this field's objects sits within the SPAWN_CLEAR window of
  // (worldDistance, theta) - the query side of cross-field de-confliction.
  occupies(worldDistance: number, theta: number): boolean
  // Read-only view of every LIVE object (armed, not yet triggered or popping), for
  // the playtest bots and metrics. No allocation; the callback gets the object's
  // angle and its absolute distance along the tube.
  visit(fn: (theta: number, worldDistance: number) => void): void
  // Feed mode: arm a parked object at exactly (worldDistance, theta). Returns false
  // when the pool has no parked object left (counted in failedSpawns).
  spawn(worldDistance: number, theta: number): boolean
  // Feed mode: move every waiting object beyond `boundary` to
  // boundary + (worldDistance - boundary) * ratio (the tube ahead changed speed).
  rescale(boundary: number, ratio: number): void
  readonly consumed: number // items consumed this run (debug / feel only)
  readonly failedSpawns: number // spawn() calls that found the pool empty, since the last reset
}

type SlotState = 'idle' | 'popping' | 'parked'
interface Slot {
  obj: WallObject
  theta: number // angle around the tube (0 = bottom)
  worldDistance: number // absolute distance along the tube where it sits
  triggered: boolean // armed once per encounter; cleared only on recycle/reset
  near: boolean // the ship came within nearAngle inside the capture window
  passed: boolean // left the capture window behind the ship (miss / near reported)
  state: SlotState
  popT: number // 0..1 pop progress
  popZ: number // z (frozen at collection) the pop plays at, so it stays in view
  growT: number // 0..1 grow-in progress after a feed spawn (1 = full size)
}

// Grow-in scale for progress t in 0..1: rises from GROW_FROM past full size and
// settles at 1 (an ease-out with overshoot), so the eye catches the new object.
const GROW_FROM = 0.15
const GROW_OVERSHOOT = 2.2
function growScale(t: number): number {
  const u = t - 1
  const eased = 1 + (GROW_OVERSHOOT + 1) * u * u * u + GROW_OVERSHOOT * u * u
  return GROW_FROM + (1 - GROW_FROM) * eased
}

export function createField(cfg: FieldConfig): Field {
  const group = new Group()
  // All wall objects sit exactly where the ship rides (RIDE_RADIUS), so the
  // angle-only hit test (compare craft.theta to slot.theta) is valid.
  const radius = RIDE_RADIUS
  const popScale = cfg.popScale ?? 1.8
  const slots: Slot[] = []
  let consumed = 0
  let failedSpawns = 0
  let lastCraftDistance = 0 // where the ship was at the last update / reset (to place a fresh spawn)
  let farthest = cfg.spawnStart // last placed slot's base distance (pre-jitter)

  const sampleTheta = cfg.sampleTheta ?? ((): number => rand() * Math.PI * 2)
  // Per-section spacing scale (default 1): the gap before each object is
  // spawnSpacing * scaleAt(farthest). Applied identically in the initial layout,
  // recycle, and reset so density is consistent across the run.
  const scaleAt = cfg.spacingScaleAt ?? ((): number => 1)

  // Place a slot at a distance and re-arm it: clears triggered + state + the
  // pop transform. Both initial spawn and recycle/reset funnel through here, so
  // `triggered` can never be left stuck on across a recycle or a restart.
  function arm(slot: Slot, worldDistance: number, theta?: number): void {
    slot.worldDistance = worldDistance
    slot.theta = theta ?? sampleTheta()
    if (cfg.avoid && theta === undefined) {
      // Cross-field de-confliction: resample the angle first (keeps this field's
      // z rhythm), then push forward until clear (see config SPAWN_CLEAR). Both
      // loops are try-capped; a still-conflicting spot after that is accepted -
      // this is mitigation for stacked kinds, not a placement guarantee.
      for (let i = 0; i < SPAWN_CLEAR.TRIES && cfg.avoid(slot.worldDistance, slot.theta); i++) {
        slot.theta = sampleTheta()
      }
      for (let i = 0; i < SPAWN_CLEAR.TRIES && cfg.avoid(slot.worldDistance, slot.theta); i++) {
        slot.worldDistance += SPAWN_CLEAR.NUDGE
      }
    }
    slot.triggered = false
    slot.near = false
    slot.passed = false
    slot.state = 'idle'
    slot.popT = 0
    slot.popZ = 0
    slot.growT = 1
    slot.obj.object.visible = true
    slot.obj.object.scale.setScalar(1)
    slot.obj.setOpacity(1)
  }

  function park(slot: Slot): void {
    slot.state = 'parked'
    slot.triggered = false
    slot.obj.object.visible = false
  }

  // Lay every slot out ahead of `base`: the first sits at base+spawnStart, each
  // next one a scaled gap farther on. `farthest` tracks the running base.
  function layout(base: number): void {
    lastCraftDistance = base
    if (cfg.feed) {
      slots.forEach(park)
      return
    }
    slots.forEach((slot, i) => {
      farthest = i === 0 ? base + cfg.spawnStart : farthest + cfg.spawnSpacing * scaleAt(farthest)
      arm(slot, farthest + rand() * cfg.spawnJitter)
      // place at its resting z now (base = the craft distance at layout time) so a
      // freshly laid-out field renders down the tube, not clumped at the origin,
      // before the first (gated) update runs - e.g. on the title screen.
      place(slot, base - slot.worldDistance)
    })
  }

  for (let i = 0; i < cfg.count; i++) {
    const obj = cfg.create()
    group.add(obj.object)
    slots.push({ obj, theta: 0, worldDistance: 0, triggered: false, near: false, passed: false, state: 'idle', popT: 0, popZ: 0, growT: 1 })
  }
  layout(0)

  function recycle(slot: Slot): void {
    if (cfg.feed) {
      park(slot)
      return
    }
    farthest += cfg.spawnSpacing * scaleAt(farthest)
    arm(slot, farthest + rand() * cfg.spawnJitter)
  }

  // Position on the wall at ship-relative z, drawn larger the farther ahead it is.
  function place(slot: Slot, z: number): void {
    slot.obj.object.position.set(Math.sin(slot.theta) * radius, -Math.cos(slot.theta) * radius, z)
    slot.obj.object.scale.setScalar(farScale(z))
  }

  return {
    object: group,
    update(craft: CraftState, dt: number): void {
      lastCraftDistance = craft.distance
      for (const slot of slots) {
        if (slot.state === 'parked') continue
        // (1) popping: own the slot until the pop completes, then recycle.
        if (slot.state === 'popping') {
          slot.popT += dt / cfg.popTime
          const t = Math.min(slot.popT, 1)
          slot.obj.setOpacity(1 - t)
          // Play the pop at the frozen capture z, NOT the scrolling world z:
          // otherwise at high speed the object races past the camera before the
          // pop finishes and the flash is never seen.
          place(slot, slot.popZ)
          slot.obj.object.scale.multiplyScalar(1 + t * (popScale - 1))
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
        if (slot.growT < 1) {
          slot.growT = Math.min(1, slot.growT + dt / (cfg.growTime as number))
          slot.obj.object.scale.multiplyScalar(growScale(slot.growT))
        }
        slot.obj.update(dt)

        // (4) proximity: at the ship plane and aligned in angle, fire once.
        const inWindow = Math.abs(z) < cfg.captureZ
        const dAngle = inWindow ? Math.abs(angleDiff(craft.theta, slot.theta)) : Math.PI
        if (!slot.triggered && inWindow && dAngle < cfg.captureAngle) {
          slot.triggered = true
          if (cfg.onHit(slot.theta, z)) {
            consumed += 1
            slot.state = 'popping'
            slot.popT = 0
            slot.popZ = z // freeze the pop at the ship plane where it was caught
          }
          // else: not consumed (e.g. invulnerable) - leave it; `triggered`
          // prevents re-fire, it scrolls past and recycles behind.
        }

        // (5) a pass without contact: remember a close approach inside the window,
        //     report it (and the miss) once the object is behind the window.
        if (!slot.triggered && !slot.passed) {
          if (inWindow && cfg.nearAngle !== undefined && dAngle < cfg.nearAngle) slot.near = true
          if (z >= cfg.captureZ) {
            slot.passed = true
            if (slot.near) cfg.onNear?.(slot.theta)
            cfg.onMiss?.()
          }
        }
      }
    },
    setResolution(w: number, h: number): void {
      for (const slot of slots) slot.obj.setResolution(w, h)
    },
    reset(craftDistance: number): void {
      consumed = 0
      failedSpawns = 0
      layout(craftDistance)
    },
    occupies(worldDistance: number, theta: number): boolean {
      for (const slot of slots) {
        if (
          slot.state !== 'parked' &&
          Math.abs(slot.worldDistance - worldDistance) < SPAWN_CLEAR.DZ &&
          Math.abs(angleDiff(theta, slot.theta)) < SPAWN_CLEAR.ANGLE
        ) {
          return true
        }
      }
      return false
    },
    visit(fn: (theta: number, worldDistance: number) => void): void {
      for (const slot of slots) {
        if (slot.state === 'idle' && !slot.triggered) fn(slot.theta, slot.worldDistance)
      }
    },
    spawn(worldDistance: number, theta: number): boolean {
      for (const slot of slots) {
        if (slot.state !== 'parked') continue
        arm(slot, worldDistance, theta)
        place(slot, lastCraftDistance - worldDistance)
        if (cfg.growTime) {
          slot.growT = 0
          slot.obj.object.scale.multiplyScalar(growScale(0))
        }
        return true
      }
      failedSpawns++
      return false
    },
    rescale(boundary: number, ratio: number): void {
      for (const slot of slots) {
        if (slot.state === 'idle' && slot.worldDistance > boundary) {
          slot.worldDistance = boundary + (slot.worldDistance - boundary) * ratio
        }
      }
    },
    get consumed(): number {
      return consumed
    },
    get failedSpawns(): number {
      return failedSpawns
    },
  }
}

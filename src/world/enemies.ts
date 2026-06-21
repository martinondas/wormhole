import { Group } from 'three'
import { ENEMY, GUN, LEVELS, RIDE_RADIUS } from '../config'
import { type CraftState } from '../craft'
import { angleDiff, clamp } from '../util/math'
import { createEnemy, type Enemy } from './enemy'

// The enemy pool + per-enemy state machine. NOT a Field: a Field scrolls objects
// past at exactly the player's speed (fixed worldDistance), but a raider must fly
// in, hold an engagement band AHEAD of the ship, then peel off. So each slot gets
// its OWN worldDistance that advances by its own speed each step; ship-relative
// z = craft.distance - worldDistance (same sign convention as field.ts).
//
//   approach -> engage -> depart -> recycle (with a spawn-cooldown gap)
//                  `-> dead (killed) -> recycle
//
// Dependencies are injected (no import of game/projectiles) exactly like field
// onHit effects are wired in main.ts: enemy bullets, rams, and kills call back out.
export interface EnemyDeps {
  spawnEnemyBolt(theta: number, z: number, vz: number): void
  onRam(): boolean // lethal contact with the hull (routes to game.hitHazard); enemy survives
  onKill(): void // a kill landed (score + energy refund)
}

export interface Enemies {
  object: Group
  update(craft: CraftState, dt: number): void
  setMaxActive(n: number): void // max raiders alive at once (raised by the level)
  tryKill(theta: number, z: number): boolean // a player bolt at (theta,z) - true if it struck an enemy
  setResolution(w: number, h: number): void
  reset(atDistance: number): void
  debugStage(theta: number, z: number): void // harness: stage one engaged enemy at a fixed pose
  readonly killed: number
}

type Phase = 'approach' | 'engage' | 'depart' | 'dead'

interface Slot {
  enemy: Enemy
  active: boolean // a live enemy on screen (false during the spawn-cooldown gap)
  phase: Phase
  theta: number
  worldDistance: number
  hp: number
  cooldownT: number // seconds until an inactive slot re-enters approach
  // engage
  thetaCenter: number
  strafePhase: number
  engageT: number // seconds left holding the band
  fireCd: number // seconds until the next charge starts
  charging: boolean
  chargeT: number // seconds into the current charge
  flashT: number // brief edge brighten after a non-fatal hit
  // dead
  popT: number // 0..1 death-pop progress
  popZ: number // frozen ship-relative z the pop plays at
}

const BAND_CENTER = (ENEMY.ENGAGE_Z_FAR + ENEMY.ENGAGE_Z_NEAR) / 2
const FLASH_TIME = 0.12
const rand = (a: number, b: number): number => a + Math.random() * (b - a)

export function createEnemies(deps: EnemyDeps): Enemies {
  const group = new Group()
  const radius = RIDE_RADIUS
  const slots: Slot[] = []
  let killed = 0
  // Max raiders allowed on screen at once. The pool is sized to MAX_ENEMIES_CAP;
  // the level raises maxActive up to that cap. Starts at ENEMY.COUNT (level 1).
  let maxActive = ENEMY.COUNT

  // craft snapshot, refreshed each update() so tryKill() (called afterward, from
  // projectiles.update) and debugStage() can compute ship-relative z.
  let craftDistance = 0
  let craftTheta = 0

  for (let i = 0; i < LEVELS.MAX_ENEMIES_CAP; i++) {
    const enemy = createEnemy()
    group.add(enemy.object)
    enemy.object.visible = false
    slots.push({
      enemy,
      active: false,
      phase: 'approach',
      theta: 0,
      worldDistance: 0,
      hp: ENEMY.HP,
      cooldownT: i * 1.5, // stagger the first wave so they do not arrive in lockstep
      thetaCenter: 0,
      strafePhase: 0,
      engageT: 0,
      fireCd: 0,
      charging: false,
      chargeT: 0,
      flashT: 0,
      popT: 0,
      popZ: 0,
    })
  }

  // (re)arm a slot into a fresh APPROACH run far ahead of the ship.
  function arm(slot: Slot): void {
    slot.active = true
    slot.phase = 'approach'
    slot.theta = craftTheta + rand(-ENEMY.SPAWN_THETA_SPREAD, ENEMY.SPAWN_THETA_SPREAD)
    slot.worldDistance = craftDistance + ENEMY.SPAWN_AHEAD + Math.random() * ENEMY.SPAWN_JITTER
    slot.hp = ENEMY.HP
    slot.charging = false
    slot.chargeT = 0
    slot.flashT = 0
    slot.popT = 0
    slot.thetaCenter = slot.theta // weave around the spawn angle from the moment it appears
    slot.strafePhase = Math.random() * Math.PI * 2 // desync raiders so they do not weave in lockstep
    slot.enemy.object.visible = true
    slot.enemy.object.scale.setScalar(1)
    slot.enemy.setOpacity(1)
    slot.enemy.setCharge(0)
  }

  // retire a slot to the inactive gap, then it re-arms after SPAWN_COOLDOWN
  // (+/- jitter, so two slots recycled together drift apart instead of re-pairing).
  function recycle(slot: Slot): void {
    slot.active = false
    slot.cooldownT = ENEMY.SPAWN_COOLDOWN + rand(-ENEMY.SPAWN_COOLDOWN_JITTER, ENEMY.SPAWN_COOLDOWN_JITTER)
    slot.enemy.object.visible = false
    slot.charging = false
    slot.enemy.setCharge(0)
  }

  function place(slot: Slot, z: number, bankFactor: number): void {
    slot.enemy.object.position.set(Math.sin(slot.theta) * radius, -Math.cos(slot.theta) * radius, z)
    // sit tangent on the wall (roll with theta) and lean into the strafe direction
    slot.enemy.object.rotation.z = slot.theta - ENEMY.BANK * bankFactor
  }

  function enterEngage(slot: Slot): void {
    // keep thetaCenter / strafePhase from APPROACH so the weave flows on without a snap
    slot.phase = 'engage'
    slot.engageT = ENEMY.ENGAGE_TIME + rand(-ENEMY.ENGAGE_TIME_JITTER, ENEMY.ENGAGE_TIME_JITTER)
    slot.fireCd = ENEMY.FIRE_COOLDOWN + rand(-ENEMY.FIRE_JITTER, ENEMY.FIRE_JITTER)
    slot.charging = false
    slot.chargeT = 0
  }

  // Weave theta around thetaCenter, hard-capped so the player can always track.
  // Returns a bank factor (-1..1) for the roll lean. Used in APPROACH and ENGAGE.
  function strafe(slot: Slot, dt: number): number {
    slot.strafePhase += ENEMY.STRAFE_W * dt
    const desired = slot.thetaCenter + ENEMY.STRAFE_AMP * Math.sin(slot.strafePhase)
    const step = clamp(angleDiff(desired, slot.theta), -ENEMY.STRAFE_OMEGA_MAX * dt, ENEMY.STRAFE_OMEGA_MAX * dt)
    slot.theta += step
    return clamp(step / dt / ENEMY.STRAFE_OMEGA_MAX, -1, 1)
  }

  function updateSlot(slot: Slot, craft: CraftState, dt: number, canArm: boolean): void {
    if (!slot.active) {
      slot.cooldownT -= dt
      // re-arm only when the cooldown has elapsed AND we are below the level's cap
      // (an over-cap slot holds at cooldownT <= 0 and arms the moment a slot frees).
      if (slot.cooldownT <= 0 && canArm) arm(slot)
      return
    }

    let bankFactor = 0

    if (slot.phase === 'dead') {
      slot.popT += dt / ENEMY.POP_TIME
      const t = Math.min(slot.popT, 1)
      slot.enemy.object.scale.setScalar(1 + t * (ENEMY.POP_SCALE - 1))
      slot.enemy.setOpacity(1 - t)
      place(slot, slot.popZ, 0) // frozen z so the burst is seen even at speed
      slot.enemy.update(dt)
      if (t >= 1) recycle(slot)
      return
    }

    if (slot.phase === 'approach') {
      slot.worldDistance += (craft.speed + ENEMY.CLOSE_SPEED_DELTA) * dt
      // drift the weave CENTER gently toward the player (so it trends into play
      // without locking on), and weave around it - it is dodging from the moment
      // it appears, not diving straight at your angle.
      slot.thetaCenter += clamp(angleDiff(craft.theta, slot.thetaCenter), -ENEMY.APPROACH_TRACK * dt, ENEMY.APPROACH_TRACK * dt)
      bankFactor = strafe(slot, dt)
      const z = craftDistance - slot.worldDistance
      if (z >= ENEMY.ENGAGE_Z_FAR) enterEngage(slot)
    } else if (slot.phase === 'engage') {
      const z = craftDistance - slot.worldDistance
      // station-keeping: speed springs around the band center, clamped so a full
      // boost always outruns the raider (forcing DEPART).
      const target = craft.speed + ENEMY.STATION_SPRING_K * (z - BAND_CENTER)
      const speed = clamp(target, craft.speed - ENEMY.STATION_SPEED_CLAMP, craft.speed + ENEMY.STATION_SPEED_CLAMP)
      slot.worldDistance += speed * dt

      // strafe theta around the center, hard-capped so the player can always
      // track. While charging, HOLD theta: the brightening nose then marks the
      // exact firing line (an honest aim tell) and the raider commits to its shot
      // - giving the player a clean window to swing off the line or shoot it.
      if (!slot.charging) bankFactor = strafe(slot, dt)

      // firing: a visible charge tell, then a bolt down the enemy's current theta
      if (slot.charging) {
        slot.chargeT += dt
        if (slot.chargeT >= ENEMY.CHARGE_TIME) {
          // only fire when clearly AHEAD: a bolt spawned at/behind the ship plane
          // would register instantly with no travel or dodge time. This makes the
          // "always dodgeable" guarantee structural, not tuning-dependent.
          if (z < -GUN.BULLET_HIT_Z) deps.spawnEnemyBolt(slot.theta, z, ENEMY.BULLET_SPEED)
          slot.charging = false
          slot.chargeT = 0
          slot.fireCd = ENEMY.FIRE_COOLDOWN + rand(-ENEMY.FIRE_JITTER, ENEMY.FIRE_JITTER)
        }
      } else {
        slot.fireCd -= dt
        if (slot.fireCd <= 0) {
          slot.charging = true
          slot.chargeT = 0
        }
      }

      // exit: peel off after the timer, or if the player boosted past it
      slot.engageT -= dt
      if (slot.engageT <= 0 || z > ENEMY.ENGAGE_BREAK_Z) {
        slot.phase = 'depart'
        slot.charging = false
        slot.enemy.setCharge(0)
      }
    } else {
      // depart: fall behind, no strafe, no fire
      slot.worldDistance += (craft.speed + ENEMY.DEPART_SPEED_DELTA) * dt
      const z = craftDistance - slot.worldDistance
      if (z > ENEMY.RECYCLE_BEHIND) {
        recycle(slot)
        return
      }
    }

    const z = craftDistance - slot.worldDistance

    // ram / fly-by collision: lethal contact with the hull whenever the raider is
    // near the ship plane and on the ship's line. The 'dead' phase already
    // returned above, so this runs for approach/engage/depart; in practice it
    // only fires on the DEPART fly-by, when an unkilled raider sweeps back through
    // z=0 past you (approach + engage hold station far ahead, z <= -25, never in
    // range). The invuln-first guard makes one fly-by cost at most one life; the
    // raider survives the contact (ramming is pure downside, steering you to shoot).
    if (Math.abs(z) < ENEMY.RAM_Z && Math.abs(angleDiff(craft.theta, slot.theta)) < ENEMY.RAM_ANGLE) {
      deps.onRam()
    }

    // edge brightness: charge tell, or a brief hit flash (whichever is brighter)
    if (slot.flashT > 0) slot.flashT -= dt
    const chargeLevel = slot.charging ? Math.min(slot.chargeT / ENEMY.CHARGE_TIME, 1) : 0
    const flashLevel = slot.flashT > 0 ? slot.flashT / FLASH_TIME : 0
    slot.enemy.setCharge(Math.max(chargeLevel, flashLevel))

    place(slot, z, bankFactor)
    slot.enemy.update(dt)
  }

  return {
    object: group,

    update(craft: CraftState, dt: number): void {
      craftDistance = craft.distance
      craftTheta = craft.theta
      // Count live raiders so arming respects the level cap; a slot that arms this
      // step counts immediately, so a single step can never exceed maxActive.
      let active = 0
      for (const slot of slots) if (slot.active) active++
      for (const slot of slots) {
        const canArm = active < maxActive
        const wasActive = slot.active
        updateSlot(slot, craft, dt, canArm)
        if (!wasActive && slot.active) active++
      }
    },

    setMaxActive(n: number): void {
      maxActive = Math.max(0, Math.min(slots.length, Math.floor(n)))
    },

    tryKill(theta: number, z: number): boolean {
      for (const slot of slots) {
        // any live phase is shootable except the death pop. depart is included so a
        // raider peeling off (still rammable on its fly-by) can also be shot down.
        if (!slot.active || slot.phase === 'dead') continue
        const enemyZ = craftDistance - slot.worldDistance
        const dAngle = Math.abs(angleDiff(theta, slot.theta))
        if (dAngle < GUN.HIT_ANGLE && Math.abs(z - enemyZ) < GUN.HIT_Z) {
          // dead-center shot kills outright; a looser hit only chips 1
          slot.hp = dAngle < GUN.HIT_ANGLE_KILL ? 0 : slot.hp - 1
          if (slot.hp <= 0) {
            slot.phase = 'dead'
            slot.popT = 0
            slot.popZ = enemyZ
            slot.charging = false
            slot.enemy.setCharge(0)
            killed += 1
            deps.onKill()
          } else {
            slot.flashT = FLASH_TIME
          }
          return true // bolt struck an enemy - consume it (kill or not)
        }
      }
      return false
    },

    setResolution(w: number, h: number): void {
      for (const slot of slots) slot.enemy.setResolution(w, h)
    },

    reset(atDistance: number): void {
      killed = 0
      craftDistance = atDistance
      craftTheta = 0
      slots.forEach((slot, i) => {
        // clear EVERY mutable field so reset() and arm()/enterEngage() cannot
        // drift (arm/enterEngage still overwrite the spawn-specific ones).
        slot.active = false
        slot.phase = 'approach'
        slot.cooldownT = i * 1.5 // stagger the first wave
        slot.theta = 0
        slot.worldDistance = 0
        slot.hp = ENEMY.HP
        slot.thetaCenter = 0
        slot.strafePhase = 0
        slot.engageT = 0
        slot.fireCd = 0
        slot.charging = false
        slot.chargeT = 0
        slot.flashT = 0
        slot.popT = 0
        slot.popZ = 0
        slot.enemy.object.visible = false
        slot.enemy.object.scale.setScalar(1)
        slot.enemy.setOpacity(1)
        slot.enemy.setCharge(0)
      })
    },

    debugStage(theta: number, z: number): void {
      const slot = slots[0]
      if (!slot) return
      slot.active = true
      slot.phase = 'engage'
      slot.theta = theta
      slot.thetaCenter = theta
      slot.worldDistance = craftDistance - z
      slot.hp = ENEMY.HP
      slot.charging = false
      slot.chargeT = 0
      slot.engageT = ENEMY.ENGAGE_TIME
      slot.fireCd = ENEMY.FIRE_COOLDOWN
      slot.enemy.object.visible = true
      slot.enemy.object.scale.setScalar(1)
      slot.enemy.setOpacity(1)
      slot.enemy.setCharge(0)
      place(slot, z, 0)
      slot.enemy.update(0)
    },

    get killed(): number {
      return killed
    },
  }
}

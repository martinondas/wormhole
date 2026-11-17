import { Group } from 'three'
import { ENEMY, GUN, LEVELS, RENDER, RIDE_RADIUS } from '../config'
import { type CraftState } from '../craft'
import { waveRoster, waveHunters, aggression, fireCooldown as levelFireCooldown, fireStagger as levelFireStagger } from '../levels'
import { angleDiff, clamp, lerp } from '../util/math'
import { rand, randRange } from '../util/rng'
import { createEnemy, type Enemy } from './enemy'
import { type Load } from './phrases'
import { farScale } from './farScale'
import { inBlast } from './blast'

// The enemy pool, the per-enemy state machine and the wave director. NOT a Field: a
// Field scrolls objects past at exactly the player's speed (fixed worldDistance), but
// a raider must fly in, hold a depth lane AHEAD of the ship, then leave. So each slot
// gets its OWN worldDistance that advances by its own speed each step; ship-relative
// z = craft.distance - worldDistance (same sign convention as field.ts).
//
//   approach -> engage -> exit (leaves forward into the fog) -> recycle
//                  |`-> depart (slipped behind the ship: falls behind) -> recycle
//                  `-> dead (killed) -> recycle
//
// Raiders come in WAVES. The director arms the members of a wave one by one into a
// formation around an anchor angle (side by side, or a pincer), each in its own depth
// lane, never more than the alive cap at once. A wave ends when every member is dead
// or leaving, or when its time is up; then there is a breather. A squad
// member is a WEAVER (strafes around its formation spot and fires down its own line)
// or a HUNTER (slides to the player's line and fires only when it is on it), so a
// parked player is always shot at and a moving one never is by surprise.
//
// Dependencies are injected (no import of game/projectiles) exactly like field
// onHit effects are wired in session.ts: enemy bullets, rams, and kills call back out.
export interface EnemyDeps {
  spawnEnemyBolt(theta: number, z: number, vz: number): void
  onRam(): boolean // lethal contact with the hull (routes to game.hitHazard); enemy survives
  // a kill landed (score + energy refund); (theta,z) = where the raider died. `last`:
  // this kill destroyed the whole squad (nobody left to enter, nobody got away)
  onKill(theta: number, z: number, last: boolean): void
  onChargeStart?(theta: number, z: number): void // a raider started its firing tell (theta is the line it will fire down)
  onChip?(theta: number, z: number): void // a player bolt hit a raider without killing it
  onBlasted?(theta: number, z: number): void // a mine blast destroyed a raider (no kill is paid)
}

export interface Enemies {
  object: Group
  update(craft: CraftState, dt: number): void
  setMaxActive(n: number): void // alive cap: max raiders alive at once (follows the level)
  // Tuning level T (see LEVELS.WAVES): sets the roster and hunter count of the next
  // wave and the aggression. ease is the difficulty mode's factor on the fire
  // cooldown and the breather (1 = as tuned).
  setLevel(T: number, ease?: number): void
  // How busy the wall ahead is: at load 2 no wave starts, hunters hold fire and only
  // one fire slot is open.
  setPressure(p: Load): void
  setHoldFire(hold: boolean): void // while true no raider starts a firing tell (a level gate or the fast-to-slow boundary is near)
  tryKill(theta: number, z: number): boolean // a player bolt at (theta,z) - true if it struck an enemy
  // The blast of a mine at (theta, z) destroys every live raider inside it that has
  // not passed the ship. It is not a kill (no onKill), and for its squad the raider
  // counts as one that got away, so a blast never completes a destroyed squad.
  blast(theta: number, z: number): void
  setResolution(w: number, h: number): void
  reset(atDistance: number): void
  // harness: stage an engaged raider at a fixed pose. It holds that depth and weaves
  // around that angle, outside any formation.
  debugStage(theta: number, z: number, slotIndex?: number, role?: EnemyRole): void
  // Read-only view of every live raider (the death pop is skipped), for the playtest
  // bots and metrics. No allocation. z is ship-relative (negative = ahead); charge01
  // is the visible firing tell (0 = idle, 1 = about to fire); id is stable for the
  // raider's lifetime (its pool slot), so an observer can track one across steps.
  // The role is not reported: a hunter looks like any raider and is told by how it moves.
  visit(fn: (theta: number, z: number, phase: EnemyPhase, charge01: number, id: number) => void): void
  readonly killed: number
  readonly waveActive: boolean // a wave is in progress (false during a breather)
}

export type EnemyPhase = 'approach' | 'engage' | 'depart' | 'exit' | 'dead'
export type EnemyRole = 'weaver' | 'hunter'

interface Slot {
  enemy: Enemy
  active: boolean // a live enemy on screen (false while the slot waits for the director)
  phase: EnemyPhase
  theta: number
  worldDistance: number
  hp: number
  // squad
  role: EnemyRole
  formK: number // its spot in the formation (-1 = none: a staged raider)
  stationOffset: number // rad from the wave anchor to its weave center
  laneZ: number // ship-relative depth it holds in engage
  strafeAmpK: number // its own weave width ...
  strafeWK: number // ... and weave rate, as multipliers
  flankSide: -1 | 0 | 1 // a second hunter's side of the player's line (0 = not chosen yet)
  // engage
  thetaCenter: number
  strafePhase: number
  engageT: number // seconds left in its lane
  squad: number // the squad (squadId) it entered with
  fireCd: number // seconds until the next charge starts
  charging: boolean
  chargeT: number // seconds into the current charge
  flashT: number // brief edge brighten after a non-fatal hit
  // exit
  exitT: number // seconds since it started leaving forward
  exitZ: number // ship-relative z where it started leaving
  // dead
  popT: number // 0..1 death-pop progress
  popZ: number // frozen ship-relative z the pop plays at
}

const FLASH_TIME = 0.12

// Formations: the weave-center offset (rad from the anchor) of spot k in a squad of
// n in the fight at once. SPREAD is side by side; PINCER is two wings wide of the player
// with the later members between them.
type Formation = 'spread' | 'pincer'
function formationOffset(kind: Formation, n: number, k: number): number {
  if (kind === 'spread') return (k - (n - 1) / 2) * ENEMY.FORM_SEP
  if (k < 2) return (k === 0 ? -1 : 1) * ENEMY.PINCER_OFFSET
  if (n <= 3) return 0
  return (k === 2 ? -1 : 1) * ENEMY.PINCER_INNER
}

// The outer hit window (rad) of a raider at ship-relative z: it follows the drawn
// size, so a bolt through the visible wing counts.
export const raiderHitAngle = (z: number): number => GUN.HIT_ANGLE * farScale(z, RENDER.FAR_SCALE.RAIDER_GAIN)

export function createEnemies(deps: EnemyDeps): Enemies {
  const group = new Group()
  const radius = RIDE_RADIUS
  const slots: Slot[] = []
  let killed = 0
  // Alive cap, set by the session from the level. The pool is sized to MAX_ENEMIES_CAP.
  let maxActive = LEVELS.WAVES[0]!.cap
  // Raiders currently holding a fire slot (charging). Recounted at the top of each
  // update(), incremented on a grant mid-step - so one step can never exceed the
  // open fire slots; frees (fired / left / killed) land on the next recount.
  let chargers = 0
  let sinceCharge = Infinity // seconds since the last charge start (FIRE_STAGGER)
  let leadHunter: Slot | undefined // the engaged hunter that takes the player's own line this step
  let pressure: Load = 0
  let holdFire = false

  // level tuning (setLevel)
  let tuningLevel = 0
  let roster = waveRoster(0)
  let hunters = waveHunters(0)
  let aggr = aggression(0)
  let fireStagger = levelFireStagger(0) // least s between two charge starts at the current level
  let ease = 1

  // wave director
  let waveActive = false
  let breatherT: number = ENEMY.WAVE.FIRST_DELAY // seconds until the next wave may start
  let waveT = 0 // seconds into the current wave
  let rosterLeft = 0 // members of the current wave still to enter
  let armed = 0 // members of the current wave that have entered
  let squadId = 0 // the current squad; a raider remembers the squad it entered with
  let squadOpen = 0 // members of the current squad neither killed nor gone yet
  let squadGotAway = 0 // members of the current squad that got away
  let armT = 0 // seconds until the next member may enter
  let waveHuntersN = 0 // hunters this wave keeps in play
  let formation: Formation = 'spread'
  let formN = 1 // spots in the formation (members in the fight at once)
  let anchorTheta = 0 // the angle the formation is laid out around

  // craft snapshot, refreshed each update() so tryKill() (called afterward, from
  // projectiles.update) and debugStage() can compute ship-relative z.
  let craftDistance = 0

  // Every slot default. The pool starts from it and reset() returns to it; arm(),
  // enterEngage() and debugStage() then set what a live raider needs.
  function clearSlot(slot: Slot): void {
    slot.active = false
    slot.phase = 'approach'
    slot.theta = 0
    slot.worldDistance = 0
    slot.hp = ENEMY.HP
    slot.role = 'weaver'
    slot.formK = -1
    slot.stationOffset = 0
    slot.laneZ = ENEMY.LANES[1]
    slot.strafeAmpK = 1
    slot.strafeWK = 1
    slot.flankSide = 0
    slot.thetaCenter = 0
    slot.strafePhase = 0
    slot.engageT = 0
    slot.squad = 0
    slot.fireCd = 0
    slot.charging = false
    slot.chargeT = 0
    slot.flashT = 0
    slot.exitT = 0
    slot.exitZ = 0
    slot.popT = 0
    slot.popZ = 0
    slot.enemy.object.visible = false
    slot.enemy.object.scale.setScalar(1)
    slot.enemy.setOpacity(1)
    slot.enemy.setCharge(0)
  }

  for (let i = 0; i < LEVELS.MAX_ENEMIES_CAP; i++) {
    const enemy = createEnemy()
    group.add(enemy.object)
    const slot = { enemy } as Slot
    clearSlot(slot)
    slots.push(slot)
  }

  const fighting = (slot: Slot): boolean => slot.active && (slot.phase === 'approach' || slot.phase === 'engage')
  // the visible firing tell: 0 idle .. 1 about to fire
  const chargeLevel = (slot: Slot): number => (slot.charging ? Math.min(slot.chargeT / ENEMY.CHARGE_TIME, 1) : 0)
  // where a formation wants its anchor: on the player's line, but never on the top wall
  const anchorGoal = (craft: CraftState): number => clamp(angleDiff(craft.theta, 0), -ENEMY.ANCHOR_MAX, ENEMY.ANCHOR_MAX)
  const fireCooldown = (): number => levelFireCooldown(tuningLevel) * ease + randRange(-ENEMY.FIRE_JITTER, ENEMY.FIRE_JITTER)

  // The smallest angle between `slot`'s formation spot and a fighting weaver that
  // holds depth lane `lane` (Infinity when the lane is empty).
  function lanePeerGap(slot: Slot, lane: number): number {
    let gap = Infinity
    for (const s of slots) {
      if (s === slot || !fighting(s) || s.role === 'hunter' || s.laneZ !== lane) continue
      gap = Math.min(gap, Math.abs(s.stationOffset - slot.stationOffset))
    }
    return gap
  }

  // Arm a slot as the next member of the current wave: a fresh APPROACH run far
  // ahead of the ship, on its formation spot, bound for its depth lane.
  function arm(slot: Slot): void {
    slot.squad = squadId
    let liveHunters = 0
    for (const s of slots) if (fighting(s) && s.role === 'hunter') liveHunters++
    // the first member of a squad is a weaver, so a hunter never arrives alone
    slot.role = liveHunters < waveHuntersN && (armed > 0 || roster <= waveHuntersN) ? 'hunter' : 'weaver'
    // the lowest formation spot no fighting member holds
    let k = 0
    for (; k < formN; k++) {
      let taken = false
      for (const s of slots) if (s !== slot && fighting(s) && s.formK === k) taken = true
      if (!taken) break
    }
    // Every spot taken: this is a relief (see direct), and it inherits the spot of
    // the weaver that is about to leave.
    let leaver: Slot | undefined
    if (k >= formN) {
      for (const s of slots) {
        if (s === slot || s.phase !== 'engage' || !s.active || s.role === 'hunter' || s.formK < 0) continue
        if (!leaver || s.engageT < leaver.engageT) leaver = s
      }
      k = leaver ? leaver.formK : armed % formN
    }
    slot.formK = k
    slot.stationOffset = leaver ? leaver.stationOffset : formationOffset(formation, formN, k)
    // Hunters take the middle lane. With a hunter in the squad the weavers take the
    // near and far lanes, each new one the lane where its nearest neighbour is
    // farthest away in angle, so two ships at one depth are never side by side.
    // A squad without a hunter (the first levels) takes the lanes of EARLY_LANES.
    const [near, mid, far] = ENEMY.LANES
    if (slot.role === 'hunter') slot.laneZ = mid
    else if (leaver) slot.laneZ = leaver.laneZ
    else if (waveHuntersN === 0) slot.laneZ = ENEMY.LANES[ENEMY.EARLY_LANES[k % 2]!]!
    else slot.laneZ = lanePeerGap(slot, far) > lanePeerGap(slot, near) ? far : near
    slot.strafeAmpK = randRange(ENEMY.STRAFE_AMP_K[0], ENEMY.STRAFE_AMP_K[1])
    slot.strafeWK = randRange(ENEMY.STRAFE_W_K[0], ENEMY.STRAFE_W_K[1])
    slot.flankSide = 0
    slot.active = true
    slot.phase = 'approach'
    slot.thetaCenter = anchorTheta + slot.stationOffset
    slot.theta = slot.thetaCenter
    slot.worldDistance = craftDistance + ENEMY.SPAWN_AHEAD + rand() * ENEMY.SPAWN_JITTER
    slot.hp = ENEMY.HP
    slot.charging = false
    slot.chargeT = 0
    slot.flashT = 0
    slot.exitT = 0
    slot.popT = 0
    slot.strafePhase = rand() * Math.PI * 2 // desync raiders so they do not weave in lockstep
    slot.enemy.object.visible = true
    slot.enemy.object.scale.setScalar(1)
    slot.enemy.setOpacity(1)
    slot.enemy.setCharge(0)
  }

  // retire a slot; the director arms it again when the wave has a member for it.
  function recycle(slot: Slot): void {
    slot.active = false
    slot.enemy.object.visible = false
    slot.charging = false
    slot.enemy.setCharge(0)
  }

  // A raider that was not killed leaves: forward into the fog (the normal way out),
  // or by falling behind if it already slipped past the ship plane.
  function leave(slot: Slot, phase: 'exit' | 'depart', z: number): void {
    slot.phase = phase
    slot.charging = false
    slot.exitT = 0
    slot.exitZ = z
    slot.enemy.setCharge(0)
    armT = Math.max(armT, ENEMY.WAVE.REINFORCE_DELAY)
  }

  // A raider the gun did not kill is lost to its squad: the squad is not destroyed.
  function lostToSquad(slot: Slot): void {
    if (slot.squad === squadId) {
      squadGotAway++
      squadOpen--
    }
  }

  // A leaving raider is out of reach: it got away. Until then it can still be shot
  // (tryKill), and that kill counts for the squad.
  function gotAway(slot: Slot): void {
    lostToSquad(slot)
    recycle(slot)
  }

  // Start the death pop at ship-relative z; the director waits a beat before the
  // replacement enters.
  function die(slot: Slot, z: number): void {
    slot.phase = 'dead'
    slot.popT = 0
    slot.popZ = z
    slot.charging = false
    slot.enemy.setCharge(0)
    armT = Math.max(armT, ENEMY.WAVE.REINFORCE_DELAY)
  }

  function startWave(craft: CraftState): void {
    waveActive = true
    waveT = 0
    rosterLeft = roster
    armed = 0
    squadId++
    squadOpen = roster
    squadGotAway = 0
    armT = 0
    waveHuntersN = hunters
    formN = Math.max(1, Math.min(roster, maxActive, ENEMY.WAVE.FIGHT_MAX))
    formation = rand() < 0.5 ? 'spread' : 'pincer'
    anchorTheta = anchorGoal(craft)
  }

  function endWave(): void {
    waveActive = false
    rosterLeft = 0
    breatherT = lerp(ENEMY.WAVE.BREATHER.BASE, ENEMY.WAVE.BREATHER.MIN, aggr) * ease
  }

  // The wave director: starts waves, feeds members in, ends waves. `alive` is the
  // number of live raiders before this step.
  function direct(craft: CraftState, dt: number, alive: number): void {
    if (!waveActive) {
      breatherT -= dt
      if (breatherT <= 0 && pressure < 2) startWave(craft)
      return
    }
    waveT += dt
    armT -= dt
    let inFight = 0
    for (const slot of slots) if (fighting(slot)) inFight++
    if (waveT >= ENEMY.WAVE.TIME) {
      // time is up: whoever is left leaves forward, the rest of the roster stays home
      for (const slot of slots) if (fighting(slot)) leave(slot, 'exit', craftDistance - slot.worldDistance)
      squadGotAway += rosterLeft
      squadOpen -= rosterLeft
      endWave()
      return
    }
    if (rosterLeft > 0) {
      // Above WAVE.FIGHT_MAX alive, a member enters only as a relief: when one in the
      // fight is about to leave, so its replacement arrives as it goes. More than
      // FIGHT_MAX raiders are then in the fight only for a moment.
      let relief = alive < ENEMY.WAVE.FIGHT_MAX
      if (!relief) {
        for (const slot of slots) {
          if (slot.active && slot.phase === 'engage' && slot.engageT <= ENEMY.WAVE.RELIEF_LEAD) relief = true
        }
      }
      if (alive < maxActive && armT <= 0 && relief) {
        for (const slot of slots) {
          if (slot.active) continue
          arm(slot)
          armed++
          rosterLeft--
          armT = ENEMY.WAVE.REINFORCE_DELAY
          break
        }
      }
    } else if (inFight === 0) {
      endWave()
      return
    }
    // the shape follows the player loosely
    anchorTheta += clamp(anchorGoal(craft) - anchorTheta, -ENEMY.ANCHOR_TRACK * dt, ENEMY.ANCHOR_TRACK * dt)
  }

  // Keep two raiders from reading as one: when a pair is close in angle and in depth,
  // the later slot's weave center is pushed away (a hunter keeps its line; the weaver
  // of a mixed pair moves instead).
  function separate(dt: number): void {
    for (let i = 0; i < slots.length; i++) {
      const a = slots[i]!
      if (!fighting(a)) continue
      for (let j = i + 1; j < slots.length; j++) {
        const b = slots[j]!
        if (!fighting(b)) continue
        const dTheta = angleDiff(b.theta, a.theta)
        if (Math.abs(dTheta) >= ENEMY.SEP_MIN || Math.abs(a.worldDistance - b.worldDistance) >= ENEMY.SEP_DZ) continue
        const push = (dTheta >= 0 ? 1 : -1) * ENEMY.SEP_PUSH * dt
        if (b.role === 'hunter' && a.role !== 'hunter') {
          a.stationOffset -= push
          a.thetaCenter -= push
        } else {
          b.stationOffset += push
          b.thetaCenter += push
        }
      }
    }
  }

  // Position on the wall at ship-relative z, drawn larger the farther ahead it is.
  function place(slot: Slot, z: number, bankFactor: number): void {
    slot.enemy.object.position.set(Math.sin(slot.theta) * radius, -Math.cos(slot.theta) * radius, z)
    slot.enemy.object.scale.setScalar(farScale(z, RENDER.FAR_SCALE.RAIDER_GAIN))
    // sit tangent on the wall (roll with theta) and lean into the strafe direction
    slot.enemy.object.rotation.z = slot.theta - ENEMY.BANK * bankFactor
  }

  function enterEngage(slot: Slot): void {
    // keep thetaCenter / strafePhase from APPROACH so the weave flows on without a snap
    slot.phase = 'engage'
    slot.engageT = ENEMY.ENGAGE_TIME + randRange(-ENEMY.ENGAGE_TIME_JITTER, ENEMY.ENGAGE_TIME_JITTER)
    slot.fireCd = fireCooldown()
    slot.charging = false
    slot.chargeT = 0
  }

  // Weave theta around thetaCenter, hard-capped so the player can always track.
  // Returns a bank factor (-1..1) for the roll lean. Used in APPROACH and ENGAGE.
  function strafe(slot: Slot, amp: number, dt: number): number {
    slot.strafePhase += ENEMY.STRAFE_W * slot.strafeWK * dt
    const desired = slot.thetaCenter + amp * slot.strafeAmpK * Math.sin(slot.strafePhase)
    const step = clamp(angleDiff(desired, slot.theta), -ENEMY.STRAFE_OMEGA_MAX * dt, ENEMY.STRAFE_OMEGA_MAX * dt)
    slot.theta += step
    return clamp(step / dt / ENEMY.STRAFE_OMEGA_MAX, -1, 1)
  }

  // An engaged hunter slides its weave center to the player's line. A second hunter
  // does not stack on the first: it takes the line HUNT_FLANK beside the player's and
  // waits there for the player to come to it.
  function steerHunter(slot: Slot, craft: CraftState, dt: number): void {
    const track = lerp(ENEMY.HUNT_TRACK[0], ENEMY.HUNT_TRACK[1], aggr) * dt
    let goal = craft.theta
    if (slot !== leadHunter) {
      // it keeps the side it came from, so it never crosses the first hunter
      if (slot.flankSide === 0) slot.flankSide = angleDiff(slot.thetaCenter, craft.theta) >= 0 ? 1 : -1
      goal += slot.flankSide * ENEMY.HUNT_FLANK
    }
    const next = slot.thetaCenter + clamp(angleDiff(goal, slot.thetaCenter), -track, track)
    // ... and it waits rather than slide through the first hunter's spot
    const gapNow = leadHunter && slot !== leadHunter ? Math.abs(angleDiff(slot.thetaCenter, leadHunter.thetaCenter)) : Infinity
    const gapNext = leadHunter && slot !== leadHunter ? Math.abs(angleDiff(next, leadHunter.thetaCenter)) : Infinity
    if (gapNext >= ENEMY.HUNT_GAP_MIN || gapNext >= gapNow) slot.thetaCenter = next
  }

  // A raider whose cooldown has run out starts its firing tell if it may. A charge
  // needs a free fire slot (so incoming fire stays a readable rhythm however many are
  // engaged), a beat since the last tell, and enough distance for a fair tell. A
  // hunter also waits until it sits on the player's line, and holds fire through a
  // hard phrase on the wall. `z` is the raider's ship-relative depth.
  function tryStartCharge(slot: Slot, craft: CraftState, z: number): void {
    const hunter = slot.role === 'hunter'
    const openSlots = pressure === 2 ? 1 : ENEMY.FIRE_SLOTS
    const free = !holdFire && chargers < openSlots && sinceCharge >= fireStagger && z <= -ENEMY.FIRE_MIN_AHEAD
    const aimed = !hunter || (pressure < 2 && Math.abs(angleDiff(craft.theta, slot.theta)) < ENEMY.HUNT_FIRE_ANGLE)
    if (free && aimed) {
      chargers++
      sinceCharge = 0
      slot.charging = true
      slot.chargeT = 0
      deps.onChargeStart?.(slot.theta, z)
    } else if (!hunter) {
      // back off a beat and re-try (jittered, so no fixed pool order always wins the
      // next free slot). A hunter re-checks every step instead: it fires the moment
      // it is on the line and a slot is free.
      slot.fireCd = ENEMY.FIRE_SLOT_RETRY * randRange(0.5, 1.5)
    }
  }

  function updateSlot(slot: Slot, craft: CraftState, dt: number): void {
    if (!slot.active) return

    if (slot.phase === 'dead') {
      slot.popT += dt / ENEMY.POP_TIME
      const t = Math.min(slot.popT, 1)
      slot.enemy.setOpacity(1 - t)
      place(slot, slot.popZ, 0) // frozen z so the burst is seen even at speed
      slot.enemy.object.scale.multiplyScalar(1 + t * (ENEMY.POP_SCALE - 1))
      slot.enemy.update(dt)
      if (t >= 1) recycle(slot)
      return
    }

    // a formation member weaves around its spot beside the anchor (a staged raider
    // and an engaged hunter own their center)
    const inFormation = slot.formK >= 0 && !(slot.role === 'hunter' && slot.phase === 'engage')
    if (inFormation) slot.thetaCenter = anchorTheta + slot.stationOffset

    let bankFactor = 0
    let z: number // ship-relative depth after this step's move

    if (slot.phase === 'approach') {
      slot.worldDistance += (craft.speed + ENEMY.CLOSE_SPEED_DELTA) * dt
      // it weaves from the moment it appears, not diving straight down one line
      bankFactor = strafe(slot, ENEMY.STRAFE_AMP, dt)
      z = craftDistance - slot.worldDistance
      if (z >= ENEMY.ENGAGE_Z_FAR) enterEngage(slot)
    } else if (slot.phase === 'engage') {
      // the firing and leaving rules read the depth the step started at
      const zStart = craftDistance - slot.worldDistance
      // station-keeping: speed springs toward the raider's own depth lane
      const target = craft.speed + ENEMY.STATION_SPRING_K * (zStart - slot.laneZ)
      const speed = clamp(target, craft.speed - ENEMY.STATION_SPEED_CLAMP, craft.speed + ENEMY.STATION_SPEED_CLAMP)
      slot.worldDistance += speed * dt
      z = craftDistance - slot.worldDistance

      const hunter = slot.role === 'hunter'
      // Strafe theta around the center, hard-capped so the player can always
      // track. While charging, HOLD theta: the brightening nose then marks the
      // exact firing line (an honest aim tell) and the raider commits to its shot
      // - giving the player a clean window to swing off the line or shoot it.
      if (!slot.charging) {
        if (hunter) steerHunter(slot, craft, dt)
        // a hunter sits on its line with a small weave
        bankFactor = strafe(slot, hunter ? ENEMY.HUNT_STRAFE_AMP : ENEMY.STRAFE_AMP, dt)
      }

      // firing: a visible charge tell, then a bolt down the enemy's current theta
      if (slot.charging) {
        slot.chargeT += dt
        if (slot.chargeT >= ENEMY.CHARGE_TIME) {
          // only fire when clearly AHEAD: a bolt spawned at/behind the ship plane
          // would register instantly with no travel or dodge time. This makes the
          // "always dodgeable" guarantee structural, not tuning-dependent.
          if (zStart < -GUN.BULLET_HIT_Z) deps.spawnEnemyBolt(slot.theta, zStart, ENEMY.BULLET_SPEED)
          slot.charging = false
          slot.chargeT = 0
          slot.fireCd = fireCooldown()
        }
      } else {
        slot.fireCd -= dt
        if (slot.fireCd <= 0) tryStartCharge(slot, craft, zStart)
      }

      // leave: forward after its time in the lane, or fall behind if it slipped
      // past the ship. A hunter of a wave has no timer of its own: it stays until it
      // is shot or the wave's time is up, so not shooting it is never the easy way.
      if (!hunter || slot.formK < 0) slot.engageT -= dt
      if (zStart > ENEMY.ENGAGE_BREAK_Z) leave(slot, 'depart', zStart)
      else if (slot.engageT <= 0) leave(slot, 'exit', zStart)
    } else if (slot.phase === 'exit') {
      // exit: accelerate away into the fog ahead, fading; no strafe, no fire
      slot.exitT += dt
      slot.worldDistance += (craft.speed + ENEMY.EXIT_SPEED_DELTA + ENEMY.EXIT_ACCEL * slot.exitT) * dt
      z = craftDistance - slot.worldDistance
      if (z <= -ENEMY.SPAWN_AHEAD) {
        gotAway(slot)
        return
      }
      slot.enemy.setOpacity(clamp((z + ENEMY.SPAWN_AHEAD) / (slot.exitZ + ENEMY.SPAWN_AHEAD), 0, 1))
    } else {
      // depart: fall behind, no strafe, no fire
      slot.worldDistance += (craft.speed + ENEMY.DEPART_SPEED_DELTA) * dt
      z = craftDistance - slot.worldDistance
      if (z > ENEMY.RECYCLE_BEHIND) {
        gotAway(slot)
        return
      }
    }

    // ram: lethal contact with the hull whenever the raider is near the ship plane
    // and on the ship's line. Raiders hold their lanes far ahead and leave forward,
    // so this only happens to one that slipped behind and falls back through z=0
    // (DEPART). The invuln-first guard makes one fly-by cost at most one life; the
    // raider survives the contact.
    if (Math.abs(z) < ENEMY.RAM_Z && Math.abs(angleDiff(craft.theta, slot.theta)) < ENEMY.RAM_ANGLE) {
      deps.onRam()
    }

    // edge brightness: charge tell, or a brief hit flash (whichever is brighter)
    if (slot.flashT > 0) slot.flashT -= dt
    const flashLevel = slot.flashT > 0 ? slot.flashT / FLASH_TIME : 0
    slot.enemy.setCharge(Math.max(chargeLevel(slot), flashLevel))

    place(slot, z, bankFactor)
    slot.enemy.update(dt)
  }

  return {
    object: group,

    update(craft: CraftState, dt: number): void {
      craftDistance = craft.distance
      sinceCharge += dt
      // Live raiders (the death pop is not one) against the alive cap; the director
      // arms at most one member per step, so a step can never exceed it.
      let alive = 0
      for (const slot of slots) if (slot.active && slot.phase !== 'dead') alive++
      // Recount the busy fire slots (see the firing rule in updateSlot).
      chargers = 0
      for (const slot of slots) if (slot.active && slot.charging) chargers++
      leadHunter = undefined
      for (const slot of slots) {
        if (slot.active && slot.phase === 'engage' && slot.role === 'hunter') {
          leadHunter = slot
          break
        }
      }
      direct(craft, dt, alive)
      separate(dt)
      for (const slot of slots) updateSlot(slot, craft, dt)
    },

    setMaxActive(n: number): void {
      maxActive = Math.max(0, Math.min(slots.length, Math.floor(n)))
    },

    setLevel(T: number, easeFactor = 1): void {
      tuningLevel = T
      roster = waveRoster(T)
      hunters = waveHunters(T)
      aggr = aggression(T)
      fireStagger = levelFireStagger(T)
      ease = easeFactor
    },

    setPressure(p: Load): void {
      pressure = p
    },

    setHoldFire(hold: boolean): void {
      // When the hold ends, every waiting raider takes a part of a fresh cooldown, so
      // the fire comes back one tell at a time and not as a volley.
      if (holdFire && !hold) {
        for (const slot of slots) {
          if (slot.active && slot.phase === 'engage' && !slot.charging) {
            slot.fireCd = Math.max(slot.fireCd, fireCooldown() * randRange(ENEMY.HOLD_FIRE.RESUME[0], ENEMY.HOLD_FIRE.RESUME[1]))
          }
        }
      }
      holdFire = hold
    },

    tryKill(theta: number, z: number): boolean {
      for (const slot of slots) {
        // any live phase is shootable except the death pop, a leaving raider included
        if (!slot.active || slot.phase === 'dead') continue
        const enemyZ = craftDistance - slot.worldDistance
        const dAngle = Math.abs(angleDiff(theta, slot.theta))
        if (dAngle < raiderHitAngle(enemyZ) && Math.abs(z - enemyZ) < GUN.HIT_Z) {
          // dead-center shot kills outright; a looser hit only chips 1
          slot.hp = dAngle < GUN.HIT_ANGLE_KILL ? 0 : slot.hp - 1
          if (slot.hp <= 0) {
            die(slot, enemyZ)
            killed += 1
            const ofSquad = slot.squad === squadId
            if (ofSquad) squadOpen--
            deps.onKill(slot.theta, enemyZ, ofSquad && squadOpen === 0 && squadGotAway === 0)
          } else {
            slot.flashT = FLASH_TIME
            deps.onChip?.(slot.theta, enemyZ)
          }
          return true // bolt struck an enemy - consume it (kill or not)
        }
      }
      return false
    },

    blast(theta: number, z: number): void {
      for (const slot of slots) {
        if (!slot.active || slot.phase === 'dead') continue
        const enemyZ = craftDistance - slot.worldDistance
        // a raider behind the ship's contact window has passed, like a wall object
        // behind its capture window: a blast does not reach back for it
        if (enemyZ >= ENEMY.RAM_Z || !inBlast(theta, slot.theta, enemyZ - z)) continue
        die(slot, enemyZ)
        lostToSquad(slot)
        deps.onBlasted?.(slot.theta, enemyZ)
      }
    },

    setResolution(w: number, h: number): void {
      for (const slot of slots) slot.enemy.setResolution(w, h)
    },

    reset(atDistance: number): void {
      killed = 0
      craftDistance = atDistance
      chargers = 0
      sinceCharge = Infinity
      pressure = 0
      holdFire = false
      leadHunter = undefined
      waveActive = false
      breatherT = ENEMY.WAVE.FIRST_DELAY
      waveT = 0
      rosterLeft = 0
      armed = 0
      squadId = 0
      squadOpen = 0
      squadGotAway = 0
      armT = 0
      waveHuntersN = 0
      formation = 'spread'
      formN = 1
      anchorTheta = 0
      for (const slot of slots) clearSlot(slot)
    },

    debugStage(theta: number, z: number, slotIndex = 0, role: EnemyRole = 'weaver'): void {
      const slot = slots[slotIndex]
      if (!slot) return
      clearSlot(slot)
      slot.active = true
      slot.phase = 'engage'
      slot.role = role
      slot.laneZ = z
      slot.theta = theta
      slot.thetaCenter = theta
      slot.worldDistance = craftDistance - z
      slot.engageT = ENEMY.ENGAGE_TIME
      slot.fireCd = ENEMY.FIRE_COOLDOWN
      slot.enemy.object.visible = true
      place(slot, z, 0)
      slot.enemy.update(0)
    },

    visit(fn: (theta: number, z: number, phase: EnemyPhase, charge01: number, id: number) => void): void {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!
        if (!slot.active || slot.phase === 'dead') continue
        fn(slot.theta, craftDistance - slot.worldDistance, slot.phase, chargeLevel(slot), i)
      }
    },

    get killed(): number {
      return killed
    },

    get waveActive(): boolean {
      return waveActive
    },
  }
}

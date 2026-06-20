import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createStarfield } from './render/stars'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { createField, biasedAngle, type Field } from './world/field'
import { type WallObject } from './world/wallObject'
import { createPickup } from './world/pickup'
import { createTreasure } from './world/treasure'
import { createHazard } from './world/hazard'
import { createProjectiles } from './world/projectiles'
import { createEnemies } from './world/enemies'
import { Input } from './input'
import { createCraft, updateCraft, resetCraft } from './craft'
import { createFlight } from './flight'
import { createGame } from './game'
import { createGun } from './gun'
import { createHud } from './hud'
import { createAudio } from './audio'
import { createPerfOverlay } from './render/perf'
import { startLoop } from './loop'
import { PHYSICS, SPEED, FLIGHT, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BACKGROUND, ENERGY, LIVES, SCORE, GUN, ENEMY, PROJECTILE, INPUT, AUDIO } from './config'

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
const flight = createFlight()
const game = createGame()
const hud = createHud()
const perf = createPerfOverlay() // press P to toggle the FPS / frame-time overlay
const audio = createAudio()
let paused = false // Esc pauses a live run to the intro/menu screen; resume with Space or Esc
audio.arm() // a click/tap to focus the canvas wakes the menu track (autoplay policy)
audio.playMusic(musicTrack()) // 'menu' on the title; queued until the first gesture unlocks audio

// Sound a hazard/ram/bolt hit only when a life was actually lost. hitHazard()
// returns false during i-frames (or once the run is over), so a graze is silent.
const playedHit = (lostLife: boolean): boolean => {
  if (lostLife) audio.play('hit')
  return lostLife
}

// --- wall objects: orbs (energy), gems (score), mines (a hit costs a life) --
// All three are pools of WallObjects on the tube wall, driven by one generic
// field; only the onHit effect differs. The per-kind config blocks share these
// field-constant names, so one mapping builds all three.
interface FieldConsts {
  COUNT: number
  SPAWN_START: number
  SPAWN_SPACING: number
  SPAWN_JITTER: number
  RECYCLE_BEHIND: number
  CAPTURE_Z: number
  CAPTURE_ANGLE: number
  POP_TIME: number
  POP_SCALE: number
}
function makeField(
  create: () => WallObject,
  c: FieldConsts,
  onHit: () => boolean,
  sampleTheta?: () => number,
): Field {
  return createField({
    create,
    onHit,
    sampleTheta,
    count: c.COUNT,
    spawnStart: c.SPAWN_START,
    spawnSpacing: c.SPAWN_SPACING,
    spawnJitter: c.SPAWN_JITTER,
    recycleBehind: c.RECYCLE_BEHIND,
    captureZ: c.CAPTURE_Z,
    captureAngle: c.CAPTURE_ANGLE,
    popTime: c.POP_TIME,
    popScale: c.POP_SCALE,
  })
}

const fields: Field[] = [
  // orbs favor mid-wall (swing up for energy); gems anywhere; mines hug the bottom.
  makeField(
    createPickup,
    PICKUP,
    () => {
      game.addEnergy(ENERGY.PER_ORB)
      audio.play('orb')
      ship.flash()
      return true
    },
    biasedAngle(PICKUP.SPAWN_ANGLE),
  ),
  makeField(createTreasure, TREASURE, () => {
    game.addScore(TREASURE.SCORE)
    audio.play('gem')
    return true
  }),
  // play the hit sfx only when a life is actually lost (hitHazard returns false
  // during i-frames), so an invuln graze stays silent.
  makeField(createHazard, HAZARD, () => playedHit(game.hitHazard()), biasedAngle(HAZARD.SPAWN_ANGLE)),
]
for (const f of fields) {
  stage.scene.add(f.object)
  stage.onResize((w, h) => f.setResolution(w, h))
}

// --- combat: forward gun + pooled bolts + magenta raiders -------------------
// projectiles is one shared pool (player + enemy bolts). enemies is a sibling of
// the fields - NOT a Field, because raiders fly in / hold station / peel off (own
// worldDistance). Both are dependency-injected here (the single wiring point), so
// they import neither game nor each other: enemy fire, rams, kills, and bolt hits
// all call back through these closures, exactly like field onHit effects do.
const projectiles = createProjectiles()
const gun = createGun()
const enemies = createEnemies({
  spawnEnemyBolt: (theta, z, vz) => {
    audio.play('enemyFire')
    projectiles.spawn('enemy', theta, z, vz)
  },
  onRam: () => playedHit(game.hitHazard()), // lethal hull contact (enemy survives)
  onKill: () => {
    game.addScore(ENEMY.SCORE)
    game.addEnergy(ENEMY.ENERGY_REFUND)
    audio.play('kill')
  },
})
for (const sys of [enemies, projectiles]) {
  stage.scene.add(sys.object)
  stage.onResize((w, h) => sys.setResolution(w, h))
}

// Hoisted projectile-update context (mutated each step, not re-allocated) so the
// fixed update does no per-frame allocation; the two callbacks are stable.
const projCtx = {
  tryKillEnemy: (theta: number, z: number): boolean => enemies.tryKill(theta, z),
  shipTheta: 0,
  onShipHit: (): boolean => playedHit(game.hitHazard()),
}

// Run-flow gate: the sim is frozen on the title screen (game.started=false) and
// on the game-over screen (game.over). menu.mp3 plays on both; music.mp3 during
// a run. The first run starts on Space from the title; later runs restart from
// the game-over screen the same way.
let wasOver = false // detects the run-ending edge once in render (sting)
let lastTargetSpeed = SPEED.NORMAL // detects flight-tier step-ups -> accelerate layer
// Flight inputs are stable within a frame, so preUpdate computes them once per
// frame and the fixed substeps reuse these (was recomputed every substep).
let frameTargetSpeed = SPEED.NORMAL
let frameGravity = flight.gravityForSpeed(SPEED.NORMAL)
let lastMusic: 'menu' | 'play' = musicTrack() // cache: switch tracks only on change

// Which music track the current state wants: menu on the title / game-over, the
// run track otherwise. Driven every frame (playMusic no-ops when unchanged) and
// in beginRun (before unlock) so the menu never blips on start.
function musicTrack(): 'menu' | 'play' {
  return !game.started || game.over || paused ? 'menu' : 'play'
}

function beginRun(): void {
  game.start()
  paused = false
  lastTargetSpeed = flight.targetSpeedAt(craft.distance) // no accel sting on the first step
  // queue the run track before unlocking so audio releases straight to it - the
  // menu track never sounds when Space is the very first (unlocking) keypress.
  audio.playMusic(musicTrack())
  audio.unlock()
  input.releaseFireKeys() // the Space that started the run must not fire a bolt on step 1
}

function restart(): void {
  resetCraft(craft)
  for (const f of fields) f.reset(craft.distance)
  projectiles.reset()
  gun.reset()
  enemies.reset(craft.distance)
  game.restart()
  beginRun()
}

window.addEventListener('keydown', (e) => {
  if (INPUT.mute.includes(e.code)) {
    audio.toggleMusic()
    return
  }
  if (INPUT.modeCycle.includes(e.code)) {
    console.log('[flight] mode =', flight.cycle())
    return
  }
  if (INPUT.perf.includes(e.code)) {
    perf.toggle()
    return
  }
  if (INPUT.pause.includes(e.code)) {
    // Esc: pause a live run to the intro/menu screen, or resume from it.
    if (game.started && !game.over) {
      e.preventDefault()
      paused = !paused
      if (!paused) input.releaseFireKeys()
    }
    return
  }
  const confirm = e.code === 'Space' || e.code === 'Enter'
  if (!game.started) {
    // title screen: Space starts the run; any other key just wakes menu audio.
    if (confirm) {
      e.preventDefault()
      beginRun()
    } else {
      audio.unlock()
    }
  } else if (game.over && confirm) {
    e.preventDefault()
    restart()
  } else if (paused && confirm) {
    e.preventDefault()
    paused = false
    input.releaseFireKeys() // the resuming Space must not fire a bolt
  }
})

const fixedDt = 1 / PHYSICS.HZ
const debug = { paused: false } // freeze physics (rendering continues) for poses

// Stable closure (defined once, no per-frame alloc) so the tube can color each
// ring by the flight tier at that ring's world distance - upcoming sections show
// their color ahead of the craft.
const tierIndexAt = (worldDist: number): number => flight.tierIndexAt(worldDist)

startLoop(
  fixedDt,
  (dt) => {
    if (!game.started || debug.paused || game.over || paused) return
    // targetSpeed + speed-tied gravity are computed once per frame (preUpdate)
    // and reused across this frame's substeps - they are stable within a frame.
    updateCraft(craft, input.state, frameTargetSpeed, frameGravity, dt)
    // collection / hits live in the fixed step so a fast pass never skips the
    // window; game.update runs LAST so a hazard / enemy hit this step ends the
    // run this step (lives <= 0 -> over), with no one-frame lag.
    for (const f of fields) f.update(craft, dt)
    // gun: spend energy + emit a forward bolt at the craft's current theta.
    const shot = gun.tryFire(craft, game, dt, input.state.fire)
    if (shot.fire) {
      projectiles.spawn('player', shot.theta, SHIP.Z, -GUN.BOLT_SPEED)
      audio.play('shoot')
    }
    // enemies move + fire + ram BEFORE projectiles, so a bolt fired/spawned this
    // step and a raider's new position are both resolved in projectiles.update.
    enemies.update(craft, dt)
    projCtx.shipTheta = craft.theta
    projectiles.update(dt, projCtx)
    game.update(dt, craft.distance)
  },
  (frameDt) => {
    ship.update(craft, frameDt)
    // i-frame flicker: blink the ship while invulnerable so a hit reads clearly
    // (and so losing a life never feels random). Always visible once the run is
    // over or invulnerability has lapsed.
    ship.object.visible = game.over || game.invuln <= 0 || Math.floor(game.invuln * 12) % 2 === 0
    if (game.over && !wasOver) audio.play('gameover') // one-shot sting on the run-ending edge
    wasOver = game.over
    const music = musicTrack() // switch tracks only on a state change, not every frame
    if (music !== lastMusic) {
      audio.playMusic(music) // menu on title/over, play during a run
      lastMusic = music
    }
    rig.update(craft, frameDt)
    stars.update(stage.camera)
    tube.update(craft.distance, tierIndexAt, flight.mode)
    stage.render()
    hud.update({
      score: game.score(craft.distance),
      distance: craft.distance,
      speed: craft.speed,
      energy01: game.energy / ENERGY.MAX,
      lives: game.lives,
      over: game.over,
      started: game.started,
      paused,
      musicMuted: audio.musicMuted,
      flightMode: flight.mode,
      best: game.best,
    })
  },
  {
    // once per frame, before the fixed substeps: the flight tier's target speed
    // and the speed-tied gravity are stable across a frame, so compute them here
    // rather than every substep (they fed updateCraft ~120-240x/s before).
    preUpdate: () => {
      if (!game.started || debug.paused || game.over || paused) return
      frameTargetSpeed = flight.targetSpeedAt(craft.distance)
      if (frameTargetSpeed > lastTargetSpeed) audio.playAccel() // tier stepped up
      lastTargetSpeed = frameTargetSpeed
      frameGravity = flight.gravityForSpeed(craft.speed)
    },
    onStats: (s) => perf.sample(s), // feed the FPS / frame-time overlay (toggle: P)
  },
)

// Live tuning handle: tweak constants from the console, e.g.
//   WH.config.PHYSICS.STEER_TORQUE = 22
//   WH.craft.theta            // inspect current state
//   WH.game.lives             // inspect run state
//   WH.fields[1].object       // the treasure field's group
;(window as unknown as { WH: unknown }).WH = {
  craft,
  debug,
  fields,
  enemies,
  projectiles,
  gun,
  game,
  flight, // WH.flight.mode = 'slow' | 'normal' | 'fast' | 'sections' (or press G)
  audio,
  begin: beginRun, // start the run from the console / screenshot tool (skips the title gate)
  config: { PHYSICS, SPEED, FLIGHT, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BACKGROUND, ENERGY, LIVES, SCORE, GUN, ENEMY, PROJECTILE, AUDIO },
}

import { createStage } from './render/scene'
import { createCameraRig } from './render/camera'
import { createStarfield } from './render/stars'
import { createTube } from './world/tube'
import { createShip } from './world/ship'
import { createBurst } from './world/burst'
import { createBlastFx, type RGB } from './world/blastFx'
import { createGate } from './world/gate'
import { Input } from './input'
import { createSession, type DamageCause, type PickupKind, type SessionFx } from './session'
import { seedRng } from './util/rng'
import { createHud } from './hud'
import { createMenu } from './menu'
import { createAudio } from './audio'
import { createPerfOverlay } from './render/perf'
import { startLoop, createHitStop } from './loop'
import { createShake } from './render/shake'
import { angleDiff } from './util/math'
import { PHYSICS, SPEED, FLIGHT, LEVELS, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BLAST, BLAST_FX, EXTRA_LIFE, BACKGROUND, ENERGY, LIVES, GUN, ENEMY, PROJECTILE, BURST, INPUT, AUDIO, DIFFICULTY, FEEL, SEQUENCE, GATE } from './config'

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

// Physical feel (view only): the camera shake and the hit slow-down. Neither
// touches the craft state or the aim.
const shake = createShake()
const hitStop = createHitStop(FEEL.HITSTOP)
const rig = createCameraRig(stage.camera, stage.setFovOffset, shake)
const input = new Input()
const hud = createHud()
// Impact bursts (white-hot flash + shards): a shared pooled effect played on a real
// hit so the player SEES it. A damaging hit (mine / ram / enemy bolt) flashes the hull
// red AND spawns a big, short, world-anchored red burst at the impact point; a kill
// spawns a magenta burst at the raider (see config BURST for the two kinds).
const burst = createBurst()
stage.scene.add(burst.object)
stage.onResize((w, h) => burst.setResolution(w, h))

// The look of a mine blast: rim, wave, mine shards, debris of what it destroyed.
const blastFx = createBlastFx()
stage.scene.add(blastFx.object)
stage.onResize((w, h) => blastFx.setResolution(w, h))

// The level gate: the ring that comes out of the fog once the gem quota is met.
const gate = createGate()
stage.scene.add(gate.object)
stage.onResize((w, h) => gate.setResolution(w, h))

const audio = createAudio()
let gateCueThisGem = false // the gem that meets the quota plays the gate cue, not its chime
let lastLoopCue = -Infinity // game time of the last loop cue
let deathCause: DamageCause | undefined // cause of the last life lost this run

// The gameplay itself (craft, levels, fields, gun, raiders, bolts, run state and
// the fixed-step order) lives in session.ts, shared with the headless playtest
// harness. Here we only attach what the player sees and hears to its events.
const fx: SessionFx = {
  orbCollected: () => {
    audio.play('orb')
    ship.flash()
  },
  // the gem chime climbs the ladder with the chain; the gem that meets the quota
  // plays the gate cue instead
  gemCollected: (_points, chain) => {
    if (gateCueThisGem) gateCueThisGem = false
    else audio.play('gem', 0, 1, chain - 1)
  },
  quotaReached: () => {
    gateCueThisGem = true
    audio.play('gateOpen')
    hud.pulseGems()
    hud.showGate()
    gate.open(flight.gateAt)
  },
  // the craft is through the gate: the fanfare, the headline, and the gate opens around the ship
  levelUp: (level) => {
    audio.play('levelup')
    tube.flash(FEEL.TUBE_FLASH.PEAK * GATE.FLASH)
    gate.pass()
    hud.showLevel(level + 1, flight.scoreMultiplier)
  },
  loopCompleted: () => {
    // a deliberate loop is a moment; an endless spin is not, so the cue rests between loops
    if (game.elapsed - lastLoopCue < FEEL.LOOP_CUE_GAP) return
    lastLoopCue = game.elapsed
    audio.play('loop')
    tube.flash(FEEL.TUBE_FLASH.PEAK * FEEL.LOOP_FLASH)
  },
  mineNearMiss: (theta) => {
    audio.play('whoosh', sideOf(theta))
    shake.add(FEEL.SHAKE.NEAR)
  },
  // the charge whine comes from the raider's side, louder the closer its line is to
  // yours (from FEEL.CHARGE_GAIN_MIN across the tube up to full gain on your line)
  enemyChargeStarted: (theta) => {
    const near = 1 - Math.abs(angleDiff(theta, craft.theta)) / Math.PI
    audio.play('charge', sideOf(theta), FEEL.CHARGE_GAIN_MIN + (1 - FEEL.CHARGE_GAIN_MIN) * near * near)
  },
  enemyChipped: () => audio.play('chip'),
  waveCleared: () => audio.play('waveClear'), // the squad is destroyed: a soft chime opens the breather
  lifeCollected: () => {
    audio.play('life')
    ship.flash(RENDER.SHIP_LIFE_FLASH_RGB)
  },
  // a caught shard that does not complete the set: its step of the rising tone
  // (the completing shard plays the 1-up through lifeCollected instead)
  shardCollected: (count, restored) => {
    if (!restored) audio.play('shard', 0, 1, shardToneStep(count))
  },
  // a shard or cross caught at full lives paid score: the top step of the shard tone
  bonusCollected: () => audio.play('shard', 0, 1, 1),
  crossDropped: (theta) => audio.play('cross', sideOf(theta)),
  // a life was lost (never fires during i-frames, so a graze stays silent): the
  // explosion cue, a red hull flash, and a red burst at the impact point (the mine's
  // own position, or the ship for a ram / enemy bolt).
  damaged: (cause, theta, z) => {
    deathCause = cause // the last life lost names the cause on the game-over panel
    audio.play('hit')
    ship.flash(RENDER.SHIP_HIT_FLASH_RGB)
    burst.spawn('damage', theta, z, craft.distance)
    shake.add(FEEL.SHAKE.DAMAGE)
    hitStop.trigger()
  },
  enemyFired: () => audio.play('enemyFire'),
  enemyKilled: (theta, z) => {
    audio.play('kill')
    burst.spawn('kill', theta, z, craft.distance) // magenta detonation where the raider died
    shake.add(FEEL.SHAKE.KILL)
  },
  // A mine went off (every link of a chain reports in the same step; blastFx and the
  // sound hold each link back by its turn in the ripple).
  mineDetonated: (theta, z, link) => {
    blastFx.detonate(theta, craft.distance - z, link)
    audio.play('blast', sideOf(theta), 1, link)
    shake.add(link === 0 ? FEEL.SHAKE.BLAST : FEEL.SHAKE.BLAST_LINK)
    if (link === 0) tube.flash(FEEL.TUBE_FLASH.PEAK * FEEL.BLAST_FLASH)
  },
  // a pickup the blast destroyed breaks into streaks of its own colour
  pickupBlasted: (kind, theta, z) => blastFx.debris(theta, craft.distance - z, DEBRIS_RGB[kind], BLAST_FX.DEBRIS_PIECES),
  // destroyed by the blast, not shot: dim streaks, no kill burst, no kill sound
  raiderBlasted: (theta, z) => blastFx.debris(theta, craft.distance - z, RAIDER_DEBRIS_RGB, BLAST_FX.DEBRIS_RAIDER_PIECES),
  playerFired: () => audio.play('shoot'),
  dryFired: () => audio.play('empty'), // dull click: no charge to fire
  tierUp: () => audio.playAccel(),
}
// The colour of the streaks a blasted object breaks into: its own edge colour.
const lit = (rgb: RGB, k: number): RGB => [rgb[0] * k, rgb[1] * k, rgb[2] * k]
const DEBRIS_RGB: Record<PickupKind, RGB> = {
  orb: lit(PICKUP.EDGE_RGB, BLAST_FX.DEBRIS_ORB_GAIN),
  gem: lit(TREASURE.EDGE_RGB, BLAST_FX.DEBRIS_GAIN),
  life: EXTRA_LIFE.EDGE_RGB, // already HDR green
  shard: EXTRA_LIFE.EDGE_RGB,
}
const RAIDER_DEBRIS_RGB = lit(ENEMY.EDGE_RGB, BLAST_FX.DEBRIS_RAIDER_DIM)
// Stereo side of something at `theta` relative to the craft: -1 left .. 1 right.
const sideOf = (theta: number): number => Math.sin(angleDiff(theta, craft.theta))
// Step of the shard tone for the `count`-th shard of a set: 0 for the first, 1 for
// the last one before the completing shard (which plays the 1-up instead).
const shardToneStep = (count: number): number => (count - 1) / Math.max(1, game.shardsPerLife - 2)
const session = createSession(fx)
const { craft, flight, game, fields, enemies, projectiles, gun } = session
for (const sys of [...fields, enemies, projectiles]) {
  stage.scene.add(sys.object)
  stage.onResize((w, h) => sys.setResolution(w, h))
}

// Title-screen settings (ship hull + difficulty), persisted locally. Applied
// immediately at boot so the preview, the HUD, and the level math all agree
// before the first run starts.
const menu = createMenu()
ship.setHull(menu.hullId())
flight.setDifficulty(menu.diffIndex)
session.replan() // the gem lines follow the mode's speeds
hud.setMenu(menu.shipName(), menu.diffIndex, menu.row)
const perf = createPerfOverlay() // press P to toggle the FPS / frame-time overlay
let paused = false // Esc pauses a live run to the intro/menu screen; resume with Space or Esc
audio.arm() // a click/tap to focus the canvas wakes the menu track (autoplay policy)
audio.playMusic(musicTrack()) // 'menu' on the title; queued until the first gesture unlocks audio

// Run-flow gate: the sim is frozen on the title screen (game.started=false) and
// on the game-over screen (game.over). menu.mp3 plays on both; music.mp3 during
// a run. The first run starts on Space from the title; after a game over, Enter
// returns to the title (intro + instructions) and the next run starts from there.
let wasOver = false // detects the run-ending edge once in render (sting)
let gemHintShown = false // the one-time gem reminder fires on the first run of the session
let lastMusic: 'menu' | 'play' = musicTrack() // cache: switch tracks only on change

// Which music track the current state wants: menu on the title / game-over, the
// run track otherwise. Driven every frame (playMusic no-ops when unchanged) and
// in beginRun (before unlock) so the menu never blips on start.
function musicTrack(): 'menu' | 'play' {
  return !game.started || game.over || paused ? 'menu' : 'play'
}

function beginRun(): void {
  session.begin()
  paused = false
  // queue the run track before unlocking so audio releases straight to it - the
  // menu track never sounds when Space is the very first (unlocking) keypress.
  audio.playMusic(musicTrack())
  audio.unlock()
  input.releaseFireKeys() // the Space that started the run must not fire a bolt on step 1
  if (!gemHintShown) { hud.flashGemHint(); gemHintShown = true } // one-time gate reminder
}

// Game-over -> intro: reset the run and show the title screen (instructions),
// rather than dropping straight into a new run. The next run starts from the title
// on Space/Enter (beginRun), exactly like the first run on load.
function returnToTitle(): void {
  deathCause = undefined
  lastLoopCue = -Infinity
  session.reset()
  burst.reset()
  blastFx.reset()
  gate.reset()
  hitStop.reset()
  rig.reset()
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return // run-flow keys act once per press, never on auto-repeat (a held
  // Enter must not carry a game-over -> title transition straight on into a new run)
  if (INPUT.mute.includes(e.code)) {
    audio.toggleMusic()
    return
  }
  if (INPUT.modeCycle.includes(e.code)) {
    console.log('[flight] mode =', flight.cycle())
    gate.reset() // a mode switch closes an open gate
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
  if (!game.started) {
    // title screen: arrows drive the ship/difficulty selectors, Space or Enter
    // starts the run; any other key just wakes menu audio.
    const changed = menu.handleKey(e.code)
    if (changed) {
      e.preventDefault()
      if (changed === 'ship') ship.setHull(menu.hullId())
      if (changed === 'difficulty') {
        flight.setDifficulty(menu.diffIndex)
        session.replan() // the gem lines follow the mode's speeds
      }
      hud.setMenu(menu.shipName(), menu.diffIndex, menu.row)
      return
    }
    if (INPUT.start.includes(e.code)) {
      e.preventDefault()
      beginRun()
    } else {
      audio.unlock()
    }
    return
  }
  if (game.over) {
    // game-over: Enter returns to the title screen (instructions), NOT Space - so a
    // held/tapped fire key cannot dismiss the screen the instant the last life is lost.
    if (INPUT.confirm.includes(e.code)) {
      e.preventDefault()
      returnToTitle()
    }
    return
  }
  if (paused) {
    // resume on Enter (Esc above also toggles a paused run back to running); not Space.
    if (INPUT.confirm.includes(e.code)) {
      e.preventDefault()
      paused = false
      input.releaseFireKeys()
    }
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
    session.step(input.state, dt)
  },
  (frameDt) => {
    // On the real title screen (not pause, not game-over) the ship becomes the
    // menu's turntable preview in front of the camera; everywhere else it rides
    // the wall as usual. update() fully re-poses the group, so no cleanup needed.
    if (!game.started && !game.over) ship.preview(stage.camera, frameDt)
    else ship.update(craft, frameDt)
    // impact bursts are pure-visual, frame-paced; frozen during a gameplay pause so a
    // burst caught mid-flight resumes on unpause (matches the frozen field pops). NOT
    // gated on game-over (a final death-burst plays through) or debug.paused (the
    // SHOOT_BURST harness animates staged bursts under it).
    if (!paused) burst.update(frameDt, craft.distance)
    if (!paused) blastFx.update(frameDt, craft.distance)
    if (!paused) gate.update(frameDt, craft.distance) // also on game-over, so a gate never freezes mid-fade
    // i-frame flicker: blink the ship while invulnerable so a hit reads clearly
    // (and so losing a life never feels random). Always visible once the run is
    // over, paused, or invulnerability has lapsed (a paused run freezes invuln, so
    // without this the blink could freeze mid-off and the ship vanish under the menu).
    ship.object.visible = paused || game.over || game.invuln <= 0 || Math.floor(game.invuln * 12) % 2 === 0
    if (game.over && !wasOver) audio.play('gameover') // one-shot sting on the run-ending edge
    wasOver = game.over
    const music = musicTrack() // switch tracks only on a state change, not every frame
    if (music !== lastMusic) {
      audio.playMusic(music) // menu on title/over, play during a run
      lastMusic = music
    }
    // the speed FOV follows the run's flight (held while paused); the title keeps the base view
    rig.update(craft, frameDt, game.started ? flight.speed01(craft.speed) : 0)
    stars.update(stage.camera)
    tube.update(craft.distance, tierIndexAt, flight.mode, frameDt)
    stage.render()
    hud.update({
      score: game.score(),
      speed: craft.speed,
      energy01: game.energy / ENERGY.MAX,
      lives: game.lives,
      shards: game.shards,
      shardsPerLife: game.shardsPerLife,
      gemsThisLevel: game.gemsThisLevel,
      // pinned G-key modes have no levels, so report quota 0 there (HUD blanks the pip row)
      gemQuota: flight.mode === 'sections' ? flight.gemQuota(flight.level) : 0,
      elapsed: game.elapsed,
      over: game.over,
      started: game.started,
      paused,
      musicMuted: audio.musicMuted,
      flightMode: flight.mode,
      level: flight.level + 1, // 0-based internally, shown 1-based
      best: game.best,
      difficultyIndex: menu.diffIndex,
      deathCause,
    })
  },
  {
    // once per frame, before the fixed substeps (see session.preUpdate)
    timeScale: (frameDt) => hitStop.scale(frameDt),
    preUpdate: () => {
      if (!game.started || debug.paused || game.over || paused) return
      session.preUpdate()
    },
    onStats: (s) => perf.sample(s), // feed the FPS / frame-time overlay (toggle: P)
  },
)

// Live tuning handle: tweak constants from the console, e.g.
//   WH.config.PHYSICS.STEER_TORQUE = 22
//   WH.craft.theta            // inspect current state
//   WH.game.lives             // inspect run state
//   WH.session.fieldByKind.gem.object // the treasure field's group
;(window as unknown as { WH: unknown }).WH = {
  session, // the whole gameplay session (what the playtest bots drive)
  fx, // the session's event hooks; the live playtest harness wraps these to count events
  craft,
  debug,
  fields,
  enemies,
  projectiles,
  burst,
  blastFx, // the mine blast look (WH.blastFx.detonate(theta, worldDistance, 0))
  gate, // the level gate ring
  ship, // the player hull (WH.ship.setHull("delta"))
  shake, // view shake (WH.shake.add(0.6) previews a hit jolt)
  hitStop, // hit slow-down (WH.hitStop.trigger())
  gun,
  game,
  flight, // WH.flight.mode = 'slow' | 'normal' | 'fast' | 'sections' (or press G)
  menu, // title-screen ship + difficulty selection
  audio,
  begin: beginRun, // start the run from the console / screenshot tool (skips the title gate)
  // Reproducible run: seed the gameplay randomness, then re-lay the fields from it.
  // Call on the title screen, before starting (the live playtest harness does).
  reseed: (seed: number): void => {
    seedRng(seed)
    returnToTitle()
  },
  config: { PHYSICS, SPEED, FLIGHT, LEVELS, CAMERA, TUBE, SHIP, RENDER, PICKUP, TREASURE, HAZARD, BLAST, BLAST_FX, EXTRA_LIFE, BACKGROUND, ENERGY, LIVES, GUN, ENEMY, PROJECTILE, BURST, INPUT, AUDIO, DIFFICULTY, FEEL, SEQUENCE, GATE },
}

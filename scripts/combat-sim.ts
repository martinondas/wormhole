// Headless behavior sim for the combat loop (npm run sim). Drives the real gun,
// projectiles, enemies and game through the fixed-step order of the session, with
// no browser or WebGL (three.js objects construct without a renderer). It checks:
//   A-G  the gun and its charge, kills, enemy bolts, rams, i-frames, how a raider
//        leaves, and that passive flight scores nothing;
//   H-L  the raiders as a group: fire slots, charge tells, waves at several tuning
//        levels, the hunter, formations and depth lanes;
//   M    life shards and squad crosses, in the real session.
import { PHYSICS, SPEED, SHIP, GUN, ENEMY, LEVELS, LIVES, LIFE_SHARD, EXTRA_LIFE } from '../src/config'
import { createSession } from '../src/session'
import { createCraft, updateCraft, type CraftState } from '../src/craft'
import { createGame, type Game } from '../src/game'
import { createGun, type Gun } from '../src/gun'
import { createProjectiles, type Projectiles } from '../src/world/projectiles'
import { createEnemies, type Enemies, type EnemyDeps } from '../src/world/enemies'
import { waveAliveCap, waveRoster, fireStagger } from '../src/levels'
import { angleDiff } from '../src/util/math'
import { seedRng } from '../src/util/rng'
import { check, finish, withConfig, driveSession, STEP_DT as dt } from './sim-kit'

const NEUTRAL = { steerTarget: 0, fire: false }

interface Rig {
  craft: CraftState
  game: Game
  gun: Gun
  projectiles: Projectiles
  enemies: Enemies
}
// The wired systems of one test. By default an enemy bolt is spawned, a ram costs a
// life and a kill pays score and charge; `deps` replaces any of these. `level` is
// the tuning level of the raiders (AGGRESSION_FROM: ENEMY.FIRE_COOLDOWN applies as written).
function makeRig(deps: Partial<EnemyDeps> = {}, level: number = LEVELS.AGGRESSION_FROM): Rig {
  const craft = createCraft()
  const game = createGame()
  const gun = createGun()
  const projectiles = createProjectiles()
  const enemies = createEnemies({
    spawnEnemyBolt: (t, z, vz) => projectiles.spawn('enemy', t, z, vz),
    onRam: () => game.hitHazard(),
    onKill: () => {
      game.addScore(ENEMY.SCORE)
      game.addEnergy(ENEMY.ENERGY_REFUND)
    },
    ...deps,
  })
  enemies.reset(0)
  enemies.setLevel(level)
  return { craft, game, gun, projectiles, enemies }
}
// hooks of a rig whose raiders cannot hurt the craft and pay nothing
const HARMLESS: Partial<EnemyDeps> = { onRam: () => false, onKill: () => {} }

// one fixed step, in the order of the session
function step(r: Rig, fireHeld: boolean, opts: { integrate?: boolean } = {}): void {
  if (opts.integrate === false) {
    r.craft.distance += r.craft.speed * dt // advance forward but freeze theta
  } else {
    updateCraft(r.craft, { ...NEUTRAL, fire: fireHeld }, SPEED.NORMAL, PHYSICS.GRAVITY_K, SPEED.FAST, dt)
  }
  const shot = r.gun.tryFire(r.craft, r.game, dt, fireHeld)
  if (shot.fire) r.projectiles.spawn('player', shot.theta, SHIP.Z, -GUN.BOLT_SPEED)
  r.enemies.update(r.craft, dt)
  r.projectiles.update(dt, {
    tryKillEnemy: (t, z) => r.enemies.tryKill(t, z),
    shipTheta: r.craft.theta,
    onShipHit: () => r.game.hitHazard(),
  })
  r.game.update(dt)
}

// ---- A) gun: energy per shot, rate limit, inert at low energy, never ends run
;(() => {
  const r = makeRig()
  const e0 = r.game.energy
  let shots = 0
  for (let i = 0; i < PHYSICS.HZ; i++) {
    // count shots by the per-step charge drop: the charge falls only on a shot
    // (spendEnergy), so any drop of about a shot's cost is one shot.
    const before = r.game.energy
    step(r, true)
    if (before - r.game.energy > GUN.COST * 0.5) shots++
  }
  check('A1 gun fires ~4/s while held', shots >= 3 && shots <= 5, `shots=${shots}`)
  check('A2 firing drains energy', r.game.energy < e0, `energy ${e0.toFixed(1)} -> ${r.game.energy.toFixed(1)}`)

  // drop energy below one shot: trigger must be inert and never end the run
  r.game.energy = GUN.COST - 1
  const overBefore = r.game.over
  let fired = false
  for (let i = 0; i < 60; i++) {
    const shot = r.gun.tryFire(r.craft, r.game, dt, true)
    if (shot.fire) fired = true
  }
  check('A3 trigger inert below GUN.COST', !fired)
  check('A4 firing never ends the run', r.game.over === overBefore && !r.game.over)
})()

// ---- B) kill: 2 aligned hits -> +SCORE, +ENERGY_REFUND, killed==1
// STRAFE_AMP 0 holds the raider's theta; FIRE_COOLDOWN 999: it does not shoot back
withConfig(ENEMY, { STRAFE_AMP: 0, FIRE_COOLDOWN: 999 }, () => {
  const r = makeRig()
  r.enemies.debugStage(0, -32) // engage, dead ahead, in the band
  r.game.energy = 50 // mid-bar: the refund lands unclamped and observable for any refund value
  const scoreBefore = r.game.score()
  // The killing bolt is fired ~0.17s before it lands, so the step that resolves the
  // kill does not also fire (cooldown). preKillStep is the charge at the start of that
  // step, so its delta is exactly the applied refund - independent of refund magnitude.
  let preKillStep = r.game.energy
  let steps = 0
  while (r.enemies.killed < 1 && steps < PHYSICS.HZ * 3) {
    preKillStep = r.game.energy
    step(r, true)
    steps++
  }
  check('B1 enemy killed by aligned fire', r.enemies.killed === 1, `killed=${r.enemies.killed} in ${(steps * dt).toFixed(2)}s`)
  check('B2 kill scores ENEMY.SCORE', r.game.scoreBonus === ENEMY.SCORE, `scoreBonus=${r.game.scoreBonus}`)
  check('B3 score jumped by at least the points of a kill', r.game.score() - scoreBefore >= ENEMY.SCORE, '')
  check('B4 kill applied ENERGY_REFUND', Math.abs((r.game.energy - preKillStep) - ENEMY.ENERGY_REFUND) < 1e-6, `kill-step refund=${(r.game.energy - preKillStep).toFixed(1)}`)
})

// ---- C) enemy bolt: lethal when aligned, dodged when theta swung away
withConfig(ENEMY, { FIRE_COOLDOWN: 0.1, FIRE_JITTER: 0, CHARGE_TIME: 0.1, STRAFE_AMP: 0 }, () => {
  // aligned: ship holds theta 0 where the enemy fires from -> a life is lost
  {
    const r = makeRig()
    r.enemies.debugStage(0, -34)
    const lives0 = r.game.lives
    for (let i = 0; i < PHYSICS.HZ * 2; i++) step(r, false, { integrate: false }) // theta frozen at 0
    check('C1 aligned: enemy bolt costs a life', r.game.lives < lives0, `lives ${lives0} -> ${r.game.lives}`)
  }
  // dodged: ship sits far in theta from the enemy's firing line -> no life lost
  {
    const r = makeRig()
    r.enemies.debugStage(0, -34)
    r.craft.theta = 1.6 // swung well away from the enemy's theta 0
    const lives0 = r.game.lives
    for (let i = 0; i < PHYSICS.HZ * 2; i++) step(r, false, { integrate: false }) // hold theta 1.6
    check('C2 dodged: no life lost', r.game.lives === lives0, `lives stayed ${r.game.lives}`)
  }
})

// ---- D) ram: hull contact at the ship plane costs a life, enemy survives
withConfig(ENEMY, { STRAFE_AMP: 0, FIRE_COOLDOWN: 999 }, () => {
  const r = makeRig()
  r.enemies.debugStage(0, -1.5) // staged right at the ship plane, same theta
  const lives0 = r.game.lives
  const killed0 = r.enemies.killed
  step(r, false, { integrate: false })
  check('D1 ram costs a life', r.game.lives === lives0 - 1, `lives ${lives0} -> ${r.game.lives}`)
  check('D2 ram does not kill the enemy', r.enemies.killed === killed0, `killed=${r.enemies.killed}`)
})

// ---- E) one encounter costs at most one life (invuln-first guard)
;(() => {
  const r = makeRig()
  const lives0 = r.game.lives
  r.game.hitHazard()
  r.game.hitHazard() // second in the same i-frame window must be a no-op
  check('E1 two hits in one i-frame window cost one life', r.game.lives === lives0 - 1, `lives ${lives0} -> ${r.game.lives}`)
})()

// ---- F) leaving: a raider whose time in the lane is up leaves FORWARD into the
// fog. It never comes back through the ship plane, so it cannot ram a player who
// simply did not shoot it. Only a raider that already slipped behind the ship falls
// back (and can still be rammed into, see D).
// STRAFE_AMP 0 holds the raider on the ship's line (theta 0), FIRE_COOLDOWN 999
// keeps lethal bolts out of the check, ENGAGE_TIME 0.3: its time is up almost at
// once, FIRST_DELAY 999: no wave of its own during the check.
const F_ENEMY = { STRAFE_AMP: 0, FIRE_COOLDOWN: 999, ENGAGE_TIME: 0.3, ENGAGE_TIME_JITTER: 0 }
withConfig(ENEMY, F_ENEMY, () => withConfig(ENEMY.WAVE, { FIRST_DELAY: 999 }, () => {
  {
    const r = makeRig()
    r.enemies.debugStage(0, -40) // engaged on the ship's line
    const lives0 = r.game.lives
    let maxZ = -Infinity
    let sawExit = false
    let gone = false
    for (let i = 0; i < PHYSICS.HZ * 6 && !gone; i++) {
      step(r, false, { integrate: false }) // ship holds theta 0 and advances forward
      let seen = false
      r.enemies.visit((_theta, z, phase) => {
        seen = true
        if (z > maxZ) maxZ = z
        if (phase === 'exit') sawExit = true
      })
      if (sawExit && !seen) gone = true
    }
    check(
      'F1 a timed-out raider leaves forward and never crosses the ship plane',
      sawExit && gone && maxZ < -39 && r.game.lives === lives0,
      `exit=${sawExit} gone=${gone} nearest z=${maxZ.toFixed(1)} lives ${lives0} -> ${r.game.lives}`,
    )
  }
  {
    const r = makeRig()
    r.enemies.debugStage(1.5, ENEMY.ENGAGE_BREAK_Z + 2) // already behind the ship, off its line
    let phaseSeen = ''
    let gone = false
    for (let i = 0; i < PHYSICS.HZ * 3 && !gone; i++) {
      step(r, false, { integrate: false })
      let seen = false
      r.enemies.visit((_theta, _z, phase) => {
        seen = true
        phaseSeen = phase
      })
      if (!seen) gone = true
    }
    check('F2 a raider that slipped behind the ship falls behind and recycles', phaseSeen === 'depart' && gone, `phase=${phaseSeen} gone=${gone}`)
  }
}))

// ---- G) scoring: passive flight earns nothing ----
// Flying without collecting or killing scores 0, however far the craft travels:
// score comes only from gems and kills.
;(() => {
  const r = makeRig()
  for (let i = 0; i < PHYSICS.HZ * 3; i++) step(r, false) // 3s of passive flight, no firing
  check('G1 passive flight scores 0 (no distance points)', r.game.score() === 0, `score=${r.game.score()}, dist=${Math.round(r.craft.distance)}`)
})()

// ---- H) fire-slot cap: many engaged raiders, bounded simultaneous fire ----
// Stage a full pool of raiders with a near-zero cooldown: every one of them wants
// to fire immediately. A bolt requires holding one of the ENEMY.FIRE_SLOTS for the
// full CHARGE_TIME, so bolts over a window T are hard-bounded by
// FIRE_SLOTS * (T / CHARGE_TIME + 1) - independent of how many raiders engage.
// (Uncapped, four parallel chargers would fire roughly 4 * T / CHARGE_TIME, ~2x over.)
withConfig(ENEMY, { STRAFE_AMP: 0, FIRE_COOLDOWN: 0.01, FIRE_JITTER: 0 }, () => {
  let bolts = 0
  const r: Rig = makeRig({
    spawnEnemyBolt: (t, z, vz) => {
      bolts++
      r.projectiles.spawn('enemy', t, z, vz)
    },
  })
  // thetas well off the ship's line (theta 0) so no bolt lands and no ram triggers
  const staged = LEVELS.MAX_ENEMIES_CAP
  for (let i = 0; i < staged; i++) r.enemies.debugStage(1.0 + i * 0.8, -35, i)
  const T = 2
  for (let i = 0; i < PHYSICS.HZ * T; i++) step(r, false, { integrate: false })
  const bound = ENEMY.FIRE_SLOTS * (T / ENEMY.CHARGE_TIME + 1)
  check('H1 bolts bounded by the fire slots', bolts <= bound, `bolts=${bolts} bound=${bound.toFixed(1)}`)
  check('H2 raiders still fire under the cap', bolts >= 2, `bolts=${bolts}`)
})

// ---- I) every charge start is reported once: starts = bolts + aborted charges ----
// Quick waves of six with a short cooldown and a short time in the lane, and a
// player firing down theta 0 now and then: charges end in a bolt, in the raider's
// death, or in its leaving. A charging raider holds its theta, so a start is tracked
// by its line: it is resolved by a bolt down that line, it stays pending while a
// raider still sits on that line charging, and otherwise it was aborted.
// Independently, every raider seen with a charge tell must belong to a reported start.
const I_ENEMY = {
  SPAWN_AHEAD: 70, // new members reach their lanes quickly
  FIRE_COOLDOWN: 0.2,
  FIRE_COOLDOWN_DEEP: 0.2,
  FIRE_JITTER: 0.1,
  ENGAGE_TIME: 1.4,
  ENGAGE_TIME_JITTER: 1.0,
  STRAFE_AMP: 0.3,
}
const quickWaves = (fn: () => void): void =>
  withConfig(ENEMY, I_ENEMY, () =>
    withConfig(ENEMY.WAVE, { FIRST_DELAY: 0, REINFORCE_DELAY: 0.3 }, () => withConfig(ENEMY.WAVE.BREATHER, { BASE: 0.5, MIN: 0.5 }, fn)))
quickWaves(() => {
  seedRng(7)
  let starts = 0
  let bolts = 0
  let aborts = 0
  let unreported = 0
  const pending: number[] = [] // lines of charges not yet resolved
  const boltLines: number[] = []
  const freshLines: number[] = [] // starts in the current step
  const r: Rig = makeRig(
    {
      ...HARMLESS,
      spawnEnemyBolt: (t, z, vz) => {
        bolts++
        boltLines.push(t)
        r.projectiles.spawn('enemy', t, z, vz)
      },
      onChargeStart: (t) => {
        starts++
        pending.push(t)
        freshLines.push(t)
      },
    },
    6,
  )
  const { craft, game, gun, projectiles, enemies } = r
  enemies.setMaxActive(waveAliveCap(6))
  const charging: number[] = [] // lines of raiders seen with a tell this step
  game.energy = 1e9
  for (let i = 0; i < PHYSICS.HZ * 120; i++) {
    boltLines.length = 0
    freshLines.length = 0
    craft.distance += SPEED.NORMAL * dt
    const shot = gun.tryFire(craft, game, dt, i % (PHYSICS.HZ * 4) < PHYSICS.HZ / 2) // fire 0.5 s in every 4 s
    if (shot.fire) projectiles.spawn('player', shot.theta, SHIP.Z, -GUN.BOLT_SPEED)
    enemies.update(craft, dt)
    projectiles.update(dt, { tryKillEnemy: (t, z) => enemies.tryKill(t, z), shipTheta: 9, onShipHit: () => false })
    charging.length = 0
    enemies.visit((theta, _z, _phase, charge01) => {
      if (charge01 > 0) charging.push(theta)
    })
    for (const line of charging) if (!pending.includes(line)) unreported++
    for (let k = pending.length - 1; k >= 0; k--) {
      const line = pending[k]!
      if (boltLines.includes(line)) pending.splice(k, 1)
      else if (!charging.includes(line) && !freshLines.includes(line)) {
        pending.splice(k, 1)
        aborts++
      }
    }
  }
  check('I1 charge starts = bolts + aborted charges', starts === bolts + aborts + pending.length, `starts=${starts} bolts=${bolts} aborts=${aborts} pending=${pending.length}`)
  check('I2 every visible tell was reported as a charge start', unreported === 0, `unreported=${unreported}`)
  check('I3 the scenario has both outcomes', bolts > 10 && aborts > 5, `bolts=${bolts} aborts=${aborts} kills=${enemies.killed}`)
})

// ---- J) waves: the director on the real constants, at several tuning levels ----
// A craft swinging gently around the bottom that fires in bursts, for three minutes
// per level. Checked every step: live raiders never exceed the alive cap. Checked
// per bolt: at least 0.80 s from the start of its tell to its arrival at the ship
// plane. Checked per tell: never closer than FIRE_STAGGER to the tell before it.
// A raider is never seen behind the ship (it leaves forward).
;(() => {
  const TELL_MIN = 0.8
  for (const T of [0, 1, 2, 4, 7, 9, 14]) {
    seedRng(100 + T)
    let now = 0
    let lastStart = -Infinity
    let minStagger = Infinity
    let minTell = Infinity
    let bolts = 0
    let clears = 0
    const startLine: number[] = []
    const startAt: number[] = []
    const r: Rig = makeRig(
      {
        ...HARMLESS,
        spawnEnemyBolt: (theta, z, vz) => {
          bolts++
          const k = startLine.lastIndexOf(theta)
          if (k >= 0) {
            minTell = Math.min(minTell, now - startAt[k]! + -z / ENEMY.BULLET_SPEED)
            startLine.splice(k, 1)
            startAt.splice(k, 1)
          } else minTell = 0 // a bolt without a tell
          r.projectiles.spawn('enemy', theta, z, vz)
        },
        onChargeStart: (theta) => {
          minStagger = Math.min(minStagger, now - lastStart)
          lastStart = now
          startLine.push(theta)
          startAt.push(now)
        },
        onWaveClear: () => clears++,
      },
      T,
    )
    const cap = waveAliveCap(T)
    r.enemies.setMaxActive(cap)
    r.game.energy = 1e9
    let maxAlive = 0
    let maxZ = -Infinity
    let waves = 0
    let wasActive = false
    const input = { steerTarget: 0, fire: false }
    for (let i = 0; i < PHYSICS.HZ * 180; i++) {
      now = i * dt
      input.steerTarget = Math.sin(now * 0.9) > 0.6 ? 1 : Math.sin(now * 0.9) < -0.6 ? -1 : 0
      updateCraft(r.craft, input, SPEED.NORMAL, PHYSICS.GRAVITY_K, SPEED.FAST, dt)
      const shot = r.gun.tryFire(r.craft, r.game, dt, i % (PHYSICS.HZ * 3) < PHYSICS.HZ * 1.5)
      if (shot.fire) r.projectiles.spawn('player', shot.theta, SHIP.Z, -GUN.BOLT_SPEED)
      r.enemies.update(r.craft, dt)
      r.projectiles.update(dt, { tryKillEnemy: (t, z) => r.enemies.tryKill(t, z), shipTheta: r.craft.theta, onShipHit: () => false })
      let alive = 0
      r.enemies.visit((_theta, z) => {
        alive++
        if (z > maxZ) maxZ = z
      })
      if (alive > maxAlive) maxAlive = alive
      if (r.enemies.waveActive && !wasActive) waves++
      wasActive = r.enemies.waveActive
    }
    check(`J1 T${T}: live raiders never exceed the alive cap`, maxAlive <= cap && maxAlive > 0, `max alive=${maxAlive} cap=${cap}`)
    check(`J2 T${T}: every bolt has at least ${TELL_MIN.toFixed(2)} s from tell to arrival`, bolts > 0 && minTell >= TELL_MIN, `bolts=${bolts} shortest=${minTell.toFixed(3)}s`)
    check(`J3 T${T}: two tells are never closer than the level's fire stagger`, minStagger >= fireStagger(T) - 1e-9, `closest=${minStagger.toFixed(3)}s`)
    check(`J4 T${T}: no raider behind the ship`, maxZ < 0, `nearest z=${maxZ.toFixed(1)}`)
    check(`J5 T${T}: waves come and go (roster ${waveRoster(T)})`, waves >= 3 && r.enemies.killed > 0, `waves=${waves} cleared=${clears} kills=${r.enemies.killed}`)
  }
})()

// ---- K) hunter: slides to the player's line, fires only when it is on it ----
// ENGAGE_TIME 999: the staged hunter never leaves. FIRST_DELAY 999 keeps waves out of
// the first three cases; the last two run with FIRST_DELAY 0, so a wave may start at once.
const stageHunter = (r: Rig, theta: number): void => r.enemies.debugStage(theta, ENEMY.LANES[1], 0, 'hunter')
withConfig(ENEMY, { ENGAGE_TIME: 999 }, () => {
  withConfig(ENEMY.WAVE, { FIRST_DELAY: 999 }, () => {
    // parked craft: the hunter comes from the side wall and its tells are on the line
    {
      let worstTell = 0
      let tells = 0
      const r: Rig = makeRig(
        {
          ...HARMLESS,
          onChargeStart: (theta) => {
            tells++
            worstTell = Math.max(worstTell, Math.abs(angleDiff(r.craft.theta, theta)))
          },
        },
        0,
      )
      stageHunter(r, 2.0)
      const lives0 = r.game.lives
      let firstTellAt = -1
      for (let i = 0; i < PHYSICS.HZ * 8; i++) {
        step(r, false, { integrate: false }) // parked at theta 0
        if (tells > 0 && firstTellAt < 0) firstTellAt = i * dt
      }
      check('K1 hunter reaches a parked craft and fires down its line', tells >= 2 && worstTell < ENEMY.HUNT_FIRE_ANGLE, `tells=${tells} worst offset=${worstTell.toFixed(2)} first at ${firstTellAt.toFixed(1)}s`)
      check('K2 a parked craft is hit by the hunter', r.game.lives < lives0, `lives ${lives0} -> ${r.game.lives}`)
    }
    // a craft that stays ahead of the hunter's slide is never fired at by it
    {
      let tells = 0
      const r = makeRig({ ...HARMLESS, onChargeStart: () => tells++ }, 0)
      stageHunter(r, 0)
      let minGap = Infinity
      // 3.5 s: long enough for several cooldowns, short enough that the craft does not
      // come around the tube and meet the hunter from the other side
      for (let i = 0; i < PHYSICS.HZ * 3.5; i++) {
        r.craft.theta = 1.0 + (ENEMY.HUNT_TRACK[0] + 0.5) * (i * dt) // moves away faster than the hunter slides
        step(r, false, { integrate: false })
        r.enemies.visit((theta) => {
          minGap = Math.min(minGap, Math.abs(angleDiff(r.craft.theta, theta)))
        })
      }
      check('K3 a craft that stays off the line is not fired at by the hunter', tells === 0 && minGap > ENEMY.HUNT_FIRE_ANGLE, `tells=${tells} closest=${minGap.toFixed(2)} rad`)
    }
  })
  withConfig(ENEMY.WAVE, { FIRST_DELAY: 0 }, () => {
    // a hard phrase on the wall (pressure 2): the hunter holds fire, no wave starts
    {
      let tells = 0
      const r = makeRig({ ...HARMLESS, onChargeStart: () => tells++ }, 0)
      r.enemies.setPressure(2)
      stageHunter(r, 0)
      let maxAlive = 0
      for (let i = 0; i < PHYSICS.HZ * 6; i++) {
        step(r, false, { integrate: false })
        let alive = 0
        r.enemies.visit(() => alive++)
        maxAlive = Math.max(maxAlive, alive)
      }
      check('K4 pressure 2: the hunter holds fire and no wave starts', tells === 0 && maxAlive === 1 && !r.enemies.waveActive, `tells=${tells} alive=${maxAlive}`)
    }
    // fire hold (a cycle boundary is near): no tell starts while it is on, fire resumes after
    {
      let tells = 0
      const r = makeRig({ ...HARMLESS, onChargeStart: () => tells++ }, 0)
      stageHunter(r, 0)
      r.enemies.setHoldFire(true)
      for (let i = 0; i < PHYSICS.HZ * 4; i++) step(r, false, { integrate: false })
      const held = tells
      r.enemies.setHoldFire(false)
      for (let i = 0; i < PHYSICS.HZ * 3; i++) step(r, false, { integrate: false })
      check('K5 fire hold: no tell starts while it is on, the hunter fires again after', held === 0 && tells >= 1, `held=${held} after=${tells}`)
    }
  })
})

// ---- L) formation and depth lanes ----
// A wave arrives as a shape: the first two members appear FORM_SEP apart (side by
// side) or 2 * PINCER_OFFSET apart (a pincer). Once three raiders have settled, each
// holds a different depth lane, more than 10 units from the next.
// ENGAGE_TIME 999: nobody leaves during the check
withConfig(ENEMY, { ENGAGE_TIME: 999 }, () => {
  let shapes = 0
  let badShape = ''
  let settled = 0
  let shared = 0
  for (let seed = 1; seed <= 12; seed++) {
    seedRng(seed)
    const r = makeRig()
    r.enemies.setLevel(2)
    r.enemies.setMaxActive(waveAliveCap(2))
    const first: number[] = []
    const seen = new Set<number>()
    const zs: number[] = []
    for (let i = 0; i < PHYSICS.HZ * 22; i++) {
      step(r, false, { integrate: false })
      zs.length = 0
      let allEngaged = true
      r.enemies.visit((theta, z, phase, _c, id) => {
        if (!seen.has(id)) {
          seen.add(id)
          first.push(theta)
        }
        zs.push(z)
        if (phase !== 'engage') allEngaged = false
      })
      if (zs.length === 3 && allEngaged && zs.every((z) => ENEMY.LANES.some((lane) => Math.abs(z - lane) < 1))) {
        settled++
        const lanes = new Set(zs.map((z) => ENEMY.LANES.findIndex((lane) => Math.abs(z - lane) < 1)))
        if (lanes.size < 3) shared++
      }
    }
    if (first.length >= 2) {
      shapes++
      const gap = Math.abs(first[1]! - first[0]!)
      // the anchor may drift ANCHOR_TRACK * REINFORCE_DELAY between the two arrivals
      const slack = ENEMY.ANCHOR_TRACK * ENEMY.WAVE.REINFORCE_DELAY + 1e-6
      const ok = Math.abs(gap - ENEMY.FORM_SEP) <= slack || Math.abs(gap - 2 * ENEMY.PINCER_OFFSET) <= slack
      if (!ok) badShape += ` seed ${seed}: ${gap.toFixed(2)}`
    }
  }
  const laneGap = Math.min(ENEMY.LANES[0] - ENEMY.LANES[1], ENEMY.LANES[1] - ENEMY.LANES[2])
  check('L1 the first two of a squad arrive side by side or as a pincer', shapes === 12 && badShape === '', badShape || `${shapes} waves`)
  check('L2 three settled raiders hold three different depth lanes', settled > PHYSICS.HZ * 20 && shared === 0, `settled steps=${settled} shared=${shared}`)
  check('L3 lanes are more than 10 units apart and outside FIRE_MIN_AHEAD', laneGap > 10 && -ENEMY.LANES[0] >= ENEMY.FIRE_MIN_AHEAD, `gap=${laneGap} near=${ENEMY.LANES[0]}`)
  check('L4 FIRE_MIN_AHEAD gives a tell of at least 0.80 s', ENEMY.CHARGE_TIME + ENEMY.FIRE_MIN_AHEAD / ENEMY.BULLET_SPEED >= 0.8 - 1e-9, `${(ENEMY.CHARGE_TIME + ENEMY.FIRE_MIN_AHEAD / ENEMY.BULLET_SPEED).toFixed(3)}s`)
})

// ---- M) life shards: the real session (kills drop them, catching a set restores a life)
;(() => {
  seedRng(11)
  let dropped = 0
  let caught = 0
  let lifeCues = 0
  let lastDropTheta = 0
  let bonus = 0
  let crossDrops = 0
  const s = createSession({
    shardDropped: (theta) => {
      dropped++
      lastDropTheta = theta
    },
    shardCollected: () => caught++,
    bonusCollected: () => bonus++,
    crossDropped: (theta) => {
      crossDrops++
      lastDropTheta = theta
    },
    lifeCollected: () => lifeCues++,
  })
  s.reset()
  s.begin()
  const { game, craft, enemies } = s
  const shards = s.fieldByKind.shard
  // the passive craft is never hurt, so lives change only as the test sets them
  const advance = driveSession(s, NEUTRAL, { invulnerable: true })
  let hold: number | undefined // craft angle forced each step (undefined: rest at the bottom)
  const tick = (): void => {
    if (hold !== undefined) {
      craft.theta = hold
      craft.omega = 0
    }
    advance()
  }
  const live = (): number => {
    let n = 0
    shards.visit(() => n++)
    return n
  }
  // fly until a raider is ahead, then land a dead-center bolt on it
  const killOne = (): boolean => {
    for (let i = 0; i < PHYSICS.HZ * 40; i++) {
      tick()
      let kt = NaN
      let kz = NaN
      enemies.visit((theta, z) => {
        if (z < -8 && z > -60 && Number.isNaN(kt)) {
          kt = theta
          kz = z
        }
      })
      if (!Number.isNaN(kt) && enemies.tryKill(kt, kz)) return true
    }
    return false
  }
  // ride the craft into the shard dropped last; true once it was caught
  const catchLast = (): boolean => {
    const before = caught
    hold = lastDropTheta
    for (let i = 0; i < PHYSICS.HZ * 6 && caught === before; i++) tick()
    hold = undefined
    return caught > before
  }

  const catchBonus = (): boolean => {
    const before = bonus
    hold = lastDropTheta
    for (let i = 0; i < PHYSICS.HZ * 6 && bonus === before; i++) tick()
    hold = undefined
    return bonus > before
  }

  const k1 = killOne()
  check('M1 a kill at full lives drops a shard too', k1 && dropped === 1 && live() === 1, `killed=${k1} dropped=${dropped} live=${live()}`)
  const score0 = game.score()
  const b1 = catchBonus()
  check('M1b at full lives a caught shard pays score, not progress', b1 && game.score() > score0 && game.shards === 0 && game.lives === LIVES.START && caught === 0, `bonus=${bonus} score ${score0} -> ${game.score()} shards=${game.shards}`)
  dropped = 0

  game.lives = LIVES.START - 1
  const k2 = killOne()
  let ahead = -Infinity
  shards.visit((_t, wd) => (ahead = wd - craft.distance))
  check(
    'M2 a kill while a life is missing drops one shard, at least LEAD_SECONDS ahead',
    k2 && dropped === 1 && live() === 1 && ahead >= craft.speed * LIFE_SHARD.LEAD_SECONDS - 1,
    `dropped=${dropped} live=${live()} ahead=${ahead.toFixed(1)} lead=${(craft.speed * LIFE_SHARD.LEAD_SECONDS).toFixed(1)}`,
  )
  const c1 = catchLast()
  check('M3 a caught shard is progress, not a life', c1 && game.shards === 1 && game.lives === LIVES.START - 1 && lifeCues === 0, `shards=${game.shards} lives=${game.lives}`)

  game.invuln = 0
  const lost = game.hitHazard()
  check('M4 progress survives a lost life', lost && game.shards === 1 && game.lives === LIVES.START - 2, `shards=${game.shards} lives=${game.lives}`)

  // complete the set: exactly one life comes back and the progress starts again
  const need = game.shardsPerLife
  let ok = true
  while (ok && game.shards > 0) ok = killOne() && catchLast()
  check(
    `M5 a full set (${need}) restores exactly one life and clears the progress`,
    ok && caught === need && game.lives === LIVES.START - 1 && game.shards === 0 && lifeCues === 1,
    `caught=${caught} lives=${game.lives} shards=${game.shards} life cues=${lifeCues}`,
  )

  // a shard still on the wall when the lives are full again pays score
  const k3 = killOne()
  game.lives = LIVES.START
  const paid = catchBonus()
  check('M6 a shard caught after the lives are full again adds no progress', k3 && paid && game.shards === 0 && game.lives === LIVES.START, `paid=${paid} shards=${game.shards}`)

  game.lives = LIVES.START - 1
  const k4 = killOne() && catchLast() && killOne()
  const before = { shards: game.shards, live: live() }
  s.reset()
  check('M7 reset clears the shards on the wall and the progress', k4 && before.shards === 1 && before.live === 1 && game.shards === 0 && live() === 0 && game.shardsPerLife === LIFE_SHARD.PER_LIFE, `before: ${before.shards} caught, ${before.live} live; after: ${game.shards} caught, ${live()} live`)

  let crosses = 0
  s.fieldByKind.life.visit(() => crosses++)
  check('M8 the distance-timed extra-life cross follows its switch', crosses === (EXTRA_LIFE.ENABLED ? EXTRA_LIFE.COUNT : 0), `crosses=${crosses} enabled=${EXTRA_LIFE.ENABLED}`)

  // destroyed squads: every SQUAD_EVERY-th one leaves a whole-life cross
  if (!EXTRA_LIFE.ENABLED) {
    game.lives = LIVES.START - 1
    game.shards = 0
    lifeCues = 0
    crossDrops = 0
    let kills = 0
    while (crossDrops === 0 && kills < 60 && killOne()) kills++
    hold = lastDropTheta
    for (let i = 0; i < PHYSICS.HZ * 6 && lifeCues === 0; i++) tick()
    hold = undefined
    check('M9 a destroyed squad leaves a cross that restores a whole life', crossDrops === 1 && lifeCues === 1 && game.lives === LIVES.START, `kills=${kills} cross drops=${crossDrops} life cues=${lifeCues} lives=${game.lives} shards=${game.shards}`)
  }
})()

finish('COMBAT SIM')

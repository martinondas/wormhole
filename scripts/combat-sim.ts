// Headless behavior sim for the combat loop. Drives the REAL wired systems
// (gun + projectiles + enemies + game) through the real fixed-step order, with no
// browser/WebGL - three.js objects construct fine without a renderer. Asserts the
// integrated behavior that screenshots cannot: energy-per-shot, 2-hit kills with
// score+refund, lethal enemy bolts (hit when aligned, miss when dodged), and rams.
//
// Run:  npm run sim   (bundles with esbuild + runs under node; the local source
// uses extensionless imports that bare `node` cannot resolve - see package.json).
import { PHYSICS, SHIP, GUN, ENEMY, ENERGY } from '../src/config'
import { createCraft, updateCraft, type CraftState } from '../src/craft'
import { createGame, type Game } from '../src/game'
import { createGun, type Gun } from '../src/gun'
import { createProjectiles, type Projectiles } from '../src/world/projectiles'
import { createEnemies, type Enemies } from '../src/world/enemies'

const dt = 1 / PHYSICS.HZ
let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failures++
}

const NEUTRAL = { steerTarget: 0, throttle: false, brake: false, boost: false, fire: false }

interface Rig {
  craft: CraftState
  game: Game
  gun: Gun
  projectiles: Projectiles
  enemies: Enemies
}
function makeRig(): Rig {
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
  })
  enemies.reset(0)
  return { craft, game, gun, projectiles, enemies }
}

// one fixed step in the same order as main.ts
function step(r: Rig, fireHeld: boolean, opts: { integrate?: boolean } = {}): void {
  if (opts.integrate === false) {
    r.craft.distance += r.craft.speed * dt // advance forward but freeze theta
  } else {
    updateCraft(r.craft, { ...NEUTRAL, fire: fireHeld }, dt)
  }
  const shot = r.gun.tryFire(r.craft, r.game, dt, fireHeld)
  if (shot.fire) r.projectiles.spawn('player', shot.theta, SHIP.Z, -GUN.BOLT_SPEED)
  r.enemies.update(r.craft, dt)
  r.projectiles.update(dt, {
    tryKillEnemy: (t, z) => r.enemies.tryKill(t, z),
    shipTheta: r.craft.theta,
    onShipHit: () => r.game.hitHazard(),
  })
  r.game.update(dt, r.craft.distance)
}

// ---- A) gun: energy per shot, rate limit, inert at low energy, never ends run
;(() => {
  const r = makeRig()
  const e0 = r.game.energy
  let shots = 0
  for (let i = 0; i < PHYSICS.HZ; i++) {
    // count shots by watching energy steps from the gun (spendEnergy) vs drain
    const before = r.game.energy
    step(r, true)
    if (before - r.game.energy > ENERGY.DRAIN * dt + GUN.COST * 0.5) shots++
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
;(() => {
  const ampWas = ENEMY.STRAFE_AMP
  const fireWas = ENEMY.FIRE_COOLDOWN
  ENEMY.STRAFE_AMP = 0 // hold theta so the test is deterministic
  ENEMY.FIRE_COOLDOWN = 999 // do not let it shoot back during the kill test
  const r = makeRig()
  r.enemies.debugStage(0, -32) // engage, dead ahead, in the band
  const scoreBefore = r.game.score(r.craft.distance)
  const energyBefore = r.game.energy
  let steps = 0
  while (r.enemies.killed < 1 && steps < PHYSICS.HZ * 3) {
    step(r, true)
    steps++
  }
  check('B1 enemy killed by aligned fire', r.enemies.killed === 1, `killed=${r.enemies.killed} in ${(steps * dt).toFixed(2)}s`)
  check('B2 kill scores ENEMY.SCORE', r.game.scoreBonus === ENEMY.SCORE, `scoreBonus=${r.game.scoreBonus}`)
  check('B3 score jumped > a gem (250)', r.game.score(r.craft.distance) - scoreBefore >= ENEMY.SCORE, '')
  check('B4 kill refunded energy', r.game.energy > energyBefore - ENEMY.ENERGY_REFUND, `energy ${energyBefore.toFixed(1)} -> ${r.game.energy.toFixed(1)}`)
  ENEMY.STRAFE_AMP = ampWas
  ENEMY.FIRE_COOLDOWN = fireWas
})()

// ---- C) enemy bolt: lethal when aligned, dodged when theta swung away
;(() => {
  const fireWas = ENEMY.FIRE_COOLDOWN
  const jitWas = ENEMY.FIRE_JITTER
  const chgWas = ENEMY.CHARGE_TIME
  const ampWas = ENEMY.STRAFE_AMP
  ENEMY.FIRE_COOLDOWN = 0.1
  ENEMY.FIRE_JITTER = 0
  ENEMY.CHARGE_TIME = 0.1
  ENEMY.STRAFE_AMP = 0

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
  ENEMY.FIRE_COOLDOWN = fireWas
  ENEMY.FIRE_JITTER = jitWas
  ENEMY.CHARGE_TIME = chgWas
  ENEMY.STRAFE_AMP = ampWas
})()

// ---- D) ram: hull contact at the ship plane costs a life, enemy survives
;(() => {
  const ampWas = ENEMY.STRAFE_AMP
  const fireWas = ENEMY.FIRE_COOLDOWN
  ENEMY.STRAFE_AMP = 0
  ENEMY.FIRE_COOLDOWN = 999
  const r = makeRig()
  r.enemies.debugStage(0, -1.5) // staged right at the ship plane, same theta
  const lives0 = r.game.lives
  const killed0 = r.enemies.killed
  step(r, false, { integrate: false })
  check('D1 ram costs a life', r.game.lives === lives0 - 1, `lives ${lives0} -> ${r.game.lives}`)
  check('D2 ram does not kill the enemy', r.enemies.killed === killed0, `killed=${r.enemies.killed}`)
  ENEMY.STRAFE_AMP = ampWas
  ENEMY.FIRE_COOLDOWN = fireWas
})()

// ---- E) one encounter costs at most one life (invuln-first guard)
;(() => {
  const r = makeRig()
  const lives0 = r.game.lives
  r.game.hitHazard()
  r.game.hitHazard() // second in the same i-frame window must be a no-op
  check('E1 two hits in one i-frame window cost one life', r.game.lives === lives0 - 1, `lives ${lives0} -> ${r.game.lives}`)
})()

// ---- F) fly-by collision: an UNKILLED raider departing back through the ship
// plane, on the ship's line, costs a life. This is the only phase where it is
// near z=0 (approach/engage hold station far ahead), so it is the real collision.
;(() => {
  const ampWas = ENEMY.STRAFE_AMP
  const fireWas = ENEMY.FIRE_COOLDOWN
  const engWas = ENEMY.ENGAGE_TIME
  const jitWas = ENEMY.ENGAGE_TIME_JITTER
  ENEMY.STRAFE_AMP = 0 // hold the raider on the ship's line (theta 0)
  ENEMY.FIRE_COOLDOWN = 999 // isolate collision from lethal bolts
  ENEMY.ENGAGE_TIME = 0.3 // depart quickly so the fly-by happens within the window
  ENEMY.ENGAGE_TIME_JITTER = 0
  const r = makeRig()
  r.enemies.debugStage(0, -22) // engage on the ship's line, then it peels off
  const lives0 = r.game.lives
  let collided = false
  let minAbsZ = Infinity
  for (let i = 0; i < PHYSICS.HZ * 5 && !collided; i++) {
    step(r, false, { integrate: false }) // ship holds theta 0 and advances forward
    if (r.game.lives < lives0) collided = true
  }
  void minAbsZ
  check('F1 departing raider fly-by on the ship line costs a life', collided, `lives ${lives0} -> ${r.game.lives}`)
  ENEMY.STRAFE_AMP = ampWas
  ENEMY.FIRE_COOLDOWN = fireWas
  ENEMY.ENGAGE_TIME = engWas
  ENEMY.ENGAGE_TIME_JITTER = jitWas
})()

console.log(failures === 0 ? '\nALL COMBAT SIM CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

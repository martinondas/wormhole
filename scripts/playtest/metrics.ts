// Per-run playability metrics and their aggregation. A Recorder listens to the
// session's events (SessionFx) and samples the world at TICK_HZ through the same
// read-only perception the bots use, so it measures any future version of the game
// without knowing how its spawning or raider AI works.
import { type Session, type SessionFx, type DamageCause } from '../../src/session'
import { angleDiff } from '../../src/util/math'
import { ENEMY, ENERGY, GUN, LIVES } from '../../src/config'
import { createPerception, createSnapshot, KIND_GEM, KIND_LIFE, KIND_MINE, KIND_ORB, KIND_SHARD, PHASE_DEPART, PHASE_EXIT, MAX_ENEMIES } from './perception'

export const BUCKET_SECONDS = 5 // intensity timeline resolution
const MAX_LEVELS = 60
const THETA_BINS = 12 // 30 degrees each, bin 0 centered on the bottom
const RAIDER_BINS = 11 // 0..10 raiders in play
const IN_PLAY_Z = -90 // a raider nearer than this (and not yet behind) is "in play"
const BUSY_SECONDS = 1.5 // a wall object arriving within this is "something to do"
const PASS_MARGIN = 3 // units past the ship plane before a wall object counts as passed
const MINE_NEAR = 1.2 // rad: a mine farther than this from the craft's line needs no attention
const CLOSE_CALL = 0.3 // rad beyond the capture cone that still counts as a close call
const CLUMP_ANGLE = 0.4 // rad: two raiders closer than this in angle ...
const CLUMP_DZ = 10 // ... and this in depth read as one clump
const FAR_KILL = 60 // units: a kill farther ahead than this was made at long range
const CHAIN_HIT_GAP = 1.0 // s after the i-frames end: a second life lost inside this is a chain hit
const CHARGE_RING = 16 // recent charge starts kept to pair each enemy bolt with its tell

export interface LevelStats {
  level: number // 1-based, as displayed
  time: number
  livesLost: number
  gems: number
  gemsOffered: number
  kills: number
  threats: number // bolts fired at the player + mines passing + raider fly-bys
  pickups: number // gems + orbs + crosses that passed or were collected
  repeats: number // cycles of this level that ended short of the gem quota
  raiderTime: number // raiders in play, summed over time (divide by time for the mean)
  raider4Time: number // seconds with 4 or more raiders in play
  cyclesEnded: number // cycles of this level that ended (advance or repeat)
  firstTryMet: number // 1 if the first cycle of this level ended with the quota met
  bolts: number // enemy bolts fired in this level
  tellsAimed: number // ... of which had their tell start on the player's line
}

export interface RunResult {
  seed: number
  // --- outcome
  time: number // seconds survived (capped at --max-seconds)
  capped: number // 1 if the run hit the time cap alive
  level: number // level reached (1-based)
  score: number
  deathCause: DamageCause | 'none'
  // --- damage
  livesLost: number
  livesLostMine: number
  livesLostBolt: number
  livesLostRam: number
  hitsPerMin: number
  timeToFirstHit: number // seconds until the first life was lost (run time if never)
  // --- progression
  levelRepeats: number // gem-gate failures: cycles that ended without a level-up
  gems: number
  gemsOffered: number
  gemShare: number // collected / offered
  orbs: number
  orbsOffered: number
  extraLives: number // lives regained (shard sets completed, plus extra-life crosses when that field is on)
  shardsDropped: number // life shards left by kills
  shardsCaught: number
  shardCatchShare: number // caught / dropped (NaN with none dropped)
  livesFromShards: number // lives restored by a completed shard set
  crossesDropped: number // whole-life crosses left by destroyed squads
  crossesCaught: number
  // --- gun
  emptyGunShare: number // share of time with less than one shot of charge
  meanCharge: number // mean weapon charge 0..1
  shots: number
  accuracy: number // player bolts that struck a raider / shots
  kills: number
  killsPerMin: number
  // --- raiders
  boltsAtPlayer: number // enemy bolts fired
  boltsAimedShare: number // share fired on the player's line (would hit if the player did not move)
  tellsAimedShare: number // share of bolts whose firing tell STARTED on the player's line (aimed at the player, dodged or not)
  boltsHitShare: number // share that cost a life
  boltsDodgedShare: number // 1 - (hit or absorbed by i-frames) / fired
  raidersMean: number // mean raiders in play
  raidersMax: number
  raiders4PlusShare: number // share of time with 4 or more raiders in play
  // --- pacing
  deadAirLongest: number // longest stretch (s) with nothing to collect, dodge or fight
  deadAirShare: number
  threatsPerMin: number
  intensityCV: number // spread of threats per 5 s bucket (std / mean): 0 = perfectly flat pacing
  quietShare: number // share of 5 s buckets with at most one threat (breathers)
  // --- use of the wall
  bottomShare: number // time within 30 degrees of the bottom
  upperShare: number // time above the horizontal (more than 90 degrees from the bottom)
  wallBinsUsed: number // of 12 30-degree bins, how many hold at least 2% of the time
  loops: number // times over the top
  // --- input
  reversalsPerMin: number // left<->right changes of steering direction
  pressesPerMin: number // steer key presses
  steerDuty: number // share of time a steer key is held
  mineCloseCalls: number // mines that passed just outside the hit cone
  // --- feedback events and fairness probes
  killDistanceMedian: number // median distance ahead of the ship at which raiders died
  killsBeyond60Share: number // share of kills farther than 60 units ahead
  clumpShare: number // share of time with two live raiders within 0.4 rad and 10 units
  tellToArrivalMin: number // shortest time from a charge start to its bolt reaching the ship plane (Infinity if none)
  lifeBalance: number // lives regained / lives lost (lives lost floored at 1)
  chainHits: number // lives lost within 1 s after the i-frames of the previous hit ended
  gateFirstTry: number // share of levels whose first cycle ended with the quota met (NaN if no cycle ended)
  gemChainMedian: number // median length of a run of consecutive gems without a miss
  gemChainMax: number
  nearMissPerMin: number // mine near-miss events (session's mineNearMiss)
  loopsPerMin: number // loopCompleted events per minute
  wavesClearedPerMin: number // raider waves destroyed to the last member, per minute
  raiderFreeShare: number // share of time with no raider in play and no enemy bolt in flight (breathers)
  boltMinePerMin: number // seconds per minute with an enemy bolt in flight and a mine less than 1 s ahead
  // --- distributions (not aggregated as scalars)
  raiderHist: number[] // time share by raiders in play (index = count)
  thetaHist: number[] // time share by 30-degree wall bin (index 0 = bottom, 6 = top)
  perLevel: LevelStats[]
  timeline: number[] // threats per 5 s bucket
  timelineLevel: number[] // level (1-based) at the start of each bucket
}

export interface Recorder {
  fx: SessionFx
  begin(seed: number): void
  tick(dt: number, steer: number): void // call at the bot tick rate, after the steps
  finish(capped: boolean): RunResult
}

export function createRecorder(session: Session): Recorder {
  const perception = createPerception(session)
  const snap = createSnapshot()
  const prevEnemyZ = new Float64Array(MAX_ENEMIES)

  let r: RunResult
  let levels: LevelStats[]
  let seed = 0
  let t = 0
  let prevDist = 0
  let firstHit = -1
  let lastCause: DamageCause | 'none' = 'none'
  let emptyT = 0
  let chargeSum = 0
  let shotHits = 0
  let boltsAimed = 0
  let tellsAimed = 0
  let boltsHit = 0
  let boltsBlocked = 0
  let raiderSum = 0
  let raiderHist: number[]
  let thetaHist: number[]
  let deadRun = 0
  let deadTotal = 0
  let threats = 0
  let reversals = 0
  let presses = 0
  let dutyT = 0
  let lastSteer = 0
  let lastDir = 0
  let winding = 0
  let lastCycles = 0
  let timeline: number[]
  let timelineLevel: number[]
  let killDist: number[]
  let clumpT = 0
  let lastHitT = -1
  let chain = 0
  let chains: number[]
  let nearMisses = 0
  let loopEvents = 0
  let wavesCleared = 0
  let raiderFreeT = 0
  let boltMineT = 0
  const chargeTheta = new Float64Array(CHARGE_RING)
  const chargeAt = new Float64Array(CHARGE_RING)
  const chargeAimed = new Uint8Array(CHARGE_RING) // 1 if the craft was on that line when the tell started
  let chargeHead = 0
  let shardLife = false // the life cue that follows was earned by a completed shard set

  const lvlAt = (level: number): LevelStats => {
    const i = Math.max(0, Math.min(level, MAX_LEVELS - 1))
    while (levels.length <= i) {
      levels.push({ level: levels.length + 1, time: 0, livesLost: 0, gems: 0, gemsOffered: 0, kills: 0, threats: 0, pickups: 0, repeats: 0, raiderTime: 0, raider4Time: 0, cyclesEnded: 0, firstTryMet: 0, bolts: 0, tellsAimed: 0 })
    }
    return levels[i]!
  }
  const lvl = (): LevelStats => lvlAt(session.flight.level)
  const threat = (): void => {
    threats++
    lvl().threats++
    const b = Math.floor(t / BUCKET_SECONDS)
    while (timeline.length <= b) {
      timeline.push(0)
      timelineLevel.push(session.flight.level + 1)
    }
    timeline[b]!++
  }

  const fx: SessionFx = {
    orbCollected: () => {
      r.orbs++
      r.orbsOffered++
      lvl().pickups++
    },
    gemCollected: (_points, c) => {
      chain = c
      if (c > r.gemChainMax) r.gemChainMax = c
      r.gems++
      r.gemsOffered++
      const l = lvl()
      l.gems++
      l.gemsOffered++
      l.pickups++
    },
    lifeCollected: () => {
      r.extraLives++
      if (shardLife) shardLife = false
      else r.crossesCaught++ // a whole-life cross (the restoring shard announces itself first)
      lvl().pickups++
    },
    shardDropped: () => {
      r.shardsDropped++
    },
    crossDropped: () => {
      r.crossesDropped++
    },
    bonusCollected: (big) => {
      if (big) r.crossesCaught++
      else r.shardsCaught++
      lvl().pickups++
    },
    shardCollected: (_count, restored) => {
      r.shardsCaught++
      if (restored) {
        r.livesFromShards++
        shardLife = true
      }
      else lvl().pickups++ // the restoring shard is counted by lifeCollected
    },
    damaged: (cause) => {
      r.livesLost++
      if (cause === 'mine') r.livesLostMine++
      else if (cause === 'bolt') r.livesLostBolt++
      else r.livesLostRam++
      if (cause === 'bolt') boltsHit++
      if (cause === 'mine') threat() // a mine that hit never "passes", count it here
      lvl().livesLost++
      if (firstHit < 0) firstHit = t
      lastCause = cause
      const now = session.game.elapsed
      if (lastHitT >= 0 && now - (lastHitT + LIVES.INVULN_TIME) <= CHAIN_HIT_GAP) r.chainHits++
      lastHitT = now
    },
    gemMissed: () => {
      if (chain > 0) chains.push(chain)
      chain = 0
    },
    cycleEnded: (advanced) => {
      // the level that just ended: one below the current one after an advance
      const l = lvlAt(session.flight.level - (advanced ? 1 : 0))
      if (l.cyclesEnded === 0 && advanced) l.firstTryMet = 1
      l.cyclesEnded++
    },
    mineNearMiss: () => {
      nearMisses++
    },
    loopCompleted: () => {
      loopEvents++
    },
    waveCleared: () => {
      wavesCleared++
    },
    enemyChargeStarted: (theta) => {
      chargeTheta[chargeHead] = theta
      chargeAt[chargeHead] = session.game.elapsed
      chargeAimed[chargeHead] = Math.abs(angleDiff(session.craft.theta, theta)) < GUN.BULLET_HIT_ANGLE ? 1 : 0
      chargeHead = (chargeHead + 1) % CHARGE_RING
    },
    hitBlocked: (cause) => {
      if (cause === 'bolt') boltsBlocked++
    },
    enemyFired: (theta, z) => {
      // pair the bolt with its tell: a charging raider holds its theta, so the
      // newest charge start on exactly this line is this bolt's. Enemy bolts are
      // ship-relative and fly at ENEMY.BULLET_SPEED, so the arrival is exact.
      for (let k = 1; k <= CHARGE_RING; k++) {
        const i = (chargeHead - k + CHARGE_RING) % CHARGE_RING
        if (chargeTheta[i] === theta) {
          const tell = session.game.elapsed - chargeAt[i]! + -z / ENEMY.BULLET_SPEED
          if (tell < r.tellToArrivalMin) r.tellToArrivalMin = tell
          if (chargeAimed[i]) {
            tellsAimed++
            lvl().tellsAimed++
          }
          chargeTheta[i] = NaN
          break
        }
      }
      r.boltsAtPlayer++
      lvl().bolts++
      if (Math.abs(angleDiff(session.craft.theta, theta)) < GUN.BULLET_HIT_ANGLE) boltsAimed++
      threat()
    },
    enemyKilled: (_theta, z) => {
      killDist.push(-z)
      r.kills++
      lvl().kills++
    },
    playerFired: () => {
      r.shots++
    },
    playerBoltHit: () => {
      shotHits++
    },
  }

  return {
    fx,

    begin(s: number): void {
      seed = s
      t = 0
      prevDist = session.craft.distance
      firstHit = -1
      lastCause = 'none'
      emptyT = 0
      chargeSum = 0
      shotHits = 0
      boltsAimed = 0
      tellsAimed = 0
      boltsHit = 0
      boltsBlocked = 0
      raiderSum = 0
      raiderHist = new Array<number>(RAIDER_BINS).fill(0)
      thetaHist = new Array<number>(THETA_BINS).fill(0)
      deadRun = 0
      deadTotal = 0
      threats = 0
      reversals = 0
      presses = 0
      dutyT = 0
      lastSteer = 0
      lastDir = 0
      winding = 0
      lastCycles = 0
      levels = []
      timeline = []
      timelineLevel = []
      killDist = []
      clumpT = 0
      lastHitT = -1
      chain = 0
      chains = []
      nearMisses = 0
      loopEvents = 0
      wavesCleared = 0
      raiderFreeT = 0
      boltMineT = 0
      chargeTheta.fill(NaN)
      chargeHead = 0
      prevEnemyZ.fill(NaN)
      r = {
        seed,
        time: 0, capped: 0, level: 1, score: 0, deathCause: 'none',
        livesLost: 0, livesLostMine: 0, livesLostBolt: 0, livesLostRam: 0, hitsPerMin: 0, timeToFirstHit: 0,
        levelRepeats: 0, gems: 0, gemsOffered: 0, gemShare: 0, orbs: 0, orbsOffered: 0, extraLives: 0, shardsDropped: 0, shardsCaught: 0, shardCatchShare: NaN, livesFromShards: 0, crossesDropped: 0, crossesCaught: 0,
        emptyGunShare: 0, meanCharge: 0, shots: 0, accuracy: 0, kills: 0, killsPerMin: 0,
        boltsAtPlayer: 0, boltsAimedShare: 0, tellsAimedShare: 0, boltsHitShare: 0, boltsDodgedShare: 0,
        raidersMean: 0, raidersMax: 0, raiders4PlusShare: 0,
        deadAirLongest: 0, deadAirShare: 0, threatsPerMin: 0, intensityCV: 0, quietShare: 0,
        bottomShare: 0, upperShare: 0, wallBinsUsed: 0, loops: 0,
        reversalsPerMin: 0, pressesPerMin: 0, steerDuty: 0, mineCloseCalls: 0,
        killDistanceMedian: 0, killsBeyond60Share: 0, clumpShare: 0, tellToArrivalMin: Infinity,
        lifeBalance: 0, chainHits: 0, gateFirstTry: NaN, gemChainMedian: 0, gemChainMax: 0,
        nearMissPerMin: 0, loopsPerMin: 0, wavesClearedPerMin: 0, raiderFreeShare: 0, boltMinePerMin: 0,
        raiderHist: [], thetaHist: [], perLevel: [], timeline: [], timelineLevel: [],
      }
    },

    tick(dt: number, steer: number): void {
      const craft = session.craft
      const game = session.game
      t += dt
      const l = lvl()
      l.time += dt
      // keep the timeline as long as the run, even through quiet buckets
      const b = Math.floor(t / BUCKET_SECONDS)
      while (timeline.length <= b) {
        timeline.push(0)
        timelineLevel.push(session.flight.level + 1)
      }

      // gem-gate failures: a cycle boundary that did not raise the level
      const cycles = session.flight.cycles
      if (cycles > lastCycles) {
        const failed = cycles - session.flight.level - r.levelRepeats
        if (failed > 0) {
          r.levelRepeats += failed
          l.repeats += failed
        }
        lastCycles = cycles
      }

      perception.capture(snap, t)

      // wall objects that passed the ship plane uncollected since the last tick
      let busy = false
      let mineSoon = false // a mine less than 1 s ahead
      for (let i = 0; i < snap.nObj; i++) {
        const wd = snap.objWd[i]!
        const kind = snap.objKind[i]!
        const edge = wd + PASS_MARGIN
        if (prevDist < edge && edge <= craft.distance) {
          if (kind === KIND_GEM) {
            r.gemsOffered++
            l.gemsOffered++
            l.pickups++
          } else if (kind === KIND_ORB) {
            r.orbsOffered++
            l.pickups++
          } else if (kind === KIND_LIFE || kind === KIND_SHARD) l.pickups++
          else {
            threat()
            const gap = Math.abs(angleDiff(craft.theta, snap.objTheta[i]!))
            if (gap < 0.62 + CLOSE_CALL) r.mineCloseCalls++
          }
        }
        const eta = (wd - craft.distance) / Math.max(craft.speed, 1)
        if (kind === KIND_MINE && eta > 0 && eta < 1) mineSoon = true
        if (eta > 0 && eta < BUSY_SECONDS) {
          if (kind === KIND_ORB) busy ||= game.energy < ENERGY.MAX
          else if (kind === KIND_LIFE || kind === KIND_SHARD) busy ||= game.lives < LIVES.START
          else if (kind === KIND_MINE) busy ||= Math.abs(angleDiff(craft.theta, snap.objTheta[i]!)) < MINE_NEAR
          else busy = true
        }
      }
      prevDist = craft.distance

      // raiders in play, and fly-bys (a raider crossing the ship plane)
      let inPlay = 0
      for (let i = 0; i < snap.nEn; i++) {
        const z = snap.enZ[i]!
        const id = snap.enId[i]!
        if (z > IN_PLAY_Z && z < 10 && snap.enPhase[i] !== PHASE_DEPART && snap.enPhase[i] !== PHASE_EXIT) inPlay++
        const pz = prevEnemyZ[id]!
        if (pz < 0 && z >= 0) threat()
      }
      prevEnemyZ.fill(NaN)
      for (let i = 0; i < snap.nEn; i++) prevEnemyZ[snap.enId[i]!] = snap.enZ[i]!
      let clump = false
      for (let i = 0; i < snap.nEn && !clump; i++) {
        for (let j = i + 1; j < snap.nEn; j++) {
          if (Math.abs(angleDiff(snap.enTheta[i]!, snap.enTheta[j]!)) < CLUMP_ANGLE && Math.abs(snap.enZ[i]! - snap.enZ[j]!) < CLUMP_DZ) {
            clump = true
            break
          }
        }
      }
      if (clump) clumpT += dt
      raiderSum += inPlay * dt
      l.raiderTime += inPlay * dt
      if (inPlay >= 4) l.raider4Time += dt
      raiderHist[Math.min(inPlay, RAIDER_BINS - 1)]! += dt
      if (inPlay > r.raidersMax) r.raidersMax = inPlay
      if (inPlay > 0 || snap.nBolt > 0) busy = true
      else raiderFreeT += dt
      if (mineSoon && snap.nBolt > 0) boltMineT += dt

      // dead air: nothing to collect, dodge or fight right now
      if (busy) deadRun = 0
      else {
        deadRun += dt
        deadTotal += dt
        if (deadRun > r.deadAirLongest) r.deadAirLongest = deadRun
      }

      // gun
      if (game.energy < GUN.COST) emptyT += dt
      chargeSum += (game.energy / ENERGY.MAX) * dt

      // wall use: wrapped angle into 30-degree bins centered on the bottom
      const wrapped = angleDiff(craft.theta, 0)
      const bin = ((Math.round(wrapped / (Math.PI / 6)) % THETA_BINS) + THETA_BINS) % THETA_BINS
      thetaHist[bin]! += dt
      const w = Math.floor((craft.theta + Math.PI) / (2 * Math.PI))
      r.loops += Math.abs(w - winding)
      winding = w

      // input
      if (steer !== 0) {
        dutyT += dt
        if (steer !== lastSteer) presses++
        if (lastDir !== 0 && steer !== lastDir) reversals++
        lastDir = steer
      }
      lastSteer = steer
    },

    finish(capped: boolean): RunResult {
      const game = session.game
      const time = Math.max(t, 1e-6)
      const min = time / 60
      r.time = t
      r.capped = capped ? 1 : 0
      r.level = session.flight.level + 1
      r.score = game.score()
      r.deathCause = game.over ? lastCause : 'none'
      r.hitsPerMin = r.livesLost / min
      r.timeToFirstHit = firstHit < 0 ? t : firstHit
      r.gemShare = r.gemsOffered > 0 ? r.gems / r.gemsOffered : 0
      r.emptyGunShare = emptyT / time
      r.meanCharge = chargeSum / time
      r.accuracy = r.shots > 0 ? shotHits / r.shots : 0
      r.killsPerMin = r.kills / min
      r.boltsAimedShare = r.boltsAtPlayer > 0 ? boltsAimed / r.boltsAtPlayer : 0
      r.tellsAimedShare = r.boltsAtPlayer > 0 ? tellsAimed / r.boltsAtPlayer : 0
      r.boltsHitShare = r.boltsAtPlayer > 0 ? boltsHit / r.boltsAtPlayer : 0
      r.boltsDodgedShare = r.boltsAtPlayer > 0 ? 1 - (boltsHit + boltsBlocked) / r.boltsAtPlayer : 1
      r.raidersMean = raiderSum / time
      r.raiders4PlusShare = raiderHist.slice(4).reduce((a, b) => a + b, 0) / time
      r.deadAirShare = deadTotal / time
      r.threatsPerMin = threats / min
      const full = timeline.slice(0, Math.max(1, Math.floor(t / BUCKET_SECONDS))) // drop the partial last bucket
      const mean = full.reduce((a, b) => a + b, 0) / full.length
      const sd = Math.sqrt(full.reduce((a, b) => a + (b - mean) ** 2, 0) / full.length)
      r.intensityCV = mean > 0 ? sd / mean : 0
      r.quietShare = full.filter((x) => x <= 1).length / full.length
      r.raiderHist = raiderHist.map((x) => x / time)
      r.thetaHist = thetaHist.map((x) => x / time)
      r.bottomShare = r.thetaHist[0]!
      r.upperShare = [4, 5, 6, 7, 8].reduce((a, i) => a + r.thetaHist[i]!, 0)
      r.wallBinsUsed = r.thetaHist.filter((x) => x >= 0.02).length
      r.reversalsPerMin = reversals / min
      r.pressesPerMin = presses / min
      r.steerDuty = dutyT / time
      const median = (xs: number[]): number => {
        if (xs.length === 0) return 0
        const v = [...xs].sort((a, b) => a - b)
        const m = v.length >> 1
        return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2
      }
      r.killDistanceMedian = median(killDist)
      r.killsBeyond60Share = killDist.length ? killDist.filter((d) => d > FAR_KILL).length / killDist.length : 0
      r.clumpShare = clumpT / time
      r.lifeBalance = r.extraLives / Math.max(1, r.livesLost)
      r.shardCatchShare = r.shardsDropped ? r.shardsCaught / r.shardsDropped : NaN
      const firsts = levels.filter((l) => l.cyclesEnded > 0)
      r.gateFirstTry = firsts.length ? firsts.filter((l) => l.firstTryMet).length / firsts.length : NaN
      r.gemChainMedian = median(chain > 0 ? [...chains, chain] : chains)
      r.nearMissPerMin = nearMisses / min
      r.loopsPerMin = loopEvents / min
      r.wavesClearedPerMin = wavesCleared / min
      r.raiderFreeShare = raiderFreeT / time
      r.boltMinePerMin = boltMineT / min
      r.perLevel = levels
      r.timeline = timeline
      r.timelineLevel = timelineLevel
      return r
    },
  }
}

// ---------------------------------------------------------------------------
// aggregation over N runs of one bot on one difficulty

export interface Stat {
  mean: number
  median: number
  p10: number
  p90: number
  sd: number // standard deviation over the runs (for judging a delta against noise)
  min: number
  max: number
  n: number // runs with a value (a run without the event, e.g. no enemy bolt, has none)
}

export interface LevelAggregate {
  level: number
  reachedShare: number // share of runs that reached this level
  meanTime: number // mean seconds spent in the level (runs that reached it)
  hitsPerMin: number // lives lost per minute in the level
  threatsPer5s: number
  pickupsPer5s: number
  gemShare: number
  killsPerMin: number
  repeatsPerRun: number // gem-gate failures per run that reached it
  raidersMean: number // mean raiders in play
  raiders4PlusShare: number // share of the level's time with 4 or more in play
  endedHereShare: number // share of ALL runs that ended in this level
  gateFirstTry: number // share of first cycles of this level that ended with the quota met (NaN if none ended)
  tellsAimedShare: number // share of the level's enemy bolts whose tell started on the player's line (NaN if none)
}

export interface Aggregate {
  bot: string
  difficulty: string
  runs: number
  maxSeconds: number
  stats: Record<string, Stat>
  deathCauses: Record<string, number> // share of runs by the final blow
  raiderHist: number[]
  thetaHist: number[]
  perLevel: LevelAggregate[]
  timeline: { t: number; aliveShare: number; threatsPer5s: number; level: number }[]
}

const SCALARS: (keyof RunResult)[] = [
  'time', 'capped', 'level', 'score',
  'livesLost', 'livesLostMine', 'livesLostBolt', 'livesLostRam', 'hitsPerMin', 'timeToFirstHit',
  'levelRepeats', 'gems', 'gemsOffered', 'gemShare', 'orbs', 'orbsOffered', 'extraLives', 'shardsDropped', 'shardsCaught', 'shardCatchShare', 'livesFromShards', 'crossesDropped', 'crossesCaught',
  'emptyGunShare', 'meanCharge', 'shots', 'accuracy', 'kills', 'killsPerMin',
  'boltsAtPlayer', 'boltsAimedShare', 'tellsAimedShare', 'boltsHitShare', 'boltsDodgedShare',
  'raidersMean', 'raidersMax', 'raiders4PlusShare',
  'deadAirLongest', 'deadAirShare', 'threatsPerMin', 'intensityCV', 'quietShare',
  'bottomShare', 'upperShare', 'wallBinsUsed', 'loops',
  'reversalsPerMin', 'pressesPerMin', 'steerDuty', 'mineCloseCalls',
  'killDistanceMedian', 'killsBeyond60Share', 'clumpShare', 'tellToArrivalMin',
  'lifeBalance', 'chainHits', 'gateFirstTry', 'gemChainMedian', 'gemChainMax',
  'nearMissPerMin', 'loopsPerMin', 'wavesClearedPerMin', 'raiderFreeShare', 'boltMinePerMin',
]

function stat(values: number[]): Stat {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  const q = (p: number): number => {
    if (v.length === 0) return 0
    const x = p * (v.length - 1)
    const lo = Math.floor(x)
    const hi = Math.ceil(x)
    return v[lo]! + (v[hi]! - v[lo]!) * (x - lo)
  }
  const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0
  return { mean, median: q(0.5), p10: q(0.1), p90: q(0.9), sd, min: v[0] ?? 0, max: v[v.length - 1] ?? 0, n: v.length }
}

export function aggregate(bot: string, difficulty: string, maxSeconds: number, runs: RunResult[]): Aggregate {
  const n = Math.max(runs.length, 1)
  const stats: Record<string, Stat> = {}
  for (const k of SCALARS) stats[k] = stat(runs.map((r) => r[k] as number))

  const deathCauses: Record<string, number> = { mine: 0, bolt: 0, ram: 0, none: 0 }
  for (const r of runs) deathCauses[r.deathCause] = (deathCauses[r.deathCause] ?? 0) + 1 / n

  const meanHist = (pick: (r: RunResult) => number[]): number[] => {
    const len = Math.max(0, ...runs.map((r) => pick(r).length))
    const out = new Array<number>(len).fill(0)
    for (const r of runs) pick(r).forEach((x, i) => (out[i]! += x / n))
    return out
  }

  const maxLevel = Math.max(0, ...runs.map((r) => r.perLevel.length))
  const perLevel: LevelAggregate[] = []
  for (let i = 0; i < maxLevel; i++) {
    const rows = runs.filter((r) => r.perLevel.length > i).map((r) => r.perLevel[i]!)
    const sum = (f: (l: LevelStats) => number): number => rows.reduce((a, l) => a + f(l), 0)
    const time = Math.max(sum((l) => l.time), 1e-6)
    const offered = sum((l) => l.gemsOffered)
    perLevel.push({
      level: i + 1,
      reachedShare: rows.length / n,
      meanTime: time / Math.max(rows.length, 1),
      hitsPerMin: (sum((l) => l.livesLost) / time) * 60,
      threatsPer5s: (sum((l) => l.threats) / time) * BUCKET_SECONDS,
      pickupsPer5s: (sum((l) => l.pickups) / time) * BUCKET_SECONDS,
      gemShare: offered > 0 ? sum((l) => l.gems) / offered : 0,
      killsPerMin: (sum((l) => l.kills) / time) * 60,
      repeatsPerRun: sum((l) => l.repeats) / Math.max(rows.length, 1),
      raidersMean: sum((l) => l.raiderTime) / time,
      raiders4PlusShare: sum((l) => l.raider4Time) / time,
      endedHereShare: runs.filter((r) => !r.capped && r.level === i + 1).length / n,
      gateFirstTry: rows.some((l) => l.cyclesEnded > 0)
        ? rows.filter((l) => l.cyclesEnded > 0 && l.firstTryMet).length / rows.filter((l) => l.cyclesEnded > 0).length
        : NaN,
      tellsAimedShare: sum((l) => l.bolts) > 0 ? sum((l) => l.tellsAimed) / sum((l) => l.bolts) : NaN,
    })
  }

  const buckets = Math.max(0, ...runs.map((r) => r.timeline.length))
  const timeline: Aggregate['timeline'] = []
  for (let b = 0; b < buckets; b++) {
    const alive = runs.filter((r) => r.timeline.length > b)
    if (alive.length === 0) break
    timeline.push({
      t: b * BUCKET_SECONDS,
      aliveShare: alive.length / n,
      threatsPer5s: alive.reduce((a, r) => a + r.timeline[b]!, 0) / alive.length,
      level: alive.reduce((a, r) => a + r.timelineLevel[b]!, 0) / alive.length,
    })
  }

  return {
    bot,
    difficulty,
    runs: runs.length,
    maxSeconds,
    stats,
    deathCauses,
    raiderHist: meanHist((r) => r.raiderHist),
    thetaHist: meanHist((r) => r.thetaHist),
    perLevel,
    timeline,
  }
}

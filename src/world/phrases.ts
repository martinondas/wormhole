import { PHYSICS } from '../config'
import { stepSwing, type SwingState } from '../craft'
import { DEG } from '../util/math'

// Gem-line phrases: the static library the director (world/sequencer.ts) places on
// the tube wall, and the "ghost" that turns a phrase into angles.
//
// A phrase with a script is the visible shape of a swing. The ghost starts at rest
// at the bottom and plays the script (hold a steer key, release, ...) through
// stepSwing, the same function the craft swings through. Gems sit on the ghost's
// path, so a player who presses the same keys collects them all; mines sit a fixed
// angle off that path (or at a fixed angle from the bottom), so the gems mark the
// clear line. `scatter` has no script: the director draws its few gems and mines at
// random angles.
//
// Gravity depends on the tier (heavy in slow sections, light in fast ones), so one
// trace per phrase and tier is built when the session is created. Times in the
// phrase data are ghost times in seconds, either absolute or relative to a turning
// point ("apex") of the trace, which keeps "the gem on the apex" on the apex in
// every tier.

export type Steer = -1 | 0 | 1
/** How busy a phrase makes the wall: 0 calm, 1 busy, 2 a hard phrase. */
export type Load = 0 | 1 | 2
/** A ghost time: seconds from the phrase start, or [apex index, offset in s]. */
export type At = number | readonly [apex: number, offset: number]

type PerTier = readonly [number, number, number]

export interface PhraseMine {
  at: At
  deg: number // offset from the ghost angle at that time, away from the bottom side the ghost is on ...
  abs?: true // ... or an absolute angle from the bottom
  minTuned?: number // present only from this tuning level
}

export interface Phrase {
  id: 'arc' | 'pump' | 'jump' | 'weave' | 'loop' | 'scatter'
  // tuning level the phrase unlocks at in the slow / normal / fast tier (null = never)
  unlock: readonly [number | null, number | null, number | null]
  weight: readonly [number, number, number] // pick weight per tier
  load: Load // the raiders ease off under load 2
  // per tier: how many other phrases lie between two uses of this one at least (default 2;
  // 0 = it may follow itself)
  spacing?: readonly [number, number, number]
  // ghost input: hold `steer` for t seconds (one value, or one per tier), or until the
  // ghost is `untilDeg` degrees from the bottom (per tier: gravity differs, and so does
  // the hold that carries the ghost to a given height)
  script: readonly { steer: Steer; t?: number | PerTier; untilDeg?: PerTier }[]
  gems: { from: At; to: At; count: number } | readonly At[] // ghost times with a gem on the path
  mines?: readonly PhraseMine[]
}

// The hold of an arc, per tier: the heavier the gravity, the longer the hold, so the
// apex is above the horizontal in every tier.
const ARC_HOLD: PerTier = [0.58, 0.5, 0.45]

// Positive steer swings the ghost to positive theta; the director mirrors a phrase
// by negating every angle.
export const PHRASES: readonly Phrase[] = [
  {
    // one swing up the wall and back: rise, apex, fall
    id: 'arc',
    unlock: [0, 0, 0],
    weight: [2, 5, 3],
    load: 0,
    script: [{ steer: 1, t: ARC_HOLD }, { steer: 0, t: 1.4 }],
    gems: { from: [0, -0.45], to: [0, 0.45], count: 4 },
  },
  {
    // left-right-left: a small swing one way, a bigger one back, and a third that
    // carries above the horizontal
    id: 'pump',
    unlock: [1, 0, 0],
    weight: [1, 4, 1.5],
    load: 1,
    script: [
      { steer: 1, t: 0.3 },
      { steer: 0, t: 0.3 },
      { steer: -1, t: 0.35 },
      { steer: 0, t: 0.3 },
      { steer: 1, t: [0.7, 0.66, 0.58] },
      { steer: 0, t: 1.2 },
    ],
    // a pair of gems on each of the three turning points, where the swing is slow
    gems: [
      [0, -0.13],
      [0, 0.13],
      [1, -0.13],
      [1, 0.13],
      [2, -0.13],
      [2, 0.13],
    ],
    // deeper levels: a mine on the floor under the big third swing, then one on the
    // far wall while the ghost hangs on its second turn. Neither is near the line.
    mines: [
      { at: [2, 0], deg: 0, abs: true, minTuned: 4 },
      { at: [1, 0], deg: 75, abs: true, minTuned: 7 },
    ],
  },
  {
    // an arc over a mine on the floor
    id: 'jump',
    unlock: [0, 0, 0],
    weight: [4, 1.5, 2],
    load: 1,
    script: [{ steer: 1, t: ARC_HOLD }, { steer: 0, t: 1.4 }],
    gems: { from: [0, -0.3], to: [0, 0.3], count: 3 },
    mines: [
      { at: [0, 0], deg: 0, abs: true },
      { at: [0, 0], deg: -40, abs: true, minTuned: 3 }, // widens the wall away from the gems
      { at: [0, 0], deg: 40, abs: true, minTuned: 6 }, // ... and toward them: a wall across the floor
    ],
  },
  {
    // a slalom: short swings to alternating sides, with a mine near the floor under
    // each turn, so staying low is what gets punished
    id: 'weave',
    unlock: [0, 0, null],
    weight: [4, 1, 0],
    load: 2,
    script: [
      { steer: 1, t: 0.3 },
      { steer: -1, t: 0.5 },
      { steer: 1, t: 0.5 },
      { steer: -1, t: 0.5 },
      { steer: 0, t: 0.6 },
    ],
    gems: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    mines: [
      { at: [1, 0], deg: -60 },
      { at: [2, 0], deg: -60 },
      // none under the first turn: a craft may still be coming down the wall there
      // from whatever it flew before
      { at: [3, 0], deg: -60, minTuned: 3 },
    ],
  },
  {
    // one long hold, released on the way up, carries the ghost over the top at an easy
    // pace: a ring of gems around the tube. A craft that is late keeps holding and
    // catches up; one that is early lets go and waits.
    id: 'loop',
    unlock: [null, 1, 0],
    weight: [0, 6, 10],
    load: 2,
    spacing: [2, 2, 0], // the fast tier's signature: there a ring may follow a ring
    // The ring starts where the hold ends: from there on the pace is slow enough to
    // adjust to, whatever the craft was doing when the phrase began.
    script: [{ steer: 1, untilDeg: [140, 132, 115] }, { steer: 0, t: 1.75 }],
    gems: { from: 0.55, to: [-1, -0.15], count: 7 },
  },
  {
    // a few loose gems and mines, so the tube does not feel on rails
    id: 'scatter',
    unlock: [0, 0, 0],
    weight: [3.3, 3, 3.5],
    load: 1,
    script: [],
    gems: [],
  },
]

const MAX_HOLD_SECONDS = 3 // a hold that has not reached its angle by then ends anyway
const MAX_APEX = 8
export const MAX_ITEMS = 8 // most gems, and most mines, one phrase holds
const TAIL = 0.1 // s a phrase lasts beyond its last item

/** One phrase in one tier: the ghost's angle over time and where its items sit. */
export interface Trace {
  phrase: Phrase
  duration: number // s from ghost time 0 to just after the last item (the script may run on)
  thetaAt(t: number): number // ghost angle at ghost time t (clamped to the trace)
  nGems: number
  gemT: Float32Array
  gemTheta: Float32Array
  nMines: number // every variant; filter by mineMinTuned
  mineT: Float32Array
  mineTheta: Float32Array
  mineMinTuned: Float32Array
}

/** Longest one script segment lasts in a tier: its time, or the cap of a hold to an angle. */
export function segmentSeconds(seg: Phrase['script'][number], tier: number): number {
  return seg.untilDeg ? MAX_HOLD_SECONDS : typeof seg.t === 'number' ? seg.t : (seg.t?.[tier] ?? 0)
}

/** Builds the trace of `phrase` under the steady gravity of one tier. */
export function buildTrace(phrase: Phrase, tier: number, gravityK: number): Trace {
  const dt = 1 / PHYSICS.HZ
  let steps = 0
  for (const seg of phrase.script) steps += Math.round(segmentSeconds(seg, tier) * PHYSICS.HZ)
  const theta = new Float32Array(steps + 1)
  const apexT: number[] = []
  const ghost: SwingState = { theta: 0, omega: 0, steerSignal: 0 }
  let n = 0
  let lastOmega = 0
  for (const seg of phrase.script) {
    const segSteps = Math.round(segmentSeconds(seg, tier) * PHYSICS.HZ)
    for (let k = 0; k < segSteps; k++) {
      if (seg.untilDeg && Math.abs(ghost.theta) >= seg.untilDeg[tier]! * DEG) break
      stepSwing(ghost, seg.steer, gravityK, dt)
      n++
      theta[n] = ghost.theta
      // a turning point: the swing stops and comes back
      if (lastOmega !== 0 && ghost.omega !== 0 && Math.sign(ghost.omega) !== Math.sign(lastOmega) && apexT.length < MAX_APEX) {
        apexT.push(n * dt)
      }
      lastOmega = ghost.omega
    }
  }
  const scriptEnd = n * dt
  const thetaAt = (t: number): number => theta[Math.max(0, Math.min(n, Math.round(t * PHYSICS.HZ)))] ?? 0
  // [apex, offset]: a negative apex index counts from the end of the phrase (-1 = the end)
  const timeOf = (at: At): number => {
    if (typeof at === 'number') return at
    const [apex, offset] = at
    const base = apex < 0 ? scriptEnd : (apexT[apex] ?? scriptEnd)
    return Math.max(0, Math.min(scriptEnd, base + offset))
  }

  const trace: Trace = {
    phrase,
    duration: scriptEnd,
    thetaAt,
    nGems: 0,
    gemT: new Float32Array(MAX_ITEMS),
    gemTheta: new Float32Array(MAX_ITEMS),
    nMines: 0,
    mineT: new Float32Array(MAX_ITEMS),
    mineTheta: new Float32Array(MAX_ITEMS),
    mineMinTuned: new Float32Array(MAX_ITEMS),
  }
  const addGem = (t: number): void => {
    if (trace.nGems >= MAX_ITEMS) return
    trace.gemT[trace.nGems] = t
    trace.gemTheta[trace.nGems] = thetaAt(t)
    trace.nGems++
  }
  const g = phrase.gems
  if ('count' in g) {
    const from = timeOf(g.from)
    const to = timeOf(g.to)
    for (let i = 0; i < g.count; i++) addGem(g.count > 1 ? from + ((to - from) * i) / (g.count - 1) : from)
  } else {
    for (const at of g) addGem(timeOf(at))
  }
  for (const m of phrase.mines ?? []) {
    if (trace.nMines >= MAX_ITEMS) break
    const t = timeOf(m.at)
    const here = thetaAt(t)
    // a relative mine sits `deg` farther up the wall than the ghost, on the ghost's side;
    // an absolute one takes its sign as given (the ghost's first swing goes to the positive side)
    const side = here >= 0 ? 1 : -1
    trace.mineT[trace.nMines] = t
    trace.mineTheta[trace.nMines] = m.abs ? m.deg * DEG : here + side * m.deg * DEG
    trace.mineMinTuned[trace.nMines] = m.minTuned ?? 0
    trace.nMines++
  }
  let lastItem = 0
  for (let i = 0; i < trace.nGems; i++) lastItem = Math.max(lastItem, trace.gemT[i]!)
  for (let i = 0; i < trace.nMines; i++) lastItem = Math.max(lastItem, trace.mineT[i]!)
  trace.duration = Math.min(scriptEnd, lastItem + TAIL)
  return trace
}

import { FLIGHT, SEQUENCE, SPEED, SPAWN_CLEAR, type FlightMode } from '../config'
import { N_TIERS, TIERS, pinnedTier, type Flight } from '../flight'
import { angleDiff, clamp, lerp, DEG } from '../util/math'
import { rand, randRange } from '../util/rng'
import { PHRASES, MAX_ITEMS, buildTrace, type Load, type Phrase, type Trace } from './phrases'

// The gem-line director. It fills the gem and mine pools (feed-mode fields) with
// phrases from world/phrases.ts.
//
// It works one section at a time. When the planning horizon reaches a section, the
// director picks that section's phrases - by tier, tuning level and weight, never
// one of the last two unless the phrase allows it (Phrase.spacing) - against two budgets:
//   - gems per cycle: at least GEMS_PER_CYCLE and at most GEMS_EXTRA_MAX more, so
//     the gem gate's quota is always on offer;
//   - mines per section: MINES_PER_SECTION, rising with the tuning level.
// Then it spreads them evenly over the section with at least GAP seconds of rest in
// between. No phrase crosses a section boundary or starts in the first
// BOUNDARY_CLEAR seconds of a section, so the speed change and the level banner
// happen in calm air and the craft flies a phrase at the steady speed the ghost
// assumed. The phrases are placed on the wall as the horizon reaches them.
//
// An item at ghost time t sits at phraseStart + tierSpeed * t. The tube ahead is
// planned for the current level; when the level rises at a cycle boundary, every
// waiting item beyond the boundary is moved to keep its time (levelUp).

const SECS = FLIGHT.SECTION_SECONDS
const LOG = 16 // phrases remembered for pressureAt
const MAX_PLAN = 8 // phrases one section can hold
const PLAN_TRIES = 16 // plans drawn for a section before the closest one is taken
const PHRASE_CUE = 0.5 // s before a phrase's start that onPhraseAhead fires
const SHORTEST = 1.2 // s: about the shortest phrase, when estimating how many more fit
const LATER_GEMS = 4 // gems each of those further phrases is counted as adding
const PLACE_TRIES = 4 // forward nudges when a scripted phrase lands on an orb or an extra life
const ITEM_TRIES = 8 // angle samples for one scatter gem or mine
const EDGE = 0.15 // s a scatter keeps free before its first and after its last item

/** What the director just placed (one reused object, for the sims and metrics). */
export interface PlacedPhrase {
  id: Phrase['id']
  load: Load
  tier: number
  level: number
  mirror: boolean
  start: number // world distance of ghost time 0
  end: number
  speed: number // tier speed the phrase was laid out for
  gems: number
  mines: number
  sectionStart: number
  sectionEnd: number
  clearEnd: number // first distance a phrase may start in this section
  cycle: number // index of the cycle it belongs to (0 = the first of the run)
}

export interface SequencerDeps {
  flight: Flight
  bombMult(tuningLevel: number): number // mine density multiplier (levels.ts)
  spawnGem(worldDistance: number, theta: number): boolean
  spawnMine(worldDistance: number, theta: number): boolean
  blocked(worldDistance: number, theta: number): boolean // an orb or an extra life sits there
  rescaleItems(boundary: number, ratio: number): void // move the waiting gems and mines
  clearItems(): void // park every gem and mine
  onPhrase?(p: PlacedPhrase): void
  onPhraseAhead?(id: Phrase['id'], tier: number): void // the craft is PHRASE_CUE seconds before a phrase
  // a section is fully placed: its mines against its budget
  onSection?(tier: number, mines: number, budget: number): void
  // a cycle is fully placed: the gems it offers
  onCycle?(cycle: number, gems: number): void
}

export interface Sequencer {
  update(craftDistance: number): void // place what the horizon has reached (once per frame)
  levelUp(): void // the level rose at the boundary flight.cycleStart(): re-time the tube beyond it
  pressureAt(distance: number): Load // load of the phrase covering a distance, else 0
  reset(): void // plan from distance 0 (title screen and run start)
  stale(): boolean // the tube was planned for other speeds than flight now gives (difficulty changed)
}

export function createSequencer(deps: SequencerDeps): Sequencer {
  const { flight } = deps
  const N = PHRASES.length

  // One trace per phrase and tier. With tier-relative gravity the steady gravity of
  // a tier is the same at every level, so level 0 stands for all of them.
  const traces: (Trace | undefined)[][] = PHRASES.map((p) =>
    TIERS.map((tier) =>
      p.script.length > 0 && p.unlock[tier] !== null ? buildTrace(p, tier, flight.gravityOf(0, flight.tierSpeedOf(0, tier))) : undefined,
    ),
  )
  const arcIndex = PHRASES.findIndex((p) => p.id === 'arc')

  // --- planning state ---------------------------------------------------------
  let mode: FlightMode = flight.mode
  let level = 0 // level the tube ahead is planned for
  let plannedSlow = 0 // slow-tier speed it was planned with
  let cycle = 0
  let secIndex = 0 // section within the cycle, 0..2
  let secTier = 0
  let secStart = 0
  let secEnd = 0
  let clearEnd = 0 // first distance a phrase may start in the section
  let cycleGems = 0
  let secMines = 0
  let secBudget = 0
  let last1 = -1 // indices of the last two phrases
  let last2 = -1
  let first = true // the next phrase is the first of the run
  let plannedBefore = Infinity // phrases of this run planned in earlier sections (Infinity: no warm-up)

  // the current section's phrases: index, start (s after clearEnd), gems and mines
  const planPhrase = new Int8Array(MAX_PLAN)
  const planAt = new Float64Array(MAX_PLAN)
  const planDur = new Float64Array(MAX_PLAN)
  const planGems = new Uint8Array(MAX_PLAN)
  const planMines = new Uint8Array(MAX_PLAN)
  let planN = 0
  let planNext = 0 // first phrase of the plan not placed yet
  // the best plan found so far while a section is being planned
  const keptPhrase = new Int8Array(MAX_PLAN)
  const keptDur = new Float64Array(MAX_PLAN)
  const keptPlanGems = new Uint8Array(MAX_PLAN)
  const keptPlanMines = new Uint8Array(MAX_PLAN)
  let keptN = 0
  let keptGems = 0
  let keptMines = 0
  let kept1 = -1
  let kept2 = -1

  const logStart = new Float64Array(LOG)
  const logEnd = new Float64Array(LOG).fill(-1)
  const logLoad = new Uint8Array(LOG)
  const logPhrase = new Int8Array(LOG)
  const logTier = new Uint8Array(LOG)
  const logCue = new Float64Array(LOG).fill(Infinity) // distance at which onPhraseAhead fires (Infinity once it has)
  let logHead = 0

  // scratch for one phrase's items (ghost time, angle)
  const gemT = new Float64Array(MAX_ITEMS)
  const gemTheta = new Float64Array(MAX_ITEMS)
  const mineT = new Float64Array(MAX_ITEMS)
  const mineTheta = new Float64Array(MAX_ITEMS)
  let nGems = 0
  let nMines = 0
  const cand = new Int8Array(N)
  const candGems = new Int16Array(N) // gems the section could still reach with this pick
  const candMines = new Int16Array(N) // ... and mines
  const taken = new Uint8Array(N)
  const placed: PlacedPhrase = {
    id: 'arc', load: 0, tier: 0, level: 0, mirror: false, start: 0, end: 0, speed: 0,
    gems: 0, mines: 0, sectionStart: 0, sectionEnd: 0, clearEnd: 0, cycle: 0,
  }

  const tierOf = (index: number): number => (mode === 'sections' ? index : pinnedTier(mode))
  const speedOf = (tier: number): number => flight.tierSpeedOf(level, tier)
  // the whole tuning level, as the level tables use it (levels.ts)
  const tuning = (): number => Math.round(flight.tuned(level))
  const gap = (): number => lerp(SEQUENCE.GAP[0], SEQUENCE.GAP[1], clamp(flight.tuned(level) / SEQUENCE.GAP_FULL_T, 0, 1))

  // Distance the craft covers in the first BOUNDARY_CLEAR seconds of a section. It
  // enters at the previous tier's speed and eases at SPEED.EASE, so a section entered
  // from a faster one is crossed quicker than its own steady speed suggests.
  function clearDistance(index: number): number {
    const tier = tierOf(index)
    const v = speedOf(tier)
    const prev = speedOf(tierOf((index + N_TIERS - 1) % N_TIERS))
    const over = prev > v ? ((prev - v) * (prev - v)) / (2 * SPEED.EASE) : 0
    return SEQUENCE.BOUNDARY_CLEAR[tier]! * v + over
  }

  function frameSection(index: number, start: number): void {
    secIndex = index
    secTier = tierOf(index)
    secStart = start
    secEnd = start + speedOf(secTier) * SECS
    clearEnd = start + clearDistance(index)
    secBudget = SEQUENCE.MINES_PER_SECTION[secTier]! / deps.bombMult(tuning()) / flight.ease()
  }

  function nextSection(): void {
    deps.onSection?.(secTier, secMines, secBudget)
    plannedBefore += planN
    if (secIndex === N_TIERS - 1) {
      deps.onCycle?.(cycle, cycleGems)
      cycle++
      cycleGems = 0
      frameSection(0, secEnd)
    } else frameSection(secIndex + 1, secEnd)
    planSection()
  }

  // Forget everything planned and start over for the current mode and level.
  function restart(): void {
    deps.clearItems()
    mode = flight.mode
    level = flight.level
    plannedSlow = speedOf(0)
    cycleGems = 0
    plannedBefore = Infinity
    last1 = last2 = -1
    logHead = 0
    logEnd.fill(-1)
    logCue.fill(Infinity)
    frameSection(0, flight.cycleStart())
  }

  // --- what a phrase holds --------------------------------------------------------
  const unlocked = (i: number): boolean => {
    const unlock = PHRASES[i]!.unlock[secTier]
    return unlock !== null && unlock !== undefined && tuning() >= unlock && PHRASES[i]!.weight[secTier]! > 0
  }
  // the phrase was used too recently (Phrase.spacing: 2 = not one of the last two, 0 = may follow itself)
  const tooSoon = (i: number): boolean => {
    const spacing = PHRASES[i]!.spacing?.[secTier] ?? 2
    return (i === last1 && spacing >= 1) || (i === last2 && spacing >= 2)
  }
  // mines of a scripted phrase: the base ones, and all of them at this tuning level
  const baseMines = (trace: Trace): number => {
    let n = 0
    for (let i = 0; i < trace.nMines; i++) if (trace.mineMinTuned[i]! <= 0) n++
    return n
  }
  const allMines = (trace: Trace): number => {
    let n = 0
    for (let i = 0; i < trace.nMines; i++) if (tuning() >= trace.mineMinTuned[i]!) n++
    return n
  }
  // longest a scatter of g gems and m mines can take
  const scatterSeconds = (g: number, m: number): number => {
    const S = SEQUENCE.SCATTER
    const gems = EDGE + (g - 1) * S.GEM_GAP[1]
    const mines = m > 0 ? S.MINE_FIRST[1] + (m - 1) * S.MINE_GAP[1] : 0
    return Math.max(gems, mines) + EDGE
  }
  const scatterMaxMines = (): number => (tuning() >= SEQUENCE.SCATTER.MINES_3_FROM ? 3 : 2)
  const maxMines = (i: number): number => {
    const trace = traces[i]![secTier]
    return trace ? allMines(trace) : scatterMaxMines()
  }
  // the most mines `slots` further phrases could add (each a different phrase, none of them `self`)
  function laterMines(slots: number, self: number): number {
    taken.fill(0)
    let sum = 0
    for (let k = 0; k < slots; k++) {
      let best = -1
      for (let i = 0; i < N; i++) {
        if (i === self || taken[i] || !unlocked(i)) continue
        if (best < 0 || maxMines(i) > maxMines(best)) best = i
      }
      if (best < 0) break
      taken[best] = 1
      sum += maxMines(best)
    }
    return sum
  }

  // --- planning one section -------------------------------------------------------
  // Picks the section's phrases in order (each with the gems and mines it will hold),
  // then spreads them over the section. The weighted picks are random, so a plan can
  // miss a budget: the section is planned up to PLAN_TRIES times and the plan closest
  // to both budgets is kept. The last try takes the phrase with the most gems every
  // time, so the cycle's gem minimum is met whenever the time allows it.
  function planSection(): void {
    const speed = speedOf(secTier)
    const rest = gap()
    const usable = (secEnd - clearEnd) / speed
    const lastSection = secIndex === N_TIERS - 1
    const gems0 = cycleGems
    const l1 = last1
    const l2 = last2
    let bestMiss = Infinity
    for (let attempt = 0; attempt < PLAN_TRIES && bestMiss > 0; attempt++) {
      cycleGems = gems0
      last1 = l1
      last2 = l2
      secMines = 0
      planN = 0
      let t = 0 // s after clearEnd where the next phrase could start
      while (planN < MAX_PLAN && pick(usable - t, attempt === PLAN_TRIES - 1)) {
        t += planDur[planN - 1]! + rest
      }
      const gemsShort = lastSection ? Math.max(0, SEQUENCE.GEMS_PER_CYCLE - cycleGems) : 0
      const miss = gemsShort * 10 + Math.max(0, Math.abs(secMines - secBudget) - 1)
      if (miss >= bestMiss) continue
      bestMiss = miss
      keptN = planN
      keptGems = cycleGems
      keptMines = secMines
      kept1 = last1
      kept2 = last2
      keptPhrase.set(planPhrase)
      keptDur.set(planDur)
      keptPlanGems.set(planGems)
      keptPlanMines.set(planMines)
    }
    planN = keptN
    cycleGems = keptGems
    secMines = keptMines
    last1 = kept1
    last2 = kept2
    planPhrase.set(keptPhrase)
    planDur.set(keptDur)
    planGems.set(keptPlanGems)
    planMines.set(keptPlanMines)
    planNext = 0
    if (planN === 0) return
    // spread: the spare time goes between the phrases, half a share before the first
    // and after the last (the first phrase of a run stays where FIRST_AT put it)
    let used = -rest
    for (let i = 0; i < planN; i++) used += planDur[i]! + rest
    const share = Math.max(0, usable - used) / planN
    let at = first ? 0 : share / 2
    for (let i = 0; i < planN; i++) {
      planAt[i] = at
      at += planDur[i]! + rest + share
    }
  }

  // Adds one phrase to the plan, if any fits in `timeLeft` seconds and the budgets.
  function pick(timeLeft: number, greedy: boolean): boolean {
    const rest = gap()
    const lastSection = secIndex === N_TIERS - 1
    const gemCap = lastSection
      ? SEQUENCE.GEMS_PER_CYCLE + SEQUENCE.GEMS_EXTRA_MAX
      : Math.min(SEQUENCE.GEMS_PER_CYCLE + SEQUENCE.GEMS_EXTRA_MAX, SEQUENCE.GEMS_CUMULATIVE_MAX[secIndex] ?? Infinity)
    const gemRoom = gemCap - cycleGems
    // gems this section must still add so the cycle can reach its minimum
    const gemNeed = (lastSection ? SEQUENCE.GEMS_PER_CYCLE : SEQUENCE.GEMS_CUMULATIVE_MIN[secIndex]!) - cycleGems
    const mineNeed = secBudget - 1 - secMines // mines still missing to land within one of the budget
    const opening = first && planN === 0
    // gems this pick would hold: a scripted phrase its own, a scatter as many as fit
    const pickGems = (i: number): number => traces[i]![secTier]?.nGems ?? Math.min(SEQUENCE.SCATTER.GEMS[1], gemRoom)
    const warmup = plannedBefore + planN < SEQUENCE.WARMUP_PHRASES // the run opens without mines

    // Candidates, each with what the section could still reach after it: its own
    // gems and mines plus those of the phrases that fit in the time left.
    let n = 0
    let bestGems = 0
    let bestMines = 0
    for (let i = 0; i < N; i++) {
      if (opening ? i !== arcIndex : !unlocked(i) || tooSoon(i)) continue
      const trace = traces[i]![secTier]
      const gems = pickGems(i)
      const dur = trace ? trace.duration : scatterSeconds(SEQUENCE.SCATTER.GEMS[0], 0) // the shortest scatter
      if (dur > timeLeft || gems > gemRoom || gems < SEQUENCE.SCATTER.GEMS[0]) continue
      if (!warmup && secMines + (trace ? baseMines(trace) : 0) > secBudget + 1) continue
      const later = Math.max(0, Math.floor((timeLeft - dur) / (rest + SHORTEST)))
      cand[n] = i
      candGems[n] = Math.min(gemRoom, gems + later * LATER_GEMS)
      candMines[n] = maxMines(i) + laterMines(later, i)
      if (candGems[n]! > bestGems) bestGems = candGems[n]!
      if (candMines[n]! > bestMines) bestMines = candMines[n]!
      n++
    }
    if (n === 0) return false

    let choice = -1
    if (greedy) {
      for (let k = 0; k < n; k++) if (choice < 0 || pickGems(cand[k]!) > pickGems(choice)) choice = cand[k]!
    }
    // Keep the candidates that can still meet the gem goal and the mine budget; when
    // none can do both, the gem goal alone (the gem gate depends on it).
    const gemFloor = Math.min(gemNeed, bestGems)
    const mineFloor = Math.min(mineNeed, bestMines)
    for (let pass = 0; pass < 2 && choice < 0; pass++) {
      let total = 0
      for (let k = 0; k < n; k++) {
        if (candGems[k]! >= gemFloor && (pass === 1 || candMines[k]! >= mineFloor)) total += PHRASES[cand[k]!]!.weight[secTier]!
      }
      if (total <= 0) continue
      let r = rand() * total
      for (let k = 0; k < n; k++) {
        if (candGems[k]! < gemFloor || (pass === 0 && candMines[k]! < mineFloor)) continue
        choice = cand[k]!
        r -= PHRASES[choice]!.weight[secTier]!
        if (r < 0) break
      }
    }
    if (choice < 0) return false

    const trace = traces[choice]![secTier]
    let gems: number
    let mines: number
    let dur: number
    if (trace) {
      // the base mines always, the higher-tuning extras while they fit the budget
      gems = trace.nGems
      mines = warmup ? 0 : baseMines(trace)
      const all = warmup ? 0 : allMines(trace)
      while (mines < all && secMines + mines + 1 <= secBudget + 0.5) mines++
      dur = trace.duration
    } else {
      // a scatter takes its fewest or its most gems (the most only with time and room
      // for it) and as many mines as the section's budget still asks for and the time allows
      const [few, many] = SEQUENCE.SCATTER.GEMS
      const canMany = gemRoom >= many && timeLeft >= scatterSeconds(many, 0)
      gems = canMany && (gemNeed >= many || rand() < 0.5) ? many : few
      mines = warmup ? 0 : Math.max(0, Math.min(scatterMaxMines(), Math.round(secBudget - secMines)))
      while (mines > 0 && scatterSeconds(gems, mines) > timeLeft) mines--
      dur = scatterSeconds(gems, mines)
    }
    planPhrase[planN] = choice
    planDur[planN] = dur
    planGems[planN] = gems
    planMines[planN] = mines
    planN++
    cycleGems += gems
    secMines += mines
    last2 = last1
    last1 = choice
    return true
  }

  // --- placing one planned phrase -------------------------------------------------
  // Draws a scatter that starts at `start`: `g` gems and `m` mines at loose times and
  // random angles, none on an orb or an extra life. Every mine keeps MINE_CLEAR from
  // each gem that passes within SCATTER.NEAR seconds of it; a mine that finds no such
  // angle is left out.
  function drawScatter(g: number, m: number, start: number, speed: number): void {
    const S = SEQUENCE.SCATTER
    nGems = 0
    nMines = 0
    let t = EDGE
    for (let i = 0; i < g; i++) {
      if (i > 0) t += randRange(S.GEM_GAP[0], S.GEM_GAP[1])
      // not on an orb, and within reach of the gem before it through the bottom
      let theta = 0
      for (let k = 0; k < ITEM_TRIES; k++) {
        theta = (rand() < 0.5 ? -1 : 1) * randRange(S.GEM_DEG[0], S.GEM_DEG[1]) * DEG
        const reach = i === 0 || Math.abs(theta - gemTheta[i - 1]!) <= S.GEM_REACH
        if (reach && !deps.blocked(start + t * speed, theta)) break
      }
      gemT[nGems] = t
      gemTheta[nGems] = theta
      nGems++
    }
    t = randRange(S.MINE_FIRST[0], S.MINE_FIRST[1])
    for (let i = 0; i < m; i++) {
      if (i > 0) t += randRange(S.MINE_GAP[0], S.MINE_GAP[1])
      for (let k = 0; k < ITEM_TRIES; k++) {
        const theta = (rand() < 0.5 ? -1 : 1) * randRange(S.MINE_DEG[0], S.MINE_DEG[1]) * DEG
        let clear = !deps.blocked(start + t * speed, theta)
        for (let j = 0; j < nGems; j++) {
          if (Math.abs(gemT[j]! - t) < S.NEAR && Math.abs(angleDiff(theta, gemTheta[j]!)) < SEQUENCE.MINE_CLEAR) clear = false
        }
        if (clear) {
          mineT[nMines] = t
          mineTheta[nMines] = theta
          nMines++
          break
        }
      }
    }
  }

  function itemsBlocked(start: number, speed: number): boolean {
    for (let i = 0; i < nMines; i++) if (deps.blocked(start + mineT[i]! * speed, mineTheta[i]!)) return true
    for (let i = 0; i < nGems; i++) if (deps.blocked(start + gemT[i]! * speed, gemTheta[i]!)) return true
    return false
  }

  function place(index: number): void {
    const speed = speedOf(secTier)
    const choice = planPhrase[index]!
    const phrase = PHRASES[choice]!
    const trace = traces[choice]![secTier]
    // the first phrase of a run always curves up the right wall
    const mirror = first ? 1 : rand() < 0.5 ? -1 : 1
    if (trace) {
      nGems = trace.nGems
      for (let i = 0; i < nGems; i++) {
        gemT[i] = trace.gemT[i]!
        gemTheta[i] = mirror * trace.gemTheta[i]!
      }
      nMines = 0
      for (let i = 0; i < trace.nMines && nMines < planMines[index]!; i++) {
        if (tuning() < trace.mineMinTuned[i]!) continue
        mineT[nMines] = trace.mineT[i]!
        mineTheta[nMines] = mirror * trace.mineTheta[i]!
        nMines++
      }
    }
    let start = clearEnd + planAt[index]! * speed
    if (trace) {
      // an orb or an extra life in the way of a scripted phrase: move on a little
      // (into the rest that follows), then leave out the mines that still sit on one
      const room = index + 1 < planN ? clearEnd + (planAt[index + 1]! - SEQUENCE.GAP[1]) * speed : secEnd
      for (let k = 0; k < PLACE_TRIES; k++) {
        if (!itemsBlocked(start, speed) || start + SPAWN_CLEAR.NUDGE + planDur[index]! * speed > room) break
        start += SPAWN_CLEAR.NUDGE
      }
    } else drawScatter(planGems[index]!, planMines[index]!, start, speed)
    let gems = 0
    let mines = 0
    for (let i = 0; i < nGems; i++) if (deps.spawnGem(start + gemT[i]! * speed, gemTheta[i]!)) gems++
    for (let i = 0; i < nMines; i++) {
      const wd = start + mineT[i]! * speed
      if (!deps.blocked(wd, mineTheta[i]!) && deps.spawnMine(wd, mineTheta[i]!)) mines++
    }
    // the budgets count what is really on the wall
    cycleGems += gems - planGems[index]!
    secMines += mines - planMines[index]!
    first = false

    const end = start + planDur[index]! * speed
    logStart[logHead] = start
    logEnd[logHead] = end
    logLoad[logHead] = phrase.load
    logPhrase[logHead] = choice
    logTier[logHead] = secTier
    logCue[logHead] = start - PHRASE_CUE * speed
    logHead = (logHead + 1) % LOG

    if (deps.onPhrase) {
      placed.id = phrase.id
      placed.load = phrase.load
      placed.tier = secTier
      placed.level = level
      placed.mirror = mirror < 0
      placed.start = start
      placed.end = end
      placed.speed = speed
      placed.gems = gems
      placed.mines = mines
      placed.sectionStart = secStart
      placed.sectionEnd = secEnd
      placed.clearEnd = clearEnd
      placed.cycle = cycle
      deps.onPhrase(placed)
    }
  }

  const seq: Sequencer = {
    update(craftDistance: number): void {
      if (flight.mode !== mode) {
        // the flight mode was switched mid-run (a testing key): start over, in the
        // section that holds the first distance worth planning
        const from = craftDistance + SEQUENCE.FIRST_AT
        restart()
        while (secEnd <= from) frameSection((secIndex + 1) % N_TIERS, secEnd)
        if (clearEnd < from) clearEnd = from
        planSection()
      }
      const horizon = craftDistance + SEQUENCE.HORIZON
      for (;;) {
        if (planNext < planN) {
          // a phrase is placed whole, so it may reach past the horizon
          if (clearEnd + planAt[planNext]! * speedOf(secTier) >= horizon) break
          place(planNext++)
        } else {
          if (secEnd >= horizon) break
          nextSection()
        }
      }
      if (deps.onPhraseAhead) {
        for (let i = 0; i < LOG; i++) {
          if (craftDistance < logCue[i]!) continue
          logCue[i] = Infinity
          deps.onPhraseAhead(PHRASES[logPhrase[i]!]!.id, logTier[i]!)
        }
      }
    },

    levelUp(): void {
      const boundary = flight.cycleStart()
      const old = plannedSlow
      level = flight.level
      plannedSlow = speedOf(0)
      const ratio = old > 0 ? plannedSlow / old : 1
      // The horizon is shorter than a slow section, so everything waiting beyond the
      // boundary is in the slow section that starts there. Its placed items move with
      // the fields; its phrases still to place keep their times and follow clearEnd.
      const move = (d: number): number => (d > boundary ? boundary + (d - boundary) * ratio : d)
      deps.rescaleItems(boundary, ratio)
      for (let i = 0; i < LOG; i++) {
        if (logEnd[i]! < 0) continue
        logStart[i] = move(logStart[i]!)
        logEnd[i] = move(logEnd[i]!)
        if (logCue[i]! < Infinity) logCue[i] = move(logCue[i]!)
      }
      if (secStart >= boundary - 1e-6) {
        // the section keeps the mine budget its phrases were picked against
        const clear = move(clearEnd)
        const budget = secBudget
        frameSection(0, boundary)
        clearEnd = clear
        secBudget = budget
      }
    },

    pressureAt(distance: number): Load {
      for (let i = 0; i < LOG; i++) {
        if (logEnd[i]! >= distance && logStart[i]! <= distance) return logLoad[i] as Load
      }
      return 0
    },

    reset(): void {
      restart()
      cycle = 0
      plannedBefore = 0
      first = true
      clearEnd = secStart + SEQUENCE.FIRST_AT // the run opens with its first phrase here
      planSection()
      seq.update(0)
    },

    stale: (): boolean => flight.tierSpeedOf(flight.level, 0) !== plannedSlow || flight.mode !== mode,
  }
  return seq
}

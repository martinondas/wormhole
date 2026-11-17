// Headless bot playtests of the REAL game (npm run playtest -- [options]).
// Runs seeded bot players through src/session.ts - the same gameplay module the
// browser runs - and reports playability metrics. See playtest/README.md.
//
//   --bot <names>        comma list or "all" (kid, average, good, oracle, camper, spinner, tapper, passive)
//   --difficulty <modes> comma list or "all" (milkyway, orion, quasar)   default orion
//   --runs <n>           seeded runs per bot x mode                      default 40
//   --seed <n>           first seed (runs use seed, seed+1, ...)         default 1
//   --max-seconds <n>    time cap per run                                default 600
//   --matrix baseline    the baseline set: every bot on ORION, kid on MILKY WAY, good on QUASAR
//   --matrix next        the baseline set plus the oracle on MILKY WAY and on QUASAR (the
//                        fairness guard in every mode); playtest/next-level.json holds it
//   --out <file.json>    write the aggregated results (add --keep-runs for every run)
//   --compare <file>     print baseline-vs-current deltas against an earlier --out file
//   --levels             also print the per-level pacing table for each entry
//   --set <bot.key=value>  override one bot profile number for this invocation (repeatable),
//                        for example --set kid.reaction=0.3 (to study the bots, not the game)
//   --cfg <PATH=value>   override one number in src/config.ts for this invocation (repeatable),
//                        for example --cfg ENEMY.HUNT_TRACK.0=2 (to try a tuning value before
//                        editing config; a value the game reads only once at load is not affected)
//   --workers <n>        parallel worker threads                         default cores - 1 (max 8)
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import * as CONFIG from '../src/config'
import { DIFFICULTY } from '../src/config'
import { createHarness } from './playtest/run'
import { PROFILES } from './playtest/bot'
import { aggregate, type Aggregate, type RunResult } from './playtest/metrics'
import { summaryTable, probeTable, levelTable, compareTable } from './playtest/report'

const args = process.argv.slice(2)
const flag = (name: string): boolean => args.includes(`--${name}`)
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback
}

const modeKey = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, '')
const modeIndex = (name: string): number => {
  const i = DIFFICULTY.MODES.findIndex((m) => modeKey(m.name) === modeKey(name))
  if (i < 0) throw new Error(`unknown difficulty "${name}" (have: ${DIFFICULTY.MODES.map((m) => modeKey(m.name)).join(', ')})`)
  return i
}

// profile overrides apply in the main thread and (same argv) in every worker
args.forEach((a, i) => {
  if (a !== '--set') return
  const m = /^(\w+)\.(\w+)=(-?[\d.]+)$/.exec(args[i + 1] ?? '')
  const profile = m ? (PROFILES[m[1]!] as unknown as Record<string, unknown> | undefined) : undefined
  if (!m || !profile || typeof profile[m[2]!] !== 'number') throw new Error(`bad --set "${args[i + 1]}" (want bot.key=number)`)
  profile[m[2]!] = Number(m[3])
})

// config overrides, likewise in the main thread and in every worker
args.forEach((a, i) => {
  if (a !== '--cfg') return
  const m = /^([\w.]+)=(-?[\d.]+)$/.exec(args[i + 1] ?? '')
  const path = m ? m[1]!.split('.') : []
  let node: unknown = CONFIG
  for (const key of path.slice(0, -1)) node = (node as Record<string, unknown> | undefined)?.[key]
  const leaf = path[path.length - 1] ?? ''
  const holder = node as Record<string, unknown> | undefined
  const kind = typeof holder?.[leaf]
  if (!m || !holder || (kind !== 'number' && kind !== 'boolean')) throw new Error(`bad --cfg "${args[i + 1]}" (want GROUP.KEY=number)`)
  holder[leaf] = kind === 'boolean' ? Number(m[2]) !== 0 : Number(m[2]) // a switch takes 0 or 1
})

const runs = Number(opt('runs', '40'))
const seed0 = Number(opt('seed', '1'))
const maxSeconds = Number(opt('max-seconds', '600'))

let jobs: { bot: string; mode: number }[] = []
const matrix = opt('matrix', '')
if (matrix === 'baseline' || matrix === 'next') {
  const orion = modeIndex('orion')
  jobs = Object.keys(PROFILES).map((bot) => ({ bot, mode: orion }))
  jobs.push({ bot: 'kid', mode: modeIndex('milkyway') }, { bot: 'good', mode: modeIndex('quasar') })
  if (matrix === 'next') jobs.push({ bot: 'oracle', mode: modeIndex('milkyway') }, { bot: 'oracle', mode: modeIndex('quasar') })
} else {
  if (matrix !== '') throw new Error(`unknown --matrix "${matrix}" (have: baseline, next)`)
  const botArg = opt('bot', 'average')
  const bots = botArg === 'all' ? Object.keys(PROFILES) : botArg.split(',')
  const diffArg = opt('difficulty', 'orion')
  const modes = diffArg === 'all' ? DIFFICULTY.MODES.map((_, i) => i) : diffArg.split(',').map(modeIndex)
  for (const mode of modes) for (const bot of bots) jobs.push({ bot, mode })
}

// Every (job, seed) run is independent and deterministic, so the runs are dealt
// round-robin to worker threads (this same bundle, started with a task list) and
// the results are put back in order.
interface Task {
  job: number
  bot: string
  mode: number
  seed: number
}

if (!isMainThread) {
  const harness = createHarness()
  const tasks = workerData as Task[]
  parentPort!.postMessage(tasks.map((t) => ({ job: t.job, result: harness.run(t.bot, t.mode, t.seed, maxSeconds) })))
  process.exit(0)
}

const started = Date.now()
const tasks: Task[] = []
jobs.forEach((j, job) => {
  for (let i = 0; i < runs; i++) tasks.push({ job, bot: j.bot, mode: j.mode, seed: seed0 + i })
})
const workers = Math.max(1, Math.min(Number(opt('workers', String(Math.min(8, availableParallelism() - 1)))), tasks.length))
const perJob: RunResult[][] = jobs.map(() => [])
if (workers === 1) {
  const harness = createHarness()
  for (const t of tasks) perJob[t.job]!.push(harness.run(t.bot, t.mode, t.seed, maxSeconds))
} else {
  const chunks: Task[][] = Array.from({ length: workers }, () => [])
  tasks.forEach((t, i) => chunks[i % workers]!.push(t))
  const done = await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<{ job: number; result: RunResult }[]>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: chunk, argv: args })
          w.once('message', resolve)
          w.once('error', reject)
        }),
    ),
  )
  for (const list of done) for (const d of list) perJob[d.job]!.push(d.result)
  for (const list of perJob) list.sort((a, b) => a.seed - b.seed)
}
const results: Aggregate[] = []
const allRuns: Record<string, RunResult[]> = {}
jobs.forEach((job, i) => {
  const mode = DIFFICULTY.MODES[job.mode]!.name
  results.push(aggregate(job.bot, mode, maxSeconds, perJob[i]!))
  allRuns[`${job.bot}@${mode}`] = perJob[i]!
})
const wall = (Date.now() - started) / 1000
const simSeconds = Object.values(allRuns).flat().reduce((a, r) => a + r.time, 0)

console.log(summaryTable(results))
console.log('\n' + probeTable(results))
if (flag('levels')) for (const a of results) console.log('\n' + levelTable(a))
console.log(
  `\n${jobs.length * runs} runs, ${(simSeconds / 60).toFixed(0)} min of play simulated in ${wall.toFixed(1)}s ` +
    `(seeds ${seed0}..${seed0 + runs - 1}, cap ${maxSeconds}s)`,
)

const out = opt('out', '')
if (out) {
  mkdirSync(dirname(out), { recursive: true })
  const doc = {
    meta: { runs, seed: seed0, maxSeconds, bots: Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, p.about])) },
    results,
    ...(flag('keep-runs') ? { runs: allRuns } : {}),
  }
  writeFileSync(out, JSON.stringify(doc, null, 1) + '\n')
  console.log(`wrote ${out}`)
}

const compare = opt('compare', '')
if (compare) {
  const base = JSON.parse(readFileSync(compare, 'utf8')) as { results: Aggregate[] }
  console.log('\n' + compareTable(base.results, results))
}

// Text output for the playtest harness: the compact results table, the per-level
// pacing table, and the baseline-vs-current comparison.
import { type Aggregate } from './metrics'

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const f0 = (x: number): string => x.toFixed(0)
const f1 = (x: number): string => x.toFixed(1)
const f2 = (x: number): string => x.toFixed(2)
const pct = (x: number): string => (x * 100).toFixed(0) + '%'

function table(head: string[], rows: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]): string => cells.map((c, i) => (i < 2 ? pad(c, w[i]!) : lpad(c, w[i]!))).join('  ')
  return [line(head), w.map((n) => '-'.repeat(n)).join('  '), ...rows.map(line)].join('\n')
}

export function summaryTable(results: Aggregate[]): string {
  const head = [
    'bot', 'mode', 'runs', 'time med (p10-p90)', 'level med (p10-p90)', 'score med', 'cap%',
    'hits/min', 'death mine/bolt/ram', 'gem%', 'repeats', 'empty%', 'acc%', 'kills/min',
    'bolts aimed/hit', 'raiders (4+)', 'dead air', 'flat/quiet', 'lives+', 'bottom/upper', 'loops', 'rev/min',
  ]
  const rows = results.map((a) => {
    const s = a.stats
    const g = (k: string): { mean: number; median: number; p10: number; p90: number } => s[k]!
    return [
      a.bot,
      a.difficulty,
      String(a.runs),
      `${f0(g('time').median)}s (${f0(g('time').p10)}-${f0(g('time').p90)})`,
      `${f0(g('level').median)} (${f0(g('level').p10)}-${f0(g('level').p90)})`,
      f0(g('score').median),
      pct(g('capped').mean),
      f2(g('hitsPerMin').mean),
      `${pct(a.deathCauses.mine ?? 0)}/${pct(a.deathCauses.bolt ?? 0)}/${pct(a.deathCauses.ram ?? 0)}`,
      pct(g('gemShare').mean),
      f1(g('levelRepeats').mean),
      pct(g('emptyGunShare').mean),
      pct(g('accuracy').mean),
      f1(g('killsPerMin').mean),
      `${pct(g('boltsAimedShare').mean)}/${pct(g('boltsHitShare').mean)}`,
      `${f1(g('raidersMean').mean)} (${pct(g('raiders4PlusShare').mean)})`,
      `${f1(g('deadAirLongest').mean)}s ${pct(g('deadAirShare').mean)}`,
      `${f2(g('intensityCV').mean)}/${pct(g('quietShare').mean)}`,
      f1(g('extraLives').mean),
      `${pct(g('bottomShare').mean)}/${pct(g('upperShare').mean)}`,
      f1(g('loops').mean),
      f0(g('reversalsPerMin').mean),
    ]
  })
  return table(head, rows)
}

export function levelTable(a: Aggregate, maxRows = 20): string {
  const head = ['level', 'reached', 'ended here', 'time in level', 'hits/min', 'threats/5s', 'pickups/5s', 'gem%', 'kills/min', 'repeats/run', 'raiders (4+)']
  const rows = a.perLevel.slice(0, maxRows).map((l) => [
    String(l.level),
    pct(l.reachedShare),
    pct(l.endedHereShare),
    f0(l.meanTime) + 's',
    f2(l.hitsPerMin),
    f2(l.threatsPer5s),
    f2(l.pickupsPer5s),
    pct(l.gemShare),
    f1(l.killsPerMin),
    f2(l.repeatsPerRun),
    `${f1(l.raidersMean)} (${pct(l.raiders4PlusShare)})`,
  ])
  return `${a.bot} on ${a.difficulty} - pacing per level\n` + table(head, rows)
}

// Metrics shown in the comparison, with the direction that is "more" (not good or
// bad: the reader decides, since easier is not always better).
const COMPARE: [string, (x: number) => string][] = [
  ['time', f0], ['level', f1], ['score', f0], ['hitsPerMin', f2], ['timeToFirstHit', f0],
  ['livesLostMine', f2], ['livesLostBolt', f2], ['livesLostRam', f2],
  ['levelRepeats', f2], ['gemShare', pct], ['emptyGunShare', pct], ['accuracy', pct], ['killsPerMin', f2],
  ['boltsAtPlayer', f0], ['boltsAimedShare', pct], ['boltsHitShare', pct],
  ['raidersMean', f2], ['raiders4PlusShare', pct], ['deadAirLongest', f1], ['deadAirShare', pct],
  ['threatsPerMin', f1], ['intensityCV', f2], ['quietShare', pct], ['extraLives', f1], ['bottomShare', pct], ['upperShare', pct], ['wallBinsUsed', f1], ['loops', f1],
  ['reversalsPerMin', f0],
]

export function compareTable(baseline: Aggregate[], current: Aggregate[]): string {
  const out: string[] = []
  for (const cur of current) {
    const base = baseline.find((b) => b.bot === cur.bot && b.difficulty === cur.difficulty)
    if (!base) {
      out.push(`${cur.bot} on ${cur.difficulty}: no baseline entry`)
      continue
    }
    const rows = COMPARE.map(([k, fmt]) => {
      const b = base.stats[k]?.mean ?? 0
      const c = cur.stats[k]?.mean ?? 0
      const d = c - b
      const rel = Math.abs(b) > 1e-9 ? ` (${d >= 0 ? '+' : ''}${((d / Math.abs(b)) * 100).toFixed(0)}%)` : ''
      // standard error of the difference of the two means: a delta below about two
      // of these is within run-to-run noise
      const se = Math.sqrt((base.stats[k]?.sd ?? 0) ** 2 / Math.max(base.runs, 1) + (cur.stats[k]?.sd ?? 0) ** 2 / Math.max(cur.runs, 1))
      const real = se > 0 && Math.abs(d) > 2 * se ? 'CHANGED' : ''
      return [k, '', fmt(b), fmt(c), (d >= 0 ? '+' : '-') + fmt(Math.abs(d)).replace('-', '') + rel, fmt(2 * se), real]
    })
    out.push(
      `${cur.bot} on ${cur.difficulty} - baseline (${base.runs} runs) vs current (${cur.runs} runs), means\n` +
        table(['metric', '', 'baseline', 'current', 'delta', 'noise (2 SE)', ''], rows),
    )
  }
  return out.join('\n\n')
}

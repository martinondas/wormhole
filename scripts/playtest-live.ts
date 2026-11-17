// Live playtest: one bot plays the REAL browser build (npm run playtest:live -- [options]).
// Starts its own vite dev server on a free port, opens the game in headless
// Chromium, lets a bot play through real key presses (Playwright keyboard), and
// saves screenshots, frame-time stats and the run summary. Stops the dev server
// when done. Besides the timed shots it saves shots of feedback events, named after
// the event. See playtest/README.md.
//
//   --bot <name>          a bot of scripts/playtest/bot.ts                   default good
//   --difficulty <mode>   a mode of DIFFICULTY.MODES, for example orion      default orion
//   --seed <n>            run seed                                           default 1
//   --max-seconds <n>     stop after this much game time                     default 90
//   --shot-every <n>      screenshot every n seconds of game time            default 10
//   --out <dir>           output directory (must be outside the repository)
//                         default: $PLAYTEST_LIVE_DIR or <os tmp>/wormhole-playtest-live, plus a timestamp
//   --width / --height    viewport                                           default 1280 x 720
//   --software            force software WebGL (SwiftShader); default tries the real GPU
//   --force-repeat        hold the gem count at 0 in the first cycle's fast section, so
//                         the first cycle repeats (to see the REPEAT banner)
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIFFICULTY } from '../src/config'
import { DIFF_KEY } from '../src/menu'
import { type PlaytestApi } from './playtest/live-agent'

// the page's global that live-agent.ts installs
type Page = { __playtest: PlaytestApi }

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name: string): boolean => args.includes(`--${name}`)
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback
}

const botName = opt('bot', 'good')
const modes = DIFFICULTY.MODES.map((m) => m.name.toLowerCase().replace(/[^a-z]/g, ''))
const difficulty = modes.indexOf(opt('difficulty', 'orion').toLowerCase().replace(/[^a-z]/g, ''))
if (difficulty < 0) throw new Error(`unknown difficulty (have: ${modes.join(', ')})`)
const seed = Number(opt('seed', '1'))
const maxSeconds = Number(opt('max-seconds', '90'))
const shotEvery = Number(opt('shot-every', '10'))
const width = Number(opt('width', '1280'))
const height = Number(opt('height', '720'))
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const out = resolve(opt('out', join(process.env.PLAYTEST_LIVE_DIR ?? join(tmpdir(), 'wormhole-playtest-live'), `${stamp}-${botName}`)))
if ((out + sep).startsWith(repo + sep)) throw new Error(`--out must be outside the repository (${repo})`)
mkdirSync(out, { recursive: true })

const agentPath = join(repo, '.cache', 'live-agent.js')
if (!existsSync(agentPath)) throw new Error('missing .cache/live-agent.js - run this through "npm run playtest:live"')

const freePort = (): Promise<number> =>
  new Promise((ok, fail) => {
    const srv = createServer()
    srv.once('error', fail)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => ok(port))
    })
  })

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const port = await freePort()
const url = `http://127.0.0.1:${port}/`
// the dev server is OUR child process: started here, stopped in the finally below
const vite = spawn(process.execPath, [join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: repo,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let viteLog = ''
vite.stdout.on('data', (d: Buffer) => (viteLog += d.toString()))
vite.stderr.on('data', (d: Buffer) => (viteLog += d.toString()))

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let exitCode = 0
try {
  let up = false
  for (let i = 0; i < 100 && !up; i++) {
    if (vite.exitCode !== null) throw new Error(`vite exited early:\n${viteLog}`)
    try {
      up = (await fetch(url)).ok
    } catch {
      await sleep(150)
    }
  }
  if (!up) throw new Error(`vite did not come up on ${url}\n${viteLog}`)

  const gpuArgs = flag('software')
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-gl=angle', '--use-angle=metal', '--enable-gpu']
  browser = await chromium.launch({ args: [...gpuArgs, '--ignore-gpu-blocklist', '--enable-webgl'] })
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  const errors: string[] = []
  const isAudioNoise = (s: string): boolean => s.includes('[audio]')
  page.on('console', (m) => {
    if (m.type() === 'error' && !isAudioNoise(m.text())) errors.push(m.text())
  })
  page.on('pageerror', (e) => {
    if (!isAudioNoise(String(e))) errors.push(String(e))
  })
  // the difficulty is chosen the way the game stores it: under the key of the title menu
  await page.addInitScript(([key, d]) => {
    try {
      localStorage.setItem(key, String(d))
    } catch {
      /* ignore */
    }
  }, [DIFF_KEY, difficulty] as const)
  await page.goto(url, { waitUntil: 'load', timeout: 30000 })
  await page.waitForFunction(() => Boolean((globalThis as Record<string, unknown>).WH), undefined, { timeout: 15000 })
  await page.waitForTimeout(800)
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  })
  await page.screenshot({ path: join(out, '000-title.png') })

  await page.addScriptTag({ path: agentPath })
  await page.evaluate(([b, s, cap, fr]) => (globalThis as unknown as Page).__playtest.arm(b, s, cap, { forceRepeat: fr }), [botName, seed, maxSeconds, flag('force-repeat')] as const)
  await page.keyboard.press('Space') // start the run like a player does

  const started = Date.now()
  let left = false
  let right = false
  let fire = false
  let nextShot = shotEvery
  let shots = 0
  const shoot = async (s: { t: number; level: number }, suffix: string): Promise<void> => {
    shots++
    await page.screenshot({ path: join(out, `${String(shots).padStart(3, '0')}-t${Math.round(s.t)}s-L${s.level}${suffix}.png`) })
  }
  // Some events show best a moment later: [start of the event's name, delay in ms, name of the second shot]
  const SECOND_SHOTS: [string, number, string][] = [
    ['levelup', 450, 'banner'], // banners animate in: once they are fully shown
    ['repeat', 450, 'banner'],
    ['charge', 180, 'tell'], // the tell brightens over the charge: when the nose is white
    ['hit', 1000, 'hit-after'], // a hit jolts the view and slows time: once both are over
    ['shard-drop', 300, 'shard-ahead'], // the kill burst covers a fresh shard: once it has cleared
  ]
  const secondShotAt = new Map<string, number>() // name of a pending second shot -> wall time it is due
  let last = { t: 0, level: 1, lives: 0, score: 0 }
  const wallLimitMs = Math.max(120000, maxSeconds * 1000 * 6) // give a slow renderer room, but never hang
  for (;;) {
    const s = await page.evaluate(() => (globalThis as unknown as Page).__playtest.poll())
    last = { t: s.t, level: s.level, lives: s.lives, score: s.score }
    const wantLeft = !s.done && s.steer < 0
    const wantRight = !s.done && s.steer > 0
    const wantFire = !s.done && s.fire
    if (wantLeft !== left) await (wantLeft ? page.keyboard.down('ArrowLeft') : page.keyboard.up('ArrowLeft'))
    if (wantRight !== right) await (wantRight ? page.keyboard.down('ArrowRight') : page.keyboard.up('ArrowRight'))
    if (wantFire !== fire) await (wantFire ? page.keyboard.down('Space') : page.keyboard.up('Space'))
    left = wantLeft
    right = wantRight
    fire = wantFire
    if (s.shot) {
      await shoot(s, `-${s.shot}`)
      const second = SECOND_SHOTS.find(([event]) => s.shot.startsWith(event))
      if (second) secondShotAt.set(second[2], Date.now() + second[1])
    }
    for (const [name, at] of secondShotAt) {
      if (Date.now() < at) continue
      secondShotAt.delete(name)
      await shoot(s, `-${name}`)
    }
    if (s.t >= nextShot || s.done) {
      await shoot(s, '')
      nextShot += shotEvery
    }
    if (s.done) break
    if (Date.now() - started > wallLimitMs) {
      errors.push(`wall-clock limit hit at game time ${s.t.toFixed(1)}s`)
      break
    }
    await sleep(4)
  }
  const wallSeconds = (Date.now() - started) / 1000
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '999-end.png') })

  const summary = await page.evaluate(() => (globalThis as unknown as Page).__playtest.summary())
  const doc = {
    bot: botName,
    difficulty: modes[difficulty],
    seed,
    maxSeconds,
    viewport: { width, height },
    renderer,
    wallSeconds,
    gameSeconds: last.t,
    gameSpeed: last.t / wallSeconds, // 1.0 = the game ran in real time
    final: last,
    errors,
    ...summary,
  }
  writeFileSync(join(out, 'summary.json'), JSON.stringify(doc, null, 1) + '\n')
  const f = doc.frames
  console.log(`bot=${botName} mode=${modes[difficulty]} seed=${seed} renderer="${renderer}"`)
  console.log(
    `game time ${last.t.toFixed(1)}s in ${wallSeconds.toFixed(1)}s wall (speed ${(last.t / wallSeconds).toFixed(2)}x), ` +
      `level ${last.level}, score ${last.score}, lives ${last.lives}`,
  )
  console.log(`frames: ${f.fps.toFixed(1)} fps mean, p50 ${f.p50Ms.toFixed(1)} ms, p95 ${f.p95Ms.toFixed(1)} ms, max ${f.maxMs.toFixed(0)} ms`)
  console.log(`${shots + 2} screenshots + summary.json in ${out}`)
  if (errors.length) {
    console.error('page errors:\n' + errors.join('\n'))
    exitCode = 2
  }
} catch (e) {
  console.error(e)
  exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  vite.kill('SIGTERM')
  await new Promise<void>((r) => {
    if (vite.exitCode !== null) r()
    else {
      vite.once('exit', () => r())
      setTimeout(() => {
        vite.kill('SIGKILL')
        r()
      }, 3000)
    }
  })
}
process.exit(exitCode)

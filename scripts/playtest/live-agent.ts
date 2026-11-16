// In-page half of the live playtest (bundled to .cache/live-agent.js and injected
// by scripts/playtest-live.ts). It runs the SAME bot and recorder as the headless
// harness against the browser game's session (window.WH.session), ticking on the
// game's own clock. It never touches the game's input: it only publishes which keys
// the bot wants held, and the Node side presses real keys through Playwright.
import { type Session, type SessionFx } from '../../src/session'
import { createBot, PROFILES, TICK_HZ, type Bot } from './bot'
import { createRecorder, type Recorder, type RunResult } from './metrics'

interface WH {
  session: Session
  fx: SessionFx
  reseed(seed: number): void
}

interface FrameStats {
  frames: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  fps: number
  over33msShare: number // frames slower than 30 fps
}

const wh = (globalThis as unknown as { WH: WH }).WH
const TICK = 1 / TICK_HZ

let bot: Bot | undefined
let recorder: Recorder | undefined
let nextTick = 0
let lastTickT = 0
let maxSeconds = Infinity
let done = false
let result: RunResult | undefined
const frameMs: number[] = []
let lastFrame = 0

function frame(now: number): void {
  if (done) return
  requestAnimationFrame(frame)
  const game = wh.session.game
  if (!bot || !recorder || !game.started) {
    lastFrame = now
    return
  }
  if (lastFrame > 0) frameMs.push(now - lastFrame)
  lastFrame = now
  const t = game.elapsed
  if (t >= nextTick) {
    bot.tick(t)
    recorder.tick(t - lastTickT, bot.steer)
    lastTickT = t
    nextTick = Math.max(nextTick + TICK, t - TICK) // never queue up missed ticks
  }
  if (game.over || t >= maxSeconds) {
    done = true
    bot.steer = 0
    bot.fire = false
    result = recorder.finish(!game.over)
  }
}

function frameStats(): FrameStats {
  const v = [...frameMs].sort((a, b) => a - b)
  const q = (p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0
  const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
  return {
    frames: v.length,
    meanMs: mean,
    p50Ms: q(0.5),
    p95Ms: q(0.95),
    maxMs: v[v.length - 1] ?? 0,
    fps: mean > 0 ? 1000 / mean : 0,
    over33msShare: v.length ? v.filter((x) => x > 33.4).length / v.length : 0,
  }
}

const api = {
  // Call on the title screen: seeds the run, hooks the recorder into the session's
  // events, and arms the bot. The run itself starts when Space is pressed.
  arm(botName: string, seed: number, capSeconds: number): void {
    const profile = PROFILES[botName]
    if (!profile) throw new Error(`unknown bot ${botName}`)
    wh.reseed(seed)
    bot = createBot(profile, wh.session)
    bot.reset(seed)
    const rec = createRecorder(wh.session)
    recorder = rec
    rec.begin(seed)
    // wrap the game's own event hooks so the recorder hears every event too
    const fx = wh.fx as Record<string, ((...a: unknown[]) => void) | undefined>
    const mine = rec.fx as Record<string, ((...a: unknown[]) => void) | undefined>
    for (const key of Object.keys(mine)) {
      const game = fx[key]
      const tap = mine[key]!
      fx[key] = (...a: unknown[]): void => {
        game?.(...a)
        if (!done) tap(...a) // the game runs on after the capture ends; the result must not
      }
    }
    maxSeconds = capSeconds
    nextTick = 0
    lastTickT = 0
    done = false
    result = undefined
    frameMs.length = 0
    lastFrame = 0
    requestAnimationFrame(frame)
  },
  // Polled by the Node side: which keys should be down right now, and the state.
  poll(): { steer: number; fire: boolean; done: boolean; t: number; level: number; lives: number; score: number } {
    const s = wh.session
    return {
      steer: bot?.steer ?? 0,
      fire: bot?.fire ?? false,
      done,
      t: s.game.elapsed,
      level: s.flight.level + 1,
      lives: s.game.lives,
      score: s.game.score(),
    }
  },
  summary(): { result: RunResult | undefined; frames: FrameStats } {
    return { result, frames: frameStats() }
  },
}

;(globalThis as unknown as { __playtest: typeof api }).__playtest = api

// Headless run loop: one real gameplay session, one bot, one recorder. The bot
// writes only the InputState (steer / fire) the session reads, exactly what the
// keyboard writes in the browser.
import { createSession, type SessionFx } from '../../src/session'
import { seedRng } from '../../src/util/rng'
import { type InputState } from '../../src/input'
import { PHYSICS } from '../../src/config'
import { driveSession, STEP_DT } from '../sim-kit'
import { createBot, PROFILES, TICK_HZ, type Bot } from './bot'
import { createRecorder, type RunResult } from './metrics'

export interface Harness {
  run(botName: string, difficultyIndex: number, seed: number, maxSeconds: number): RunResult
}

export function createHarness(): Harness {
  // The session is built once and reset between runs (the same path the game takes
  // from game-over back to the title), so a run costs no mesh construction.
  const fx: SessionFx = {}
  const session = createSession(fx)
  const recorder = createRecorder(session)
  Object.assign(fx, recorder.fx)
  const bots = new Map<string, Bot>()
  const input: InputState = { steerTarget: 0, fire: false }

  const stepsPerTick = Math.round(PHYSICS.HZ / TICK_HZ)

  return {
    run(botName: string, difficultyIndex: number, seed: number, maxSeconds: number): RunResult {
      const profile = PROFILES[botName]
      if (!profile) throw new Error(`unknown bot "${botName}" (have: ${Object.keys(PROFILES).join(', ')})`)
      let bot = bots.get(botName)
      if (!bot) {
        bot = createBot(profile, session)
        bots.set(botName, bot)
      }
      session.flight.setDifficulty(difficultyIndex)
      seedRng(seed)
      session.reset() // lays the fields out from the seeded generator
      bot.reset(seed)
      recorder.begin(seed)
      input.steerTarget = 0
      input.fire = false
      session.begin()

      const advance = driveSession(session, input)
      let t = 0
      let step = 0
      while (!session.game.over && t < maxSeconds) {
        for (let s = 0; s < stepsPerTick && !session.game.over; s++) {
          advance()
          step++
        }
        t = step * STEP_DT
        bot.tick(t)
        input.steerTarget = bot.steer
        input.fire = bot.fire
        recorder.tick(stepsPerTick * STEP_DT, bot.steer)
      }
      return recorder.finish(!session.game.over)
    },
  }
}

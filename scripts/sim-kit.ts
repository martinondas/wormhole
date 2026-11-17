// Shared pieces of the headless scripts: the check counter of the sims, temporary
// config overrides, and the loop that steps a real session.
import { PHYSICS, TREASURE } from '../src/config'
import { type Session } from '../src/session'
import { type InputState } from '../src/input'

let failed = 0

export function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failed++
}

/** Prints the summary line and ends the process, with exit code 1 when a check failed. */
export function finish(label: string): never {
  console.log(failed === 0 ? `\nALL ${label} CHECKS PASSED` : `\n${failed} ${label} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

/** Runs `fn` with some values of a config group replaced, then puts the old values back. */
export function withConfig<T extends object>(target: T, overrides: Partial<T>, fn: () => void): void {
  const saved: Partial<T> = {}
  for (const key of Object.keys(overrides) as (keyof T)[]) saved[key] = target[key]
  Object.assign(target, overrides)
  try {
    fn()
  } finally {
    Object.assign(target, saved)
  }
}

/**
 * Returns a `beforeFrame` that puts the craft on the angle of the next gem ahead, so
 * the session collects every gem the tube offers (a way to meet gem quotas in a sim).
 */
export function flyOntoGems(session: Session): () => void {
  return () => {
    const craft = session.craft
    let nearest = Infinity
    let theta = craft.theta
    session.fieldByKind.gem.visit((gemTheta, worldDistance) => {
      const ahead = worldDistance - craft.distance
      if (ahead > -TREASURE.CAPTURE_Z && ahead < nearest) {
        nearest = ahead
        theta = gemTheta
      }
    })
    craft.theta = theta
    craft.omega = 0
  }
}

export const STEP_DT = 1 / PHYSICS.HZ
const STEPS_PER_FRAME = Math.max(1, Math.round(PHYSICS.HZ / 60)) // the browser calls preUpdate once per 60 fps frame

/**
 * Returns a function that advances the session by one fixed step, in the browser's
 * order: preUpdate once per frame, then the step. `beforeFrame` runs before each
 * preUpdate. `invulnerable` holds the i-frames on, so nothing can end the run.
 */
export function driveSession(
  session: Session,
  input: InputState,
  opts: { invulnerable?: boolean; beforeFrame?: () => void } = {},
): () => void {
  let step = 0
  return () => {
    if (step % STEPS_PER_FRAME === 0) {
      opts.beforeFrame?.()
      session.preUpdate()
    }
    if (opts.invulnerable) session.game.invuln = 1e9
    session.step(input, STEP_DT)
    step++
  }
}

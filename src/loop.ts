// Fixed-timestep game loop with an accumulator. Physics runs at a fixed dt for
// a stable pendulum; rendering runs once per animation frame. Render gets the
// real frame delta (for camera smoothing etc).
export type UpdateFn = (dt: number) => void
export type RenderFn = (frameDt: number) => void

// Per-frame timing, handed to onStats after render (drives the perf overlay).
export interface LoopStats {
  frameDt: number // seconds since the previous frame
  updateMs: number // wall-clock ms spent in the fixed-step update loop this frame
  renderMs: number // wall-clock ms spent in render() this frame
  steps: number // number of fixed substeps run this frame
}

export interface LoopHooks {
  // runs once per frame BEFORE the fixed substeps - for inputs that are stable
  // across a frame (e.g. the flight tier's target speed/gravity), so they are not
  // recomputed every substep.
  preUpdate?: (frameDt: number) => void
  // game-time scale for this frame (1 = normal), e.g. the hit slow-down
  timeScale?: (frameDt: number) => number
  onStats?: (s: LoopStats) => void
}

// Hit slow-down: after trigger() the game runs at HITSTOP.SCALE for HOLD seconds of
// real time, then eases back to 1 over EASE seconds (smoothstep).
export interface HitStop {
  trigger(): void
  scale(realDt: number): number // advance by real time, return the scale for this frame
  reset(): void
}

export function createHitStop(cfg: { SCALE: number; HOLD: number; EASE: number }): HitStop {
  let t = Infinity // real seconds since the last trigger
  return {
    trigger(): void {
      t = 0
    },
    scale(realDt: number): number {
      t += realDt
      if (t <= cfg.HOLD) return cfg.SCALE
      const e = (t - cfg.HOLD) / Math.max(cfg.EASE, 1e-4)
      if (e >= 1) return 1
      const s = e * e * (3 - 2 * e)
      return cfg.SCALE + (1 - cfg.SCALE) * s
    },
    reset(): void {
      t = Infinity
    },
  }
}

export function startLoop(fixedDt: number, update: UpdateFn, render: RenderFn, hooks: LoopHooks = {}): () => void {
  let last = performance.now() / 1000
  let acc = 0
  let raf = 0
  let running = true

  const frame = (): void => {
    if (!running) return
    raf = requestAnimationFrame(frame)

    const now = performance.now() / 1000
    let frameDt = now - last
    last = now
    if (frameDt > 0.25) frameDt = 0.25 // avoid spiral of death after a stall

    acc += frameDt
    hooks.preUpdate?.(frameDt)
    // The time scale shortens each fixed substep instead of feeding fewer substeps:
    // the step count per frame stays even, so a slowed world still moves smoothly
    // (fewer substeps would freeze it on some frames, which reads as lag).
    const stepDt = fixedDt * (hooks.timeScale?.(frameDt) ?? 1)

    const u0 = performance.now()
    let steps = 0
    while (acc >= fixedDt) {
      update(stepDt)
      acc -= fixedDt
      steps++
    }
    const u1 = performance.now()
    render(frameDt)
    hooks.onStats?.({ frameDt, updateMs: u1 - u0, renderMs: performance.now() - u1, steps })
  }

  raf = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(raf)
  }
}

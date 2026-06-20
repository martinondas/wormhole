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
  onStats?: (s: LoopStats) => void
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

    const u0 = performance.now()
    let steps = 0
    while (acc >= fixedDt) {
      update(fixedDt)
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

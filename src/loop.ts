// Fixed-timestep game loop with an accumulator. Physics runs at a fixed dt for
// a stable pendulum; rendering runs once per animation frame. Render gets the
// real frame delta (for camera smoothing etc).
export type UpdateFn = (dt: number) => void
export type RenderFn = (frameDt: number) => void

export function startLoop(fixedDt: number, update: UpdateFn, render: RenderFn): () => void {
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
    while (acc >= fixedDt) {
      update(fixedDt)
      acc -= fixedDt
    }
    render(frameDt)
  }

  raf = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(raf)
  }
}

import { type LoopStats } from '../loop'

// A toggleable diagnostic overlay (press P): live FPS, frame time (avg + max),
// the CPU split (update vs render ms), and substeps/frame. Hidden by default and
// zero-cost while hidden (it only samples ring buffers; it touches the DOM ~5x/s
// and only when visible). Fed by the loop's onStats each frame - so the numbers
// are the real per-frame cost on whatever machine is running it, which is the
// point: drop it on the target machine (the iMac, Safari) to see the truth.
export interface PerfOverlay {
  sample(s: LoopStats): void
  toggle(): void
}

const N = 120 // ring-buffer length (~1-2s of frames)

export function createPerfOverlay(): PerfOverlay {
  const el = document.createElement('div')
  el.id = 'wh-perf'
  el.style.cssText =
    'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:20;display:none;' +
    "font:12px/1.45 ui-monospace,Menlo,monospace;color:#7dffa6;white-space:pre;pointer-events:none;" +
    'background:rgba(0,8,14,0.72);border:1px solid rgba(125,255,166,0.4);border-radius:4px;' +
    'padding:6px 10px;text-shadow:0 0 4px rgba(80,255,150,0.5);'
  document.body.appendChild(el)

  const frameMs = new Float32Array(N)
  const updMs = new Float32Array(N)
  const renMs = new Float32Array(N)
  const steps = new Float32Array(N)
  let head = 0
  let count = 0
  let visible = false
  let acc = 0 // seconds since the last DOM refresh (throttle to ~5/s)

  function refresh(): void {
    if (!count) return
    let fSum = 0
    let fMax = 0
    let uSum = 0
    let rSum = 0
    let sSum = 0
    for (let i = 0; i < count; i++) {
      const f = frameMs[i]!
      fSum += f
      if (f > fMax) fMax = f
      uSum += updMs[i]!
      rSum += renMs[i]!
      sSum += steps[i]!
    }
    const fAvg = fSum / count
    const fps = fAvg > 0 ? 1000 / fAvg : 0
    el.textContent =
      `FPS ${fps.toFixed(0).padStart(3)}   frame ${fAvg.toFixed(1)}ms (max ${fMax.toFixed(1)})\n` +
      `update ${(uSum / count).toFixed(2)}ms   render ${(rSum / count).toFixed(2)}ms   substeps ${(sSum / count).toFixed(1)}`
  }

  return {
    sample(s: LoopStats): void {
      frameMs[head] = s.frameDt * 1000
      updMs[head] = s.updateMs
      renMs[head] = s.renderMs
      steps[head] = s.steps
      head = (head + 1) % N
      if (count < N) count++
      if (!visible) return
      acc += s.frameDt
      if (acc >= 0.2) {
        acc = 0
        refresh()
      }
    },
    toggle(): void {
      visible = !visible
      el.style.display = visible ? 'block' : 'none'
      if (visible) refresh()
    },
  }
}

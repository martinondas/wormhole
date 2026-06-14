import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three'
import { BACKGROUND } from '../config'

// A static deep-space gradient drawn once to a canvas: dark blue, a faint band
// around the vanishing point, near-black corners. Used as scene.background so
// it sits behind the tube and lowers the harsh line-on-pure-black contrast.
// (Stars live in a separate world-space starfield, see render/stars.ts.)
export function createBackgroundTexture(): CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('background: 2d context unavailable')

  const cx = size * 0.5
  const cy = size * 0.48
  const grad = ctx.createRadialGradient(cx, cy, size * 0.03, cx, cy, size * 0.62)
  grad.addColorStop(0, BACKGROUND.CENTER)
  grad.addColorStop(BACKGROUND.MID_STOP, BACKGROUND.MID)
  grad.addColorStop(1, BACKGROUND.EDGE)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  return tex
}

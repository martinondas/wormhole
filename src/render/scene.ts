import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Color,
  Fog,
  Vector2,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RENDER, CAMERA } from '../config'

export type ResizeCb = (bufferW: number, bufferH: number) => void

export interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  onResize(cb: ResizeCb): void
  render(): void
}

export function createStage(container: HTMLElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setClearColor(new Color(RENDER.BG_COLOR), 1)
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(RENDER.BG_COLOR)
  scene.fog = new Fog(RENDER.BG_COLOR, RENDER.FOG_NEAR, RENDER.FOG_FAR)

  const camera = new PerspectiveCamera(CAMERA.FOV, 1, 0.1, RENDER.FOG_FAR + 60)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  if (RENDER.BLOOM_ENABLED) {
    composer.addPass(
      new UnrealBloomPass(
        new Vector2(1, 1),
        RENDER.BLOOM_STRENGTH,
        RENDER.BLOOM_RADIUS,
        RENDER.BLOOM_THRESHOLD,
      ),
    )
  }
  composer.addPass(new OutputPass())

  const resizeCbs: ResizeCb[] = []
  let bufW = 1
  let bufH = 1

  function resize(): void {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    const pr = Math.min(window.devicePixelRatio, RENDER.DPR_CAP) * RENDER.RENDER_SCALE

    renderer.setPixelRatio(pr)
    renderer.setSize(w, h)
    composer.setPixelRatio(pr)
    composer.setSize(w, h)

    // Cap the horizontal FOV. Three's camera.fov is vertical, so a wide window
    // would otherwise balloon the horizontal view and make the side walls race
    // past. Shrink the vertical FOV on wide aspects so horizontal stays bounded.
    const aspect = w / h
    camera.aspect = aspect
    const vBase = (CAMERA.FOV * Math.PI) / 180
    const vFromHCap = 2 * Math.atan(Math.tan((CAMERA.HFOV_MAX * Math.PI) / 180 / 2) / aspect)
    camera.fov = (Math.min(vBase, vFromHCap) * 180) / Math.PI
    camera.updateProjectionMatrix()

    bufW = Math.floor(w * pr)
    bufH = Math.floor(h * pr)
    for (const cb of resizeCbs) cb(bufW, bufH)
  }

  window.addEventListener('resize', resize)
  resize()

  return {
    renderer,
    scene,
    camera,
    onResize(cb: ResizeCb): void {
      resizeCbs.push(cb)
      cb(bufW, bufH)
    },
    render(): void {
      composer.render()
    },
  }
}

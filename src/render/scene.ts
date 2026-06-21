import {
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
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
import { RENDER, CAMERA, BACKGROUND } from '../config'
import { createBackgroundTexture } from './background'

export type ResizeCb = (bufferW: number, bufferH: number) => void

export interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  onResize(cb: ResizeCb): void
  render(): void
}

// Pick render quality from the GPU. Integrated GPUs (Intel / mobile) pay the most
// for the full-res MSAA resolve + bloom fill every frame, so they get lighter MSAA
// and a smaller render scale; discrete GPUs keep the higher-quality defaults. This
// is best-effort: an unrecognized or privacy-masked renderer string keeps the
// defaults, so the worst case is the current behavior.
function pickRenderTier(renderer: WebGLRenderer): { msaa: number; scale: number } {
  const hi = { msaa: RENDER.MSAA_SAMPLES, scale: RENDER.RENDER_SCALE }
  const low = { msaa: RENDER.MSAA_SAMPLES_LOW, scale: RENDER.RENDER_SCALE_LOW }
  try {
    const gl = renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return hi
    const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase()
    // Discrete GPUs keep the defaults. Guard the discrete AMD lines ("Radeon Pro" =
    // the iMac, "Radeon RX") and NVIDIA first, so the broad "radeon" integrated arm
    // below does not catch them.
    if (/radeon pro|radeon rx|geforce|nvidia|quadro/.test(name)) return hi
    // Integrated: Intel + common mobile GPUs, and AMD APUs, which report a plain
    // "Radeon Graphics" / "Radeon(TM) Graphics" with no Pro/RX (e.g. the ThinkPad E14).
    const integrated = /intel|iris|uhd|hd graphics|adreno|mali|powervr|radeon/.test(name)
    return integrated ? low : hi
  } catch {
    return hi
  }
}

export function createStage(container: HTMLElement): Stage {
  // antialias:false on the context: all rendering goes through the composer's
  // multisampled offscreen target (below) and the final OutputPass is a full-screen
  // quad blit, so MSAA on the default framebuffer would only cost memory/bandwidth.
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setClearColor(new Color(RENDER.BG_COLOR), 1)
  container.appendChild(renderer.domElement)

  // lighter MSAA + render scale on integrated GPUs (see pickRenderTier); tune the
  // _LOW values on the target machine with the P overlay.
  const tier = pickRenderTier(renderer)

  const scene = new Scene()
  // Subtle deep-space backdrop (gradient + stars); fog fades far lines into the
  // gradient's dark center so the tube dissolves into the "hole".
  const fogColor = new Color(BACKGROUND.ENABLED ? BACKGROUND.CENTER : RENDER.BG_COLOR)
  scene.background = BACKGROUND.ENABLED ? createBackgroundTexture() : new Color(RENDER.BG_COLOR)
  scene.fog = new Fog(fogColor, RENDER.FOG_NEAR, RENDER.FOG_FAR)

  // far plane must clear the world-space starfield sphere (radius ~500); fog
  // still fades the tube long before this, so the big far plane costs nothing.
  const camera = new PerspectiveCamera(CAMERA.FOV, 1, 0.1, 1200)

  // Multisampled, HDR (half-float) target so the offscreen pass is anti-aliased
  // (thin scrolling rings stop shimmering) and bloom keeps its bright cores.
  const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: tier.msaa })
  const composer = new EffectComposer(renderer, rt)
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
    const pr = Math.min(window.devicePixelRatio, RENDER.DPR_CAP) * tier.scale

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

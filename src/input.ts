import { INPUT } from './config'

export interface InputState {
  steerTarget: number // -1 left, +1 right, 0 none
  fire: boolean
}

const ALL_CODES = new Set<string>([...INPUT.left, ...INPUT.right, ...INPUT.fire])

export class Input {
  private pressed = new Set<string>()
  readonly state: InputState = { steerTarget: 0, fire: false }

  constructor() {
    window.addEventListener('keydown', this.onDown)
    window.addEventListener('keyup', this.onUp)
    window.addEventListener('blur', this.onBlur)
  }

  private onDown = (e: KeyboardEvent): void => {
    if (!ALL_CODES.has(e.code)) return
    e.preventDefault()
    if (e.repeat) return
    this.pressed.add(e.code)
    this.refresh()
  }

  private onUp = (e: KeyboardEvent): void => {
    if (!ALL_CODES.has(e.code)) return
    e.preventDefault()
    this.pressed.delete(e.code)
    this.refresh()
  }

  private onBlur = (): void => {
    this.pressed.clear()
    this.refresh()
  }

  private has(codes: string[]): boolean {
    for (const c of codes) if (this.pressed.has(c)) return true
    return false
  }

  private refresh(): void {
    const left = this.has(INPUT.left)
    const right = this.has(INPUT.right)
    this.state.steerTarget = (right ? 1 : 0) - (left ? 1 : 0)
    this.state.fire = this.has(INPUT.fire)
  }

  // Forget the fire key as if released. Called on restart so a Space held to
  // restart the run does not immediately fire a bolt (and spend energy) on the
  // first live step; the player must re-press to shoot.
  releaseFireKeys(): void {
    for (const c of INPUT.fire) this.pressed.delete(c)
    this.refresh()
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown)
    window.removeEventListener('keyup', this.onUp)
    window.removeEventListener('blur', this.onBlur)
  }
}

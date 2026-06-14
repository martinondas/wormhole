import { INPUT } from './config'

export interface InputState {
  steerTarget: number // -1 left, +1 right, 0 none
  throttle: boolean
  brake: boolean
  boost: boolean
}

const ALL_CODES = new Set<string>([
  ...INPUT.left, ...INPUT.right, ...INPUT.throttle, ...INPUT.brake, ...INPUT.boost,
])

export class Input {
  private pressed = new Set<string>()
  readonly state: InputState = { steerTarget: 0, throttle: false, brake: false, boost: false }

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
    this.state.throttle = this.has(INPUT.throttle)
    this.state.brake = this.has(INPUT.brake)
    this.state.boost = this.has(INPUT.boost)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown)
    window.removeEventListener('keyup', this.onUp)
    window.removeEventListener('blur', this.onBlur)
  }
}

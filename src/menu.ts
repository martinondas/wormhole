import { DIFFICULTY, INPUT, SHIP } from './config'
import { type HullId } from './world/ship'

// Title-screen settings model: the selected hull + difficulty and the active
// selector row. Pure state + key semantics; rendering lives in hud.ts and the
// wiring in main.ts. Both choices persist locally, so a returning player keeps
// their setup and Space still starts instantly with the last-used settings.
const SHIP_KEY = 'wormhole.ship'
const DIFF_KEY = 'wormhole.difficulty'

export interface Menu {
  row: number // 0 = SHIP, 1 = DIFFICULTY
  shipIndex: number
  diffIndex: number
  hullId(): HullId
  shipName(): string
  // Handle a title-screen keydown. Returns which selection changed ('ship' /
  // 'difficulty'), 'row' for a row move, or null when it was not a menu key.
  handleKey(code: string): 'ship' | 'difficulty' | 'row' | null
}

function loadIndex(key: string, max: number, fallback: number): number {
  try {
    const n = parseInt(localStorage.getItem(key) ?? '', 10)
    return Number.isInteger(n) && n >= 0 && n < max ? n : fallback
  } catch {
    return fallback
  }
}

function saveIndex(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n))
  } catch {
    /* storage unavailable (private mode) - ignore */
  }
}

const mod = (n: number, m: number): number => ((n % m) + m) % m

export function createMenu(): Menu {
  return {
    row: 0,
    shipIndex: loadIndex(SHIP_KEY, SHIP.HULLS.length, 0),
    diffIndex: loadIndex(DIFF_KEY, DIFFICULTY.MODES.length, DIFFICULTY.DEFAULT),
    hullId(): HullId {
      return SHIP.HULLS[this.shipIndex]?.id ?? SHIP.HULLS[0]!.id
    },
    shipName(): string {
      return SHIP.HULLS[this.shipIndex]?.name ?? ''
    },
    handleKey(code: string): 'ship' | 'difficulty' | 'row' | null {
      if (INPUT.menuUp.includes(code) || INPUT.menuDown.includes(code)) {
        this.row = mod(this.row + (INPUT.menuUp.includes(code) ? -1 : 1), 2)
        return 'row'
      }
      const dir = INPUT.left.includes(code) ? -1 : INPUT.right.includes(code) ? 1 : 0
      if (dir === 0) return null
      if (this.row === 0) {
        this.shipIndex = mod(this.shipIndex + dir, SHIP.HULLS.length)
        saveIndex(SHIP_KEY, this.shipIndex)
        return 'ship'
      }
      this.diffIndex = mod(this.diffIndex + dir, DIFFICULTY.MODES.length)
      saveIndex(DIFF_KEY, this.diffIndex)
      return 'difficulty'
    },
  }
}

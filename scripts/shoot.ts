// Headless screenshot of the running game, for visual self-verification.
// Usage: node scripts/shoot.ts [url] [outPath]
//   defaults: url=http://127.0.0.1:5173  out=shots/latest.png
// Requires the dev server (npm run dev) or preview server to be running.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const url = process.argv[2] ?? process.env.SHOOT_URL ?? 'http://127.0.0.1:5173'
const out = process.argv[3] ?? 'shots/latest.png'
const waitMs = Number(process.env.SHOOT_WAIT ?? 2500)

mkdirSync(dirname(out), { recursive: true })

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
})
const vw = Number(process.env.SHOOT_W ?? 1600)
const vh = Number(process.env.SHOOT_H ?? 900)
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 })

const errors: string[] = []
// Ignore audio diagnostics: a headless capture has no user gesture and may lack
// the optional mp3s, so the audio module's load/unlock noise is expected here
// and must not fail the visual check (which gates on errors[] below).
const isAudioNoise = (s: string): boolean => s.includes('[audio]')
page.on('console', (m) => { if (m.type() === 'error' && !isAudioNoise(m.text())) errors.push(m.text()) })
page.on('pageerror', (e) => { if (!isAudioNoise(String(e))) errors.push(String(e)) })

await page.goto(url, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(waitMs)

// Leave the title screen so poses capture live gameplay, not the start gate.
await page.evaluate(() => {
  const wh = (globalThis as Record<string, unknown>).WH as { begin?: () => void } | undefined
  wh?.begin?.()
})

// Optional: hold one or more keys (KeyboardEvent.code, comma-separated) for
// SHOOT_HOLD_MS before the capture, to verify steering/throttle in a still.
const setTheta = process.env.SHOOT_SET_THETA
const hold = (process.env.SHOOT_HOLD ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (process.env.SHOOT_GAMEOVER) {
  // force the run to end for a deterministic game-over screen grab
  await page.evaluate(() => {
    const wh = (globalThis as Record<string, unknown>).WH as { game?: { energy: number; over: boolean } } | undefined
    if (wh?.game) {
      wh.game.energy = 0
      wh.game.over = true
    }
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: out })
} else if (setTheta !== undefined) {
  // Force a specific craft angle (radians) for a deterministic still, e.g. to
  // check that theta = 2*PI (bottom after a loop) renders fully upright.
  await page.evaluate((t) => {
    const wh = (globalThis as Record<string, unknown>).WH as
      | { craft?: { theta: number; omega: number; steerSignal: number }; debug?: { paused: boolean } }
      | undefined
    if (wh?.debug) wh.debug.paused = true // freeze physics so the angle holds
    if (wh?.craft) { wh.craft.theta = t; wh.craft.omega = 0; wh.craft.steerSignal = 0 }
  }, Number(setTheta))
  await page.waitForTimeout(250)
  await page.screenshot({ path: out })
} else if (process.env.SHOOT_POSE) {
  // Freeze physics and stage one orb, gem, and mine in a row along the lower
  // wall just ahead of the ship, for a direct side-by-side look comparison.
  await page.evaluate(() => {
    const wh = (globalThis as Record<string, unknown>).WH as
      | {
          debug?: { paused: boolean }
          fields?: {
            object: {
              children: {
                position: { set(x: number, y: number, z: number): void }
                rotation: { set(x: number, y: number, z: number): void }
              }[]
            }
          }[]
        }
      | undefined
    if (!wh?.fields || !wh.debug) return
    wh.debug.paused = true // physics frozen -> manual poses hold (field.update is gated)
    // Float the three above the ship, close to the camera, for an unobstructed
    // side-by-side look comparison (not their in-game ride radius).
    const place = (fi: number, x: number, tilt: number): void => {
      const obj = wh.fields?.[fi]?.object.children[0]
      if (!obj) return
      obj.position.set(x, -1.2, -4)
      obj.rotation.set(tilt, tilt, 0)
    }
    place(0, -3.2, 0.0) // orb
    place(1, 0.0, 0.5) // gem (tilt to show facets)
    place(2, 3.2, 0.4) // mine
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: out })
} else if (process.env.SHOOT_COMBAT) {
  // Freeze physics and stage a combat tableau: one magenta raider up the wall
  // ahead, a player bolt streaking forward, an enemy bolt closing on the ship -
  // a side-by-side look check of the new combat art against the existing palette.
  const combat = {
    et: Number(process.env.ENEMY_THETA ?? 0.18),
    ez: Number(process.env.ENEMY_Z ?? -11),
    bolts: !process.env.NO_BOLTS,
  }
  const visN = await page.evaluate((c) => {
    const wh = (globalThis as Record<string, unknown>).WH as
      | {
          debug?: { paused: boolean }
          enemies?: { debugStage(theta: number, z: number): void }
          projectiles?: {
            object: { children: { visible: boolean }[] }
            spawn(side: string, theta: number, z: number, vz: number): void
          }
        }
      | undefined
    if (!wh?.debug) return -1
    wh.debug.paused = true // freeze physics so the staged pose holds
    wh.enemies?.debugStage(c.et, c.ez) // raider up the wall, close ahead
    if (c.bolts) {
      // a stream of player bolts forward + one enemy bolt closing on the ship
      wh.projectiles?.spawn('player', -0.1, -8, -110)
      wh.projectiles?.spawn('player', -0.1, -22, -110)
      wh.projectiles?.spawn('enemy', c.et, c.ez + 6, 90)
    }
    // count visible bolt meshes (diagnostic: confirm they render)
    return wh.projectiles?.object.children.filter((m) => m.visible).length ?? -2
  }, combat)
  console.log(`visible bolt meshes = ${visN}`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: out })
} else if (hold.length) {
  const holdMs = Number(process.env.SHOOT_HOLD_MS ?? 1200)
  const settleMs = Number(process.env.SHOOT_SETTLE_MS ?? 0) // if >0, release then settle before the shot
  for (const k of hold) await page.keyboard.down(k)
  await page.waitForTimeout(holdMs)
  if (settleMs > 0) {
    for (const k of hold) await page.keyboard.up(k)
    await page.waitForTimeout(settleMs)
  }
  await page.screenshot({ path: out })
  if (settleMs <= 0) for (const k of hold) await page.keyboard.up(k)
} else {
  await page.screenshot({ path: out })
}

const state = await page.evaluate(() => {
  const wh = (globalThis as Record<string, unknown>).WH as
    | {
        craft?: { theta: number; distance: number }
        game?: { energy: number; lives: number; over: boolean }
        fields?: { consumed: number }[]
        enemies?: { killed: number }
      }
    | undefined
  return {
    theta: wh?.craft?.theta ?? null,
    distance: wh?.craft?.distance ?? null,
    energy: wh?.game?.energy ?? null,
    lives: wh?.game?.lives ?? null,
    over: wh?.game?.over ?? null,
    consumed: wh?.fields?.map((f) => f.consumed) ?? null,
    killed: wh?.enemies?.killed ?? null,
  }
})
console.log(
  `theta=${state.theta} dist=${state.distance} energy=${state.energy} lives=${state.lives} over=${state.over} consumed=${JSON.stringify(state.consumed)} killed=${state.killed}`,
)

await browser.close()

if (errors.length) {
  console.error('Page reported errors:\n' + errors.join('\n'))
  process.exit(2)
}
console.log('Saved ' + out)

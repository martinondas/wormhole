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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(waitMs)

// Optional: hold one or more keys (KeyboardEvent.code, comma-separated) for
// SHOOT_HOLD_MS before the capture, to verify steering/throttle in a still.
const hold = (process.env.SHOOT_HOLD ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (hold.length) {
  const holdMs = Number(process.env.SHOOT_HOLD_MS ?? 1200)
  for (const k of hold) await page.keyboard.down(k)
  await page.waitForTimeout(holdMs)
  await page.screenshot({ path: out })
  for (const k of hold) await page.keyboard.up(k)
} else {
  await page.screenshot({ path: out })
}
await browser.close()

if (errors.length) {
  console.error('Page reported errors:\n' + errors.join('\n'))
  process.exit(2)
}
console.log('Saved ' + out)

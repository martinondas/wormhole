// Headless checks for the physical-feel layer (npm run sim:feel): camera shake,
// speed FOV, hull attitude, hit slow-down and the far-object draw scale. All of it
// is visual only; the playtest compare proves the gameplay did not move.
import { PerspectiveCamera } from 'three'
import { createShake } from '../src/render/shake'
import { verticalFov, horizontalFov } from '../src/render/fov'
import { createCameraRig } from '../src/render/camera'
import { createAttitude } from '../src/world/attitude'
import { createHitStop } from '../src/loop'
import { farScale } from '../src/world/farScale'
import { createFlight } from '../src/flight'
import { createCraft } from '../src/craft'
import { CAMERA, FEEL, RENDER, SHIP } from '../src/config'

let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) failed++
}
const DT = 1 / 60

// --- shake ---------------------------------------------------------------------
{
  const s = createShake()
  s.add(1)
  let peak = 0
  const steps = Math.round(1 / FEEL.SHAKE.DECAY / DT)
  for (let i = 0; i < steps; i++) {
    s.update(DT)
    peak = Math.max(peak, Math.abs(s.x), Math.abs(s.y))
  }
  check('A1 shake: after add(1) the offset is exactly 0 after 1 / DECAY seconds',
    s.trauma === 0 && s.x === 0 && s.y === 0 && s.roll === 0, `trauma ${s.trauma} after ${(steps * DT).toFixed(3)} s`)
  check('A2 shake: the offset moved and never exceeded MAX_OFFSET', peak > 0 && peak <= FEEL.SHAKE.MAX_OFFSET, `peak ${peak.toFixed(3)}`)
  const a = createShake()
  a.add(0.5)
  a.add(0.8)
  check('A3 shake: trauma is capped at 1', a.trauma === 1)
  // trauma squared: a near miss stays far below a damage jolt
  const near = FEEL.SHAKE.NEAR ** 2 / FEEL.SHAKE.DAMAGE ** 2
  check('A4 shake: a near miss moves the view at most 5% of a damage jolt', near <= 0.05, `${(near * 100).toFixed(1)}%`)
}

// --- speed FOV -----------------------------------------------------------------
{
  let worstLow = 0
  let worstHigh = 0
  let worstH = 0
  for (const aspect of [0.6, 1, 4 / 3, 16 / 9, 21 / 9, 32 / 9]) {
    const base = verticalFov(aspect, 0)
    for (let o = 0; o <= CAMERA.FOV_SPEED + 1e-9; o += CAMERA.FOV_SPEED / 12) {
      const v = verticalFov(aspect, o)
      worstLow = Math.min(worstLow, v - base)
      worstHigh = Math.max(worstHigh, v - base - CAMERA.FOV_SPEED)
      worstH = Math.max(worstH, horizontalFov(v, aspect) - (CAMERA.HFOV_MAX + o))
    }
  }
  check('B1 FOV: stays within [base, base + FOV_SPEED] at every aspect', worstLow >= -1e-9 && worstHigh <= 1e-9,
    `below base ${worstLow.toFixed(4)}, above top ${worstHigh.toFixed(4)}`)
  check('B2 FOV: horizontal never exceeds HFOV_MAX + the speed offset', worstH <= 1e-9, `worst ${worstH.toFixed(4)} deg`)
  const wide = 21 / 9
  const hSlow = horizontalFov(verticalFov(wide, 0), wide)
  const hFast = horizontalFov(verticalFov(wide, CAMERA.FOV_SPEED), wide)
  check('B3 FOV: at 21:9 the slow tier keeps HFOV_MAX and the fast tier widens to HFOV_MAX + FOV_SPEED',
    Math.abs(hSlow - CAMERA.HFOV_MAX) < 1e-6 && Math.abs(hFast - CAMERA.HFOV_MAX - CAMERA.FOV_SPEED) < 1e-6,
    `${hSlow.toFixed(2)} -> ${hFast.toFixed(2)} deg`)
  const d169 = verticalFov(16 / 9, CAMERA.FOV_SPEED) - verticalFov(16 / 9, 0)
  check('B4 FOV: a 16:9 window sees the widening (at least half of FOV_SPEED, vertical)', d169 >= CAMERA.FOV_SPEED / 2,
    `+${d169.toFixed(2)} deg`)

  // the rig: smoothed, bounded, and the projection only rebuilt on a real change
  const cam = new PerspectiveCamera(CAMERA.FOV, 16 / 9, 0.1, 1200)
  let calls = 0
  let lo = Infinity
  let hi = -Infinity
  let smallest = Infinity
  let last = 0
  const rig = createCameraRig(cam, (deg) => {
    calls++
    lo = Math.min(lo, deg)
    hi = Math.max(hi, deg)
    smallest = Math.min(smallest, Math.abs(deg - last))
    last = deg
  }, createShake())
  rig.reset()
  calls = 0
  smallest = Infinity
  const craft = createCraft()
  let at1s = 0
  for (let i = 0; i < 600; i++) {
    const sp = i < 300 ? 1 : 0 // fast for 5 s, then slow for 5 s
    rig.update(craft, DT, sp)
    if (i === 59) at1s = last
  }
  check('B5 FOV rig: offset stays in [0, FOV_SPEED]', lo >= 0 && hi <= CAMERA.FOV_SPEED + 1e-9, `${lo.toFixed(2)}..${hi.toFixed(2)}`)
  check('B6 FOV rig: projection updates only on a change above 0.05 deg', smallest > 0.05, `${calls} updates in 10 s, smallest step ${smallest.toFixed(3)}`)
  check('B7 FOV rig: eases in (about 1 - e^-1/FOV_LAG of the way after 1 s), never a snap',
    at1s > 0.8 * CAMERA.FOV_SPEED && at1s < CAMERA.FOV_SPEED, `${at1s.toFixed(2)} deg after 1 s`)
}

// --- hull attitude -------------------------------------------------------------
{
  const speed = 60
  let ok = true
  let detail = ''
  for (const omega of [5, -5, 1, -1]) {
    const a = createAttitude()
    for (let i = 0; i < 60; i++) a.update(omega, speed, 0, DT)
    if (Math.sign(a.yaw) !== Math.sign(omega) || Math.abs(a.yaw) > SHIP.YAW_MAX + 1e-9) ok = false
    detail += `omega ${omega}: yaw ${a.yaw.toFixed(3)} roll ${a.roll.toFixed(3)}; `
  }
  check('C1 attitude: yaw has the sign of omega and stays within YAW_MAX', ok, detail)
  const a = createAttitude()
  for (let i = 0; i < 60; i++) a.update(5, speed, 1, DT)
  for (let i = 0; i < 30; i++) a.update(0, speed, 0, DT)
  check('C2 attitude: back within 0.01 rad 0.5 s after omega reaches 0', Math.abs(a.yaw) < 0.01 && Math.abs(a.roll) < 0.01,
    `yaw ${a.yaw.toExponential(2)} roll ${a.roll.toExponential(2)}`)
  const b = createAttitude()
  for (let i = 0; i < 60; i++) b.update(4, speed, 0, DT) // key released, swing still carrying
  check('C3 attitude: the hull stays slewed while the swing carries with no key held', b.yaw > 0.05 && b.roll < -0.1,
    `yaw ${b.yaw.toFixed(3)} roll ${b.roll.toFixed(3)}`)
  const c = createAttitude()
  for (let i = 0; i < 60; i++) c.update(40, speed, 1, DT)
  check('C4 attitude: roll is clamped', Math.abs(c.roll) <= SHIP.ROLL_MAX + 1e-9, `roll ${c.roll.toFixed(3)}`)
}

// --- hit slow-down -------------------------------------------------------------
{
  const h = createHitStop(FEEL.HITSTOP)
  check('D1 hit stop: idle scale is 1', h.scale(DT) === 1)
  h.trigger()
  const hold = h.scale(FEEL.HITSTOP.HOLD * 0.9)
  let prev = hold
  let mono = true
  let t = FEEL.HITSTOP.HOLD * 0.9
  while (t < FEEL.HITSTOP.HOLD + FEEL.HITSTOP.EASE + 0.05) {
    const s = h.scale(DT)
    t += DT
    if (s < prev - 1e-12) mono = false
    prev = s
  }
  check('D2 hit stop: holds SCALE, then eases back to exactly 1', hold === FEEL.HITSTOP.SCALE && prev === 1 && mono,
    `hold ${hold}, end ${prev}`)
}

// --- speed01 -------------------------------------------------------------------
{
  const f = createFlight()
  f.update(0, 0)
  const lo = f.tierSpeedOf(0, 0)
  const hi = f.tierSpeedOf(0, 2)
  check('E1 speed01: 0 at the slow tier, 1 at the fast tier, clamped outside',
    f.speed01(lo) === 0 && f.speed01(hi) === 1 && f.speed01(lo - 10) === 0 && f.speed01(hi + 10) === 1 &&
      Math.abs(f.speed01((lo + hi) / 2) - 0.5) < 1e-9)
}

// --- far-object draw scale -----------------------------------------------------
{
  // on-screen size ~ scale / distance from the camera; it must grow all the way in
  let mono = true
  for (const gain of [RENDER.FAR_SCALE.GAIN, RENDER.FAR_SCALE.RAIDER_GAIN]) {
    let prev = 0
    for (let ahead = 300; ahead >= 0; ahead -= 0.5) {
      const size = farScale(-ahead, gain) / (ahead + CAMERA.BACK)
      if (size <= prev) mono = false
      prev = size
    }
  }
  check('F1 far scale: 1 at the ship, the on-screen size still grows all the way in', farScale(0) === 1 && farScale(5) === 1 && mono)
}

if (failed > 0) {
  console.log(`${failed} FEEL SIM CHECK(S) FAILED`)
  process.exit(1)
}
console.log('ALL FEEL SIM CHECKS PASSED')

// ============================================================================
// config.ts - ALL tunable constants live here, grouped. Tweak freely.
// Values are starting points chosen for feel; expect to adjust constantly.
// Live handle in the browser console: window.WH (see main.ts).
// ============================================================================

// --- physics: the damped, driven pendulum (the heart of the game) -----------
// theta = angle around the tube cross-section, 0 = bottom. Unbounded (can loop).
export const PHYSICS = {
  HZ: 240,            // fixed physics substeps per second
  GRAVITY_K: 9.0,     // restoring strength: angAccel includes -K*sin(theta).
                      // small-angle period ~ 2*PI/sqrt(K) ~ 2.1s
  DAMPING_C: 0.5,     // light damping on omega: overshoots, eventually settles
  STEER_TORQUE: 15.0, // angular accel added by full steering input (rad/s^2)
  STEER_ATTACK: 0.07, // seconds for steer signal to ramp up (weighty taps)
  STEER_RELEASE: 0.13,// seconds for steer signal to ramp back to zero
}

// --- speed: forward motion. Never halts. -----------------------------------
// Units are world units per second (tube radius ~ 6, ring spacing ~ 7).
export const SPEED = {
  CRUISE: 36,         // resting speed with no throttle/brake input
  MIN: 22,            // floor: easing/braking never drops below this (no halt)
  MAX: 90,            // boost ceiling
  THROTTLE_ACCEL: 34, // accel while throttle held (units/s^2)
  BOOST_ACCEL: 78,    // accel while boost held
  EASE_DECEL: 30,     // decel while braking, and ease-back toward CRUISE
}

// --- tube geometry ----------------------------------------------------------
export const TUBE = {
  RADIUS: 6,
  RING_SPACING: 7,        // distance between cross-section rings
  RINGS_VISIBLE: 56,      // rings drawn ahead (render distance = this * spacing)
  SEGMENTS_PER_RING: 48,  // smoothness of each ring circle
  LONGITUDINAL_LINES: 24, // lines running down the length of the tube
}

// --- ship -------------------------------------------------------------------
export const SHIP = {
  Z: 0,               // ship sits at world z=0; camera is behind at +Z
  RADIAL_OFFSET: 1.35,// how far the belly floats inside the tube wall
  SCALE: 0.8,         // overall hull scale
  BANK: 0.5,          // extra roll (rad) leaned into a full steer input
  LINE_WIDTH: 2.4,    // edge line width in pixels (Line2)
}

// --- camera (chase cam, orbits with theta, rolls through loops) -------------
export const CAMERA = {
  FOV: 64,            // tighter than wide-angle: gentler convergence, see ahead
  BACK: 11,           // distance behind the ship along the tube axis
  RISE: 3.0,          // pulled toward tube center ("above" the ship)
  LOOK_AHEAD: 34,     // how far ahead down the tube the camera aims
  ROLL_FOLLOW: 0.85,  // 0 = world-upright, 1 = fully rolls with theta
  ROLL_LAG: 0.10,     // seconds of lag on the orbit/roll follow (weight)
}

// --- render / look (Tron: green neon on near-black, GPU bloom) --------------
// Line RGB values intentionally exceed 1.0 so they read as bright cores that
// bloom strongly in the HDR composer (near-white center, green halo).
export const RENDER = {
  BG_COLOR: 0x00060a,
  FOG_NEAR: 26,
  FOG_FAR: 360,

  RING_RGB: [0.16, 1.25, 0.55] as [number, number, number],
  LONG_RGB: [0.10, 0.85, 0.40] as [number, number, number],
  SHIP_RGB: [0.55, 1.70, 0.95] as [number, number, number],
  SHIP_FILL_RGB: [0.01, 0.04, 0.03] as [number, number, number],

  DPR_CAP: 1.5,       // cap devicePixelRatio before scaling
  RENDER_SCALE: 0.85, // render below native res, upscale (main 60fps lever)

  BLOOM_ENABLED: true,
  BLOOM_STRENGTH: 0.9,
  BLOOM_RADIUS: 0.5,
  BLOOM_THRESHOLD: 0.0,
}

// --- input key bindings (KeyboardEvent.code) --------------------------------
export const INPUT = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  boost: ['ShiftLeft', 'ShiftRight', 'Space'],
}

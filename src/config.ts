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
  CRUISE: 30,         // resting speed with no throttle/brake input
  MIN: 18,            // floor: easing/braking never drops below this (no halt)
  MAX: 75,            // boost ceiling
  THROTTLE_ACCEL: 28, // accel while throttle held (units/s^2)
  BOOST_ACCEL: 64,    // accel while boost held
  EASE_DECEL: 26,     // decel while braking, and ease-back toward CRUISE
}

// --- tube geometry ----------------------------------------------------------
export const TUBE = {
  RADIUS: 6,
  RING_SPACING: 9,        // distance between cross-section rings (wider = calmer)
  RINGS_VISIBLE: 36,      // rings drawn ahead (render distance = this * spacing)
  SEGMENTS_PER_RING: 48,  // smoothness of each ring circle
  LONGITUDINAL_LINES: 24, // lines running down the length of the tube
}

// --- ship -------------------------------------------------------------------
export const SHIP = {
  Z: 0,               // ship sits at world z=0; camera is behind at +Z
  RADIAL_OFFSET: 1.35,// how far the belly floats inside the tube wall
  SCALE: 0.9,         // overall hull scale
  BANK: 0.5,          // extra roll (rad) leaned into a full steer input
  LINE_WIDTH: 2.4,    // edge line width in pixels (Line2)
}

// --- camera (chase cam, orbits with theta, rolls through loops) -------------
export const CAMERA = {
  FOV: 62,            // vertical FOV used on square/tall windows
  HFOV_MAX: 80,       // cap on horizontal FOV: wide windows no longer widen the
                      // view (calms edge strobe), and keeps convergence gentle
  BACK: 14,           // distance behind the ship along the tube axis
  RISE: 3.7,          // pulled toward tube center ("above" the ship)
  LOOK_AHEAD: 34,     // how far ahead down the tube the camera aims
  // Keep the wormhole mostly STILL when steering; the craft rides the walls
  // within a stable tube. These add just a little movement for life.
  ORBIT_FOLLOW: 0.15, // how much the camera orbits the tube with the craft (0 = fixed)
  ROLL_FOLLOW: 0.12,  // how much the view banks/rolls with the craft
  AIM_FOLLOW: 0.40,   // how much the camera aims toward the craft (keeps it framed)
  FOLLOW_LAG: 0.10,   // smoothing on the orbit follow (weight)
}

// --- render / look (Tron: green neon on near-black, GPU bloom) --------------
// Line RGB values intentionally exceed 1.0 so they read as bright cores that
// bloom strongly in the HDR composer (near-white center, green halo).
export const RENDER = {
  BG_COLOR: 0x00060a,
  FOG_NEAR: 22,
  FOG_FAR: 250,       // fade the deep rings so they don't pile into a bright core

  RING_RGB: [0.12, 0.92, 0.42] as [number, number, number],
  LONG_RGB: [0.07, 0.52, 0.26] as [number, number, number],
  SHIP_RGB: [0.50, 1.50, 0.85] as [number, number, number],
  SHIP_FILL_RGB: [0.01, 0.04, 0.03] as [number, number, number],

  DPR_CAP: 1.5,       // cap devicePixelRatio before scaling
  RENDER_SCALE: 0.85, // render below native res, upscale (main 60fps lever)
  MSAA_SAMPLES: 4,    // anti-alias the offscreen pass so thin rings don't shimmer

  BLOOM_ENABLED: true,
  BLOOM_STRENGTH: 0.45,
  BLOOM_RADIUS: 0.45,
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

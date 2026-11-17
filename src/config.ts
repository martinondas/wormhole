// ============================================================================
// config.ts - ALL tunable constants live here, grouped. Tweak freely.
// Values are starting points chosen for feel; expect to adjust constantly.
// Live handle in the browser console: window.WH (see main.ts).
// ============================================================================

// --- physics: the damped, driven pendulum (the heart of the game) -----------
// theta = angle around the tube cross-section, 0 = bottom. Unbounded (can loop).
export const PHYSICS = {
  HZ: 120,            // fixed physics substeps per second: a smooth swing and tunnel-free
                      // bolt hits (see GUN.HIT_Z)
  GRAVITY_K: 11.0,    // restoring strength: angAccel includes -K*sin(theta). Higher = snappier
                      // swing and harder to loop (a loop needs omega at the bottom above about 2*sqrt(K))
  DAMPING_C: 1.3,     // damping on omega: higher = the craft settles at the bottom sooner
  STEER_TORQUE: 24,   // angular accel of a full steering input (rad/s^2); most of the agility
                      // at high speed, where gravity is lightest
  STEER_OMEGA_MAX: 7.0,// soft cap: steering torque fades to zero as |omega| nears this, so a
                      // held key does not spin up forever. Gravity can still exceed it on a dive.
  STEER_ATTACK: 0.04, // seconds for steer signal to ramp up (low = crisp direction changes)
  STEER_RELEASE: 0.13,// seconds for steer signal to ramp back to zero
}

// --- flight mode (speed tier -> gravity + tube color) -----------------------
// Speed is the single driver: the mode (or the current section) picks a target
// speed tier, the craft eases to it, and gravity is tied to speed (see flight.ts):
//   slow   = yellow, full gravity
//   normal = green,  mid gravity
//   fast   = blue,   floor gravity (lightest, still a pendulum)
// 'sections' cycles the tiers along the tube; the other modes pin one tier for feel
// testing (INPUT.modeCycle, or WH.flight.mode). The tube color follows speed.
export type FlightMode = 'slow' | 'normal' | 'fast' | 'sections'
export const FLIGHT = {
  MODE: 'sections' as FlightMode, // startup mode (cycle tiers along the tube)
  SECTION_SECONDS: 10,          // 'sections' mode: seconds per section (equal in TIME; distance scales with the tier's speed)
  SLOW_RING_RGB: [0.72, 0.54, 0.08] as [number, number, number], // yellow tube (slow / full gravity)
  SLOW_LONG_RGB: [0.42, 0.31, 0.05] as [number, number, number],
  FAST_RING_RGB: [0.16, 0.34, 0.85] as [number, number, number], // blue tube (fast / floor gravity)
  FAST_LONG_RGB: [0.10, 0.20, 0.52] as [number, number, number], // normal/green reuses RENDER.RING_RGB / LONG_RGB
  // Gravity across the speed span: scale = FLOOR + (1 - FLOOR) * t^CURVE, where t
  // runs 1 (slow tier speed) -> 0 (fast tier speed). The FLOOR keeps a real downward
  // pull in fast sections (never a free rotor); CURVE shapes the middle tier
  // (1 = linear, >1 lighter mid, <1 heavier mid). Applied in flight.ts gravityOf.
  GRAVITY_FLOOR: 0.45, // fraction of GRAVITY_K that remains at the fast tier speed
  GRAVITY_CURVE: 1.0,  // exponent shaping the fade between the tiers (1 = linear)
}

// --- speed: forward motion. Set by the flight mode / section, not the player. -
// World units per second. Three tiers at level 1 (LEVELS raises them per level); the
// craft eases toward the active tier's speed at EASE and never halts (SLOW > 0).
export const SPEED = {
  SLOW: 30,   // yellow sections: full gravity, heaviest swing
  NORMAL: 52, // green sections: mid gravity
  FAST: 75,   // blue sections: floor gravity, most agile
  EASE: 28,   // accel/decel toward the active tier's speed (units/s^2)
}

// --- levels (gem-gated difficulty ramp) ---------------------------------------
// A level lasts until its gem quota is collected. A level gate then appears ahead in
// the tube (GATE), and the level changes where the craft flies through it (flight.ts).
// Each level raises every tier speed and the score multiplier; the raider waves and
// the mine density follow the tuning level (levels.ts). The speed sections keep
// cycling on their own clock. Levels only progress in FLIGHT.MODE 'sections'; the
// pinned modes stay at level 1 with no gate.
export const LEVELS = {
  // Per-level speed bonus added to EVERY tier, in three bands by display level: EARLY
  // up to EARLY_UNTIL, MID up to MID_UNTIL, LATE beyond. The step decays but is never
  // zero, so deep levels keep speeding up without the reaction window collapsing
  // (flight.ts speedBonus).
  SPEED_STEP: { EARLY: 5, MID: 3, LATE: 1.5 },    // u/s added per level in each band
  SPEED_BAND: { EARLY_UNTIL: 10, MID_UNTIL: 15 }, // display level the EARLY / MID band ends at
  SCORE_MULT_STEP: 0.5, // score multiplier = 1 + tuning level * this; scales gem and kill points
  // Gem quota of a level, in gems: GEM_QUOTA_START at tuning level 0, GEM_QUOTA_STEP
  // more per tuning level, at most GEM_QUOTA_MAX (flight.gemQuota). A difficulty mode
  // may cap it lower (DIFFICULTY quotaCap).
  GEM_QUOTA_START: 8,  // small, so a new player meets the first gate early
  GEM_QUOTA_STEP: 5,   // the levels lengthen while the player learns to collect
  GEM_QUOTA_MAX: 30,   // sets how long a deep level lasts for a player who collects most gems
  // Reference span of the slow->fast gravity fade (FLIGHT.GRAVITY_FLOOR / GRAVITY_CURVE):
  //   'tier'     - full gravity at the level's OWN slow speed, the floor at its own
  //                fast speed, so each section keeps its feel as speeds climb.
  //   'absolute' - full at SPEED.SLOW, the floor at SPEED.FAST: every section gets
  //                lighter as levels speed up, and deep levels flatten to the floor.
  GRAVITY_MODE: 'tier' as 'tier' | 'absolute',
  MAX_ENEMIES_CAP: 4,       // most raiders ever alive at once (sizes the pool once)
  // Raider waves by tuning level T (flight.tuned, rounded), read through levels.ts.
  // roster = raiders in one wave, cap = alive at once, hunters = members that slide to
  // the player's line and fire aimed shots. Past the last row the roster grows by 1
  // every WAVE_ROSTER_EVERY levels up to WAVE_ROSTER_MAX, the cap is MAX_ENEMIES_CAP
  // from WAVE_CAP4_FROM and there are two hunters from WAVE_HUNTERS2_FROM.
  WAVES: [
    { roster: 2, cap: 2, hunters: 0 }, // T0
    { roster: 3, cap: 2, hunters: 0 }, // T1
    { roster: 3, cap: 3, hunters: 1 }, // T2
    { roster: 4, cap: 3, hunters: 1 }, // T3
    { roster: 5, cap: 3, hunters: 1 }, // T4
    { roster: 5, cap: 3, hunters: 1 }, // T5
    { roster: 6, cap: 3, hunters: 1 }, // T6
  ],
  WAVE_ROSTER_EVERY: 2,
  WAVE_ROSTER_MAX: 9,
  WAVE_CAP4_FROM: 7,
  WAVE_HUNTERS2_FROM: 9,
  // Raider aggression 0..1 = clamp((T - AGGRESSION_FROM) / AGGRESSION_SPAN, 0, 1): it
  // shortens the fire cooldown and the breather and speeds up the hunter's slide.
  AGGRESSION_FROM: 2,
  AGGRESSION_SPAN: 10,
  // Deep pressure 0..1 = clamp((T - DEEP_FROM) / DEEP_SPAN, 0, 1): a second ramp for
  // the levels past the wave table. It scales the fire cooldown by up to
  // ENEMY.DEEP_COOLDOWN_K and the fire stagger by up to ENEMY.DEEP_STAGGER_K, so deep
  // levels keep getting harder for a skilled player while the levels before DEEP_FROM
  // are untouched.
  DEEP_FROM: 8,
  DEEP_SPAN: 7,
  // Mines are the SECONDARY threat: past the last TABLE row the mine multiplier drops
  // by BOMB_MULT_STEP per level down to BOMB_MULT_FLOOR (levels.ts bombMult), then
  // levels off. The gem-line director divides its per-section mine budget by it.
  BOMB_MULT_STEP: 0.02,     // mine multiplier tightening per level past the table
  BOMB_MULT_FLOOR: 0.6,     // densest mines ever reach (playability floor)
  // Per tuning level: the mine multiplier (levels.ts bombMult), <1 = more mines in a
  // section. Mines barely move over the warm-up levels, then tighten.
  TABLE: [
    { bombSpacingMult: 1.0 },  // L1
    { bombSpacingMult: 0.95 }, // L2
    { bombSpacingMult: 0.85 }, // L3
    { bombSpacingMult: 0.72 }, // L4
    { bombSpacingMult: 0.66 }, // L5
  ],
}

// --- difficulty (title-screen selector; maps the played level to a tuning level) --
// tuningLevel = offset + slope * level (0-based), applied in flight.ts (tier speeds,
// score multiplier, gem quota) and levels.ts (raider waves, mine density), so a mode
// needs no tables of its own. The score multiplier follows the tuning level, so a
// harder mode pays more per gem / kill and the single shared best score stays honest.
// `ease` multiplies the raider fire cooldown and the breather between waves and
// divides the mine budget of the gem lines, so a mode can be gentler from level 1,
// where the level mapping alone changes nothing (MILKY WAY is the mode for children).
// `quotaCap` caps the gem quota in gems (Infinity = only LEVELS.GEM_QUOTA_MAX applies).
// `color` is the mode's threat color in the title selector and the HUD readout; the
// threat pips render in hud.ts from the mode index.
export const DIFFICULTY = {
  MODES: [
    { name: 'MILKY WAY', slope: 0.4, offset: 0, ease: 2.2, quotaCap: 24, color: '#7dffa6' },
    { name: 'ORION', slope: 1.0, offset: 0, ease: 1.0, quotaCap: Infinity, color: '#ffd24d' },
    { name: 'QUASAR', slope: 1.0, offset: 2.5, ease: 1.0, quotaCap: Infinity, color: '#ff5a5a' },
  ],
  DEFAULT: 1, // index into MODES (ORION: the tuning with no mapping)
}

// --- level gate (the ring the craft flies through to change level) ------------
// The gate is placed when the level's gem quota is met (session.ts) and drawn by
// world/gate.ts: a thin frame that hugs the tube wall, so the middle of the view
// stays open and whatever flies behind the gate stays readable.
export const GATE = {
  AHEAD: 290,          // units ahead of the craft: past the last drawn ring and SEQUENCE.HORIZON, so it comes out of the fog
  RADIUS: 0.985,       // outer ring radius as a share of TUBE.RADIUS (on the wall, clear of the wall lines)
  INNER: 0.95,         // inner ring radius as a share of TUBE.RADIUS (a narrow band: wall objects ride well inside it)
  SEGMENTS: 64,        // straight segments per ring (smooth at full screen size)
  LINE_WIDTH: 1.5,     // px, thinner than a wall object's edges: the gate frames the view and covers nothing
  RGB: [1.1, 0.9, 0.4] as [number, number, number], // white-gold, a little brighter than the tube rings so the bloom stays small; not the red of mines or the magenta of raiders
  SPIN: 0.5,           // rad/s the gate turns about the tube axis, so it differs from the still tube rings
  PASS_TIME: 0.35,     // s the gate takes to fade once the craft is through
  PASS_SCALE: 1.15,    // the gate widens to this size while it fades (outward, away from the view)
  FLASH: 0.5,          // tube flash at the pass, as a multiple of FEEL.TUBE_FLASH.PEAK (a pulse, not a white-out)
}

// --- tube geometry ----------------------------------------------------------
export const TUBE = {
  RADIUS: 6,
  RING_SPACING: 9,        // distance between cross-section rings (wider = calmer)
  RINGS_VISIBLE: 30,      // rings drawn ahead (render distance = this * spacing; kept near FOG_FAR/spacing so far rings aren't drawn past the fog)
  SEGMENTS_PER_RING: 48,  // smoothness of each ring circle
  LONGITUDINAL_LINES: 24, // lines running down the length of the tube
}

// --- ship -------------------------------------------------------------------
export const SHIP = {
  Z: 0,               // ship sits at world z=0; camera is behind at +Z
  RADIAL_OFFSET: 1.35,// how far the belly floats inside the tube wall
  SCALE: 0.9,         // overall hull scale
  // Selectable hulls (world/ship.ts builds the geometry per id). COSMETIC ONLY: every
  // hull flies identically and shares the global hit windows. Keep a new silhouette
  // near the raptor's footprint, so the shared hitbox also LOOKS believable.
  HULLS: [
    { id: 'raptor', name: 'RAPTOR' },   // X-wing-ish winged fighter
    { id: 'falcon', name: 'FALCON' },   // saucer: lens disc, offset cockpit, front mandibles
    { id: 'delta', name: 'DELTA' },     // rebel-style delta: arrow wing, twin fins + engines
  ] as { id: 'raptor' | 'falcon' | 'delta'; name: string }[],
  // Title-screen preview: the selected hull floats in front of the camera and
  // slowly turns (turntable) so the choice is seen, not read.
  PREVIEW_DIST: 15,   // world units in front of the camera
  PREVIEW_RIGHT: 7.4, // shift right of the screen center, clear of the title text column
  PREVIEW_DOWN: 1.2,  // shift below the camera axis
  PREVIEW_SPIN: 0.6,  // turntable yaw speed (rad/s)
  PREVIEW_TILT: 0.30, // fixed pitch so the top of the hull is visible (rad)
  BANK: 0.5,          // extra roll (rad) leaned into a full steer input
  // Hull attitude (visual only; hit windows are unchanged). The nose yaws toward the
  // direction of travel: slip = atan2(omega * RIDE_RADIUS, speed), yaw = YAW_FOLLOW *
  // slip clamped to YAW_MAX. The roll adds BANK_OMEGA * omega on top of the steer
  // bank, so the hull stays slewed while the swing carries after a key is released.
  YAW_FOLLOW: 0.5,
  YAW_MAX: 0.3,        // rad
  BANK_OMEGA: 0.06,    // rad of roll per rad/s of swing
  ROLL_MAX: 0.8,       // rad, clamp on the total roll
  ATTITUDE_LAG: 0.08,  // s, smoothing time constant of yaw and roll
  LINE_WIDTH: 2.4,    // edge line width in pixels (Line2)
  FLASH_HOLD: 0.5,    // seconds the blue orb-pickup flash stays at full before fading
  FLASH_TIME: 0.7,    // seconds the flash then fades from full back to normal
}

// Shared ride radius: where the ship belly floats AND where every wall object
// (orb / gem / mine) sits. The angle-only hit test (craft.theta vs object theta)
// is only valid if these match, so ship.ts and field.ts both derive from this
// one value - a constraint, not a per-kind tunable.
export const RIDE_RADIUS = TUBE.RADIUS - SHIP.RADIAL_OFFSET

// --- camera (chase cam, orbits with theta, rolls through loops) -------------
export const CAMERA = {
  FOV: 62,            // vertical FOV used on square/tall windows
  HFOV_MAX: 80,       // cap on horizontal FOV: a wide window does not widen the view
                      // (calms edge strobe, keeps convergence gentle)
  BACK: 14,           // distance behind the ship along the tube axis
  RISE: 3.7,          // pulled toward tube center ("above" the ship)
  LOOK_AHEAD: 34,     // how far ahead down the tube the camera aims
  // Keep the wormhole mostly STILL when steering; the craft rides the walls
  // within a stable tube. These add just a little movement for life.
  ORBIT_FOLLOW: 0.15, // how much the camera orbits the tube with the craft (0 = fixed)
  ROLL_FOLLOW: 0.12,  // how much the view banks/rolls with the craft
  AIM_FOLLOW: 0.40,   // how much the camera aims toward the craft (keeps it framed)
  FOLLOW_LAG: 0.10,   // smoothing on the orbit follow (weight)
  // Speed FOV: the view widens by FOV_SPEED degrees (vertical) from the level's slow
  // tier to its fast tier, smoothed with FOV_LAG. The horizontal cap widens with it
  // (HFOV_MAX + FOV_SPEED at the fast tier): a wide window already sits on the cap,
  // so a fixed cap would cancel the effect on every 16:9 screen.
  FOV_SPEED: 6,
  FOV_LAG: 0.35,      // s, smoothing time constant
}

// --- render / look (Tron: green neon on near-black, GPU bloom) --------------
// Line RGB values intentionally exceed 1.0 so they read as bright cores that
// bloom strongly in the HDR composer (near-white center, green halo).
export const RENDER = {
  BG_COLOR: 0x00060a,
  FOG_NEAR: 22,
  FOG_FAR: 250,       // fade the deep rings so they don't pile into a bright core

  RING_RGB: [0.18, 0.60, 0.40] as [number, number, number], // softer, less neon green (easier on the eye)
  LONG_RGB: [0.11, 0.36, 0.24] as [number, number, number],
  SHIP_RGB: [0.50, 1.50, 0.85] as [number, number, number],
  SHIP_FILL_RGB: [0.01, 0.04, 0.03] as [number, number, number],
  SHIP_FLASH_RGB: [0.10, 0.50, 4.50] as [number, number, number], // HDR blue, keyed to the orb; ship edges flash this on pickup then decay to SHIP_RGB. Low green = deep blue (not pale cyan); high blue = strong bloom pop
  SHIP_LIFE_FLASH_RGB: [0.30, 5.00, 1.10] as [number, number, number], // HDR green, keyed to the extra-life cross; brighter than SHIP_RGB so the hull clearly lights green on a life gain, then decays back
  SHIP_HIT_FLASH_RGB: [5.00, 0.18, 0.08] as [number, number, number], // HDR red, keyed to the mine; the hull flashes this on a damaging hit (mine / ram / bolt) then decays back. Low green/blue = pure red, not pink

  DPR_CAP: 1.5,       // cap devicePixelRatio before scaling
  RENDER_SCALE: 0.85, // render below native res, upscale (main 60fps lever)
  MSAA_SAMPLES: 4,    // anti-alias the offscreen pass so thin rings don't shimmer
  // Integrated-GPU fallback, auto-selected in scene.ts (pickRenderTier): the full-res
  // MSAA resolve + bloom fill is the dominant cost there, so it renders smaller with
  // lighter MSAA. Discrete GPUs keep the values above.
  RENDER_SCALE_LOW: 0.72,
  MSAA_SAMPLES_LOW: 2,

  // Far-object readability: wall objects and raiders are drawn larger the farther
  // ahead they are, from 1x at NEAR to 1 + gain at FAR and beyond. GAIN (wall objects,
  // visual only) is small enough that neighbours stay separate shapes at the far end
  // of the tube; RAIDER_GAIN is larger, so a raider's firing tell stands out from the
  // wall objects (its outer hit window follows the drawn size, see GUN.HIT_ANGLE).
  // A gain below (FAR - NEAR) / NEAR keeps the on-screen size growing all the way in,
  // so the depth cue never runs backwards.
  FAR_SCALE: { NEAR: 15, FAR: 110, GAIN: 0.5, RAIDER_GAIN: 1.0 },

  BLOOM_ENABLED: true,
  BLOOM_STRENGTH: 0.45,
  BLOOM_RADIUS: 0.45,
  BLOOM_THRESHOLD: 0.0,
}

// --- background (subtle deep-space gradient + stars behind the tube) --------
// Colors are CSS strings (drawn to a canvas). Tweak + save to regenerate (HMR).
export const BACKGROUND = {
  ENABLED: true,
  CENTER: '#01040b',  // near the vanishing point (the "hole")
  MID: '#050d22',     // deep, dark blue band
  EDGE: '#010207',    // corners / outer
  MID_STOP: 0.42,     // 0..1 radius where MID sits
  STARS: 330,         // world-space star count
  STAR_ALPHA: 0.7,    // max star brightness
  STAR_SPREAD_DEG: 52, // half-angle of the forward cone stars are placed in
                       // (wider than the FOV so banking never reveals an edge)
}

// --- pickups (blue orbs: weapon charge) -------------------------------------
export const PICKUP = {
  RADIUS: 0.8,
  DETAIL: 1,          // icosphere subdivision (1 = faceted geodesic look)
  LINE_WIDTH: 2.2,    // edge line width in pixels (Line2)
  EDGE_RGB: [0.00, 0.22, 1.00] as [number, number, number], // bright blue facet lines (contrast vs fill; no red so bloom can't whiten)
  GLOW_RGB: [0.02, 0.09, 0.72] as [number, number, number], // deep saturated blue inside
  GLOW_OPACITY: 0.82,                                        // solid, more blue fill
  SPIN_SPEED: 0.8,    // rad/s about the vertical axis
  BOB_AMP: 0.14,      // bob height (world units)
  BOB_SPEED: 2.2,     // bob rad/s

  // --- spawn / collection mechanic ---
  // Orbs recharge the weapon, so they are deliberately sparse: no topping up fast
  // enough to fire without pause. Density is set by SPACING (encounter rate = speed /
  // spacing); COUNT only keeps the visible range filled so they fade in from the fog.
  COUNT: 5,           // orbs alive in the pool at once
  SPAWN_START: 50,    // distance ahead of the first orb
  SPAWN_SPACING: 240, // nominal distance between orbs (encounter rate = speed / spacing)
  SPAWN_JITTER: 14,   // random extra distance per orb
  RECYCLE_BEHIND: 22, // recycle once an orb is this far behind the ship
  CAPTURE_Z: 2.4,     // along-tube window (units) for a catch
  CAPTURE_ANGLE: 0.42,// angular window (rad) for a catch
  POP_TIME: 0.18,     // collect pop duration (s)
  POP_SCALE: 1.8,     // collect pop peak scale (expand-and-fade)
  // angle-from-bottom bias (deg; 0=bottom, 180=top). Favor mid-wall so the
  // player has to swing up for charge rather than scoop it off the floor.
  SPAWN_ANGLE: { band: [40, 90] as [number, number], bias: 0.8, rest: [0, 180] as [number, number] },
}

// --- treasure (gold brilliant-cut gem; ride-into = score) -------------------
// Visual: a custom diamond (flat table on top, a crown widening to the waist,
// then a long pavilion to a point), edge-lit gold over a near-black warm fill.
// NORMAL blend (depthTest), like the orb and unlike the ship: additive HDR gold
// would bloom toward white and lose the hue separation from the blue orb.
export const TREASURE = {
  RADIUS: 0.75,        // waist (widest) radius
  FACETS: 8,           // radial segments -> 8 vertical facet ridges (classic cut)
  TABLE_RATIO: 0.45,   // flat top radius as a fraction of RADIUS
  CROWN_RATIO: 0.55,   // crown (table->waist) height as a fraction of RADIUS
  PAVILION_RATIO: 1.5, // long pointed bottom height as a fraction of RADIUS
  EDGE_THRESHOLD: 1,   // EdgesGeometry thresholdAngle (deg); low keeps all facets
  LINE_WIDTH: 2.2,     // edge line width in px (Line2)
  EDGE_RGB: [1.60, 1.10, 0.18] as [number, number, number], // warm gold, >1 cores bloom white
  FILL_RGB: [0.16, 0.09, 0.01] as [number, number, number], // deep warm-amber, dark enough to occlude
  FILL_OPACITY: 0.85,
  SPIN_SPEED: 2.4,     // rad/s about vertical (faster than the orb, so the facets flash)
  BOB_AMP: 0.10,
  BOB_SPEED: 2.0,

  // --- field ---
  // The pool is fed by the gem-line director (SEQUENCE); COUNT is sized for its
  // planning horizon.
  COUNT: 24,
  RECYCLE_BEHIND: 22,
  CAPTURE_Z: 2.4,      // generous ride-into (like the orb)
  CAPTURE_ANGLE: 0.40,
  POP_TIME: 0.18,
  POP_SCALE: 1.8,
  SCORE: 110,          // points per gem (x the level multiplier at award time)
}

// --- hazard (red naval contact mine; AVOID, a hit costs a life) --------------
// The ONLY red object on the tube: a dominant ball with straight rod horns (uniform
// cylinders, no pointed cones or bulb tips), so it reads as a sea mine, not a spiky
// virus. Edge-lit solid like the ship, but NORMAL blend like the orb (additive HDR
// red would bloom toward white/pink).
export const HAZARD = {
  CORE_RADIUS: 0.72,   // faceted core ball radius (world units) - dominant body
  // 12 horns, fixed by the geometry (the 12 icosahedron vertex directions in hazard.ts).
  SPIKE_LEN: 0.42,     // horn length out from the core (a distinct rod, not a stub)
  SPIKE_BASE_R: 0.12,  // horn radius at the core (rod thickness)
  SPIKE_TIP_R: 0.095,  // horn radius at the tip (slightly < base = subtle taper, flat end)
  SCALE: 1.6,          // overall size multiplier on the built mine (bigger = scarier)
  EDGE_THRESHOLD: 18,  // EdgesGeometry threshold (deg): keeps the rod ridges + facets
  LINE_WIDTH: 2.2,     // edge line width in px
  EDGE_RGB: [1.0, 0.06, 0.04] as [number, number, number], // deep, dim red (blooms gently; big silhouette keeps it readable)
  FILL_RGB: [0.05, 0.005, 0.005] as [number, number, number], // near-black, faint red bias
  SPIN_SPEED: 0.55,    // rad/s, slow + menacing (slower than the orb)
  PULSE_SPEED: 3.4,    // throb rad/s
  PULSE_AMP: 0.05,     // +/- scale breathing

  // --- field ---
  // The pool is fed by the gem-line director (SEQUENCE); COUNT is sized for its
  // planning horizon.
  COUNT: 12,
  RECYCLE_BEHIND: 22,
  // The hit test compares the ship CENTER to the mine center, so the window must
  // absorb the ship's wingspan and the mine's horns, or a banked wing can overlap a
  // horn with no hit.
  CAPTURE_Z: 2.8,      // ship half-length + mine half-extent
  CAPTURE_ANGLE: 0.62, // ship wing half-width + mine horn reach
  POP_TIME: 0.10,      // fast + big -> reads as an explosion on a real hit
  POP_SCALE: 2.6,
}

// --- extra life (bright-green medkit cross; ride-into = +1 life) -------------
// A chunky 3D plus (the universal "+1" icon), shape-distinct from every other wall
// object despite green being the theme color. Edge-lit solid like the mine. It adds a
// life only below LIVES.START (game.addLife); at full lives it pays FULL_SCORE.
export const EXTRA_LIFE = {
  // A whole-life cross comes two ways. Squad cross: the last raider of every Nth fully
  // destroyed squad leaves one. N grows with the tuning level T: SQUAD_EVERY +
  // SQUAD_EVERY_STEP * T, rounded, at most SQUAD_EVERY_MAX (levels.ts squadEvery).
  SQUAD_EVERY: 3,
  SQUAD_EVERY_STEP: 1,
  SQUAD_EVERY_MAX: 12,
  // Bonus cross: one appears on the wall on its own after BONUS_EVERY seconds of play
  // (a random time in that range), at least BONUS_LEAD_SECONDS of flight ahead. Rare by intent:
  // a surprise, not a way to live without fighting.
  BONUS_EVERY: [80, 130] as readonly [number, number],
  BONUS_LEAD_SECONDS: 3,
  COUNT: 3,           // pool size: crosses the wall can hold at once
  FULL_SCORE: 750,    // points for a cross caught at full lives (x the level multiplier)
  CHARGE: 20,         // weapon charge a caught cross returns
  GROW_TIME: 0.35,    // a dropped cross grows in over this long, like a shard
  SCALE: 1.4,         // size of the whole-life cross (the life shard is the same cross at LIFE_SHARD.SCALE)
  // A halo ring around the whole-life cross, so it is told apart from a shard at a
  // glance: inner and outer radius in arm lengths, and how far it breathes in and out.
  RING: { INNER: 1.5, OUTER: 1.75, PULSE_AMP: 0.14, LINE_WIDTH: 3.2 },
  ARM: 0.85,          // half-length of each cross arm (world units)
  THICK: 0.30,        // half-thickness of the arm bars
  DEPTH: 0.30,        // half-depth along z (a chunky 3D cross, not a flat sign)
  EDGE_THRESHOLD: 1,  // EdgesGeometry threshold (deg): keeps the full plus outline, drops flat-face triangulation
  LINE_WIDTH: 2.6,    // edge line width in px (a touch fatter than orbs/gems so it pops)
  EDGE_RGB: [0.35, 4.20, 0.90] as [number, number, number], // bright HDR green: near-white core blooms green, far brighter than the dim tube green
  FILL_RGB: [0.01, 0.06, 0.02] as [number, number, number],  // near-black green, dark enough to occlude
  SPIN_SPEED: 1.4,    // rad/s about vertical (livelier than the orb, to catch the eye)
  BOB_AMP: 0.12,
  BOB_SPEED: 2.2,
  PULSE_SPEED: 4.0,   // throb rad/s (a beckoning pulse)
  PULSE_AMP: 0.10,    // +/- scale breathing (more than the mine: eye-catching)

  RECYCLE_BEHIND: 22, // recycle once it is this far behind the ship
  CAPTURE_Z: 2.6,     // generous ride-into window (a rare reward should be easy to grab once reached)
  CAPTURE_ANGLE: 0.46,// angular catch window (rad)
  POP_TIME: 0.22,     // collect pop duration (s)
  POP_SCALE: 2.2,     // collect pop peak scale
  // where a bonus cross appears, as an angle-from-bottom bias (deg): mid-wall, so you swing up for it
  SPAWN_ANGLE: { band: [30, 110] as [number, number], bias: 0.75, rest: [0, 180] as [number, number] },
}

// --- life shard (a small green cross left behind by a killed raider) ---------
// A killed raider leaves a shard on the wall where it died: the extra-life cross at
// SCALE. It is caught by riding into it; a missed shard is gone. A full set of caught
// shards restores one whole life (lives are never fractional), and progress is kept
// when a life is lost. A caught shard also returns CHARGE to the weapon; at full
// lives it pays FULL_SCORE instead of progress.
// The set grows with the tuning level T: PER_LIFE + PER_LIFE_STEP * max(0, T -
// PER_LIFE_HOLD), rounded, at most PER_LIFE_MAX (levels.ts shardsPerLife; a set
// already started keeps its size). Deeper levels bring more kills per minute, so a
// fixed set would make a skilled player immortal there while staying out of reach
// for an ordinary player early on.
export const LIFE_SHARD = {
  PER_LIFE: 4,        // shards per life at tuning level 0
  PER_LIFE_HOLD: 2,   // tuning levels that keep the base set before it grows
  PER_LIFE_STEP: 1.5, // extra shards per tuning level past the hold
  PER_LIFE_MAX: 20,   // the set never grows past this, so one catch stays a visible step of the bar
  SCALE: 0.6,         // size of a shard: the extra-life cross geometry at this scale
  COUNT: 8,           // pool size; a kill with the pool empty drops nothing
  LEAD_SECONDS: 1.2,  // a shard never appears closer than this much flight time ahead, so there is time to swing back for it
  FULL_SCORE: 110,    // points for a shard caught at full lives (x the level multiplier)
  CHARGE: 6,          // weapon charge a caught shard returns (an orb gives ENERGY.PER_ORB)
  CAPTURE_Z: 2.6,     // ride-into window along the tube (as generous as the extra life)
  CAPTURE_ANGLE: 0.60,// angular catch window (rad): wide, because a shard is chased right after a dodge
  RECYCLE_BEHIND: 22,
  POP_TIME: 0.22,
  POP_SCALE: 2.2,
  GROW_TIME: 0.35,    // a dropped shard grows in over this long (with a small overshoot), so it is seen leaving the kill burst
}

// --- field spawn de-confliction (cross-kind minimum separation) --------------
// A random field spawns independently of the other kinds, so two kinds could land at
// nearly the same (z, theta), where the player cannot read them apart. Every
// random (re)spawn checks the OTHER fields' objects against this window: it resamples
// its angle up to TRIES times (keeping the field's own z rhythm), then nudges forward
// as a last resort. Raiders are excluded: they fly and strafe, so a static spawn
// check cannot hold for them.
export const SPAWN_CLEAR = {
  DZ: 12,      // along-tube half-window (u); > the summed capture z of any two kinds
  ANGLE: 0.85, // angular half-window (rad); > the mine's capture cone plus a margin,
               // so an object at the window's edge is safely collectable next to a mine
  TRIES: 6,    // theta resamples, then forward nudges, before accepting the spot
  NUDGE: 14,   // forward push (u) per nudge when every theta try conflicted (> DZ,
               // so one nudge fully clears the conflicting object)
}

// --- gem lines (gems and mines placed as flyable phrases) --------------------
// A director (world/sequencer.ts) fills the gem and mine pools with short phrases
// from world/phrases.ts: a gem phrase follows the path a scripted swing takes (the
// "ghost"), a mine phrase keeps a clear line marked by gems. Orbs stay a random
// field; life shards and the squad cross are left by killed raiders, and the bonus cross
// appears on its own.
export const SEQUENCE = {
  HORIZON: 280,                       // units planned ahead of the craft (past the visible rings,
                                      // and shorter than a slow section)
  FIRST_AT: 70,                       // distance of the first phrase of a run (an arc)
  WARMUP_PHRASES: 3,                  // the first phrases of a run carry no mines
  GAP: [1.1, 0.7] as readonly [number, number], // least s of rest between phrases at tuning level 0 and at GAP_FULL_T
  GAP_FULL_T: 12,
  BOUNDARY_CLEAR: [2.0, 1.0, 1.0] as readonly [number, number, number], // s without a phrase after a boundary, per tier entered
  GEMS_PER_CYCLE: 32,                 // gems every cycle offers at least ...
  GEMS_EXTRA_MAX: 8,                  // ... and at most this many more
  // gems scheduled by the end of the slow and of the normal section at most, so each
  // section keeps a share of the cycle's gems
  GEMS_CUMULATIVE_MAX: [12, 23] as readonly [number, number],
  GEMS_CUMULATIVE_MIN: [8, 16] as readonly [number, number], // ... and at least, so the last section is never asked for too many
  MINES_PER_SECTION: [3.6, 2.2, 1.6] as readonly [number, number, number], // slow, normal, fast at tuning level 0 (the director
                                      // lands within one of it, so a fraction shifts which whole counts qualify)
  MINE_CLEAR: HAZARD.CAPTURE_ANGLE + 0.25, // rad a mine keeps from the ghost line and from gems (the hit window plus a margin)
  GEM_EVERY_MIN: 0.25,                // s, closest gem spacing on a path
  SCATTER: {
    GEMS: [2, 3] as readonly [number, number],        // fewest and most gems one scatter holds
    GEM_GAP: [1.2, 1.7] as readonly [number, number],  // s between two gems
    MINE_GAP: [1.0, 1.5] as readonly [number, number], // s between two mines
    MINE_FIRST: [0.3, 0.8] as readonly [number, number], // s into the scatter of its first mine
    MINES_3_FROM: 3,                  // tuning level from which a scatter may hold three mines
    GEM_DEG: [55, 145] as readonly [number, number],   // gem angle from the bottom (either side)
    GEM_REACH: 2.0,                   // rad: most a gem sits from the one before it
    MINE_DEG: [0, 80] as readonly [number, number],    // mine angle from the bottom (either side)
    NEAR: 0.6,                        // s: a mine keeps MINE_CLEAR from every gem this close in time
  },
}

// --- weapon charge (HUD bar shown as WEAPON; blue orbs refill it) ------------
// The gun's ammo. Spent ONLY by firing (GUN.COST per shot), refilled by blue orbs
// (PER_ORB), kills (ENEMY.ENERGY_REFUND), shards and crosses. It never ends the run:
// at zero the gun is inert until recharged. The internal name is ENERGY; the
// player-facing label is WEAPON.
export const ENERGY = {
  MAX: 100,
  START: 60,     // part-charged, so the first levels already feel the meter
  PER_ORB: 20,   // charge refilled per collected blue orb
  LOW: 0.28,     // fraction below which the bar turns yellow (low ammo). Below one
                 // shot's worth of charge (GUN.COST/MAX) the bar turns red (empty).
}

// --- feel (feedback cues: sound, tube flash, near misses) -------------------
// Presentation only, except NEAR_MINE_EXTRA / NEAR_THROTTLE, which decide when the
// session reports a mine near miss (an event, never a gameplay effect).
export const FEEL = {
  TUBE_FLASH: { PEAK: 1.2, DECAY: 0.25 }, // tube line brightness boost on a level-up; DECAY = time constant (s)
  LOOP_FLASH: 0.4,     // a loop over the top flashes the tube at this fraction of PEAK
  LOOP_CUE_GAP: 2.0,   // s: a loop gets its sound + flash only this long after the last loop cue (a held spin stays quiet)
  CHAIN_STEPS: 8,      // gem chime climbs this many pentatonic steps along a gem chain, then holds
  NEAR_MINE_EXTRA: 0.45, // rad past HAZARD.CAPTURE_ANGLE that still counts as a near miss
  NEAR_THROTTLE: 0.4,  // s: at most one near-miss cue per this long
  CHARGE_GAIN_MIN: 0.45, // quietest a raider's charge cue plays (its line opposite yours): the tell must still be heard over gunfire
  // Camera shake (render/shake.ts): one trauma value in 0..1 that decays linearly at
  // DECAY per second; the offset scales with trauma squared, so small events stay
  // small. Applied to the view only, never to the craft or the aim.
  SHAKE: { MAX_ROLL_DEG: 3.0, MAX_OFFSET: 0.8, DECAY: 1.6, DAMAGE: 0.6, KILL: 0.2, NEAR: 0.12 },
  // Hit slow-down: on a lost life the game runs at SCALE for HOLD seconds, then eases
  // back to full speed over EASE seconds, so the cause of the hit is visible. Only
  // the browser loop applies it; the headless harness steps the session directly.
  HITSTOP: { SCALE: 0.35, HOLD: 0.18, EASE: 0.35 },
}

// --- HUD ----------------------------------------------------------------------
export const HUD = {
  GEM_PIPS_MAX: 12, // most pips the gem quota row draws; a larger quota fills them in proportion
}

// --- lives (hazards cost a life; brief i-frames after a hit) ----------------
export const LIVES = {
  START: 3,
  INVULN_TIME: 1.6, // seconds of invulnerability after a hit (drives ship flicker)
}

// Score comes only from active play: gem points (TREASURE.SCORE) and kill points
// (ENEMY.SCORE), each multiplied by the level multiplier at award time. There is
// no distance / survival baseline, so passive flying earns nothing and progressing
// (which raises the multiplier) is the only way to score more.

// --- gun (forward weapon: Space fires; each shot spends weapon charge) --------
// At zero charge the trigger dry-clicks until the gun is recharged. A kill scores AND
// refunds charge (see ENEMY), so accurate aggression sustains its own ammo. Bolts
// freeze theta at fire time and travel down -Z along it, so you AIM by lining up the
// pendulum onto a target's theta.
export const GUN = {
  COST: 3,            // weapon charge spent per shot
  COOLDOWN: 0.25,     // seconds between shots (tap or hold)
  BOLT_SPEED: 185,    // player bolt speed down -Z (units/s, ship-relative): fast, so little lead error vs strafing raiders
  BOLT_TTL: 0.7,      // seconds before a player bolt recycles: raiders are fought from
                      // late approach inward, where their tells are readable
  // Two concentric hit windows (rad): a dead-center shot inside HIT_ANGLE_KILL is
  // an instant kill; a looser hit inside HIT_ANGLE only chips 1 (so it takes the
  // full ENEMY.HP). HIT_ANGLE is the window at draw scale 1 and grows with the
  // raider's far scale (RENDER.FAR_SCALE RAIDER_GAIN), so a bolt that crosses the
  // drawn wing always registers; the kill cone has one size at every distance.
  HIT_ANGLE_KILL: 0.14, // inner cone: the fuselage; one shot here kills outright
  HIT_ANGLE: 0.29,    // outer cone: the drawn wing span; a hit here deals 1 damage
  HIT_Z: 3.0,         // along-tube window (units) for a player bolt hit. Tunnel-free while a
                      // bolt moves less than this per substep (BOLT_SPEED / PHYSICS.HZ).
  BULLET_HIT_ANGLE: 0.30, // player dodge window vs an enemy bolt (wider: the hit is lethal)
  BULLET_HIT_Z: 2.5,  // along-tube window where an enemy bolt registers at the ship plane
}

// --- enemy (magenta raider: a forward-swept dart that flies in, strafes, and --
// shoots back). LETHAL: any hit (its bullet OR ramming its hull) costs a life,
// routed through the existing game.hitHazard() (i-frames + one-life-per-step).
// Its OWN worldDistance advances each step (unlike a static wall object), so it
// can fly in -> hold an engagement band ahead of you -> peel off.
export const ENEMY = {
  HP: 2,              // outer-cone hits to kill (a dead-center shot kills outright)
  SCORE: 750,         // points per kill (the highest-value event), x the level multiplier at award time
  ENERGY_REFUND: 4,   // charge returned per kill (clamped at MAX): a clean one-shot kill pays a little
                      // more than GUN.COST and every miss is a loss, so fighting (the way to earn
                      // lives back) does not starve the gun, while hold-and-spray still runs it dry

  // --- waves (the director in world/enemies.ts; sizes come from LEVELS.WAVES) ---
  WAVE: {
    FIRST_DELAY: 6,       // s before the first wave of a run starts
    REINFORCE_DELAY: 1.2, // s between two members of a wave entering (and after a loss)
    TIME: 40,             // s a wave may last; then the survivors leave forward
    FIGHT_MAX: 3,         // raiders in the fight at once; one more (up to the alive cap) enters
                          // only as a relief for a member about to leave ...
    RELIEF_LEAD: 1.4,     // ... this many s before that member's time in the lane is up
    BREATHER: { BASE: 5, MIN: 2.5 }, // quiet s between waves: BASE at no aggression, MIN at full
  },

  // --- spawn / lifecycle ---
  SPAWN_AHEAD: 150,   // units ahead of the ship a raider enters APPROACH (inside the fog)
  SPAWN_JITTER: 12,   // random extra spawn distance
  RECYCLE_BEHIND: 26, // recycle once the enemy z passes this far behind the ship

  // --- formation (a wave arrives as a shape around an anchor angle) ---
  FORM_SEP: 1.1,      // rad between neighbours of a spread formation (side by side)
  PINCER_OFFSET: 1.4, // rad either side of the anchor for the two wings of a pincer
  PINCER_INNER: 0.45, // rad either side for the third / fourth member of a pincer of four
  ANCHOR_TRACK: 0.3,  // rad/s the anchor drifts toward the player (the shape follows loosely)
  ANCHOR_MAX: 1.0,    // rad from the bottom the anchor may sit (no formation on the top wall)
  LANES: [-32, -42.5, -53] as readonly [number, number, number], // depth lanes (ship-relative z): near, middle, far.
                      // Far enough apart that neighbours read as separate ships at separate
                      // depths; the near lane sits just outside FIRE_MIN_AHEAD, as close
                      // (and as large on screen) as a fair tell allows.
  EARLY_LANES: [0, 1] as readonly [number, number], // lane indices of a squad without a hunter (the first levels)
  SEP_MIN: 0.5,       // rad: two engaged raiders closer than this in angle ...
  SEP_DZ: 12,         // ... and this in depth are pushed apart
  SEP_PUSH: 0.8,      // rad/s the higher slot's weave center is pushed away

  // --- engagement (z negative = ahead of the ship) ---
  ENGAGE_Z_FAR: -62,  // APPROACH -> ENGAGE here; the station spring then settles it in its lane
  ENGAGE_BREAK_Z: 8,  // a raider that slipped behind the ship (z > this) falls behind (DEPART)
  ENGAGE_TIME: 18,    // seconds it holds its lane before leaving forward if not killed
  ENGAGE_TIME_JITTER: 2,

  // --- closing speeds (all relative to craft.speed, so correct at any tier speed) ---
  CLOSE_SPEED_DELTA: -42, // APPROACH: slower than you, so the gap closes it into the band
  STATION_SPRING_K: 1.5,  // ENGAGE: speed = craft.speed + k*(z - laneZ), a spring toward its lane
  STATION_SPEED_CLAMP: 18,// ENGAGE: clamp on |speed - craft.speed|
  DEPART_SPEED_DELTA: -22,// DEPART: falls behind and recycles
  EXIT_SPEED_DELTA: 30,   // EXIT: starts leaving forward this much faster than you ...
  EXIT_ACCEL: 40,         // ... and keeps accelerating (u/s^2) into the fog

  // --- strafe (active from APPROACH on; must stay HITTABLE: peak strafe well below PHYSICS.STEER_OMEGA_MAX) ---
  STRAFE_AMP: 0.95,   // theta = thetaCenter + AMP*sin(phase); wide weave so it is never a sitting duck
  STRAFE_W: 3.4,      // strafe phase rad/s
  STRAFE_OMEGA_MAX: 3.2, // hard per-step clamp on strafe angular speed (the hittability guarantee)
  STRAFE_AMP_K: [0.6, 1.0] as readonly [number, number],   // per-raider multiplier range on STRAFE_AMP ...
  STRAFE_W_K: [0.75, 1.05] as readonly [number, number],   // ... and on STRAFE_W, so a squad does not weave as one

  // --- hunter (the squad member that comes for a parked player) ---
  HUNT_TRACK: [2.0, 3.0] as readonly [number, number], // rad/s its center slides toward the player's line (by aggression)
  HUNT_STRAFE_AMP: 0.1,  // it all but stops on that line while it waits to fire
  HUNT_FIRE_ANGLE: 0.28, // it starts its charge only when this close to the player's line (rad): inside
                         // GUN.BULLET_HIT_ANGLE, so a hunter's shot always hits a player who stays put
  HUNT_FLANK: 1.2,       // rad beside the player's line a second hunter takes (it fires when the player comes to it)
  HUNT_GAP_MIN: 1.1,     // rad: a second hunter never slides closer than this to the first

  // --- firing (telegraphed so a lethal shot is always fairly dodgeable) ---
  FIRE_COOLDOWN: 1.15, // seconds between shots, ENGAGE only (tuning level LEVELS.AGGRESSION_FROM)
  FIRE_COOLDOWN_EARLY: 3.0, // ... at tuning level 0: the first squads fire slowly (eases to FIRE_COOLDOWN)
  FIRE_COOLDOWN_DEEP: 0.7, // ... at full aggression (LEVELS.AGGRESSION_*)
  DEEP_COOLDOWN_K: 0.5, // the cooldown is multiplied by 1 .. this as the deep pressure rises (LEVELS.DEEP_*)
  DEEP_STAGGER_K: 0.6,  // FIRE_STAGGER is multiplied by 1 .. this the same way (tells arrive closer together)
  FIRE_STAGGER: 0.35, // minimum s between two charge starts, so tells arrive one at a time
  FIRE_MIN_AHEAD: 31.5, // a charge starts only this far ahead or more, so CHARGE_TIME plus the
                      // bolt's travel at BULLET_SPEED leaves a fair time from tell to arrival
  FIRE_JITTER: 0.4,   // +/- on the cooldown so volleys are not metronomic
  FIRE_SLOTS: 2,      // cap on raiders charging / firing AT ONCE: any number can engage, but
                      // the incoming fire stays a readable rhythm, never a bolt hail
  FIRE_SLOT_RETRY: 0.25, // mean wait (s, +/-50% jitter) before a raider denied a
                      // fire slot re-tries; the jitter keeps a fixed pool order
                      // from always winning the next free slot
  CHARGE_TIME: 0.45,  // nose brightens toward white-hot for this long before each shot (the tell)
  // No firing tell starts from BEFORE seconds ahead of a level gate or of the
  // fast-to-slow boundary until AFTER seconds past it: the speed steps there (and at
  // the gate the level headline shows), so no bolt is in flight through the change (a
  // tell that started earlier still fires). When the hold ends each waiting raider
  // takes RESUME (a random share) of a fresh fire cooldown, so the fire returns one
  // tell at a time, not as a volley.
  HOLD_FIRE: { BEFORE: 1.1, AFTER: 1.5, RESUME: [0.3, 1.0] as readonly [number, number] },
  BULLET_SPEED: 90,   // enemy bolt speed toward +Z (units/s, ship-relative)
  RAM_ANGLE: 0.55,    // ram hit window (rad): the ship's wing half-width + the raider's body
  RAM_Z: 2.8,         // ram hit window (units); mirrors HAZARD.CAPTURE_Z

  // --- look (edge-lit solid like the ship/mine, but NORMAL blend like the mine) ---
  EDGE_RGB: [1.5, 0.1, 1.3] as [number, number, number], // hot magenta-violet (>1 cores bloom; near-zero green)
  FILL_RGB: [0.05, 0.005, 0.05] as [number, number, number], // near-black, faint violet bias (occludes)
  CHARGE_RGB: [2.4, 1.6, 2.4] as [number, number, number], // edge lerps toward this white-hot while charging
  EDGE_THRESHOLD: 22, // EdgesGeometry threshold (deg): keeps wing/fuselage ridges
  LINE_WIDTH: 2.2,    // edge line width in px (wall-object weight; the player ship is heavier)
  SCALE: 0.7,         // overall hull scale (a lean dart, smaller than the player's hull)
  BANK: 0.5,          // roll leaned into the strafe direction (like the ship banks into a steer)
  THROB_SPEED: 3.0,   // idle breathing rad/s
  THROB_AMP: 0.04,    // +/- scale throb
  POP_TIME: 0.28,     // death-burst duration (s)
  POP_SCALE: 3.0,     // death-burst peak scale (expand + fade at the frozen kill z)
}

// --- projectiles (one pooled bolt system; player + enemy bolts, opposite z) --
// Both sides are the same axis-aligned fat-line streak; only the z direction and
// color differ. Fixed pools -> zero per-frame allocation. They ride at the same
// RIDE_RADIUS as everything else so the angle-only hit tests are valid.
export const PROJECTILE = {
  MAX_PLAYER: 8,      // pooled player bolts (GUN.BOLT_TTL / GUN.COOLDOWN live at once, plus margin)
  MAX_ENEMY: 8,       // pooled enemy bolts
  LENGTH: 1.6,        // streak length along the tube axis (world units)
  LINE_WIDTH: 3.0,    // fat-line width in px (fatter than hulls so bolts pop)
  PLAYER_RGB: [0.55, 2.0, 1.1] as [number, number, number], // hot white-green (yours; SHIP hue family)
  ENEMY_RGB: [2.0, 0.15, 1.6] as [number, number, number],  // white-hot magenta (theirs)
}

// --- burst (impact effect: white-hot flash + glowing shards) ----------------
// A pooled shard-burst played on a REAL hit (see world/burst.ts) so the player SEES
// the impact, not just hears it. TWO kinds; both start white-hot (FLASH_RGB blooms
// hard at BLOOM_THRESHOLD 0 = the flash) then resolve to the kind color and fade.
//   'kill'   - a raider destroyed: magenta, frozen at spawn z (stays framed), and
//              distance-compensated to a constant screen size (near/far kills bloom alike).
//   'damage' - a life lost (mine / ram / enemy bolt): a big, bright, SHORT red flash,
//              WORLD-ANCHORED so it stays put in space and recedes as the craft flies
//              forward (not hanging in front of it); NOT distance-compensated, so it reads
//              big right at the ship. The craft hull also flashes red on the same hit
//              (RENDER.SHIP_HIT_FLASH_RGB).
export const BURST = {
  POOL: 14,           // max concurrent bursts (kills + damage rarely overlap this much; excess drop)
  SHARDS: 13,         // line shards per burst (odd count avoids an obviously symmetric look)
  FLASH_RGB: [4.0, 4.0, 4.0] as [number, number, number], // white-hot start (both kinds); blooms hard = the flash
  FLASH_FRACTION: 0.4,// shards stay white-hot then resolve to the kind color by this fraction of life.
                      // Decoupled from the (slower) opacity fade so the hue is visible WHILE the shard is
                      // bright - the core clamps to white under NoToneMapping, so a hue tied to the fade
                      // only shows once nearly faded (see burst.ts).

  // KILL burst (raider destroyed)
  KILL_RGB: [3.2, 0.2, 2.8] as [number, number, number], // hot magenta (keyed to the enemy hue)
  SPREAD: 3.0,        // peak shard-tip radius for kills at/beyond REF_DIST. CLOSER kills scale DOWN
                      // proportionally so they keep a glowing-flash screen size instead of blowing up into
                      // big bare lines (bloom is a fixed screen-space size: a large on-screen burst gets only
                      // a thin glow rim while a small one is swallowed = flash).
  REF_DIST: 40,       // camera distance (world u) at/beyond which full SPREAD applies (about the
                      // engagement band); a closer kill shrinks toward it.
  DURATION: 0.34,     // kill flash-to-gone (s)
  LINE_WIDTH: 3.0,    // kill shard width in px (matches the bold bolt weight)

  // DAMAGE burst (life lost: mine / ram / enemy bolt) - see the header note
  DAMAGE_RGB: [6.0, 0.3, 0.1] as [number, number, number], // bright red (the mine's hue, brighter for a strong bloom)
  DAMAGE_SPREAD: 3.4, // peak shard-tip radius; NOT distance-compensated, so it engulfs the mine at the ship
  DAMAGE_DURATION: 0.2, // short + punchy: it recedes fast and must not linger in front of the craft
  DAMAGE_LINE_WIDTH: 6.0, // fat shards = more bright pixels = more bloom glow at close range
}

// --- input key bindings (KeyboardEvent.code) --------------------------------
export const INPUT = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  menuUp: ['ArrowUp', 'KeyW'],   // title menu: move between the SHIP / DIFFICULTY rows
  menuDown: ['ArrowDown', 'KeyS'],
  fire: ['Space'],                    // forward gun
  start: ['Space', 'Enter'],          // title screen only: begin the first run
  confirm: ['Enter'],                 // Enter: game-over -> title, and resume-from-pause.
                                      // NOT Space, so a fire key still held when the last
                                      // life is lost cannot dismiss the screen by accident.
  mute: ['KeyM'],                     // toggle MUSIC on/off (SFX keep playing; handled in main.ts)
  pause: ['Escape'],                  // pause a live run, or resume a paused one (handled in main.ts)
  modeCycle: ['KeyG'],                // cycle flight mode for testing (handled in main.ts)
  perf: ['KeyP'],                     // toggle the FPS / frame-time overlay (handled in main.ts)
}

// --- audio: mp3 music + sfx (Web Audio) -------------------------------------
// Files live in public/audio/ and are copied verbatim into dist/ (Vite). Paths
// are RELATIVE (no leading slash) so they resolve under base './' on the dev
// server, npm run preview, and a GitHub Pages subpath alike. SFX are fetched +
// decoded once into AudioBuffers (low latency, freely overlapping); music is a
// looping <audio> element streamed through the context. A missing/undecodable
// file is logged and skipped - it never breaks the run. Volumes are 0..1.
//
// An SFX entry is either FILE-backed (`src`: fetched + decoded once) or SYNTH
// (`synth`: generated procedurally in audio.ts, no asset). Synth cues keep the
// offline build self-contained and fit the vector look - see audio.ts SYNTHS.
export const AUDIO = {
  MASTER_VOLUME: 0.9,
  MUSIC_VOLUME: 0.35,
  SFX_VOLUME: 0.85,
  MUTE_RAMP: 0.05,     // seconds to ramp the music gain on the M mute toggle
  // Looping music tracks. 'menu' plays on the title + game-over screens, 'play'
  // during a run. playMusic(name) switches; only one track sounds at a time.
  MUSIC: {
    menu: 'audio/menu.mp3',
    play: 'audio/music.mp3',
  },
  // accelerate: a short one-shot layered ON TOP of the music whenever the flight
  // tier steps up (target speed increases). Plays SECONDS then fades out, and
  // ducks the music to DUCK of its volume meanwhile so the sting cuts through.
  ACCEL: { SRC: 'audio/accelerate.mp3', VOLUME: 1.6, SECONDS: 3, FADE: 0.4, DUCK: 0.4 },
  // key = event name used in main.ts: audio.play('shoot') etc. `src` = file,
  // `synth` = procedural generator id (audio.ts SYNTHS). Same name space either way.
  SFX: {
    shoot:     { src: 'audio/shoot.mp3', volume: 0.55 },
    orb:       { src: 'audio/orb.mp3',   volume: 0.8 },
    gem:       { synth: 'gem',       volume: 0.8 },  // bright two-note chime
    enemyFire: { synth: 'enemyFire', volume: 0.4 },  // short saw "pew"
    kill:      { synth: 'kill',      volume: 0.8 },  // descending square zap
    empty:     { synth: 'empty',     volume: 0.5 },  // dull dry-fire click (no charge to fire)
    life:      { synth: 'life',      volume: 0.95 }, // ascending 1-up arpeggio (extra life gained)
    shard:     { synth: 'shard',     volume: 0.85 }, // one rising pair of the 1-up arpeggio per caught life shard
    hit:       { synth: 'hit',       volume: 1.8 },  // explosion (big + loud - a life lost should land like a bomb)
    gameover:  { synth: 'gameover',  volume: 0.85 }, // slow descending tone
    gateOpen:  { synth: 'gateOpen',  volume: 0.75 }, // gem quota met, the level gate is ahead: three rising blips
    levelup:   { synth: 'levelup',   volume: 0.9 },  // level up fanfare (square + triangle, held last note)
    charge:    { synth: 'charge',    volume: 0.5 },  // a raider's firing tell (panned; audible under gunfire, softer than the shot)
    chip:      { synth: 'chip',      volume: 0.5 },  // a hit that did not kill the raider
    loop:      { synth: 'loop',      volume: 1.1 },  // a loop over the top
    whoosh:    { synth: 'whoosh',    volume: 0.6 },  // a mine near miss (panned)
    waveClear: { synth: 'waveClear', volume: 0.6 },  // a raider wave cleared
    cross:     { synth: 'cross',     volume: 0.8 },  // a whole-life cross appeared ahead (panned)
  },
}

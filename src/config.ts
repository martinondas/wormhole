// ============================================================================
// config.ts - ALL tunable constants live here, grouped. Tweak freely.
// Values are starting points chosen for feel; expect to adjust constantly.
// Live handle in the browser console: window.WH (see main.ts).
// ============================================================================

// --- physics: the damped, driven pendulum (the heart of the game) -----------
// theta = angle around the tube cross-section, 0 = bottom. Unbounded (can loop).
export const PHYSICS = {
  HZ: 120,            // fixed physics substeps per second. 120 keeps the swing
                      // smooth and bolt hits tunnel-free (see GUN.HIT_Z), while
                      // halving per-frame substeps + the slow-frame spiral on
                      // weaker GPUs vs the old 240 (one missed frame -> 2 extra
                      // substeps here, not 4).
  GRAVITY_K: 11.0,    // restoring strength: angAccel includes -K*sin(theta).
                      // higher = snappier swing + harder to loop over the top.
                      // (loop needs omega_bottom > ~2*sqrt(K) = ~6.6 here)
  DAMPING_C: 1.3,     // damping on omega: overshoots then settles. Higher = the
                      // craft stabilizes at the bottom sooner (fewer left-rights)
  STEER_TORQUE: 24,   // angular accel added by full steering input (rad/s^2). Higher =
                      // quicker direction change / less sluggish, especially at high
                      // speed where gravity is lightest and torque is most of the agility.
  STEER_OMEGA_MAX: 7.0,// soft cap: steering torque fades to zero as |omega| nears
                      // this, so holding a steer does not spin you up forever.
                      // Gravity can still exceed it on a dive (momentum survives).
  STEER_ATTACK: 0.04, // seconds for steer signal to ramp up (low = crisp direction changes)
  STEER_RELEASE: 0.13,// seconds for steer signal to ramp back to zero
}

// --- climb: steering can weaken high on the wall (switched off) ----------------
// FADE is the share of the upward steering torque removed above START, complete at END
// (UP_SOFT blends it out at the top). It is 0: one held key carries the craft over the
// top in every tier. A fade of 0.9 made every crossing of the top in normal and fast
// sections two to three times slower (`npm run sim:swing -- --fade 0.9`); revisit only
// if looping in slow sections proves too easy. Applied in craft.ts stepSwing.
export const CLIMB = {
  FADE: 0,       // share of the upward steering torque removed at END and above (0 = off)
  START: 1.57,   // rad from the bottom where the fade begins (the horizontal)
  END: 2.3,      // rad from the bottom where the fade is complete
  UP_SOFT: 0.7,  // |sin(theta)| below which the fade blends out toward the top
}

// --- flight mode (experimental: speed tier -> gravity + tube color) ----------
// Speed is the single driver: the mode (or the current section) picks a target
// speed tier, the craft eases to it, and gravity is tied to speed (full at SLOW,
// fading to GRAVITY_FLOOR at FAST - see flight.ts). The three fixed tiers map to colors:
//   slow   = yellow, full gravity  (heaviest)
//   normal = green,  mid gravity   (startup)
//   fast   = blue,   floor gravity (lightest, still a pendulum)
// 'sections' cycles the tiers along the tube. Cycle live with the mode key (see
// INPUT.modeCycle) or set WH.flight.mode. The tube color follows speed, so it
// blends smoothly through the tiers as the craft eases between sections.
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
  // pull even in fast sections (never a free rotor); CURVE shapes the middle tier:
  // 1 = linear, >1 lighter mid, <1 heavier mid. Applied in flight.ts gravityForSpeed.
  // With FLOOR 0.45: slow 1.0, normal ~0.73 (was ~0.51), fast 0.45 (was 0).
  GRAVITY_FLOOR: 0.45, // fraction of GRAVITY_K that remains at the fast tier speed
  GRAVITY_CURVE: 1.0,  // exponent shaping the fade between the tiers (1 = linear)
}

// --- speed: forward motion. Set by the flight mode / section, not the player. -
// Units are world units per second (tube radius ~ 6, ring spacing ~ 7). Three
// tiers; gravity is tied to speed (faster = lighter, see flight.ts), so the tier
// chosen by the mode/section sets the whole feel. Never halts (SLOW > 0). The
// craft eases toward the active tier's speed at EASE.
export const SPEED = {
  SLOW: 30,   // yellow sections: full gravity, heaviest swing (level 1 base)
  NORMAL: 52, // green sections: mid gravity (startup speed; midpoint of slow..fast)
  FAST: 75,   // blue sections: floor gravity, most agile (level 1 base)
  EASE: 28,   // accel/decel toward the active tier's speed (units/s^2)
}

// --- levels (gem-gated difficulty ramp; one level = one slow->normal->fast cycle).
// A cycle is TIERS x FLIGHT.SECTION_SECONDS in time (3 x 10 = 30s by default - not
// hard-coded: change SECTION_SECONDS or the tier set and it follows). A LEVEL is
// gem-gated: it advances at a cycle boundary only once GEM_QUOTA_FRACTION of the
// cycle's gems are collected, else the same cycle repeats - so a level lasts one
// cycle if you meet the quota and longer if you fall short (see flight.ts). Each
// level above 1 shifts every tier speed up by a per-level speed bonus (decaying but
// never zero, see SPEED_STEP/SPEED_BAND) and raises the score multiplier. Per-level
// enemy cap + orb/bomb frequency come from TABLE (level 1 = index 0); beyond the
// table the enemy cap keeps ramping and the mine multiplier keeps tightening (to a
// floor); orb frequency is flat across levels (rising speed already makes orbs harder
// to catch, so they do not also need to thin out).
// Levels only progress in FLIGHT.MODE 'sections' (the game); pinned slow/normal/fast
// modes (G key) stay at level 1 with no gate.
export const LEVELS = {
  // Per-level speed bonus added to EVERY tier. A DECAYING-but-never-zero increment
  // in three bands (by display level), so early levels keep the original +5/level
  // while deep levels still speed up, ever more slowly - it never plateaus. Derived
  // in flight.ts (speedBonus). Bands: L1-10 use EARLY, L11-15 use MID, L16+ use LATE.
  //   fast tier (base 75): L10 -> 120, L15 -> 135, L17 -> 138, L20 -> 142.5, L30 -> 157.5
  // (was a flat +5/level: L17 -> 155, L30 -> 220 - far too fast deep).
  SPEED_STEP: { EARLY: 5, MID: 3, LATE: 1.5 },    // u/s added per level in each band
  SPEED_BAND: { EARLY_UNTIL: 10, MID_UNTIL: 15 }, // display level the EARLY / MID band ends at
  SCORE_MULT_STEP: 0.5, // score multiplier = 1 + (level-1) * this (L1 x1.0, L2 x1.5, L3 x2.0 ...)
                        // scales gem + kill points (the whole score; there is no distance term)
  // Gem gate: a level advances only when you have collected the level's gem quota,
  // quota = round(SEQUENCE.GEMS_PER_CYCLE * fraction), with the fraction starting at
  // GEM_QUOTA_FRACTION and rising by QUOTA_FRACTION_STEP per tuning level up to
  // QUOTA_FRACTION_MAX (flight.gemQuota). Fall short at the cycle boundary and the
  // level repeats (same speeds/colors) until you qualify. On ORION the quota is 15
  // gems at level 1, 19 at level 2, 23 at level 3 and 27 from level 4, of the 32 to
  // 40 (about 36) a cycle offers: the first levels pass with half of the gems, from
  // level 4 on a level asks for three of every four. The quota always stays 5 gems
  // under the fewest a cycle offers, so a player who collects nearly everything never
  // repeats a level. A difficulty mode may cap the fraction lower (DIFFICULTY quotaMax).
  // With random gem fields (SEQUENCE.ENABLED false) the quota is GEM_QUOTA_FRACTION of
  // the gems one cycle's length holds (cycleLen / TREASURE.SPAWN_SPACING).
  GEM_QUOTA_FRACTION: 0.48,
  QUOTA_FRACTION_STEP: 0.12,
  QUOTA_FRACTION_MAX: 0.85,
  // Gravity across levels (the slow->fast fade itself is shaped by
  // FLIGHT.GRAVITY_FLOOR / GRAVITY_CURVE; this picks the reference span):
  //   'tier'     - full gravity at the level's OWN slow speed, the floor at its
  //                own fast speed: each section keeps its feel as speeds climb (the
  //                slow section stays heavy at level 10). The agreed default.
  //   'absolute' - the original model: full at SPEED.SLOW, the floor at SPEED.FAST.
  //                As levels speed up, every section gets lighter, and once a
  //                level's OWN slow speed reaches SPEED.FAST (level 9 with
  //                SLOW=30, INCREMENT=5) gravity is pinned to the FLOOR for all
  //                tiers. Flip here if high-level slow sections feel too sluggish;
  //                accept that deep levels flatten toward one gravity.
  GRAVITY_MODE: 'tier' as 'tier' | 'absolute',
  MAX_ENEMIES_CAP: 4,       // most raiders ever alive at once (sizes the pool once)
  // Raider waves by tuning level T (flight.tuned, rounded; ORION display level is T + 1),
  // read through levels.ts. roster = raiders in one wave, cap = alive at once, hunters =
  // members that slide to the player's line and fire aimed shots. Past the last row the
  // roster grows by 1 every WAVE_ROSTER_EVERY levels up to WAVE_ROSTER_MAX, the cap is
  // MAX_ENEMIES_CAP from WAVE_CAP4_FROM and there are two hunters from WAVE_HUNTERS2_FROM.
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
  // Deep pressure 0..1 = clamp((T - DEEP_FROM) / DEEP_SPAN, 0, 1): a second ramp that
  // starts where the wave table ends (ORION level 9) and is full at ORION level 16. It
  // scales the fire cooldown by up to ENEMY.DEEP_COOLDOWN_K and the fire stagger by up
  // to ENEMY.DEEP_STAGGER_K, so the levels past 9 keep getting harder for a skilled
  // player while the levels before stay as they are.
  DEEP_FROM: 8,
  DEEP_SPAN: 7,
  // Mines keep getting denser past the table down to a floor (they are the SECONDARY
  // threat, so they level off where enemies carry the deep difficulty). bombMult in
  // levels.ts subtracts BOMB_MULT_STEP per level past the last TABLE row, clamped at
  // BOMB_MULT_FLOOR (0.6 = two thirds more mines per second than level 1, reached at
  // tuning level 8). The gem-line director divides its per-section mine budget by it.
  BOMB_MULT_STEP: 0.02,     // mine multiplier tightening per level past the table
  BOMB_MULT_FLOOR: 0.6,     // densest mines ever reach (playability floor)
  // Per-level tuning. orb/bombSpacingMult are ENCOUNTER-RATE multipliers vs level 1
  // (speed-normalized in levels.ts, so they hold their meaning as the tube speeds up):
  // >1 = rarer per second, <1 = denser per second.
  // orbSpacingMult is flat 1.0 (rising speed already makes orbs harder to catch);
  // bombSpacingMult barely moves over levels 1 to 3 (the warm-up and the level the
  // hunter arrives at), steps down at level 4, then keeps tightening via bombMult.
  TABLE: [
    { orbSpacingMult: 1.0, bombSpacingMult: 1.0 },  // L1
    { orbSpacingMult: 1.0, bombSpacingMult: 0.95 }, // L2
    { orbSpacingMult: 1.0, bombSpacingMult: 0.85 }, // L3
    { orbSpacingMult: 1.0, bombSpacingMult: 0.72 }, // L4
    { orbSpacingMult: 1.0, bombSpacingMult: 0.66 }, // L5
  ],
}

// --- difficulty (title-screen selector; maps the played level to a tuning level) --
// One mapping covers everything: tuningLevel = OFFSET + SLOPE * level (0-based),
// applied inside flight.ts (tierSpeed / score multiplier / gem quota) and levels.ts
// (enemy cap, mine density) - so a mode never needs its own tables. MILKY WAY ramps
// at 40% of the normal rate (its display L5 plays like ORION L2.6, its L10 like
// ORION L4.6); ORION is the unmodified game; QUASAR starts around ORION L3.5 and
// ramps at the full rate. The score multiplier follows the tuning level, so a
// harder mode pays more per gem/kill and the single shared best score stays honest.
// Each mode carries its threat COLOR (the intuitive difficulty signal, reused by
// the title selector and the HUD readout): the HUD's own green -> the low-ammo
// amber -> the danger red. The threat pips (filled triangles, index+1 of 3) render
// in hud.ts from the mode index.
// `ease` multiplies the raider fire cooldown and the breather between waves and
// divides the mine budget of the gem lines, so a mode can be gentler from level 1,
// where the level mapping alone changes nothing. MILKY WAY is the mode for children:
// raiders fire less than half as often and a section holds less than half the mines.
// `quotaMax` caps the gem-quota fraction of the mode (1 = only LEVELS.QUOTA_FRACTION_MAX
// applies): MILKY WAY never asks for more than 22 of a cycle's gems.
export const DIFFICULTY = {
  MODES: [
    { name: 'MILKY WAY', slope: 0.4, offset: 0, ease: 2.2, quotaMax: 0.7, color: '#7dffa6' },
    { name: 'ORION', slope: 1.0, offset: 0, ease: 1.0, quotaMax: 1, color: '#ffd24d' },
    { name: 'QUASAR', slope: 1.0, offset: 2.5, ease: 1.0, quotaMax: 1, color: '#ff5a5a' },
  ],
  DEFAULT: 1, // ORION (the game exactly as tuned so far)
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
  // Selectable hulls (title-screen menu; world/ship.ts builds the geometry per id).
  // COSMETIC ONLY: every hull flies identically and shares the exact same hit
  // windows (those are the global CAPTURE_*/RAM_*/BULLET_* constants), so the
  // choice is a look, never an advantage. Keep new silhouettes near the same
  // footprint as the raptor so the identical hitbox also LOOKS believable.
  HULLS: [
    { id: 'raptor', name: 'RAPTOR' },   // the original X-wing-ish winged fighter
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
  // Integrated-GPU fallback, auto-selected in scene.ts (pickRenderTier) for an
  // integrated GPU (Intel, an AMD APU's "Radeon Graphics", or mobile): the full-res
  // MSAA resolve + bloom fill is the dominant cost there, so render a bit smaller with
  // lighter MSAA. Discrete GPUs (incl. the iMac's "Radeon Pro") keep the values above.
  // Tune on the target machine (P overlay); MSAA_SAMPLES_LOW can drop to 0 if still
  // GPU-bound (bloom hides most line shimmer).
  RENDER_SCALE_LOW: 0.72,
  MSAA_SAMPLES_LOW: 2,

  // Far-object readability (visual only): wall objects and raiders are drawn larger
  // the farther ahead they are, from 1x at NEAR to 1 + gain at FAR and beyond, so a
  // gem line or a raider reads as a shape well before contact instead of a speck.
  // GAIN is for wall objects: at 1.5x they stay separate shapes at the far end of the
  // tube (at 2x mines and gems merged into one blob there). RAIDER_GAIN is larger, so
  // a raider at its firing lane (32 to 53 units) is drawn 1.2x to 1.4x and its firing
  // tell stands out from the wall objects. With a gain below (FAR - NEAR) / NEAR the
  // on-screen size still grows all the way in, so the depth cue never runs backwards.
  // Hit tests are angle-only and do not change.
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
  STARS: 330,         // world-space star count (these now mostly land on screen)
  STAR_ALPHA: 0.7,    // max star brightness
  STAR_SPREAD_DEG: 52, // half-angle of the forward cone stars are placed in
                       // (wider than the FOV so banking never reveals an edge)
}

// --- pickups (blue health orbs, Descent-balloon flavour) --------------------
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
  // Blue orbs recharge the weapon (ammo), so they are deliberately sparse: you
  // cannot top up fast enough to fire continuously without pause. Density is set
  // by SPACING (encounter rate = speed / spacing); COUNT just keeps the visible
  // range filled so they fade in from the far fog rather than popping. SPACING is
  // a starting point - tune against how combat-heavy the levels feel in playtest.
  COUNT: 5,           // orbs alive in the pool at once
  SPAWN_START: 50,    // distance ahead of the first orb
  SPAWN_SPACING: 240, // nominal distance between orbs (encounter rate = speed / spacing)
  SPAWN_JITTER: 14,   // random extra distance per orb
  RECYCLE_BEHIND: 22, // recycle once an orb is this far behind the ship
  CAPTURE_Z: 2.4,     // along-tube window (units) for a catch
  CAPTURE_ANGLE: 0.42,// angular window (rad) for a catch (~24 deg)
  POP_TIME: 0.18,     // collect pop duration (s)
  POP_SCALE: 1.8,     // collect pop peak scale (expand-and-fade)
  // angle-from-bottom bias (deg; 0=bottom, 180=top). Favor mid-wall so the
  // player has to swing up for energy rather than scoop it off the floor.
  SPAWN_ANGLE: { band: [40, 90] as [number, number], bias: 0.8, rest: [0, 180] as [number, number] },
}

// --- treasure (gold brilliant-cut gem; ride-into = score) -------------------
// Visual: a custom diamond (flat table on top, a crown widening to the waist,
// then a long pavilion to a point), edge-lit gold over a near-black warm fill.
// NORMAL blend (depthTest), like the orb and unlike the ship: additive HDR gold
// would bloom toward white and lose the hue separation from the blue orb. Spins
// ~3x the orb so facets flash.
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
  SPIN_SPEED: 2.4,     // rad/s about vertical: ~3x the orb (eye-catching flash)
  BOB_AMP: 0.10,
  BOB_SPEED: 2.0,

  // --- field / spawn ---
  // With gem lines (SEQUENCE.ENABLED) the pool is fed by the director and COUNT is
  // sized for its planning horizon; the SPAWN_* values and RANDOM_COUNT describe the
  // random field used when gem lines are off.
  COUNT: 24,
  RANDOM_COUNT: 4,
  SPAWN_START: 85,
  SPAWN_SPACING: 120,
  SPAWN_JITTER: 22,
  RECYCLE_BEHIND: 22,
  CAPTURE_Z: 2.4,      // generous ride-into (like the orb)
  CAPTURE_ANGLE: 0.40,
  POP_TIME: 0.18,
  POP_SCALE: 1.8,
  SCORE: 110,          // points per gem -> game.addScore (multiplied by the level multiplier at award time).
                       // A cycle offers about 36 gems, so a fully collected cycle pays about 3900.
}

// --- hazard (red naval contact mine: a big ball with cylindrical Hertz horns;
// AVOID, a hit costs a life). The ONLY red object on the tube. Edge-lit solid like
// the ship, but NORMAL blend like the orb (additive HDR red would bloom toward
// white/pink). The dominant central ball + straight rod horns read as a real sea
// mine, not a spiky virus: the horns are uniform cylinders (slight taper), not
// pointed cones, and have no bulb tips.
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
  SPIN_SPEED: 0.55,    // rad/s, slow + menacing (slower than the orb's 0.8)
  PULSE_SPEED: 3.4,    // throb rad/s
  PULSE_AMP: 0.05,     // +/- 5% scale breathing

  // --- field / spawn ---
  // With gem lines (SEQUENCE.ENABLED) the pool is fed by the director and COUNT is
  // sized for its planning horizon; the SPAWN_* values, SLOW_DENSITY, SPAWN_ANGLE and
  // RANDOM_COUNT describe the random field used when gem lines are off.
  COUNT: 12,
  RANDOM_COUNT: 5,
  SPAWN_START: 120,
  SPAWN_SPACING: 114,  // nominal distance between mines (was 125: ~10% denser overall baseline)
  SPAWN_JITTER: 30,
  RECYCLE_BEHIND: 22,
  // Slow (yellow, full-gravity) sections spawn 30% more mines: their spacing is
  // scaled by 1/SLOW_DENSITY. Wired in main.ts via the flight tier (so it tracks
  // 'sections' cycling and a pinned 'slow' mode alike). 1 = uniform everywhere.
  SLOW_DENSITY: 1.3,
  // The hit test compares the ship CENTER to the mine center, but the ship's
  // wings span ~0.5 rad and the mine's spikes ~0.4 rad - so the window must
  // absorb the ship's wingspan + the spikes, or a banked wing can overlap a
  // spike with no hit. These cover that overlap. Widen if grazes should count;
  // tighten if too punishing.
  CAPTURE_Z: 2.8,      // ship half-length (~1.5) + mine half-extent (~2.0) overlap
  CAPTURE_ANGLE: 0.62, // ship wing half-width (~0.5) + mine spike reach, roughly
  POP_TIME: 0.10,      // fast + big -> reads as an explosion on a real hit
  POP_SCALE: 2.6,
  // angle-from-bottom bias (deg). Favor the lower half - a mine on the ceiling
  // is no challenge; mines near the bottom force you to swing away to dodge.
  SPAWN_ANGLE: { band: [0, 90] as [number, number], bias: 0.8, rest: [90, 180] as [number, number] },
}

// --- extra life (rare bright-green medkit cross; ride-into = +1 life) --------
// A chunky 3D plus (the universal "health / +1" icon), so it reads instantly and
// is shape-distinct from every other wall object (orb sphere / gem diamond / mine
// ball / raider dart) despite green being the theme color. Edge-lit solid like
// the mine (near-black depth-writing fill under glowing green fat-line edges,
// NORMAL blend - the HDR green core still blooms). Adds a life ONLY when below
// LIVES.START (game.addLife caps at 100%); at full lives it passes through
// untouched (no pop, no sound). Scarce when on: on ORION the first one comes 1.3 to 2.3
// minutes into a run, the next ones about every 3 to 4 minutes.
// ENABLED is off: lives come back only through fighting, so a player who never fights
// earns none. Killed raiders drop life shards (LIFE_SHARD), and the last raider of a
// destroyed squad sometimes drops this cross, a whole life (SQUAD_EVERY). Set ENABLED
// to true for the distance-timed cross field instead of the squad cross.
export const EXTRA_LIFE = {
  ENABLED: false,     // the distance-timed cross field (off: crosses come only from destroyed squads, see SQUAD_EVERY)
  // The last raider of every Nth fully destroyed squad leaves a cross (a whole life) in
  // place of a shard. N grows with the tuning level T (SQUAD_EVERY + SQUAD_EVERY_STEP * T,
  // rounded, at most SQUAD_EVERY_MAX): frequent for a beginner, a rare bonus at depth.
  SQUAD_EVERY: 3,
  SQUAD_EVERY_STEP: 1,
  SQUAD_EVERY_MAX: 12,
  FULL_SCORE: 750,    // points for a cross caught at full lives (x the level multiplier)
  CHARGE: 20,         // weapon charge a caught cross returns (as much as an orb)
  GROW_TIME: 0.35,    // a dropped cross grows in over this long, like a shard
  ARM: 0.85,          // half-length of each cross arm (world units; full span = 1.7)
  THICK: 0.30,        // half-thickness of the arm bars (arm width = 0.6)
  DEPTH: 0.30,        // half-depth along z (a chunky 3D cross, not a flat sign)
  EDGE_THRESHOLD: 1,  // EdgesGeometry threshold (deg): keeps the full plus outline, drops flat-face triangulation
  LINE_WIDTH: 2.6,    // edge line width in px (a touch fatter than orbs/gems so it pops)
  EDGE_RGB: [0.35, 4.20, 0.90] as [number, number, number], // bright HDR green: near-white core blooms green, far brighter than the dim tube green
  FILL_RGB: [0.01, 0.06, 0.02] as [number, number, number],  // near-black green, dark enough to occlude
  SPIN_SPEED: 1.4,    // rad/s about vertical (lively: ~2x the orb, to catch the eye)
  BOB_AMP: 0.12,
  BOB_SPEED: 2.2,
  PULSE_SPEED: 4.0,   // throb rad/s (a beckoning pulse)
  PULSE_AMP: 0.10,    // +/- 10% scale breathing (more than the mine: eye-catching)

  // --- field / spawn (scarce; one in flight, far apart) ---
  COUNT: 1,           // a single cross exists at a time; it recycles far ahead after each encounter
  SPAWN_START: 4500,  // distance ahead of the first cross
  SPAWN_SPACING: 18000,// nominal distance between crosses (3 to 4 minutes apart, sooner at deep levels)
  SPAWN_JITTER: 4000, // random extra distance, so it never feels metronomic
  RECYCLE_BEHIND: 22, // recycle once it is this far behind the ship
  CAPTURE_Z: 2.6,     // generous ride-into window (a rare reward should be easy to grab once reached)
  CAPTURE_ANGLE: 0.46,// angular catch window (rad, ~26 deg)
  POP_TIME: 0.22,     // collect pop duration (s)
  POP_SCALE: 2.2,     // collect pop peak scale
  // angle-from-bottom bias (deg). Mid-wall, so you still have to swing up for it.
  SPAWN_ANGLE: { band: [30, 110] as [number, number], bias: 0.75, rest: [0, 180] as [number, number] },
}

// --- life shard (a small green cross left behind by a killed raider) ---------
// A killed raider leaves a shard on the wall
// where it died: the extra-life cross at SCALE, same green, same spin and pulse.
// It scrolls in like any wall object and is caught by riding into it; a missed
// shard is gone. A full set of caught shards restores one whole life (lives are
// never fractional: a hit always costs a whole one). Progress is kept when a life
// is lost. A caught shard also returns CHARGE to the weapon. At full lives a caught
// shard pays FULL_SCORE instead of progress.
// The set grows with the tuning level T (PER_LIFE + PER_LIFE_STEP * max(0, T - PER_LIFE_HOLD), rounded, at
// most PER_LIFE_MAX; a set already started keeps its size): deeper levels bring more raiders, so more kills per minute,
// and a fixed set would make a skilled player immortal there while staying out of
// reach for an ordinary player early on. Calibrated with the playtest bots.
export const LIFE_SHARD = {
  PER_LIFE: 4,        // shards per life at level 1 (T = 0)
  PER_LIFE_HOLD: 2,   // tuning levels that keep the base set before it grows (ORION: 4 shards on levels 1 to 3)
  PER_LIFE_STEP: 1.5, // extra shards per tuning level past the hold (ORION: 6 at level 4, 10 at level 7, 20 from level 14)
  PER_LIFE_MAX: 20,   // the set never grows past this, so one catch stays a visible step of the bar
  SCALE: 0.6,         // size relative to the extra-life cross
  COUNT: 8,           // pool size; a kill with the pool empty drops nothing
  LEAD_SECONDS: 1.2,  // a shard never appears closer than this much flight time ahead, so there is time to swing back for it
  FULL_SCORE: 110,    // points for a shard caught at full lives (one gem's worth, x the level multiplier)
  CHARGE: 6,          // weapon charge a caught shard returns (two shots; an orb gives ENERGY.PER_ORB)
  CAPTURE_Z: 2.6,     // ride-into window along the tube (as generous as the extra life)
  CAPTURE_ANGLE: 0.60,// angular catch window (rad, ~34 deg): wide, because a shard is chased right after a dodge
  RECYCLE_BEHIND: 22,
  POP_TIME: 0.22,
  POP_SCALE: 2.2,
  GROW_TIME: 0.35,    // a dropped shard grows in over this long (with a small overshoot), so it is seen leaving the kill burst
}

// --- field spawn de-confliction (cross-kind minimum separation) --------------
// The fields spawn independently, so two kinds could land at nearly the same
// (z, theta) - a mine hiding inside a gem reads as a luck death, not a dodge
// failure. Every field (re)spawn checks the OTHER fields' objects against this
// window: it resamples its angle up to TRIES times (keeping the field's own z
// rhythm), then nudges forward as a last resort. Enemies are excluded - they fly
// and strafe, so a static spawn check cannot hold for them.
export const SPAWN_CLEAR = {
  DZ: 12,      // along-tube half-window (u); > the summed capture z of any two kinds
  ANGLE: 0.85, // angular half-window (rad); > the mine's 0.62 capture cone + margin,
               // so an object at the window's edge is safely collectable next to a mine
  TRIES: 6,    // theta resamples, then forward nudges, before accepting the spot
  NUDGE: 14,   // forward push (u) per nudge when every theta try conflicted (> DZ,
               // so one nudge fully clears the conflicting object)
}

// --- gem lines (gems and mines placed as flyable phrases) --------------------
// A director (world/sequencer.ts) fills the gem and mine pools with short phrases
// from world/phrases.ts: a gem phrase follows the path a scripted swing takes (the
// "ghost"), a mine phrase keeps a clear line marked by gems. Orbs and the extra
// life stay random finds. ENABLED false gives random gem and mine fields instead.
export const SEQUENCE = {
  ENABLED: true,
  HORIZON: 280,                       // units planned ahead of the craft (past the visible rings,
                                      // and shorter than a slow section)
  FIRST_AT: 70,                       // distance of the first phrase of a run (an arc)
  WARMUP_PHRASES: 3,                  // the first phrases of a run carry no mines (about its first 9 s)
  GAP: [1.1, 0.7] as readonly number[], // least s of rest between phrases at tuning level 0 and at GAP_FULL_T
  GAP_FULL_T: 12,
  BOUNDARY_CLEAR: [2.0, 1.0, 1.0] as readonly number[], // s without a phrase after a boundary, per tier entered
  GEMS_PER_CYCLE: 32,                 // gems every cycle offers at least ...
  GEMS_EXTRA_MAX: 8,                  // ... and at most this many more
  // gems scheduled by the end of the slow and of the normal section at most, so each
  // section keeps a share of the cycle's gems
  GEMS_CUMULATIVE_MAX: [12, 23] as readonly number[],
  GEMS_CUMULATIVE_MIN: [8, 16] as readonly number[], // ... and at least, so the last section is never asked for too many
  MINES_PER_SECTION: [3.6, 2.2, 1.6] as readonly number[], // slow, normal, fast at tuning level 0 (the director
                                      // lands within one of it, so a fraction shifts which whole counts qualify)
  MINE_CLEAR: HAZARD.CAPTURE_ANGLE + 0.25, // rad a mine keeps from the ghost line and from gems (the hit window plus a margin)
  GEM_EVERY_MIN: 0.25,                // s, closest gem spacing on a path
  SCATTER: {
    GEM_GAP: [1.2, 1.7] as readonly number[],  // s between two gems
    MINE_GAP: [1.0, 1.5] as readonly number[], // s between two mines
    MINE_FIRST: [0.3, 0.8] as readonly number[], // s into the scatter of its first mine
    MINES_3_FROM: 3,                  // tuning level from which a scatter may hold three mines
    GEM_DEG: [55, 145] as readonly number[],   // gem angle from the bottom (either side)
    GEM_REACH: 2.0,                   // rad: most a gem sits from the one before it
    MINE_DEG: [0, 80] as readonly number[],    // mine angle from the bottom (either side)
    NEAR: 0.6,                        // s: a mine keeps MINE_CLEAR from every gem this close in time
  },
}

// --- weapon charge (HUD bar shown as WEAPON; blue orbs refill it) ------------
// The gun's ammo. Spent ONLY by firing (GUN.COST/shot), refilled by blue orbs
// (PER_ORB) and kills (ENEMY.ENERGY_REFUND). It never ends the run: at zero the
// gun is inert (the trigger dry-clicks) until recharged. The ONLY fail condition
// is lives -> 0 (collisions / enemy fire / ram). Kept the name ENERGY internally
// to limit churn; the player-facing label is WEAPON.
export const ENERGY = {
  MAX: 100,
  START: 60,     // start with the weapon part-charged (~20 shots) so early levels feel
                 // the meter; a full 100 made the first minute a free-fire range
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
  GEM_PIPS_MAX: 12, // most pips the gem-gate row draws; a larger quota fills them in proportion
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
// A shot spends weapon charge (the blue HUD bar / "ammo"); at zero charge the gun
// is inert (the trigger dry-clicks) until blue orbs recharge it - running dry is
// NOT a fail condition. A kill scores big AND refunds charge (see ENEMY), so
// accurate aggression sustains its own ammo. Bolts freeze theta at fire time and
// travel down -Z along that theta, so you AIM by lining up the pendulum onto a
// target's theta - aiming reuses the swing.
export const GUN = {
  COST: 3,            // weapon charge spent per shot (~6-7 shots per orb at PER_ORB 20)
  COOLDOWN: 0.25,     // seconds between shots (tap or hold -> ~4/s)
  BOLT_SPEED: 185,    // player bolt speed down -Z (units/s; >> SPEED.FAST so it leads quickly, less lead error vs strafing enemies)
  BOLT_TTL: 0.7,      // seconds before a player bolt recycles (~130u reach): raiders are
                      // fought from late approach inward, where their tells are readable
  // Two concentric hit windows (rad): a dead-center shot inside HIT_ANGLE_KILL is
  // an instant kill; a looser hit inside HIT_ANGLE only chips 1 (so it takes the
  // full ENEMY.HP). Rewards precision without making wing-clips free. HIT_ANGLE is
  // the window at draw scale 1 and grows with the raider's far scale (RENDER.FAR_SCALE
  // RAIDER_GAIN), so a bolt that crosses the drawn wing always registers; the kill
  // cone has one size at every distance.
  HIT_ANGLE_KILL: 0.14, // inner cone (~8 deg): the fuselage; one shot here kills outright
  HIT_ANGLE: 0.29,    // outer cone (~17 deg): the drawn wing span (half-span 1.33 at RIDE_RADIUS); a hit here deals 1 damage
  HIT_Z: 3.0,         // along-tube window (units) for a player bolt hit. Tunnel-free
                      // at 120Hz: a bolt moves BOLT_SPEED/HZ ~= 1.54u per substep < 3.0.
  BULLET_HIT_ANGLE: 0.30, // player dodge window vs an enemy bolt (wider: the hit is lethal)
  BULLET_HIT_Z: 2.5,  // along-tube window where an enemy bolt registers at the ship plane
}

// --- enemy (magenta raider: a forward-swept dart that flies in, strafes, and --
// shoots back). LETHAL: any hit (its bullet OR ramming its hull) costs a life,
// routed through the existing game.hitHazard() (i-frames + one-life-per-step).
// Its OWN worldDistance advances each step (unlike a static wall object), so it
// can fly in -> hold an engagement band ahead of you -> peel off.
export const ENEMY = {
  HP: 2,              // hits to kill (burst-to-kill: one quick double-tap once aligned)
  SCORE: 750,         // points per kill (about 7x a gem; the highest-value event). Multiplied by the level multiplier at award time.
  ENERGY_REFUND: 4,   // charge returned per kill (clamped at MAX). A clean one-shot kill pays a little more
                      // than it cost (GUN.COST 3), a chip-then-kill about breaks even, and every miss is a
                      // loss - so fighting, the way to earn lives back, does not starve the gun, while
                      // hold-and-spray still runs it dry and orbs still matter

  // --- waves (the director in world/enemies.ts; sizes come from LEVELS.WAVES) ---
  WAVE: {
    FIRST_DELAY: 6,       // s before the first wave of a run starts (it reaches its lanes about 4 s later)
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
  LANES: [-32, -42.5, -53] as readonly number[], // depth lanes (ship-relative z): near, middle, far.
                      // More than 10 units apart, so neighbours read as separate ships at
                      // separate depths; the near lane sits just outside FIRE_MIN_AHEAD, as close
                      // (and as large on screen) as a fair tell allows.
  EARLY_LANES: [0, 1] as readonly number[], // lane indices of a squad without a hunter (the first levels)
  SEP_MIN: 0.5,       // rad: two engaged raiders closer than this in angle ...
  SEP_DZ: 12,         // ... and this in depth are pushed apart
  SEP_PUSH: 0.8,      // rad/s the higher slot's weave center is pushed away

  // --- engagement (z negative = ahead of the ship) ---
  ENGAGE_Z_FAR: -62,  // APPROACH -> ENGAGE here; the station spring then settles it in its lane
  ENGAGE_BREAK_Z: 8,  // a raider that slipped behind the ship (z > this) falls behind (DEPART)
  ENGAGE_TIME: 18,    // seconds it holds its lane before leaving forward if not killed
  ENGAGE_TIME_JITTER: 2,

  // --- closing speeds (all relative to craft.speed, so correct at any tier speed) ---
  CLOSE_SPEED_DELTA: -42, // APPROACH: slower than you, so the gap closes it into the band (about 2 s from the fog)
  STATION_SPRING_K: 1.5,  // ENGAGE: speed = craft.speed + k*(z - laneZ): settles into its lane in about 2 s
  STATION_SPEED_CLAMP: 18,// ENGAGE: clamp on |speed - craft.speed|
  DEPART_SPEED_DELTA: -22,// DEPART: falls behind and recycles
  EXIT_SPEED_DELTA: 30,   // EXIT: starts leaving forward this much faster than you ...
  EXIT_ACCEL: 40,         // ... and keeps accelerating (u/s^2) into the fog

  // --- strafe (active from APPROACH on; must stay HITTABLE: peak strafe << player STEER_OMEGA_MAX 7) ---
  STRAFE_AMP: 0.95,   // theta = thetaCenter + AMP*sin(phase); wide weave so it is never a sitting duck
  STRAFE_W: 3.4,      // strafe phase rad/s -> peak |omega| ~3.2 (~46% of the player cap)
  STRAFE_OMEGA_MAX: 3.2, // hard per-step clamp on strafe angular speed (the hittability guarantee)
  STRAFE_AMP_K: [0.6, 1.0] as readonly number[],   // per-raider multiplier range on STRAFE_AMP ...
  STRAFE_W_K: [0.75, 1.05] as readonly number[],   // ... and on STRAFE_W, so a squad does not weave as one

  // --- hunter (the squad member that comes for a parked player) ---
  HUNT_TRACK: [2.0, 3.0] as readonly number[], // rad/s its center slides toward the player's line (by aggression)
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
  FIRE_MIN_AHEAD: 31.5, // a charge starts only this far ahead or more: CHARGE_TIME + travel
                      // at BULLET_SPEED is then at least 0.80 s from tell to arrival
  FIRE_JITTER: 0.4,   // +/- on the cooldown so volleys are not metronomic
  FIRE_SLOTS: 2,      // global cap on raiders charging/firing AT ONCE (Galaga-style
                      // attack slots): any number can engage, but incoming fire never
                      // exceeds this many simultaneous tells, so deep levels feel
                      // crowded without turning into an unreadable bolt hail
  FIRE_SLOT_RETRY: 0.25, // mean wait (s, +/-50% jitter) before a raider denied a
                      // fire slot re-tries; the jitter keeps a fixed pool order
                      // from always winning the next free slot
  CHARGE_TIME: 0.45,  // nose brightens toward white-hot for this long before each shot (the tell)
  // No firing tell starts from BEFORE seconds ahead of a cycle boundary until AFTER
  // seconds past it: the speed and gravity change there and the level banner shows,
  // so no bolt is in flight through the change (a tell that started earlier still fires).
  // When the hold ends each waiting raider takes RESUME (a random share) of a fresh fire
  // cooldown, so the fire returns one tell at a time, not as a volley.
  BOUNDARY_HOLD: { BEFORE: 1.1, AFTER: 1.5, RESUME: [0.3, 1.0] as readonly number[] },
  BULLET_SPEED: 90,   // enemy bolt speed toward +Z (> player top speed so it leads in)
  RAM_ANGLE: 0.55,    // ram hit window (rad); mirrors HAZARD.CAPTURE_ANGLE (wingspan + body)
  RAM_Z: 2.8,         // ram hit window (units); mirrors HAZARD.CAPTURE_Z

  // --- look (edge-lit solid like the ship/mine, but NORMAL blend like the mine) ---
  EDGE_RGB: [1.5, 0.1, 1.3] as [number, number, number], // hot magenta-violet (>1 cores bloom; near-zero green)
  FILL_RGB: [0.05, 0.005, 0.05] as [number, number, number], // near-black, faint violet bias (occludes)
  CHARGE_RGB: [2.4, 1.6, 2.4] as [number, number, number], // edge lerps toward this white-hot while charging
  EDGE_THRESHOLD: 22, // EdgesGeometry threshold (deg): keeps wing/fuselage ridges
  LINE_WIDTH: 2.2,    // edge line width in px (wall-object weight; player ship stays heavier at 2.4)
  SCALE: 0.7,         // overall hull scale (a lean dart, smaller than the player's 0.9)
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
  MAX_PLAYER: 8,      // pooled player bolts (GUN.COOLDOWN 0.25 x BOLT_TTL 0.7 ~ 3 live + margin)
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
  REF_DIST: 40,       // camera distance (world u) at/beyond which full SPREAD applies (~ the kill band, so
                      // band kills are unchanged); a closer kill shrinks toward it.
  DURATION: 0.34,     // kill flash-to-gone (s)
  LINE_WIDTH: 3.0,    // kill shard width in px (matches the bold bolt weight)

  // DAMAGE burst (life lost: mine / ram / enemy bolt) - see the header note
  DAMAGE_RGB: [6.0, 0.3, 0.1] as [number, number, number], // bright red (the mine's hue, brighter for a strong bloom)
  DAMAGE_SPREAD: 3.4, // peak shard-tip radius; NOT distance-compensated, so it engulfs the mine (~2u) at the ship
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
  MUSIC_VOLUME: 0.5,
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
    ready:     { synth: 'ready',     volume: 0.75 }, // gem quota met: three rising blips
    levelup:   { synth: 'levelup',   volume: 0.9 },  // level up fanfare (square + triangle, held last note)
    repeat:    { synth: 'repeat',    volume: 0.7 },  // quota missed, the level repeats: two soft falling notes
    charge:    { synth: 'charge',    volume: 0.5 },  // a raider's firing tell (panned; audible under gunfire, softer than the shot)
    chip:      { synth: 'chip',      volume: 0.5 },  // a hit that did not kill the raider
    loop:      { synth: 'loop',      volume: 1.1 },  // a loop over the top
    whoosh:    { synth: 'whoosh',    volume: 0.6 },  // a mine near miss (panned)
    waveClear: { synth: 'waveClear', volume: 0.6 },  // a raider wave cleared
  },
}

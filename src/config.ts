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
  DAMPING_C: 1.0,     // damping on omega: overshoots then settles. Higher = the
                      // craft stabilizes at the bottom sooner (fewer left-rights)
  STEER_TORQUE: 15.0, // angular accel added by full steering input (rad/s^2)
  STEER_OMEGA_MAX: 7.0,// soft cap: steering torque fades to zero as |omega| nears
                      // this, so holding a steer does not spin you up forever.
                      // Gravity can still exceed it on a dive (momentum survives).
  STEER_ATTACK: 0.07, // seconds for steer signal to ramp up (weighty taps)
  STEER_RELEASE: 0.13,// seconds for steer signal to ramp back to zero
}

// --- flight mode (experimental: speed tier -> gravity + tube color) ----------
// Speed is the single driver: the mode (or the current section) picks a target
// speed tier, the craft eases to it, and gravity is tied to speed (full at SLOW,
// zero at FAST - see flight.ts). The three fixed tiers map to colors:
//   slow   = yellow, full gravity (heaviest)
//   normal = green,  low gravity  (startup)
//   fast   = blue,   no gravity   (most agile)
// 'sections' cycles the tiers along the tube. Cycle live with the mode key (see
// INPUT.modeCycle) or set WH.flight.mode. The tube color follows speed, so it
// blends smoothly through the tiers as the craft eases between sections.
export type FlightMode = 'slow' | 'normal' | 'fast' | 'sections'
export const FLIGHT = {
  MODE: 'sections' as FlightMode, // startup mode (cycle tiers along the tube)
  SECTION_SECONDS: 10,          // 'sections' mode: seconds per section (equal in TIME; distance scales with the tier's speed)
  SLOW_RING_RGB: [0.72, 0.54, 0.08] as [number, number, number], // yellow tube (slow / full gravity)
  SLOW_LONG_RGB: [0.42, 0.31, 0.05] as [number, number, number],
  FAST_RING_RGB: [0.16, 0.34, 0.85] as [number, number, number], // blue tube (fast / no gravity)
  FAST_LONG_RGB: [0.10, 0.20, 0.52] as [number, number, number], // normal/green reuses RENDER.RING_RGB / LONG_RGB
}

// --- speed: forward motion. Set by the flight mode / section, not the player. -
// Units are world units per second (tube radius ~ 6, ring spacing ~ 7). Three
// tiers; gravity is tied to speed (faster = lighter, see flight.ts), so the tier
// chosen by the mode/section sets the whole feel. Never halts (SLOW > 0). The
// craft eases toward the active tier's speed at EASE.
export const SPEED = {
  SLOW: 30,   // yellow sections: full gravity, heaviest swing
  NORMAL: 52, // green sections: low gravity (startup speed; midpoint of slow..fast)
  FAST: 75,   // blue sections: no gravity, most agile
  EASE: 28,   // accel/decel toward the active tier's speed (units/s^2)
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

  DPR_CAP: 1.5,       // cap devicePixelRatio before scaling
  RENDER_SCALE: 0.85, // render below native res, upscale (main 60fps lever)
  MSAA_SAMPLES: 4,    // anti-alias the offscreen pass so thin rings don't shimmer

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
  // Energy orbs are meant to be occasional: ~1/3 the old density. Density is
  // set by SPACING (encounter rate = speed / spacing); COUNT just keeps the
  // visible range filled so they fade in from the far fog rather than popping.
  COUNT: 5,           // orbs alive in the pool at once
  SPAWN_START: 50,    // distance ahead of the first orb
  SPAWN_SPACING: 94,  // nominal distance between orbs (was 75; ~20% fewer)
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

  // --- field / spawn (rarer than orbs; offset start so kinds don't cluster) ---
  COUNT: 4,
  SPAWN_START: 85,
  SPAWN_SPACING: 120,
  SPAWN_JITTER: 22,
  RECYCLE_BEHIND: 22,
  CAPTURE_Z: 2.4,      // generous ride-into (like the orb)
  CAPTURE_ANGLE: 0.40,
  POP_TIME: 0.18,
  POP_SCALE: 1.8,
  SCORE: 250,          // points per gem -> game.addScore
}

// --- hazard (red spiky sea-mine / coronavirus; AVOID, a hit costs a life) ---
// The ONLY red object on the tube. Edge-lit solid like the ship, but NORMAL
// blend like the orb (additive HDR red would bloom toward white/pink).
export const HAZARD = {
  CORE_RADIUS: 0.5,    // faceted core sphere radius (world units)
  SPIKE_COUNT: 12,     // documented; geometry uses the 12 icosa vertex dirs
  SPIKE_LEN: 0.62,     // spike length out from the core surface
  SPIKE_BASE_R: 0.13,  // spike base radius (slim, sharp pyramidal cones)
  KNOB_RADIUS: 0.11,   // detonator-horn / virus-cap tip sphere
  SCALE: 1.6,          // overall size multiplier on the built mine (bigger = scarier)
  EDGE_THRESHOLD: 18,  // EdgesGeometry threshold (deg): keeps spikes + facets
  LINE_WIDTH: 2.2,     // edge line width in px
  EDGE_RGB: [1.0, 0.06, 0.04] as [number, number, number], // deep, dim red (blooms gently; big silhouette keeps it readable)
  FILL_RGB: [0.05, 0.005, 0.005] as [number, number, number], // near-black, faint red bias
  SPIN_SPEED: 0.55,    // rad/s, slow + menacing (slower than the orb's 0.8)
  PULSE_SPEED: 3.4,    // throb rad/s
  PULSE_AMP: 0.05,     // +/- 5% scale breathing

  // --- field / spawn (sparse to start; latest start so it doesn't cluster) ---
  COUNT: 4,
  SPAWN_START: 120,
  SPAWN_SPACING: 150,
  SPAWN_JITTER: 30,
  RECYCLE_BEHIND: 22,
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

// --- energy / scoring (HUD-driven survival loop) ----------------------------
export const ENERGY = {
  MAX: 100,
  START: 100,
  DRAIN: 3.5,    // energy lost per second
  PER_ORB: 25,   // energy refilled per collected orb
  LOW: 0.28,     // fraction below which the bar warns (amber)
  CRITICAL: 0.13,// fraction below which the bar is red
}

// --- lives (hazards cost a life; brief i-frames after a hit) ----------------
export const LIVES = {
  START: 3,
  INVULN_TIME: 1.6, // seconds of invulnerability after a hit (drives ship flicker)
}

export const SCORE = {
  DIST_RATE: 1.0, // points per world unit travelled (treasures add bonus later)
}

// --- gun (forward energy weapon: Space fires; each shot spends energy) -------
// The gun is the player's risk/reward against their OWN survival meter: a shot
// costs energy, a kill scores big AND refunds energy (see ENEMY). Bolts freeze
// theta at fire time and travel down -Z along that theta, so you AIM by lining
// up the pendulum onto a target's theta - aiming reuses the swing.
export const GUN = {
  COST: 3,            // energy spent per shot (~0.86s of survival at DRAIN 3.5)
  COOLDOWN: 0.25,     // seconds between shots (tap or hold -> ~4/s)
  BOLT_SPEED: 185,    // player bolt speed down -Z (units/s; >> SPEED.FAST so it leads quickly, less lead error vs strafing enemies)
  BOLT_TTL: 1.4,      // seconds before a player bolt recycles (~259u reach)
  // Two concentric hit windows (rad): a dead-center shot inside HIT_ANGLE_KILL is
  // an instant kill; a looser hit inside HIT_ANGLE only chips 1 (so it takes the
  // full ENEMY.HP). Rewards precision without making wing-clips free.
  HIT_ANGLE_KILL: 0.14, // inner cone (~8 deg): one shot here kills outright
  HIT_ANGLE: 0.24,    // outer cone (~14 deg): a hit here deals 1 damage
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
  SCORE: 500,         // points per kill (2x a gem; the highest-value event)
  ENERGY_REFUND: 12,  // energy returned on a kill (clamped at MAX; below PER_ORB so it is not a farm)
  COUNT: 2,           // enemies alive in the pool at once (one engaging, one approaching/departing)

  // --- spawn / lifecycle ---
  SPAWN_AHEAD: 220,   // units ahead of the ship an enemy enters APPROACH (fades in from fog)
  SPAWN_JITTER: 40,   // random extra spawn distance so they do not arrive in lockstep
  SPAWN_THETA_SPREAD: 0.5, // |rand| angle offset from the player's theta at spawn (rad)
  SPAWN_COOLDOWN: 3.0,// seconds a dead/recycled slot waits before re-entering APPROACH
  SPAWN_COOLDOWN_JITTER: 1.5, // +/- on the respawn wait so the two raiders drift apart instead of re-pairing
  RECYCLE_BEHIND: 26, // recycle once the enemy z passes this far behind the ship

  // --- engagement band (z negative = ahead of the ship) ---
  ENGAGE_Z_FAR: -55,  // far edge: enemy switches APPROACH -> ENGAGE here
  ENGAGE_Z_NEAR: -25, // near edge: a ~30u band, visible, outside all capture distances
  ENGAGE_BREAK_Z: 8,  // if the player boosts past so the enemy slips behind (z > this), force DEPART
  ENGAGE_TIME: 10,    // seconds it holds the band before peeling off if not killed
  ENGAGE_TIME_JITTER: 2,

  // --- closing speeds (all relative to craft.speed, so correct at any cruise/boost) ---
  CLOSE_SPEED_DELTA: -14, // APPROACH: slower than you, so the gap closes it into the band
  STATION_SPRING_K: 0.6,  // ENGAGE: speed = craft.speed + k*(z - bandCenter) to hover in the band
  STATION_SPEED_CLAMP: 18,// ENGAGE: clamp |speed - craft.speed| so a full boost (75 vs 30) always escapes
  DEPART_SPEED_DELTA: -22,// DEPART: falls behind and recycles
  APPROACH_TRACK: 0.7,    // rad/s the raider drifts its strafe CENTER toward yours while approaching (gentle: it trends into play but never locks on)

  // --- strafe (active from APPROACH on; must stay HITTABLE: peak strafe << player STEER_OMEGA_MAX 7) ---
  STRAFE_AMP: 0.95,   // theta = thetaCenter + AMP*sin(phase); wide weave so it is never a sitting duck
  STRAFE_W: 3.4,      // strafe phase rad/s -> peak |omega| ~3.2 (~46% of the player cap)
  STRAFE_OMEGA_MAX: 3.2, // hard per-step clamp on strafe angular speed (the hittability guarantee)

  // --- firing (telegraphed so a lethal shot is always fairly dodgeable) ---
  FIRE_COOLDOWN: 2.0, // seconds between shots, ENGAGE only
  FIRE_JITTER: 0.4,   // +/- on the cooldown so volleys are not metronomic
  CHARGE_TIME: 0.45,  // nose brightens toward white-hot for this long before each shot (the tell)
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
  MAX_PLAYER: 8,      // pooled player bolts (COOLDOWN 0.25 x TTL 1.4 ~ 6 live + margin)
  MAX_ENEMY: 8,       // pooled enemy bolts
  LENGTH: 1.6,        // streak length along the tube axis (world units)
  LINE_WIDTH: 3.0,    // fat-line width in px (fatter than hulls so bolts pop)
  PLAYER_RGB: [0.55, 2.0, 1.1] as [number, number, number], // hot white-green (yours; SHIP hue family)
  ENEMY_RGB: [2.0, 0.15, 1.6] as [number, number, number],  // white-hot magenta (theirs)
}

// --- input key bindings (KeyboardEvent.code) --------------------------------
export const INPUT = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  boost: ['ShiftLeft', 'ShiftRight'], // Space used to boost; it now FIRES (below)
  fire: ['Space'],                    // forward gun (Shift still boosts)
  mute: ['KeyM'],                     // toggle MUSIC on/off (SFX keep playing; handled in main.ts)
  pause: ['Escape'],                  // pause a live run back to the intro/menu screen (handled in main.ts)
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
    hit:       { synth: 'hit',       volume: 1.8 },  // explosion (big + loud - a life lost should land like a bomb)
    gameover:  { synth: 'gameover',  volume: 0.85 }, // slow descending tone
  },
}

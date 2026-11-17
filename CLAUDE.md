# CLAUDE.md - Wormhole (working name "Vector Tube")

## Overview
See [README.md](README.md) for the player-facing description (what the game is, controls, how to
run). This file is the internal design spec, physics model, architecture, and roadmap.

Design priorities that drive the code:
- The soul of the game is the MOVEMENT. The craft is not free-flying - it hangs near the bottom
  of the tube under a gravity-like pull and steers only left / right, climbing the curved wall
  like a pendulum (pump left-right-left to ride high, or loop over the top). Getting that swing
  to feel weighty and momentum-driven is the single most important thing here.
- Retro-INSPIRED, not retro-cheap: a modern machine doing a vector look, not a 1990s mockup
  (spirit of Psyborg, S.T.U.N. Runner, Tunnels of Armageddon, with modern execution).

## Game design spec (condensed)
- Constant forward motion; the craft never halts. Speed is set by the tube section (slow /
  normal / fast tiers), not a player throttle; the craft eases between tiers, never to a stop.
- Steer left / right to ride up the walls (pendulum swing, see Physics).
- Collect pickups around the tube wall: gold gems for score, blue orbs to recharge the weapon.
- Gems and mines come as GEM LINES: short, readable phrases (arc, pump, jump, weave, loop,
  scatter). A gem phrase is the visible shape of a swing - hold and release as the line shows
  and every gem is collected. A mine phrase always keeps a clear line, marked by its gems.
  Slow sections ask for precision (weave, jump), normal ones for flow, fast ones for big air
  (a ring of gems over the top). Orbs stay scattered finds.
- Dodge red mines; a hit costs a life.
- Forward gun against the raiders. They arrive in WAVES: a squad with a shape (side by side or
  a pincer), each member in its own depth lane, never more than four alive, then a breather.
  From level 3 one member is a HUNTER: it slides to the player's line, stops, shows the
  white-hot nose and fires down that line, so no spot on the wall stays safe. Every shot is
  telegraphed (0.45 s tell, at least 0.80 s from tell to arrival). No tell starts from
  1.1 s before a cycle boundary until 1.5 s after it, so no bolt is in flight while the
  speed and gravity change and the level banner shows.
- Weapon charge (the blue HUD bar) is the gun's ammo: spent only by firing, refilled by blue
  orbs and kills. At zero the gun is inert until recharged; running dry never ends the run.
- The single fail condition is lives reaching zero (collisions / enemy fire / ram).
- Lives are earned back by FIGHTING: three to start; every killed raider leaves a small
  green cross (a life shard) on the wall where it died. It scrolls in and is caught by
  riding into it; a missed one is gone. A full set of shards restores one whole life (4
  shards on levels 1 to 3, then 1.5 more per tuning level, at most 20; the HUD shows a green segmented
  bar next to the ships while a life is missing). Progress is kept when a life is lost. The
  last raider of every Nth fully destroyed squad leaves a LARGE cross, a whole life (N = 3 at
  level 1, one more per tuning level, at most 12). A caught cross of either size also
  returns weapon charge; at full lives it pays score instead of a life. A player who never
  shoots earns no lives. The distance-timed cross field is switched off (`EXTRA_LIFE.ENABLED`).
- Levels are gem-gated: a level advances only once you have collected its gem quota. A cycle
  offers 32 to 40 gems (about 36). On ORION the quota is 15 at level 1, 19 at level 2, 23 at
  level 3 and 27 from level 4. The quota always stays at least 3 gems under the fewest a
  cycle offers (5 on ORION), so a near-perfect player never repeats a level; this is a rule,
  checked by `sim:levels` I2b. Fall short at the cycle boundary and the same level repeats -
  same speeds, same three tier colors, no level-up - until you qualify; the gems collected
  so far carry over. This pulls the player into active collecting instead of coasting;
  forward motion never stops. The gate is an event: the gem row reads READY with a chime, a
  level-up flashes the tube and shows `LEVEL N`, a miss shows an amber
  `REPEAT - got/quota GEMS` with the number of gems still missing. Both banners sit above
  the tube's vanishing point, so they never cover raiders or their tells.
- A run opens calm: its first three gem lines carry no mines (the first mine comes about
  10 s in) and the first raiders arrive at about 10 s.
- The ORION curve: levels 1 and 2 are a warm-up (two or three weavers that fire slowly, the
  lightest mine budget). The hunter arrives at level 3 together with the normal fire rate,
  the extra mines of the phrases at level 4, and from level 4 the raiders' aggression rises
  step by step (faster fire, shorter breathers, a quicker hunter) up to level 13.
- Difficulty ramps with level and never plateaus, but stays winnable - this is the run's
  pressure, not a survival clock. Guiding principle for future tuning:
  - Speed keeps rising forever but with a DECAYING increment, so reaction windows tighten
    without collapsing (a flat per-level increase eventually makes the run unplayable).
  - Deep-game pressure comes mainly from CONTENT, not raw speed: more enemies first, then
    enemy aggression (fire rate, persistence). Mines are a secondary threat with a
    playability floor; weapon charge is a resource to manage.
  - Combat geometry is speed-invariant by design (bolts are ship-relative, steering is
    angular), so dodging and aiming are as fair at high levels as at low ones. Deep levels
    should be hard but fair - never a pure reflex wall that raw speed alone would create.
- Death leads to a score screen (score, level reached, run time), then restart. Local best persists.
- Title-screen menu: ship selector (three edge-lit hulls with a rotating 3D preview;
  COSMETIC ONLY - identical hit windows and handling) and a difficulty selector
  (MILKY WAY for children: 40% ramp, raiders fire less than half as often, less than half
  the mines, gem quota capped at 22 / ORION standard / QUASAR starts ~ORION L3.5; one slope/offset mapping of the
  played level to the tuning level plus an `ease` factor, score multiplier follows the
  tuning level, so harder modes pay more and the single best score stays honest). Both
  persist locally.
- HUD is minimal and in-theme (thin green vector text/lines): level, gem-gate pips, score, best,
  run time, lives, weapon charge, speed, difficulty (name + threat pips in the mode color).
  The game-over panel names what ended the run (HIT BY MINE / RAIDER BOLT / RAIDER RAM).
- Feedback: a gem row climbs a pentatonic ladder, a raider's tell is a rising whine panned to
  its side (audible from its first 30 ms, under gunfire too), a loop and a mine near miss
  have their own cues, a hit jolts the view and slows
  time for a moment, the view widens with speed, the hull yaws and rolls with its momentum.

## Physics model - the damped, driven pendulum (the heart of the game)
The craft's position is an angle `theta` around the circular cross-section of the tube
(`theta = 0` is the bottom). It is integrated each fixed timestep as a damped, driven pendulum:

    angAccel = -GRAVITY_K * sin(theta)   // gravity pulls toward bottom
             - DAMPING_C  * omega        // light damping; overshoots but eventually settles
             + steerTorque               // steering input (left/right), ramped via attack/release
    omega += angAccel * dt
    theta += omega * dt                  // theta is UNBOUNDED: a hard pump can loop over the top

- Steering is a continuous torque while a key is held (a tap = a brief torque). There is no
  HARD velocity clamp (it would flatten the feel), but a SOFT cap fades the steering torque to
  zero as `|omega|` nears `STEER_OMEGA_MAX` when it would speed the spin up further, so holding
  a side key reaches a controlled max swing speed instead of accelerating without bound.
  Gravity is untouched, so a dive from high up still carries omega past the cap (momentum lives).
- Integrator: semi-implicit (symplectic) Euler at a fixed substep, decoupled from rendering.
- Forward position advances at the current speed; tube geometry scrolls toward the camera.
- Tube cross-section is a FULL circle; `theta` wraps past the top so over-the-top loops are
  possible when pumped hard. Tuning controls how reachable the top is.

### Tunable constants (live in `src/config.ts`, grouped; values are starting points, tune freely)
- physics:  PHYSICS.{GRAVITY_K, DAMPING_C, STEER_TORQUE, STEER_OMEGA_MAX (soft spin cap),
            STEER_ATTACK, STEER_RELEASE, HZ}
- climb:    CLIMB.{FADE, START, END, UP_SOFT} - an optional fade of the upward steering torque
            high on the wall (craft.ts stepSwing). FADE is 0 = off: the handling is the
            hand-tuned one. `npm run sim:swing -- --fade 0.9` shows what the fade does.
            Revisit only if looping in slow sections proves too easy
- speed:    SLOW / NORMAL / FAST (the three tier speeds, level-1 base; raised per level
            by the LEVELS speed bonus), EASE (accel toward the active tier). Speed is set
            by the flight tier/section, not a player throttle; FLIGHT.{MODE, SECTION_SECONDS,
            GRAVITY_FLOOR, GRAVITY_CURVE (gravity fades slow->fast to a FLOOR, never zero -
            every tier keeps a pendulum pull)} + tube tier colors live alongside.
- levels:   LEVELS.{SPEED_STEP/SPEED_BAND (per-level speed bonus: a decaying-but-never-zero
            increment in bands - EARLY/MID/LATE by display level - so deep levels keep speeding
            up, slowly; derived in flight.ts speedBonus), SCORE_MULT_STEP, GEM_QUOTA_FRACTION /
            QUOTA_FRACTION_STEP / QUOTA_FRACTION_MAX (gem gate: the quota is that fraction of
            SEQUENCE.GEMS_PER_CYCLE, rising per tuning level to the cap, 0.48 / 0.12 / 0.85;
            flight.gemQuota),
            GRAVITY_MODE ('tier' default | 'absolute'), MAX_ENEMIES_CAP (4, sizes the pool),
            WAVES[] + WAVE_ROSTER_EVERY/MAX, WAVE_CAP4_FROM, WAVE_HUNTERS2_FROM (raider waves by
            tuning level: roster, alive cap, hunters; read through levels.ts), AGGRESSION_FROM /
            AGGRESSION_SPAN (0..1 raider aggression: fire cooldown, breather, hunter slide),
            DEEP_FROM / DEEP_SPAN (0..1 deep pressure, a second ramp over ORION levels 9 to 16:
            scales the fire cooldown and the fire stagger by ENEMY.DEEP_COOLDOWN_K / DEEP_STAGGER_K),
            BOMB_MULT_STEP/BOMB_MULT_FLOOR (mines keep tightening past the table to a floor;
            bombMult in levels.ts), TABLE[] (per-level orb/bombSpacingMult - speed-normalized
            per-second rate multipliers; orb flat, bomb steps down at level 4; the gem-line
            director divides its mine budget by bombMult)}
- difficulty: DIFFICULTY.{MODES (name/slope/offset/ease/quotaMax/color per mode), DEFAULT} - the
            title selector; flight.tuned() maps the played level to the tuning level everything
            derives from (see the design-spec bullet); `ease` multiplies the raider fire
            cooldown and the breather and divides the mine budget (MILKY WAY 2.2); `quotaMax`
            caps the mode's gem-quota fraction (MILKY WAY 0.7 = 22 gems; 1 = no extra cap); the color +
            threat pips (hud.ts) are the at-a-glance difficulty signal (green/amber/red)
- tube:     TUBE.{RADIUS, RING_SPACING, RINGS_VISIBLE, SEGMENTS_PER_RING, LONGITUDINAL_LINES}
- ship:     SHIP.{Z, RADIAL_OFFSET, SCALE, BANK, LINE_WIDTH, FLASH_HOLD, FLASH_TIME,
            HULLS (selectable cosmetic hulls: raptor/falcon/delta), PREVIEW_* (title
            turntable placement), YAW_FOLLOW/YAW_MAX/BANK_OMEGA/ROLL_MAX/ATTITUDE_LAG (the hull
            yaws and rolls with its momentum; visual only)}; RIDE_RADIUS derived
- camera:   CAMERA.{FOV, HFOV_MAX, BACK, RISE, LOOK_AHEAD, ORBIT_FOLLOW, ROLL_FOLLOW, AIM_FOLLOW,
            FOLLOW_LAG, FOV_SPEED/FOV_LAG (the view widens from the slow to the fast tier)}
- render:   RENDER.{BG_COLOR, FOG_NEAR, FOG_FAR, RING_RGB, LONG_RGB, SHIP_RGB, SHIP_FILL_RGB,
            SHIP_FLASH_RGB, SHIP_LIFE_FLASH_RGB, DPR_CAP, RENDER_SCALE(_LOW), MSAA_SAMPLES(_LOW),
            BLOOM_ENABLED (on), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD,
            FAR_SCALE (far objects are drawn larger, visual only: wall objects up to 1.5x
            via GAIN, raiders up to 2x via RAIDER_GAIN so a squad and its tell stand out)}
            (the _LOW variants are the integrated-GPU fallback, auto-selected in scene.ts)
- background:BACKGROUND.{ENABLED, CENTER, MID, EDGE, MID_STOP} gradient; STARS, STAR_ALPHA, STAR_SPREAD_DEG
- pickup:   RADIUS, EDGE_RGB, GLOW_RGB, GLOW_OPACITY, SPIN/BOB; COUNT, SPAWN_* (incl.
            SPAWN_ANGLE = per-kind angle-from-bottom bias), CAPTURE_Z, CAPTURE_ANGLE, POP_TIME/SCALE
- treasure: gem geometry (RADIUS, FACETS, TABLE/CROWN/PAVILION_RATIO, EDGE_THRESHOLD), EDGE/FILL
            colors, SPIN/BOB; COUNT (the pool the gem-line director feeds), CAPTURE_*/POP_*;
            SCORE (points per gem); RANDOM_COUNT + SPAWN_* only with gem lines off
- hazard:   naval-mine geometry (CORE_RADIUS big ball, cylindrical horns via
            SPIKE_LEN/BASE_R/TIP_R, EDGE_THRESHOLD), EDGE/FILL colors, SPIN/PULSE; COUNT (the
            pool the director feeds), CAPTURE_*/POP_*; RANDOM_COUNT, SPAWN_* (incl.
            SPAWN_ANGLE) and SLOW_DENSITY only with gem lines off
- extralife:medkit-cross geometry (ARM/THICK/DEPTH extruded plus, EDGE_THRESHOLD),
            EDGE/FILL colors, SPIN/BOB/PULSE; field COUNT/SPAWN_* (incl. SPAWN_ANGLE),
            CAPTURE_*/POP_* (scarce: COUNT 1, the first after SPAWN_START, then one per
            SPAWN_SPACING = every 3 to 4 minutes). +1 life, capped at LIVES.START.
            ENABLED false = a feed field: SQUAD_EVERY / _STEP / _MAX (a destroyed squad
            drops a cross), FULL_SCORE (at full lives), CHARGE, GROW_TIME
- lifeshard:LIFE_SHARD.{PER_LIFE, PER_LIFE_HOLD, PER_LIFE_STEP, PER_LIFE_MAX (shards per life = PER_LIFE +
            PER_LIFE_STEP x tuning levels past the hold, capped; set in session.preUpdate, a started set
            keeps its size), SCALE (of the extra-life cross), COUNT (pool), LEAD_SECONDS
            (minimum flight time ahead at the drop), CAPTURE_*/POP_*, GROW_TIME (grow-in
            of a dropped shard, field.ts growTime), FULL_SCORE (at full lives), CHARGE}
- sequence: SEQUENCE.{ENABLED (false = random gem and mine fields), HORIZON, FIRST_AT,
            WARMUP_PHRASES (the first phrases of a run carry no mines), GAP /
            GAP_FULL_T (rest between phrases), BOUNDARY_CLEAR, GEMS_PER_CYCLE / GEMS_EXTRA_MAX /
            GEMS_CUMULATIVE_MIN/MAX (gem budget), MINES_PER_SECTION (mine budget per tier at
            tuning level 0), MINE_CLEAR, GEM_EVERY_MIN, SCATTER.*} - the gem-line director
            (world/sequencer.ts); the phrases themselves are data in world/phrases.ts
- feel:     FEEL.{TUBE_FLASH, LOOP_FLASH, LOOP_CUE_GAP, CHAIN_STEPS (gem chime ladder),
            NEAR_MINE_EXTRA / NEAR_THROTTLE (mine near-miss event), SHAKE (camera shake),
            HITSTOP (slow time for a moment on a lost life; SCALE 1 = off)}
- hud:      HUD.GEM_PIPS_MAX
- spawnclear: SPAWN_CLEAR.{DZ, ANGLE, TRIES, NUDGE} cross-kind spawn separation: a field
            (re)spawn avoids the OTHER fields' objects (resample angle, then nudge forward)
- lives:    LIVES.{START, INVULN_TIME}
- weapon:   ENERGY.{MAX,START,PER_ORB,LOW} (weapon charge / ammo; internal name kept as
            ENERGY, HUD label is WEAPON; empty = below GUN.COST -> red bar). A kill refunds
            ENEMY.ENERGY_REFUND (4: a clean kill pays for its shot, misses do not)
- score:    no distance term - score = gem points (TREASURE.SCORE) + kill points (ENEMY.SCORE),
            each x the level multiplier (LEVELS.SCORE_MULT_STEP); passive flight earns nothing
- gun:      COST (charge/shot), COOLDOWN, BOLT_SPEED/TTL, HIT_ANGLE_KILL/HIT_ANGLE/HIT_Z
            (player->enemy: inner cone kills, outer cone chips 1), BULLET_HIT_ANGLE/Z
            (enemy bolt->ship dodge window)
- enemy:    HP, SCORE (per kill), ENERGY_REFUND; WAVE.{FIRST_DELAY, REINFORCE_DELAY, TIME,
            FIGHT_MAX, RELIEF_LEAD, BREATHER} (the wave director); SPAWN_*/RECYCLE; formation
            (FORM_SEP, PINCER_*, ANCHOR_*, LANES depth lanes, SEP_* separation); ENGAGE_* +
            speeds (CLOSE/STATION/DEPART/EXIT deltas relative to craft.speed); STRAFE_*
            (hard-capped << player STEER_OMEGA_MAX = hittability); hunter (HUNT_TRACK,
            HUNT_STRAFE_AMP, HUNT_FIRE_ANGLE, HUNT_FLANK, HUNT_GAP_MIN); FIRE_COOLDOWN_EARLY /
            FIRE_COOLDOWN / FIRE_COOLDOWN_DEEP (by tuning level), DEEP_COOLDOWN_K / DEEP_STAGGER_K
            (deep-pressure factors on the cooldown and the stagger), FIRE_STAGGER, FIRE_MIN_AHEAD,
            CHARGE_TIME, BOUNDARY_HOLD (no tell starts around a cycle boundary), BULLET_SPEED,
            FIRE_SLOTS + FIRE_SLOT_RETRY (global cap on raiders
            charging/firing at once), RAM_ANGLE/Z; dart geometry + EDGE/FILL/CHARGE colors,
            SCALE/BANK/POP_*. FAIRNESS CONSTANTS, not tuning levers: CHARGE_TIME 0.45,
            BULLET_SPEED 90, FIRE_SLOTS 2, STRAFE_OMEGA_MAX 3.2, FIRE_MIN_AHEAD, the hit windows
- projectile: MAX_PLAYER/MAX_ENEMY (fixed pools), LENGTH/LINE_WIDTH, PLAYER_RGB/ENEMY_RGB
- input:    INPUT.{left, right} steer; fire = Space; menuUp/menuDown (title selector rows;
            left/right cycle the active row); plus start / confirm (Enter: game-over
            -> title, resume-from-pause) / mute / pause / modeCycle (G) / perf (P) bindings

### One-constant switches (config.ts)
- `SEQUENCE.ENABLED = false` - random gem and mine fields instead of gem lines.
- `CLIMB.FADE = 0.9` - steering weakens high on the wall (off at 0; see the comment there).
- `FEEL.HITSTOP.SCALE = 1` - no slow-down on a lost life.
- `CAMERA.FOV_SPEED = 0` - no widening of the view with speed.
- `DIFFICULTY.DEFAULT` - the mode the title screen starts on (0 MILKY WAY, 1 ORION, 2 QUASAR).

### Camera feel (decided default, easy to change)
Chase cam sits behind and slightly above the craft. It orbits the tube a little with the
craft (`CAMERA.ORBIT_FOLLOW`, smoothed by `CAMERA.FOLLOW_LAG`) and banks the view with
`CAMERA.ROLL_FOLLOW`; both are driven by `sin(theta)`, so they sit at zero when the craft
rests at the bottom and stay continuous over the top (loops roll through smoothly). The aim
is biased toward the craft by `CAMERA.AIM_FOLLOW` so it stays framed while you still see wall ahead.

## Tech stack and why
- TypeScript (strict) + Vite + Three.js. No game engine, no heavy frameworks.
- Three.js + WebGL over hand-rolled 2D canvas: GPU does projection + depth + distance fog,
  banking is a cheap quaternion, and `UnrealBloomPass` delivers the neon glow on the GPU.
  Canvas-2D glow (`shadowBlur`) and any bloom-style pass are fill-rate killers; we want the GPU.
- Lines: `Line2` / `LineMaterial` (fat lines) for hero and width-controlled glowing strokes
  (ship edges, key tube lines) so strokes look premium and consistent, not 1px; `LineSegments`
  where width does not matter. The ship hull uses `EdgesGeometry(geom, thresholdAngle)` over a
  near-black emissive fill so it reads as an edge-lit SOLID form, not a see-through wire cage.
- Bloom (`UnrealBloomPass`) is ON by default - it is the look, not an afterthought.
- No backend, no accounts. Builds to a static bundle that runs fully offline from a local folder.
- Target browsers: current Chrome and Safari on macOS.

## Visual style (Tron, modern, not basic)
Green neon on near-black, glowing wireframe in the spirit of Tron: bright near-white line cores
that bloom into green, additive glow, depth fog/gradient into the distance. Modern post-
processing and a polished hero ship from M1 on. Hard nos: flat solid-color planes (no "Roblox"
look) and, for now, fully textured/lit surfaces. The Descent II direction (real 3D corridors)
is a possible FUTURE step; the early game stays wireframe / edge-lit, not fully rendered surfaces.

## Ship
Hand-built procedural low-poly spacecraft, rendered as glowing edge lines (`Line2`) over a
near-black emissive fill, banking with the swing. Built in code (no external model files) to
stay offline, readable, and on-aesthetic. THREE selectable hulls (title menu, cosmetic only,
same footprint so the shared hit windows look fair): RAPTOR the winged fighter (X-wing-ish:
fuselage, cockpit, X wings, engine pods), FALCON a saucer (faceted lens, offset cockpit tube,
front mandibles), DELTA a rebel-style arrowhead (triangular wing plate, spine + canopy, twin
canted fins, twin engines). All share one fill + one line material, so the pickup flash and
resolution updates apply to whichever hull is visible. Every hull is a hero asset - polished,
no placeholder arrowheads. A forward-swept dart silhouette is RESERVED for the enemy.

## Repo structure
    index.html, package.json, tsconfig.json, vite.config.ts, CLAUDE.md
    src/
      main.ts              bootstrap, canvas, resize, start loop, WH debug handle; attaches
                           audio / flashes / bursts / HUD to the session's events
      session.ts           the gameplay wiring (craft, flight, fields, gun, raiders, bolts, run
                           state, fixed-step order), free of rendering / audio / DOM; shared by
                           main.ts and the headless playtest harness (SessionFx event hooks)
      config.ts            ALL tunable constants, grouped (see above)
      loop.ts              fixed-timestep accumulator; update vs render split; the hit slow-down
                           (a time scale on the game clock, FEEL.HITSTOP)
      input.ts             keyboard -> steer (left/right) / fire (Space)
      craft.ts             player state: pendulum + speed + smoothed steer (level-aware speed clamp);
                           stepSwing, the one swing step the craft, the phrase ghost and the bots share
      flight.ts            gem-gated level + section model: per-level tier speeds, score multiplier,
                           tier-relative gravity, speed cap, tier/level lookups, derived gem quota
                           (a level advances only when its quota is met, else the cycle repeats);
                           difficulty mapping (tuned/setDifficulty, see config DIFFICULTY)
      menu.ts              title-screen settings model: ship + difficulty selection, row/key
                           semantics, localStorage persistence (hud renders, main wires)
      levels.ts            per-level difficulty tuning: raider waves (roster, alive cap, hunters,
                           aggression, fire cooldown) and field / mine density, derived from flight
      audio.ts             Web Audio mixer: streamed music + decoded/synth SFX (wired in main.ts)
      gun.ts               forward-gun trigger: cooldown + charge spend; returns fire/dry intent
      util/math.ts         clamp / approach / lerp / angleDiff (shared signed angle delta)
      util/rng.ts          the one seedable source of GAMEPLAY randomness (spawns, raider timers);
                           never use Math.random in gameplay code (cosmetic effects may)
      physics/pendulum.ts  theta integrator (damped driven pendulum)
      world/tube.ts        build + scroll the wireframe tube mesh
      world/ship.ts        procedural 3D spacecraft hulls (edge-lit; raptor/falcon/delta,
                           setHull swap, title turntable preview); place on wall from theta
      world/field.ts       generic wall-object pool (orbs/gems/mines): spawn/scroll/recycle + angle hit
                           test; optional spacingScaleAt hook for per-section / per-level density;
                           cross-field de-confliction (avoid/occupies, SPAWN_CLEAR window); feed
                           mode (a parked pool filled at exact places by the director); onMiss / onNear
      world/phrases.ts     the gem-line phrase library (arc, pump, jump, weave, loop, scatter) as
                           data, and the ghost that turns a phrase's key script into angles
      world/sequencer.ts   the gem-line director: plans each section's phrases against the gem
                           and mine budgets and feeds the gem and mine pools; pressureAt()
      world/farScale.ts    draw scale of far wall objects and raiders (visual only)
      world/attitude.ts    hull yaw / roll from the swing (visual only)
      world/wallObject.ts  the {object,update,setResolution,setOpacity} contract for field objects
      world/edgeLitSolid.ts shared builder: near-black fill + glowing fat-line edges (gem/mine/cross/raider)
      world/pickup.ts      blue health orb / treasure.ts gold gem / hazard.ts red mine /
                           extraLife.ts green medkit-cross (the life shard at LIFE_SHARD.SCALE;
                           full size = the switched-off extra life) (edge-lit WallObjects)
      world/enemy.ts       magenta forward-swept-dart hull (edge-lit; charge tell + death fade)
      world/enemies.ts     raider pool + state machine (approach/engage/exit/depart/dead), own
                           worldDistance; NOT a field; the wave director (formations, depth lanes,
                           weavers and hunters, breathers); global fire-slot cap (FIRE_SLOTS)
      world/projectiles.ts one pooled bolt system (player + enemy bolts; camera-facing diamond glyph)
      world/burst.ts       pooled impact burst (white-hot flash + shard starburst); spawned on a kill / damage hit
      game.ts              run state: weapon charge refill/spend, gems-this-level (gate counter),
                           run timer, score, lives, game-over, best
      hud.ts               DOM HUD overlay (level/gem-gate pips/score/best/time/weapon/lives/
                           speed/difficulty + title menu rows + game-over)
      render/scene.ts      Three scene/camera/renderer + bloom composer, fog/fade
      render/camera.ts     chase follow + bank from theta (sin-based, smooth loops); speed FOV; shake
      render/fov.ts        vertical FOV for an aspect ratio and a speed offset (HFOV cap)
      render/shake.ts      camera shake from one decaying trauma value
      render/background.ts deep-space gradient backdrop (scene.background)
      render/stars.ts      world-space starfield (follows camera pos, holds orientation)
      render/perf.ts       toggleable FPS / frame-time overlay (P key)
    scripts/shoot.ts       Playwright screenshot (SET_THETA/HOLD/POSE/COMBAT; logs state)
    scripts/combat-sim.ts  headless behavior sim of the combat loop (npm run sim; bundled via esbuild)
    scripts/levels-sim.ts  headless sim of the level math: boundaries, speeds, multiplier,
                           gravity modes, density normalization (npm run sim:levels)
    scripts/fields-sim.ts  headless sim of cross-field spawn de-confliction: an avoiding
                           pair never overlaps, a control pair does; feed-mode fields (npm run sim:fields)
    scripts/sequence-sim.ts  headless sim of the gem lines: every phrase is flyable and keeps its
                           mines clear of the line, budgets, boundaries (npm run sim:sequence)
    scripts/feel-sim.ts    headless checks of shake, speed FOV, hull attitude, hit slow-down (npm run sim:feel)
    scripts/swing-sim.ts   measurements of the swing per tier, with and without CLIMB.FADE (npm run sim:swing)
    scripts/playtest.ts    headless bot playtests of the real session (npm run playtest);
                           bots, perception, metrics, report live in scripts/playtest/
    scripts/playtest-live.ts  one bot plays the real browser build via Playwright
                           (npm run playtest:live; screenshots + frame times)
    scripts/node-shim.d.ts minimal declarations of the Node APIs the scripts use (for typecheck)
    playtest/              README.md (how to run, metrics), baseline.json (the game before the
                           next-level work) and next-level.json (the game as it is now)
    docs/next-level-spec.md  the design of the next-level work, with what was built and measured

## Dev commands
- Install:    `npm install`
- Run (dev):  `npm run dev`   then open the printed localhost URL
- Build:      `npm run build` (output in `dist/`, static + offline)
- Preview:    `npm run preview`
- Typecheck:  `npm run typecheck` (`tsc --noEmit` for src, then for scripts/ through
              tsconfig.playtest.json; scripts/node-shim.d.ts declares the Node APIs the scripts
              use, because @types/node is not installed; also the first half of build)
- Screenshot: `npm run shoot` (Playwright headless capture for visual self-check)
- Combat sim: `npm run sim` (headless behavior checks for the gun/enemies/projectiles loop)
- Levels sim: `npm run sim:levels` (headless checks for the level / difficulty math)
- Fields sim: `npm run sim:fields` (headless checks for cross-field spawn separation and feed fields)
- Sequence sim: `npm run sim:sequence` (every gem-line phrase is flyable, mines keep clear, budgets)
- Feel sim:   `npm run sim:feel` (camera shake, speed FOV, hull attitude, hit slow-down)
- Swing sim:  `npm run sim:swing` (the swing per tier; `-- --fade 0.9` shows the climb fade)
- Playtest:   `npm run playtest -- --bot all --runs 40` (seeded bot players on the real game;
              `npm run playtest:compare` prints deltas against playtest/baseline.json;
              `npm run playtest:next` writes playtest/next-level.json, the record of the
              game as it is now, with the per-level tables;
              `npm run playtest:live` plays the browser build; see playtest/README.md)
- After a gameplay change: typecheck, every sim, build, `npm run playtest:compare`, then
  `npm run playtest:live` and look at the screenshots.

## Coding conventions and performance budget
- TypeScript strict mode. Small, typed, modular files. No premature abstraction - refactor
  when a third case appears, not before. Match surrounding style.
- All feel constants stay grouped in `config.ts` for fast tuning; Vite HMR gives near-instant feedback.
- Performance budget: steady 60 fps with headroom on the dev machine - 2020 27" iMac, Retina 5K
  (5120x2880), Radeon Pro 5300/5500 (4GB), capable (runs Assetto Corsa well). Push visual
  quality, but DO NOT render bloom at native 5K. Main perf lever is `RENDER_SCALE`: render scene
  + bloom at a capped resolution (target ~1440-1800p) and upscale; bloom hides the softness.
  Reuse geometries/materials; no per-frame allocations in update/render. Profile and flag risks.
- No em / en dashes in any text output (house style): use a spaced hyphen " - ".

## Working agreement
- Be direct; lead with the point. Challenge design choices that do not add up, with reasoning.
- Plan before coding. Build in thin vertical slices; get one feeling right and running before the next.
- Show the running result each slice and say exactly how to see it; self-verify visually, not just compile.
- Git from the first commit. Small, descriptive commits. Never leave the repo in a broken state.

## Milestones / TODO (living)
- [x] M0  Scaffold: Vite + TS (strict) + Three.js, bloom composer, git, Playwright shoot.
- [x] M1  Scrolling wireframe tube (Tron neon + bloom) + procedural 3D ship (edge-lit, banks
          with the swing) + pendulum physics + banking chase cam + throttle/boost (no halt),
          controllable, constants exposed. BUILT + playtested + tuned (stable
          wormhole cam, gravity-down, smooth loops, framing).
- [x] M2  Wall objects + atmosphere. Edge-lit health orbs (blue, energy), treasure
          gems (gold brilliant-cut, score) and hazard mines (red spiky, cost a life);
          deep-space gradient + world-space stars. Generic "wall field" engine
          (`world/field.ts`: shared spawn/scroll/recycle/proximity, parameterized per
          kind via a config block; objects implement `world/wallObject.ts`). LIVES +
          invulnerability i-frames (ship flicker); game-over on energy OR lives.
          BUILT + verified (collection/score/life/invuln-guard/restart all checked).
- [x] M3  Combat. Forward gun (Space; energy per shot) + pooled projectiles
          (`world/projectiles.ts`, player + enemy bolts) + magenta raiders
          (`world/enemy.ts` visual, `world/enemies.ts` pool/AI). Aiming = align theta
          and fire; dodging = swing theta off the line - both fall out of the pendulum.
          Raiders fly in, hold an engagement band, strafe (hard-capped so always
          hittable), charge-telegraph then fire back; LETHAL (bolt or ram costs a life
          via the existing hitHazard/i-frames). Kill = score + energy refund (values
          calibrated in M4). BUILT + verified (npm run sim; build + screenshots).
- [x] M4  Difficulty levels. One level = one slow->normal->fast cycle (~30s, derived
          from the tier count x FLIGHT.SECTION_SECONDS, not hard-coded). Per level the
          tier speeds rise per level (a decaying-but-never-zero speed bonus, see
          LEVELS.SPEED_STEP/SPEED_BAND), a score multiplier 1+(level-1)*0.5
          scales gems + kills (NOT distance), and LEVELS.TABLE sets max enemies +
          orb/bomb frequency (speed-normalized via `flight.speedRatioAt` so the
          multipliers mean a per-second rate; a procedural ramp continues past the
          table). Gravity is tier-relative (LEVELS.GRAVITY_MODE 'tier' default:
          full at the level's own slow speed, zero at its own fast speed; 'absolute'
          switch reverts to the global span). Craft speed clamp follows the level's
          fast-tier speed. Scoring: gem 250, kill 750, both x the level multiplier
          (one kill = 3x a gem). HUD shows level + multiplier. BUILT + verified
          (npm run sim:levels: 40 checks; combat sim 14; build; 4-lens adversarial review).
- [x] M5  Gameplay legibility. (a) Energy -> weapon charge: the blue HUD bar is the gun's
          ammo (spent only by firing, refilled by blue orbs + kills) and NEVER ends the run -
          the single fail condition is lives -> 0. Empty disarms the gun (dull dry-fire click,
          red RECHARGE bar; ENEMY.ENERGY_REFUND tuned so a kill is roughly ammo-neutral).
          (b) Run timer (MM:SS.X) on the HUD + the game-over screen. (c) Gem-gated levels:
          a level advances only once its gem quota is collected (LEVELS.GEM_QUOTA_FRACTION of
          one cycle's gems, derived in flight.ts so it scales with the cycle); short at the
          boundary -> the same cycle repeats (no level-up) until met, so passive coasting no
          longer reaches deeper levels. HUD gem pips + a one-time hint. flight.ts is now
          stateful (gated), not pure distance. (d) Score is active-only: the distance/survival
          baseline is removed, so score = gems + kills (x level multiplier) and a pure dodger
          (or a level-1 camper) scores nothing - closing the farm where frozen difficulty +
          accruing distance let camping out-score progressing. BUILT + verified (sim:levels
          gate checks; combat sim incl. passive-scores-0; build; live Playwright: advance on
          quota met / hold when short / pips / movement intact).
- [x] M6  Difficulty curve tuning (playtest: a kid reached ~L17, "too fast, too few
          enemies"). Diagnosis: from ~L9 only speed scaled (linear +5/level, unbounded),
          while enemy count capped at 6 and mine/orb density froze at the L5 table row.
          Fixes: (a) speed bonus is now a decaying-but-never-zero banded increment
          (SPEED_STEP/SPEED_BAND: +5/lvl L1-10, +3 L11-15, +1.5 L16+), so L17 fast is 138
          not 155 and it never plateaus; (b) MAX_ENEMIES_CAP 6 -> 10 (reached ~L17 via the
          existing ramp); (c) mines +10% baseline (SPAWN_SPACING 125 -> 114) plus a gentle
          ramp past the table to a playable floor (BOMB_MULT_STEP/FLOOR, bombMult in
          levels.ts); (d) orb frequency flat across levels (rising speed already makes orbs
          harder to catch) and ENERGY.START 100 -> 60 so early levels feel the meter; (e)
          DAMPING_C 1.0 -> 1.3 (settles at the bottom a bit faster). BUILT + verified
          (sim:levels 40+ checks incl. speed-decay + bomb-floor; combat sim; build). Deep
          enemy aggression (fire-rate scaling, persistence) deliberately deferred - see Next up.
- [x] M7  Feel + fairness (playtest: ship felt sluggish; L6-7 deaths read as luck under
          multi-raider bolt hail; mines could hide inside gems). (a) Snappier steering:
          STEER_TORQUE 19.5 -> 24, STEER_ATTACK 0.07 -> 0.04 (playtest: "more controllable,
          keep it"). (b) Gravity floor: FLIGHT.GRAVITY_FLOOR 0.45 + GRAVITY_CURVE - gravity
          fades slow->fast to a floor, not zero, so fast sections keep a light pendulum pull
          (normal ~0.73 of full, was ~0.51; fast 0.45, was 0 = free rotor). (c) Enemy
          fire-slot cap: ENEMY.FIRE_SLOTS 2 (Galaga-style attack slots) - any number of
          raiders can engage but at most 2 charge/fire at once, so deep-level incoming fire
          stays a readable rhythm instead of scaling with the raider count. (d) Cross-field
          spawn de-confliction: a field (re)spawn avoids the OTHER fields inside the
          SPAWN_CLEAR window (resample angle, then nudge forward), so kinds never stack at
          one (z, theta). BUILT + verified (combat sim: bolt count hard-bounded by the slots;
          NEW fields sim: avoiding pair 0 overlaps vs control pair >0; sim:levels: floor
          gravity; typecheck; 5x repeat runs for the randomized checks).
- [x] M8  Title menu: ship selector + difficulty modes (the kids' request). (a) Three
          selectable hulls in world/ship.ts - RAPTOR (the original fighter), FALCON
          (saucer: faceted lens, offset cockpit, front mandibles), DELTA (rebel-style
          arrowhead: wing plate, spine, canted twin fins) - cosmetic only, shared
          materials + footprint, live turntable 3D preview on the title (SHIP.PREVIEW_*;
          the title panel lost its backdrop blur so the preview stays crisp, game-over
          keeps it). (b) Difficulty selector (config DIFFICULTY): MILKY WAY (slope 0.6),
          ORION (identity - the game as tuned), QUASAR (offset 2.5); flight.tuned() maps
          the played level to the tuning level inside tierSpeed, so speeds, gravity span,
          speed cap, gem quota, and the score multiplier all follow from one function;
          levels.ts rounds it for the enemy/density tables; speedRatioAt stays normalized
          to the UNTUNED base so field densities keep their per-second meaning. (c)
          menu.ts model (rows/keys/localStorage), hud.ts selector rows + difficulty
          readout in the mode's threat color with a 3-slot pip meter (title selector,
          HUD corner above SPD, game-over line). BUILT + verified (sim:levels L1-L6
          difficulty checks; all sims; typecheck; live Playwright: hull cycling, mode
          persistence across reload, QUASAR run scoring 2 gems x 563 = 1126 = the 2.25
          multiplier applied).
- [x] M9  Next level (design, mechanisms and measurements: docs/next-level-spec.md; bot
          results: playtest/next-level.json against playtest/baseline.json). (a) The game
          explains itself: READY / LEVEL / REPEAT are events with sound and banners, the
          gem chime climbs along a chain, threats are heard before they are seen, the
          game-over panel names the cause. (b) Raiders come in waves: formations, depth
          lanes, at most four alive, breathers, a hunter from level 3, raiders leave
          forward, fights at visible range. (c) Gem lines: gems and mines are placed as
          flyable phrases by a director (world/phrases.ts, world/sequencer.ts); the quota
          is known at the start of a level. (d) Physical feel: speed FOV, camera shake,
          hit slow-down, hull yaw and roll (visual only). (e) Climb fade: built, measured,
          switched off (CLIMB.FADE 0). (f) Difficulty curve: ORION is a warm-up for two
          levels and asks for real play from level 3; lives are scarce (first cross after
          1.3 to 2.3 minutes, then every 3 to 4); the gem gate bites from level 4 (quota
          27 of at least 32 gems) and never fails a near-perfect player; MILKY WAY is the
          children's mode. (g) Fairness at the edges: a run opens without mines, raiders
          hold their fire across a cycle boundary, the banners sit above the vanishing
          point, the firing tell is audible under gunfire, far wall objects stay separate
          shapes. Measured (60 seeded runs per bot, cap 900 s): the average bot ends at
          level 7 after 230 s (median; level 8 after 242 s over 400 runs), the good bot at
          level 16 after 464 s, the kid bot on MILKY WAY at level 10 after 322 s, the
          oracle (the fairness guard) loses at most 0.03 lives per 15 minutes in every
          mode and repeats 0.2 levels in 15 minutes. Known gaps against the targets of the
          spec: the good bot loses 0.2 to 0.4 lives a minute at levels 3 to 5 (target 0.8
          to 1.4), the camper is hit as often as the average bot (target 1.5 times), and
          raider bolts cause about 90% of the final blows (target at most 60% for one
          cause) - see the spec, section S6.

### Next up (start here)
1. Play ORION and MILKY WAY by hand and compare with the bot numbers (playtest/README.md).
   The bots are estimates of people, not measurements. The levers, in the order to try
   them: `ENEMY.FIRE_COOLDOWN` / `FIRE_COOLDOWN_DEEP` (bolts per minute; the strongest
   lever on lives lost), `LIFE_SHARD.PER_LIFE` / `PER_LIFE_STEP` (run length: how many kills buy a
   life back; see playtest/README.md),
   `LEVELS.QUOTA_FRACTION_*` (how often a level repeats; `QUOTA_FRACTION_MAX` 0.87 = quota
   28 puts the average bot at 64 to 78% first-try at levels 4 to 8; never go within 2 gems
   of `SEQUENCE.GEMS_PER_CYCLE`), `LEVELS.TABLE` / `BOMB_MULT_FLOOR` (mines),
   `DIFFICULTY.MODES[].ease` (a whole mode). Check with `npm run playtest:compare` and the
   oracle bot after every change.
2. Mines are a weak threat next to raider bolts (about one final blow in eight). A mine
   pattern that asks more of a skilled player without becoming a luck death is open design
   work: the candidates are the fork, staircase and hang phrases the spec left out.
3. Camping (never shooting) costs score but not lives: the camper bot is hit as often as
   the average bot. A second hunter earlier makes the game easier for a player who shoots
   (hunters fire less often than weavers), so it is not the fix. The diver raider of the
   spec (section 4) is the candidate.
4. High-level combat scaling: bolts are SHIP-RELATIVE (projectiles.ts), so the dodge/aim
   geometry is speed-invariant. Open only: bolts may LOOK slow against fast-scrolling walls
   at deep levels; revisit BULLET_SPEED / BOLT_SPEED for feel (not fairness).
5. Combat polish: a muzzle flash on fire and a richer head-on raider silhouette.
6. Deferred by the spec (section 4): tube bends, the diver raider, more phrases.

### Object types on the tube (color-coded language)

| Type       | Look                     | Color             | Interaction                         | Status |
|------------|--------------------------|-------------------|-------------------------------------|--------|
| Charge orb | wireframe sphere         | blue              | ride into - recharges the weapon    | built  |
| Treasure   | brilliant-cut gem        | gold              | ride into - score + level-gate progress | built  |
| Hazard     | naval contact mine       | red               | avoid - hitting costs a life        | built  |
| Life shard | small medkit cross (+)   | bright green      | dropped by every killed raider; ride into - a full set restores 1 life, plus a little weapon charge; score at full lives | built  |
| Extra life | medkit cross (+)         | bright green      | dropped by the last raider of every Nth destroyed squad; ride into - +1 life, capped at LIVES.START, plus an orb's worth of charge; score at full lives | built (the distance-timed variant is switched off, EXTRA_LIFE.ENABLED) |
| Enemy      | forward-swept dart       | magenta           | shoot (forward gun); shoots back, lethal | built  |

Orbs / treasures / hazards / extra-life crosses are all "ride into / avoid" wall
objects sharing the generic `world/field.ts` engine (one `createField(cfg)` per
kind; only the `onHit` effect differs). Orbs and crosses are random fields; gems and
mines are feed fields that the gem-line director fills phrase by phrase (with
`SEQUENCE.ENABLED` false they are random fields too). One pickup declines an encounter when it
has nothing to give: at full charge `game.addEnergy()` returns false and the orb
sails past (`onHit` returns false: no pop, no sound, exactly like a mine grazed during
i-frames). A cross or a life shard is always collected: at full lives it pays score
instead. Life shards are a fifth field, a feed field like gems and mines, filled by raider
kills in `session.ts` (`dropShard`, which also feeds the squad cross into the cross field). They ride at the SHARED derived radius `TUBE.RADIUS -
SHIP.RADIAL_OFFSET` (RIDE_RADIUS) - this is a constraint, not a tunable: the angle-only
hit test (craft.theta vs slot.theta) is only valid when objects sit where the ship rides.

Enemies are NOT a field: a field scrolls objects past at exactly the player's speed
(fixed worldDistance), but a raider must fly in, hold its depth lane ahead, then
leave forward, so each gets its OWN advancing worldDistance (`world/enemies.ts`). It still
rides at RIDE_RADIUS, so the same angle-only tests serve aim (player bolt vs enemy),
dodge (enemy bolt vs ship), and ram. Bolts (`world/projectiles.ts`) also ride there;
their ship-relative z is advanced by the bolt's own speed.

### Systems / backlog
- [x] HUD + score + run timer + weapon-charge meter (blue; spent by firing, orbs/kills
      refill; red RECHARGE when empty) + game-over (with run time) + restart + best (localStorage).
- [x] LIVES + invulnerability i-frames (ship flicker); game-over when lives reach zero (the
      only fail condition - weapon charge running dry just disarms the gun, never ends the run).
- [x] Forward gun + projectiles + magenta raiders (shoot, get shot at; lethal) - see M3.
- [x] Impact bursts: white-hot flash + shard starburst on a kill (magenta) / damage hit
      (orange: mine, ram, enemy bolt), so a hit reads visually, not just by sound (world/burst.ts).
- [x] Difficulty ramp by level (per-level speed, score multiplier, enemy cap, orb/bomb
      frequency) - see M4; gem-gated level advancement - see M5.
- [x] Raider waves with a hunter, gem lines, feedback cues, physical feel, bot playtest
      harness with a recorded baseline - see M9.
- [ ] CRT scanline toggle (bloom already on)
- [x] Web Audio synthesis (procedural SFX + streamed music; continuous engine hum not yet done)
- [x] High-score persistence (localStorage)
- [x] Title screen (intro + controls; Space to start; ship + difficulty menu with 3D preview - M8)
- [ ] Full-loop (360) tube sections
- [ ] Fully rendered surfaces (Descent II direction)
- [ ] Gamepad support

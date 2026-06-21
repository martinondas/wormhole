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
- Dodge obstacles fixed to the tube (rocks, struts, gates); a hit costs a life.
- Forward gun to clear hazards / enemies coming toward you.
- Weapon charge (the blue HUD bar) is the gun's ammo: spent only by firing, refilled by blue
  orbs and kills. At zero the gun is inert until recharged; running dry never ends the run.
- The single fail condition is lives reaching zero (collisions / enemy fire / ram).
- Difficulty ramps with distance: faster, denser obstacles, tighter gaps - this is the run's
  pressure, not a survival clock.
- Death leads to a score screen (score, level reached, run time), then restart. Local best persists.
- HUD is minimal and in-theme (thin green vector text/lines): level, score, best, run time,
  lives, weapon charge, speed.

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
- speed:    SLOW / NORMAL / FAST (the three tier speeds, level-1 base; raised per level
            by LEVELS.SPEED_INCREMENT), EASE (accel toward the active tier). Speed is set
            by the flight tier/section, not a player throttle; FLIGHT.{MODE, SECTION_SECONDS}
            + tube tier colors live alongside.
- levels:   LEVELS.{SPEED_INCREMENT, SCORE_MULT_STEP, GRAVITY_MODE ('tier' default |
            'absolute'), MAX_ENEMIES_CAP, BEYOND_ENEMY_LEVELS, TABLE[] (per-level enemyMax
            + orb/bombSpacingMult - speed-normalized per-second rate multipliers)}
- tube:     TUBE.{RADIUS, RING_SPACING, RINGS_VISIBLE, SEGMENTS_PER_RING, LONGITUDINAL_LINES}
- ship:     SHIP.{Z, RADIAL_OFFSET, SCALE, BANK, LINE_WIDTH, FLASH_HOLD, FLASH_TIME}; RIDE_RADIUS derived
- camera:   CAMERA.{FOV, HFOV_MAX, BACK, RISE, LOOK_AHEAD, ORBIT_FOLLOW, ROLL_FOLLOW, AIM_FOLLOW, FOLLOW_LAG}
- render:   RENDER.{BG_COLOR, FOG_NEAR, FOG_FAR, RING_RGB, LONG_RGB, SHIP_RGB, SHIP_FILL_RGB,
            SHIP_FLASH_RGB, SHIP_LIFE_FLASH_RGB, DPR_CAP, RENDER_SCALE(_LOW), MSAA_SAMPLES(_LOW),
            BLOOM_ENABLED (on), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD}
            (the _LOW variants are the integrated-GPU fallback, auto-selected in scene.ts)
- background:BACKGROUND.{ENABLED, CENTER, MID, EDGE, MID_STOP} gradient; STARS, STAR_ALPHA, STAR_SPREAD_DEG
- pickup:   RADIUS, EDGE_RGB, GLOW_RGB, GLOW_OPACITY, SPIN/BOB; COUNT, SPAWN_* (incl.
            SPAWN_ANGLE = per-kind angle-from-bottom bias), CAPTURE_Z, CAPTURE_ANGLE, POP_TIME/SCALE
- treasure: gem geometry (RADIUS, FACETS, TABLE/CROWN/PAVILION_RATIO, EDGE_THRESHOLD), EDGE/FILL
            colors, SPIN/BOB; field COUNT/SPAWN_*/CAPTURE_*/POP_*; SCORE (points per gem)
- hazard:   naval-mine geometry (CORE_RADIUS big ball, cylindrical horns via
            SPIKE_LEN/BASE_R/TIP_R, EDGE_THRESHOLD), EDGE/FILL colors, SPIN/PULSE; field
            COUNT/SPAWN_* (incl. SPAWN_ANGLE), CAPTURE_*/POP_*; SLOW_DENSITY (slow-section bombs)
- extralife:medkit-cross geometry (ARM/THICK/DEPTH extruded plus, EDGE_THRESHOLD),
            EDGE/FILL colors, SPIN/BOB/PULSE; field COUNT/SPAWN_* (incl. SPAWN_ANGLE),
            CAPTURE_*/POP_* (rare: COUNT 1, large SPACING). +1 life, capped at LIVES.START
- lives:    LIVES.{START, INVULN_TIME}
- weapon:   ENERGY.{MAX,START,PER_ORB,LOW} (weapon charge / ammo; internal name kept as
            ENERGY, HUD label is WEAPON; empty = below GUN.COST -> red bar); SCORE.DIST_RATE
- gun:      COST (charge/shot), COOLDOWN, BOLT_SPEED/TTL, HIT_ANGLE_KILL/HIT_ANGLE/HIT_Z
            (player->enemy: inner cone kills, outer cone chips 1), BULLET_HIT_ANGLE/Z
            (enemy bolt->ship dodge window)
- enemy:    HP, SCORE (per kill), ENERGY_REFUND; COUNT/SPAWN_*/RECYCLE; ENGAGE band + speeds
            (CLOSE/STATION/DEPART deltas relative to craft.speed); STRAFE_* (hard-capped <<
            player STEER_OMEGA_MAX = hittability), FIRE_COOLDOWN/CHARGE_TIME/BULLET_SPEED,
            RAM_ANGLE/Z; dart geometry + EDGE/FILL/CHARGE colors, SCALE/BANK/POP_*
- projectile: MAX_PLAYER/MAX_ENEMY (fixed pools), LENGTH/LINE_WIDTH, PLAYER_RGB/ENEMY_RGB
- input:    INPUT.{left, right} steer; fire = Space; plus start / confirm (Enter: game-over
            -> title, resume-from-pause) / mute / pause / modeCycle (G) / perf (P) bindings

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
Hand-built procedural low-poly spacecraft - a winged fighter (X-wing-ish): central fuselage,
cockpit, swept wings, engine pods. Rendered as glowing edge lines (`Line2`) over a near-black
emissive fill. Banks with the swing. Must already look polished in M1 - this is the hero asset,
no placeholder arrowhead. Built in code (no external model files) to stay offline, readable,
and on-aesthetic.

## Repo structure
    index.html, package.json, tsconfig.json, vite.config.ts, CLAUDE.md
    src/
      main.ts              bootstrap, canvas, resize, start loop, WH debug handle
      config.ts            ALL tunable constants, grouped (see above)
      loop.ts              fixed-timestep accumulator; update vs render split
      input.ts             keyboard -> steer (left/right) / fire (Space)
      craft.ts             player state: pendulum + speed + smoothed steer (level-aware speed clamp)
      flight.ts            distance-based level + section model: per-level tier speeds, score
                           multiplier, tier-relative gravity, speed cap, tier/level lookups
      levels.ts            per-level difficulty tuning (enemy cap + field density), derived from flight
      audio.ts             Web Audio mixer: streamed music + decoded/synth SFX (wired in main.ts)
      gun.ts               forward-gun trigger: cooldown + charge spend; returns fire/dry intent
      util/math.ts         clamp / approach / lerp / angleDiff (shared signed angle delta)
      physics/pendulum.ts  theta integrator (damped driven pendulum)
      world/tube.ts        build + scroll the wireframe tube mesh
      world/ship.ts        procedural 3D spacecraft hull (edge-lit); place on wall from theta
      world/field.ts       generic wall-object pool (orbs/gems/mines): spawn/scroll/recycle + angle hit
                           test; optional spacingScaleAt hook for per-section / per-level density
      world/wallObject.ts  the {object,update,setResolution,setOpacity} contract for field objects
      world/edgeLitSolid.ts shared builder: near-black fill + glowing fat-line edges (gem/mine/cross/raider)
      world/pickup.ts      blue health orb / treasure.ts gold gem / hazard.ts red mine /
                           extraLife.ts green medkit-cross (rare +1 life) (edge-lit WallObjects)
      world/enemy.ts       magenta forward-swept-dart hull (edge-lit; charge tell + death fade)
      world/enemies.ts     raider pool + 4-state FSM (approach/engage/depart/dead), own worldDistance; NOT a field
      world/projectiles.ts one pooled bolt system (player + enemy bolts; camera-facing diamond glyph)
      game.ts              run state: weapon charge refill/spend, run timer, score, lives, game-over, best
      hud.ts               DOM HUD overlay (level/score/best/time/weapon/lives/speed + game-over)
      render/scene.ts      Three scene/camera/renderer + bloom composer, fog/fade
      render/camera.ts     chase follow + bank from theta (sin-based, smooth loops)
      render/background.ts deep-space gradient backdrop (scene.background)
      render/stars.ts      world-space starfield (follows camera pos, holds orientation)
      render/perf.ts       toggleable FPS / frame-time overlay (P key)
    scripts/shoot.ts       Playwright screenshot (SET_THETA/HOLD/POSE/COMBAT; logs state)
    scripts/combat-sim.ts  headless behavior sim of the combat loop (npm run sim; bundled via esbuild)
    scripts/levels-sim.ts  headless sim of the level math: boundaries, speeds, multiplier,
                           gravity modes, density normalization (npm run sim:levels)

## Dev commands
- Install:    `npm install`
- Run (dev):  `npm run dev`   then open the printed localhost URL
- Build:      `npm run build` (output in `dist/`, static + offline)
- Preview:    `npm run preview`
- Typecheck:  `npm run typecheck` (`tsc --noEmit`; also the first half of build)
- Screenshot: `npm run shoot` (Playwright headless capture for visual self-check)
- Combat sim: `npm run sim` (headless behavior checks for the gun/enemies/projectiles loop)
- Levels sim: `npm run sim:levels` (headless checks for the level / difficulty math)

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
          tier speeds rise by LEVELS.SPEED_INCREMENT, a score multiplier 1+(level-1)*0.5
          scales gems + kills (NOT distance), and LEVELS.TABLE sets max enemies +
          orb/bomb frequency (speed-normalized via `flight.speedRatioAt` so the
          multipliers mean a per-second rate; a procedural ramp continues past the
          table). Level tracking is distance-based (`flight.ts` locate() over cumulative
          cycle lengths). Gravity is tier-relative (LEVELS.GRAVITY_MODE 'tier' default:
          full at the level's own slow speed, zero at its own fast speed; 'absolute'
          switch reverts to the global span). Craft speed clamp follows the level's
          fast-tier speed. Scoring: SCORE.DIST_RATE 0.7, gem 250, kill 750 (level-1
          target: all gems ~= 3x distance, one kill = 3x a gem). HUD shows level +
          multiplier. BUILT + verified (npm run sim:levels: 40 checks; combat sim 14;
          build; 4-lens adversarial review).

### Next up (start here)
1. Enemy persistence (change a little at a time): raiders currently ENGAGE then
   DEPART/recycle (they "give up"). Goal: on engage-timeout, hold and slowly close the
   band instead of departing, with fire rate rising as they get nearer. Raw count per
   level is already a LEVELS.TABLE lever; persistence is its own increment.
2. High-level combat scaling: ENEMY.BULLET_SPEED / GUN.BOLT_SPEED are not scaled per
   level, so at deep levels craft speed approaches enemy bolt speed. Scale bolt speeds
   (or lead) with level once high levels are actually reached in playtest.
3. Combat polish deferred from M3: a shard-burst death (currently the expand+fade pop),
   a muzzle flash on fire, and a richer head-on raider silhouette. Playtest the near-edge
   enemy-bolt dodge window (ENGAGE_Z_NEAR) and only widen it if it reads as unfair.
4. Watch: enemies + the three fields are independent streams, so objects can overlap at
   nearly the same (z, theta). Mitigated by staggered spawns + color/shape dominance; add
   cross-stream de-collision ONLY if playtesting shows it is unfair - do not build it preemptively.

### Object types on the tube (color-coded language)

| Type       | Look                     | Color             | Interaction                         | Status |
|------------|--------------------------|-------------------|-------------------------------------|--------|
| Charge orb | wireframe sphere         | blue              | ride into - recharges the weapon    | built  |
| Treasure   | brilliant-cut gem        | gold              | ride into - score points            | built  |
| Hazard     | naval contact mine       | red               | avoid - hitting costs a life        | built  |
| Extra life | medkit cross (+)         | bright green      | ride into (rare) - +1 life, capped at LIVES.START | built  |
| Enemy      | forward-swept dart       | magenta           | shoot (forward gun); shoots back, lethal | built  |

Orbs / treasures / hazards / extra-life crosses are all "ride into / avoid" wall
objects sharing the generic `world/field.ts` engine (one `createField(cfg)` per
kind; only the `onHit` effect differs). Two pickups decline an encounter when they
have nothing to give: at full charge `game.addEnergy()` returns false (the orb
sails past) and at full lives `game.addLife()` returns false (the cross passes
through). Both return false from `onHit`, so the object passes through with no pop /
no sound, exactly like a mine grazed during i-frames. They ride at the SHARED derived radius `TUBE.RADIUS -
SHIP.RADIAL_OFFSET` (RIDE_RADIUS) - this is a constraint, not a tunable: the angle-only
hit test (craft.theta vs slot.theta) is only valid when objects sit where the ship rides.

Enemies are NOT a field: a field scrolls objects past at exactly the player's speed
(fixed worldDistance), but a raider must fly in, hold an engagement band ahead, then
peel off, so each gets its OWN advancing worldDistance (`world/enemies.ts`). It still
rides at RIDE_RADIUS, so the same angle-only tests serve aim (player bolt vs enemy),
dodge (enemy bolt vs ship), and ram. Bolts (`world/projectiles.ts`) also ride there;
their ship-relative z is advanced by the bolt's own speed.

### Systems / backlog
- [x] HUD + score + run timer + weapon-charge meter (blue; spent by firing, orbs/kills
      refill; red RECHARGE when empty) + game-over (with run time) + restart + best (localStorage).
- [x] LIVES + invulnerability i-frames (ship flicker); game-over when lives reach zero (the
      only fail condition - weapon charge running dry just disarms the gun, never ends the run).
- [x] Forward gun + projectiles + magenta raiders (shoot, get shot at; lethal) - see M3.
- [x] Difficulty ramp with distance (levels: per-level speed, score multiplier, enemy
      cap, orb/bomb frequency) - see M4.
- [ ] CRT scanline toggle (bloom already on)
- [x] Web Audio synthesis (procedural SFX + streamed music; continuous engine hum not yet done)
- [x] High-score persistence (localStorage)
- [x] Title screen (intro + controls; Space to start)
- [ ] Full-loop (360) tube sections
- [ ] Fully rendered surfaces (Descent II direction)
- [ ] Gamepad support

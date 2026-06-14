# CLAUDE.md - Wormhole (working name "Vector Tube")

## Overview
Wormhole is a small, polished retro-inspired "tube flyer": a first-person / chase-cam craft on
a constant forward run down the inside of a long circular tube, rendered as glowing neon
wireframe on near-black in a Tron aesthetic (spirit of Psyborg, S.T.U.N. Runner, Tunnels of
Armageddon, but with modern execution). It is retro-INSPIRED, not retro-cheap: the look should
read as a modern machine doing a vector look, not a 1990s mockup. The soul of the game is the
movement: the craft is not free-flying - it hangs near the bottom of the tube under a
gravity-like pull and steers only left / right, climbing the curved wall like a pendulum.
Pumping left-right-left builds amplitude to ride high up the wall, or all the way over the top.
Getting that swing to feel weighty and momentum-driven is the single most important thing here.

## Game design spec (condensed)
- Constant forward motion; the craft never halts. Speed is changeable: a cruise baseline,
  throttle/boost to accelerate, ease off to slow toward a floor above zero (never to a stop).
- Steer left / right to ride up the walls (pendulum swing, see Physics).
- Collect pickups around the tube wall (rings / energy pods) for score and to refill energy.
- Dodge obstacles fixed to the tube (rocks, struts, gates); hits cost energy or a life.
- Forward gun to clear hazards / enemies coming toward you.
- Energy/time drains continuously; running out ends the run. Pickups extend it.
- Difficulty ramps with distance: faster, denser obstacles, tighter gaps.
- Death / out-of-energy leads to a score screen, then restart. Local high score persists.
- HUD is minimal and in-theme (thin green vector text/lines): score, energy/time, lives, speed, distance.

## Physics model - the damped, driven pendulum (the heart of the game)
The craft's position is an angle `theta` around the circular cross-section of the tube
(`theta = 0` is the bottom). It is integrated each fixed timestep as a damped, driven pendulum:

    angAccel = -GRAVITY_K * sin(theta)   // gravity pulls toward bottom
             - DAMPING_C  * omega        // light damping; overshoots but eventually settles
             + steerTorque               // steering input (left/right), ramped via attack/release
    omega += angAccel * dt
    theta += omega * dt                  // theta is UNBOUNDED: a hard pump can loop over the top

- Steering is a continuous torque while a key is held (a tap = a brief torque). No velocity
  clamp - a clamp would flatten the feel; damping is what tames runaway.
- Integrator: semi-implicit (symplectic) Euler at a fixed substep, decoupled from rendering.
- Forward position advances at the current speed; tube geometry scrolls toward the camera.
- Tube cross-section is a FULL circle; `theta` wraps past the top so over-the-top loops are
  possible when pumped hard. Tuning controls how reachable the top is.

### Tunable constants (live in `src/config.ts`, grouped; values are starting points, tune freely)
- physics:  GRAVITY_K, DAMPING_C, STEER_TORQUE, STEER_ATTACK, STEER_RELEASE, PHYSICS_HZ
- speed:    SPEED_CRUISE, SPEED_MIN (floor > 0, never halt), SPEED_MAX (boost cap),
            THROTTLE_ACCEL, BOOST_ACCEL, EASE_DECEL
- tube:     TUBE_RADIUS, RING_SPACING, RINGS_VISIBLE, SEGMENTS_PER_RING, LONGITUDINAL_LINES
- camera:   CAM_BACK, CAM_RISE, CAM_FOV, CAM_ROLL_FOLLOW, CAM_ROLL_LAG
- render:   RING_RGB, LONG_RGB, SHIP_RGB, FOG_NEAR, FOG_FAR, RENDER_SCALE, MSAA_SAMPLES,
            BLOOM_ENABLED (on), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD
- background:BACKGROUND.{CENTER,MID,EDGE,MID_STOP} gradient; STARS, STAR_ALPHA, STAR_SPREAD_DEG
- pickup:   RADIUS, EDGE_RGB, GLOW_RGB, GLOW_OPACITY, SPIN/BOB; COUNT, SPAWN_*, CAPTURE_Z,
            CAPTURE_ANGLE, POP_TIME

### Camera feel (decided default, easy to change)
Chase cam sits behind and slightly above the craft AT the craft's angular position, so it
orbits the tube to stay behind the ship and the world appears to rotate as you swing. Roll
follows `theta` with lag (`CAM_ROLL_FOLLOW`, `CAM_ROLL_LAG`) so fast swings feel weighty and
you still see a little wall ahead. Going over the top rolls the view through the loop.

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
      input.ts             keyboard -> steering + throttle/boost signals
      craft.ts             player state: pendulum + speed + smoothed steer
      util/math.ts         clamp / approach / lerp
      physics/pendulum.ts  theta integrator (damped driven pendulum)
      world/tube.ts        build + scroll the wireframe tube mesh
      world/ship.ts        procedural 3D spacecraft hull (edge-lit); place on wall from theta
      world/pickup.ts      one blue health orb (wireframe icosphere + blue fill)
      world/pickups.ts     orb pool: spawn around wall, scroll, ride-into collect
      render/scene.ts      Three scene/camera/renderer + bloom composer, fog/fade
      render/camera.ts     chase follow + bank from theta (sin-based, smooth loops)
      render/background.ts deep-space gradient backdrop (scene.background)
      render/stars.ts      world-space starfield (follows camera pos, holds orientation)
    test/                  vitest (pendulum math) - added when useful
    scripts/shoot.ts       Playwright screenshot (SET_THETA/HOLD/SETTLE; logs state)

## Dev commands
- Install:    `npm install`
- Run (dev):  `npm run dev`   then open the printed localhost URL
- Build:      `npm run build` (output in `dist/`, static + offline)
- Preview:    `npm run preview`
- Screenshot: `npm run shoot` (Playwright headless capture for visual self-check)

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
- [~] M2  Pickups + atmosphere. Blue wireframe health orbs (edge-lit), deep-space
          gradient backdrop + world-space stars, muted tube green. Spawner +
          ride-into collection (pop + WH.pickups.count) DONE. Scoring display +
          the health/energy meter + HUD still to come.

### Backlog (recorded, not built yet)
- [ ] Scoring display + health/energy meter + HUD + game-over loop
- [ ] Obstacles and collisions
- [ ] Forward gun and enemies
- [ ] Energy/time meter and game-over loop
- [ ] Difficulty ramp with distance
- [ ] CRT scanline toggle (bloom already on)
- [ ] Web Audio synthesis (bleeps, engine hum rising with speed)
- [ ] High-score persistence (localStorage)
- [ ] Title screen
- [ ] Full-loop (360) tube sections
- [ ] Fully rendered surfaces (Descent II direction)
- [ ] Gamepad support

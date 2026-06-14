# CLAUDE.md - Wormhole (working name "Vector Tube")

## Overview
Wormhole is a small, polished retro "tube flyer": a first-person / chase-cam craft on a
constant forward run down the inside of a long circular tube, drawn entirely as glowing
green wireframe lines on black (a phosphor-CRT homage in the spirit of Psyborg, S.T.U.N.
Runner, and Tunnels of Armageddon). The soul of the game is the movement: the craft is not
free-flying - it hangs near the bottom of the tube under a gravity-like pull and steers only
left / right, climbing the curved wall like a pendulum. Pumping left-right-left builds
amplitude and lets you ride high up the wall, or all the way over the top. Getting that swing
to feel weighty and momentum-driven is the single most important thing in this project.

## Game design spec (condensed)
- Constant forward motion down the tube. Player cannot stop; later can modulate speed in a range.
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
- speed:    FORWARD_SPEED (fixed for M1); later SPEED_MIN, SPEED_MAX, SPEED_ACCEL
- tube:     TUBE_RADIUS, RING_SPACING, RINGS_VISIBLE, SEGMENTS_PER_RING, LONGITUDINAL_LINES
- camera:   CAM_BACK, CAM_RISE, CAM_FOV, CAM_ROLL_FOLLOW, CAM_ROLL_LAG
- render:   LINE_COLOR, BG_COLOR, FOG_NEAR, FOG_FAR, DPR_CAP, BLOOM_ENABLED (off in M1)

### Camera feel (decided default, easy to change)
Chase cam sits behind and slightly above the craft AT the craft's angular position, so it
orbits the tube to stay behind the ship and the world appears to rotate as you swing. Roll
follows `theta` with lag (`CAM_ROLL_FOLLOW`, `CAM_ROLL_LAG`) so fast swings feel weighty and
you still see a little wall ahead. Going over the top rolls the view through the loop.

## Tech stack and why
- TypeScript (strict) + Vite + Three.js. No game engine, no heavy frameworks.
- Three.js + WebGL chosen over hand-rolled 2D canvas: GPU does projection + depth + distance
  fog, banking is a cheap quaternion, and `UnrealBloomPass` gives the CRT glow on the GPU.
  WebGL clamps line width to 1px on most drivers, but with bloom a thin bright core + halo IS
  the phosphor look. Canvas-2D glow (`shadowBlur`) and bloom are fill-rate killers on the
  target 2020 Intel iMac (AMD Radeon), which is the machine we must not assume is fast.
- Wireframe via `LineSegments` (and `Line2`/`LineMaterial` only if fat lines are ever needed).
- No backend, no accounts. Builds to a static bundle that runs fully offline from a local folder.
- Target browsers: current Chrome and Safari on macOS.

## Repo structure
    index.html, package.json, tsconfig.json, vite.config.ts, CLAUDE.md
    src/
      main.ts              bootstrap, canvas, resize, start loop
      config.ts            ALL tunable constants, grouped (see above)
      loop.ts              fixed-timestep accumulator; update vs render split
      input.ts             keyboard -> steering signal (held = torque)
      physics/pendulum.ts  theta integrator (damped driven pendulum)
      world/tube.ts        build + scroll the wireframe tube mesh
      world/ship.ts        craft wireframe; place on wall from theta
      render/scene.ts      Three scene/camera/renderer, fog/fade
      render/camera.ts     chase follow + bank from theta/omega
    test/                  vitest (pendulum math) - added when useful
    scripts/shoot.ts       Playwright screenshot of the running canvas (self-verify)

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
- Performance budget: steady 60 fps with headroom on a 2020 Intel iMac. Cap devicePixelRatio
  (`DPR_CAP`). Reuse geometries/materials; avoid per-frame allocations in update/render. Profile
  and flag anything that risks the budget.
- No em / en dashes in any text output (house style): use a spaced hyphen " - ".

## Working agreement
- Be direct; lead with the point. Challenge design choices that do not add up, with reasoning.
- Plan before coding. Build in thin vertical slices; get one feeling right and running before the next.
- Show the running result each slice and say exactly how to see it; self-verify visually, not just compile.
- Git from the first commit. Small, descriptive commits. Never leave the repo in a broken state.

## Milestones / TODO (living)
- [x] M0  Scaffold: Vite + TS (strict) + Three.js, blank green canvas, git, Playwright shoot. (in progress)
- [ ] M1  Scrolling wireframe tube + pendulum craft + banking chase cam, controllable, 60 fps,
          constants exposed. NO pickups/shooting/HUD yet. <- current target, then stop for playtest.

### Backlog (recorded, not built yet)
- [ ] Pickups and scoring
- [ ] Obstacles and collisions
- [ ] Forward gun and enemies
- [ ] Energy/time meter and game-over loop
- [ ] Difficulty ramp with distance
- [ ] CRT bloom / scanline toggle
- [ ] Web Audio synthesis (bleeps, engine hum rising with speed)
- [ ] High-score persistence (localStorage)
- [ ] Title screen
- [ ] Full-loop (360) tube sections
- [ ] Gamepad support

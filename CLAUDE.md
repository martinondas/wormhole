# CLAUDE.md - Wormhole

[README.md](README.md) describes the game for players: what it is, controls, how to run it.
This file holds the spirit of the game and what a session needs to work in the code. The code
and `src/config.ts` are the only source of current behaviour and values.

## Spirit
- The movement is the soul of the game. The craft hangs under a gravity-like pull and steers
  only left and right, so it swings like a pendulum and carries momentum.
- Fun and playability come first.
- The game is simple to learn: a new player understands it by playing.
- The look is retro-inspired on a modern 3D engine: simple glowing vector shapes, not a cheap
  copy of an old game.

## Leanings
These are notes from discovery, not rules. Play and evidence override them.
- Active play tends to work better when it pays more than passive play.
- A reward works when the player sees it coming.
- A threat feels fair when the player can see it in time to react.
- What counts as a hit feels right when it matches what is drawn.
- Rules are easier to learn when similar things behave alike.
- Variety inside clear rules keeps repeated play interesting: opponents that do not act the
  same way every time, and sequences that are designed, not random.
- Difficulty holds up better when it does not rest on a single source.
- A value that suits a beginner often does not suit a skilled player. Letting it change with
  the level has worked so far.

The reasons behind these notes, with what was tried and rejected, are in
[docs/next-level-spec.md](docs/next-level-spec.md).

## How the game works today
An orientation, not a specification. Read the code for behaviour and `src/config.ts` for values.
- The craft flies forward without a throttle and without stopping. The player steers left and
  right and fires a forward gun.
- The tube is a sequence of sections in speed tiers. A tier sets the speed and the strength of
  gravity, and the wall colour shows the tier. One pass through the tiers is a cycle.
- Levels are gem-gated: when a level's gem quota is met, a gate ring appears ahead in the tube,
  and the level changes where the craft flies through it. A level lasts until its gems are
  collected. The speed sections cycle on their own clock.
- Gems and mines come as gem lines: authored phrases placed on the path that a simulated pilot
  flies. A director sequences the phrases. Mines sit beside the line, not on it.
- Raiders arrive as squads. A wave director sets formations, depth lanes and breathers. One
  member can be a hunter that follows the player. A cap limits how many raiders fire at once,
  and every shot is announced.
- Lives are lost to mines, bolts, rams and blasts, and are earned back through kills: raiders
  the gun destroys leave green crosses to catch. Now and then a rare bonus cross appears on its
  own. Lives reaching zero is the only way a run ends.
- A player bolt detonates a mine. Within a fixed distance on the wall, the blast destroys
  raiders, gems, orbs and crosses, sets off other mines, and costs a life if the ship is in it.
  The gun pays, the blast only clears: nothing a blast destroys pays.
- Weapon charge is the gun's ammunition. Blue orbs, kills and green crosses refill it. An empty
  gun does not end the run.
- Score comes from gems and kills, times a level multiplier. Passive flight earns nothing.
- The three difficulty modes are one mapping from the played level to a tuning level. Speeds,
  quota, raiders, mines and the score multiplier derive from the tuning level.
- The selectable hulls are cosmetic: same handling, same hit windows.

## Physics model - the damped, driven pendulum
The craft's position is an angle `theta` around the circular cross-section of the tube
(`theta = 0` is the bottom):

    angAccel = -GRAVITY_K * sin(theta)   // gravity pulls toward the bottom
             - DAMPING_C  * omega        // light damping: overshoots, then settles
             + steerTorque               // steering input, ramped by attack and release
    omega += angAccel * dt
    theta += omega * dt                  // theta is unbounded: a hard swing loops over the top

- The integrator is semi-implicit Euler at a fixed step, decoupled from rendering.
- There is no hard clamp on `omega`. A soft cap fades the steering torque as the spin nears
  `PHYSICS.STEER_OMEGA_MAX`. Gravity is not capped, so a dive from high up keeps its momentum.
- Gravity fades from the slow tier to the fast tier down to a floor, never to zero
  (`FLIGHT.GRAVITY_FLOOR`), so every tier has a pendulum pull.
- `stepSwing` in `src/craft.ts` is the one swing step. The craft, the simulated pilot of the
  gem lines and the bots all call it. There is no second copy of the integrator.
- The chase camera follows `sin(theta)`, so it rests at zero at the bottom and stays continuous
  over the top.

## Tech stack and visual style
- TypeScript (strict), Vite, Three.js. No game engine, no backend, no accounts. The build is a
  static bundle that runs offline from a local folder. Targets: current Chrome and Safari on macOS.
- The look: neon lines on near-black in the spirit of Tron, near-white line cores that bloom
  into colour, fog into the distance. Bloom (`UnrealBloomPass`) is on by default. It is the look.
- Objects are edge-lit solids: glowing fat lines (`Line2`) over a near-black fill
  (`src/world/edgeLitSolid.ts`), built in code with no model files. They read as solid forms,
  not as see-through wire cages.
- Hard limits: no flat solid-colour planes (no "Roblox" look) and no fully textured or lit
  surfaces.
- Colour carries meaning (collect, recharge, avoid, life, enemy). White-hot on a raider's nose
  means one thing only: a shot comes down this line.
- Performance: steady 60 fps with headroom on a 2020 27-inch iMac with a 5K display. Do not
  render bloom at native 5K. `RENDER.RENDER_SCALE` is the main lever: render scene and bloom
  below native resolution and upscale. Reuse geometries and materials. No per-frame allocations
  in update or render.

## Code map (only what is not obvious)
- `src/session.ts` is the single module that wires the gameplay. It is free of rendering, audio
  and DOM, which attach through `SessionFx` events. The browser (`src/main.ts`) and the bot
  harness run the same module.
- Gameplay randomness goes through the seeded generator in `src/util/rng.ts`, never
  `Math.random`. Cosmetic effects may use `Math.random`. This is what makes bot runs reproducible.
- All tunable numbers live in `src/config.ts`, grouped. Level formulas live in `src/levels.ts`
  and `src/flight.ts`. `flight.tuned()` is the mapping from played level and mode to the tuning
  level.
- Wall objects (orbs, gems, mines, crosses) share the generic field engine in
  `src/world/field.ts`. They all ride at one shared radius (`RIDE_RADIUS`). This is a
  constraint, not a tunable: it is what makes the angle-only hit test valid.
- Raiders (`src/world/enemies.ts`) are not a field, because each raider has its own distance:
  it flies in, holds a depth lane and leaves. Raiders and bolts ride at the same radius, so
  aiming, dodging and ramming use the same angle-only test.
- Gem lines: phrases are data in `src/world/phrases.ts`. The director is `src/world/sequencer.ts`.
- Mine blasts: the rules are pure functions in `src/world/blast.ts`, used by the game and the
  bots. `src/world/blastFx.ts` only draws a blast that the game has already decided.
- The feel layer (speed field of view, shake, hit-stop, hull attitude, far-object scale) is
  visual only and does not touch the craft state.
- Fields, raiders and bolts expose a read-only `visit()`. The bots see the world only through it.
- `docs/next-level-spec.md` holds the design and decision notes. `playtest/` holds the bot
  harness results and its README. The harness code is in `scripts/playtest/`.

## Dev commands
- `npm install`, `npm run dev`, `npm run build` (static output in `dist/`), `npm run preview`
- `npm run typecheck` - checks `src/`, then `scripts/` through `tsconfig.playtest.json`.
  `scripts/node-shim.d.ts` declares the Node APIs the scripts use (see Open questions).
- `npm run shoot` - Playwright screenshot for a visual check
- Headless checks of one part each: `npm run sim` (combat), `sim:levels`, `sim:fields`,
  `sim:sequence`, `sim:feel`
- Bot playtests: `npm run playtest`, `playtest:compare`, `playtest:baseline`, `playtest:next`,
  `playtest:live` - see [playtest/README.md](playtest/README.md)

## Coding conventions
- TypeScript strict mode. Small, typed, modular files. No early abstraction: refactor when a
  third case appears. Match the surrounding style.
- Tunable numbers go in `src/config.ts`, not in the code that uses them.
- A new kind of object or threat is also added to the bots' perception, or the bots cannot see it.
- No em or en dashes in any text: use a spaced hyphen " - ".

## Working agreement
- Be direct and lead with the point. Challenge design choices that do not add up, with reasons.
- Plan before coding. Build in thin vertical slices. Get one feeling right and running before
  the next.
- Show the running result and say how to see it. Verify by looking, not only by compiling.
- Small, descriptive commits. The repo is never left in a broken state.

## Open questions
- Deep levels are clearly easier for the skilled bot since the hit area follows the drawn size
  of a raider. Tighter deep raider fire offsets the exploding mines, not this easing.
- Weapon charge: the bots aim better than a person, so they cannot calibrate it.
- Camping: a player who never shoots earns no lives and little score, but is hit no more often
  than a fighter.
- Far raiders are small at deep-level speeds.
- Exploding mines: the risk of a player's own blast, the gems a blast costs, and the look and
  sound. See the last note of "Exploding mines" in `docs/next-level-spec.md`.
- The perfect bot is hit a little more often on the middle mode since the level gate, though
  it never dies. The hits are not near a gate. The cause is not found.
- A beginner loses more ships to mines since the slalom mines sit near the floor. If it is too
  hard, hold the second slalom mine back until a later level.
- The three hulls have the same width, and the hit areas are smaller than every hull as drawn.
  The owner accepted this.
- Not judged by a person yet: the cue for a cross caught at full lives. Not tested since the
  latest work: Safari, and the 5K iMac target.
- `@types/node` is not installed, because this worktree shares `node_modules` with the main
  checkout. `scripts/node-shim.d.ts` stands in for it.
- Backlog ideas, none decided: a CRT scanline toggle, a continuous engine hum, full-loop tube
  sections, fully rendered surfaces in the Descent II direction, gamepad support.

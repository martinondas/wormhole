# Wormhole - next-level spec

Status: design for the next version, built on branch `feature/next-level` in the worktree
`/Users/work/gh/wormhole-next`. `CLAUDE.md` describes the game as it is today. This document
describes the target state. Where the two differ, this document is the target, and the last
slice brings `CLAUDE.md` in line with it.

Numbers marked "baseline" come from `playtest/baseline.json` (60 seeded runs per bot, cap
900 s). Numbers marked "target" are design targets. The bots are not calibrated against
people, so targets are used to compare versions, not to predict what a person reaches.
Constants marked "start value" are tuned inside their slice against the stated acceptance
criteria.

## 1. What the player gets

Controls: left, right, fire. Colors: gold = collect, blue = weapon charge, red = avoid,
green = life, magenta = enemy, white-hot nose = "a shot is coming down this line". Nothing
new has to be learned.

The first two minutes on ORION:

- **0:00** The run starts at the slow tier's own speed. Ahead, four gold gems curve up the
  right wall as a dotted line. Holding right for half a second rides the line, releasing
  lets gravity carry the craft back down through the last gem. Each gem in a row chimes one
  note higher.
- **0:10** The tube turns green and the view opens a little as the craft speeds up. Two
  raiders arrive side by side, each in its own depth lane, not as one clump. Both are
  killed, a soft chime marks the cleared wave, and there are five quiet seconds with a gem
  line to fly.
- **0:20** Blue section. A ring of gems runs all the way around the tube. One long hold
  carries the craft over the top, with a rising swoosh at the apex.
- **0:27** The last needed gem pops: a three-note chime, the gem row shows READY.
- **0:30** The cycle ends: the tube flashes, a rising sting plays, the banner reads
  `LEVEL 2  x1.5`. If the quota was missed, an amber `REPEAT - 9/12 GEMS` banner and a soft
  two-note cue say why the level did not change.
- **1:00** Level 3. One raider in the squad does not weave. It slides around the tube until
  it is under the craft, stops, its nose goes white with a rising whine from that side, and
  it fires down that line. Staying parked is hit. Swinging away is safe, and the frozen
  raider is an easy kill. No spot on the wall stays safe.
- **Any hit** The view jolts, time slows for a fifth of a second so the cause is visible,
  and the game-over panel names what ended the run.

What stays exactly as it is: the pendulum handling in the lower half of the tube, the hit
windows, the object looks and colors, score = gems + kills times the level multiplier, the
gem gate, the three difficulty modes, the three hulls, the mostly still chase camera.

## 2. Rules for every slice

- Each slice leaves the game fully playable and all checks green: `npm run typecheck`,
  `npm run sim`, `npm run sim:levels`, `npm run sim:fields`, `npm run build`, plus any sim
  the slice adds.
- `src/session.ts` is the only place that wires gameplay. Rendering, audio and HUD attach
  through `SessionFx`. The harness plays the same module as the browser.
- Gameplay randomness uses `src/util/rng.ts`. Cosmetic randomness may use `Math.random`.
- Fields, raiders and bolts keep their read-only `visit()`. A new kind of object, threat or
  tell is added to `scripts/playtest/perception.ts` and `scripts/playtest/bot.ts` in the same
  slice, so the bots see what a player sees.
- No per-frame allocation in update or render. All feel constants live in `src/config.ts`.
- Hit tests stay angle-only at `RIDE_RADIUS`. Everything a player can touch rides there.
- Fairness constants are fixed: `ENEMY.CHARGE_TIME` 0.45, `ENEMY.BULLET_SPEED` 90,
  `ENEMY.FIRE_SLOTS` 2, `ENEMY.STRAFE_OMEGA_MAX` 3.2, hold-theta-while-charging, fire only
  when clearly ahead, i-frames, `GUN.HIT_ANGLE_KILL` / `HIT_ANGLE`, all capture windows.
- Verification per slice has two parts. Bots: `npm run playtest:compare` (and
  `npm run playtest -- --levels` where per-level numbers are named). Eye:
  `npm run playtest:live` screenshots, looked at by the engineer. A slice is not done on
  numbers alone.
- The oracle bot is the fairness guard for every slice: at most 0.3 lives lost per
  15-minute run on ORION (baseline 0.1).

## 3. Slices

Order: S1 feedback, S2 raiders, S3 gem lines, S4 physical feel, S5 swing (keep or revert),
S6 difficulty tuning. S1 to S4 each stand alone. S5 is an experiment with an explicit
decision rule. S6 tunes whatever is in the build at that point.

---

### S1. The game explains itself (feedback, small fixes, harness extensions)

**Player experience.** The gem gate, the main progression rule, is audible and visible:
READY, LEVEL UP and REPEAT are events. Threats can be heard before they are seen. Skill
moments (a gem row, a loop, a close mine) get a sound. The cause of death is named.

**Harness extensions (done first, on unchanged gameplay).**

- Bot `spinner`: holds one steer key for the whole run and fires constantly.
- Bot `tapper`: rests at the bottom, collects nothing, fires at raiders on its line. When a
  raider on its line shows the charge tell, it reacts after 250 ms with a 150 ms tap away
  and then releases. It measures the "I dodged and it still hit me" case.
- Metrics added to `RunResult` and the report:
  - `killDistanceMedian`, `killsBeyond60Share` - ship-relative distance of kills.
  - `clumpShare` - share of time with two live raiders within 0.4 rad and 10 units.
  - `tellToArrivalMin` - shortest time from a charge start to that bolt reaching the ship plane.
  - `lifeBalance` - extra lives collected divided by lives lost.
  - `chainHits` - lives lost within 1.0 s after the i-frames of the previous hit ended.
  - `gateFirstTry` per level - share of first cycles of a level that ended with the quota met.
  - `gemChainMedian`, `gemChainMax` - consecutive gems without a miss.
- `playtest/baseline.json` holds the new bots and metrics measured on the game before any
  gameplay change of this spec. The baseline set gains `spinner` and `tapper` on ORION.

**Mechanisms.**

- `SessionFx` gains events, all fired from `session.ts`:
  - `cycleEnded(advanced: boolean, gems: number, quota: number)` - on each change of
    `flight.cycles`. `levelUp` stays.
  - `quotaReached()` - when `game.gemsThisLevel` first reaches the quota in a cycle.
  - `gemCollected(points, chain)` - `chain` is the count of consecutive gems without a miss.
  - `gemMissed()` - a gem passed uncollected. The chain is 0 after it.
  - `loopCompleted()` - `floor((theta + PI) / (2 PI))` changed (over the top, either way).
  - `mineNearMiss(theta)` - a mine passed the ship plane within
    `HAZARD.CAPTURE_ANGLE + FEEL.NEAR_MINE_EXTRA` but outside the hit cone while the ship
    was vulnerable. At most one per `FEEL.NEAR_THROTTLE` seconds.
  - `enemyChargeStarted(theta, z)` and `enemyChipped(theta, z)` - from `enemies.ts` at the
    charge start and at a non-fatal hit (`EnemyDeps.onChargeStart`, `onChip`).
- `field.ts`: optional `onMiss()` (a slot leaves play with `triggered === false`) and
  optional `nearAngle` + `onNear(theta)` (once per slot per encounter, never on a slot that
  hit). Gems use `onMiss`, mines use `onNear`.
- Audio (`audio.ts`), all synthesized, `play(name, pan?, gain?)`:
  - `ready` - three rising triangle blips.
  - `levelup` - C5 E5 G5 C6, square + triangle, distinct from the extra-life cue.
  - `repeat` - two soft descending sines. Not punishing.
  - `brake` - low-passed noise sweep 900 to 120 Hz over 0.5 s, on a fast-to-slow step of the
    target speed, so the slowdown at a cycle boundary has an audible cause.
  - Gem ladder - the gem chime pitch follows the chain on a pentatonic ladder from C6, eight
    steps, then holds. When the same gem also reaches the quota, only `ready` plays.
  - `charge` - rising saw 300 to 900 Hz over `ENEMY.CHARGE_TIME`, panned by
    `sin(angleDiff(raiderTheta, craftTheta))`, gain rising as the raider's line nears the
    craft's line, always quieter than `enemyFire`.
  - `chip` - short bright tick.
  - `loop` - rising swoosh. `whoosh` - short panned filtered noise for a mine near miss.
  - `waveClear` - soft two-note chime (event arrives in S2).
- Tube (`world/tube.ts`): `flash(strength)` sets a decaying scalar applied as
  `ringMat.color.setScalar(1 + boost)` and the same on the longitudinal material. No buffer
  rewrite. Level-up uses `FEEL.TUBE_FLASH.PEAK`, a loop uses 0.4 of it.
- HUD (`hud.ts`): the level banner reads `LEVEL N` with the multiplier as a sub-line. A
  smaller amber banner reads `REPEAT - got/quota GEMS` for 1.6 s. The gem row pulses once on
  `quotaReached`. The game-over panel has a cause line: `HIT BY MINE`, `RAIDER BOLT` or
  `RAIDER RAM`, from the last `damaged` cause. New HUD elements animate only `transform` and
  `opacity`. The `MODE` readout is visible only when the flight mode is not `sections`. The
  title key list has no FPS row (the P key still works).
- Run start: `resetCraft` and `createCraft` set the speed of the first section's tier, so a
  run does not open with a deceleration.

**Constants (start values).**

```ts
export const FEEL = {
  TUBE_FLASH: { PEAK: 1.2, DECAY: 0.25 },
  CHAIN_STEPS: 8,
  NEAR_MINE_EXTRA: 0.30,
  NEAR_THROTTLE: 0.4,
}
```

**Acceptance.**

- Bots (`playtest:compare`, original six bots): no `CHANGED` mark on `level`, `hitsPerMin`,
  `gemShare`, `killsPerMin` for any bot. This slice changes feedback, not play.
- `sim:levels`: `cycleEnded` fires once per cycle; `advanced` is true exactly when the level
  rose; in a quota-short scripted run the count of repeats equals `cycles - level`.
- `sim:fields`: `onMiss` fires once per uncollected gem and never for a collected one;
  `onNear` never fires on a slot that hit, and at most once per slot per encounter.
- `sim` (combat): `onChargeStart` count equals bolts fired plus aborted charges.
- Harness: average bot `mineNearMiss` 2 to 8 per minute (above 15 the window is too wide);
  camper `loops` near 0, oracle above 0.
- Eye: live screenshots of the READY row, the LEVEL banner with the tube flash frame, the
  REPEAT banner (force `gemsThisLevel` below the quota near the boundary), and the game-over
  panel with the cause line. Ear check in the browser: ladder, ready, levelup, repeat, brake,
  charge whine from the correct side.

**Excluded here.** Score popups, score bonuses for chains, a white hull flash on a near
miss, a bolt-graze cue.

---

### S2. Raiders that hunt, in formation, in waves

**Player experience.** Raiders arrive as a squad with a shape: side by side or as a pincer,
each in its own depth lane. A squad has a size; when it is destroyed there is a breather of
a few seconds. From level 3 one member is a hunter that slides to the player's line and
fires aimed shots, so parking anywhere gets hit and moving is always the answer. Never more
than four raiders are alive. A raider that outlasts its wave accelerates away into the fog
ahead. No raider drops back through the ship without warning. Fights happen at visible
range, not in the fog.

**Mechanisms (`world/enemies.ts`, `levels.ts`, `config.ts`, `session.ts`).**

- **Slot data.** Each slot gains `role: 'weaver' | 'hunter'`, `stationOffset` (rad),
  `laneZ`, `strafeAmpK`, `strafeWK`. All are set in `arm()` and cleared in `reset()`.
- **Wave director** (state inside `enemies.ts`): `waveState: 'breather' | 'active'`,
  `breatherT`, `waveT`, a roster index, `anchorTheta`, the formation of the current wave.
  - A wave starts when the breather has elapsed and `pressure < 2` (see below). At the
    start `anchorTheta = craft.theta` and the formation is drawn with `rand()`.
  - A slot arms only while the wave is active, the roster has members left and the live
    count is below the alive cap, with `WAVE.REINFORCE_DELAY` between arms.
  - The wave ends when the roster is spent and every member is dead (fires
    `EnemyDeps.onWaveClear`, which the session passes on as `fx.waveCleared`), or when
    `WAVE.TIME` expires (survivors exit forward). Then the breather starts.
  - The first wave of a run starts after `WAVE.FIRST_DELAY`.
- **Wave table** by tuning level `T` (`flight.tuned`, rounded; ORION display level is
  `T + 1`), read through `levels.ts`:

  | T | roster | alive cap | hunters |
  |---|---|---|---|
  | 0 | 2 | 2 | 0 |
  | 1 | 3 | 2 | 0 |
  | 2 | 3 | 3 | 1 |
  | 3 | 4 | 3 | 1 |
  | 4 - 5 | 5 | 3 | 1 |
  | 6 | 6 | 3 | 1 |
  | 7 - 8 | 6 + floor((T - 6) / 2) | 4 | 1 |
  | 9 and up | min(9, 6 + floor((T - 6) / 2)) | 4 | 2 |

  `levels.enemyMax(level)` returns the alive cap, and `Enemies.setMaxActive` stays the
  alive-cap setter. `LEVELS.MAX_ENEMIES_CAP` is 4 and sizes the pool. `Enemies.setLevel(T)`
  gives the director the roster, hunter count and aggression.
- **Formations.** A static table, no allocation. `spread`: offsets
  `(i - (n - 1) / 2) * ENEMY.FORM_SEP`. `pincer`: `+/-ENEMY.PINCER_OFFSET`, a third member
  at 0 in the far lane. A raider spawns at `anchorTheta + stationOffset` and weaves around
  that center. The anchor drifts toward the player at `ENEMY.ANCHOR_TRACK` during approach
  and engage, so the shape follows the player loosely without collapsing onto one line.
  There is no formation on the top wall.
- **Depth lanes.** The station spring pulls each raider to its own `laneZ` from
  `ENEMY.LANES`. Hunters take the middle lane.
- **Separation.** For each pair of engaged raiders with `|dTheta| < SEP_MIN` and
  `|dz| < SEP_DZ`, the higher-index slot's center is pushed away at `SEP_PUSH`.
- **Weave variety.** `strafeAmpK` in 0.6 to 1.0 and `strafeWK` in 0.75 to 1.05 per slot,
  multiplying `STRAFE_AMP` and `STRAFE_W`. All motion still goes through `strafe()` and its
  `STRAFE_OMEGA_MAX` clamp.
- **Hunter.** In engage and not charging: its center moves toward `craft.theta` at
  `huntTrack` and it weaves with `HUNT_STRAFE_AMP`. It starts a charge only when
  `|angleDiff(craft.theta, slot.theta)| < HUNT_FIRE_ANGLE`, a fire slot is free and
  `pressure < 2`. During the charge theta is held, as for every raider, so the white nose
  marks the exact line. There is no lead and no tracking during the charge. A hunter has no
  idle glow; it is recognized by how it moves.
- **Fire rhythm.** `FIRE_STAGGER` is the minimum time between two charge starts. Fire slots
  stay at 2, and drop to 1 while `pressure === 2`.
- **Aggression.** `levels.aggression(T) = clamp((T - 2) / 12, 0, 1)` lerps
  `FIRE_COOLDOWN` 2.0 to 1.3 s, `huntTrack` 1.4 to 2.2 rad/s and the breather 6 to 3.5 s.
- **Exit forward.** On engage timeout or wave timeout a raider leaves with
  `craft.speed + EXIT_SPEED_DELTA`, fades, and recycles past `SPAWN_AHEAD`. It does not
  fire while leaving. A raider that slipped behind the ship (`ENGAGE_BREAK_Z`) keeps the
  fall-behind path.
- **Engagement range.** `GUN.BOLT_TTL` is 0.7 s (reach about 130 units), so raiders are
  fought from late approach inward, where their tells are readable.
- **Pressure hook.** `Enemies.setPressure(p: 0 | 1 | 2)`, set by the session once per
  frame. It is 0 until S3 supplies `sequencer.pressureAt(craft.distance)`.
- **Difficulty ease.** Each entry of `DIFFICULTY.MODES` has `ease` (MILKY WAY 1.3, ORION 1,
  QUASAR 1). It multiplies the raider fire cooldown and the breather. S3 applies it to mine
  spacing as well. It makes MILKY WAY easier from level 1, where the level mapping alone
  changes nothing.

**Constants (start values, in `ENEMY` unless noted).**

```ts
LANES: [-30, -42, -54],
FORM_SEP: 1.1, PINCER_OFFSET: 1.4, ANCHOR_TRACK: 0.3,
SEP_MIN: 0.5, SEP_DZ: 12, SEP_PUSH: 0.8,
HUNT_TRACK: [1.4, 2.2], HUNT_STRAFE_AMP: 0.25, HUNT_FIRE_ANGLE: 0.35,
FIRE_STAGGER: 0.35, FIRE_COOLDOWN_DEEP: 1.3,
EXIT_SPEED_DELTA: 30,
WAVE: { FIRST_DELAY: 4, REINFORCE_DELAY: 1.2, TIME: 24,
        BREATHER: { BASE: 6, MIN: 3.5 } },
// GUN.BOLT_TTL: 0.7, LEVELS.MAX_ENEMIES_CAP: 4
```

**Acceptance.**

- `sim` (combat): live raiders never exceed the alive cap; `H1`/`H2` fire-slot bounds hold;
  every enemy bolt has at least 0.80 s from charge start to ship-plane arrival; two charge
  starts are never closer than `FIRE_STAGGER`; check `F1` reads "a timed-out raider leaves
  forward and never crosses the ship plane". `sim:levels`: alive cap and roster per level
  and per mode.
- Bots on ORION versus baseline:
  - `raidersMax` at most 4 and `raiders4PlusShare` at most 5% for every bot at every level
    (baseline: camper 30% overall, 70% at L15).
  - `clumpShare` under 5%.
  - `boltsAimedShare` at least 45% for the camper from level 3 (baseline 9%), and camper
    `hitsPerMin` at least 1.5 times the average bot's (baseline 1.48 against 1.44).
  - `killsBeyond60Share` under 20% (probe on the current game: about 45%).
  - `quietShare` between 10% and 30% and `intensityCV` at least 0.5 (baseline 1 to 2% and
    0.36 to 0.39).
  - Oracle: at most 0.3 lives lost per 15 minutes. `tellToArrivalMin` at least 0.80 s.
  - Tapper: `boltsHitShare` under 15%. If it is higher, the hunter lane moves nearer so the
    bolt arrives before the pendulum returns, and the check is repeated.
  - Level 1 on ORION stays two weavers: kid and average `hitsPerMin` at L1 not above
    baseline by more than the noise column.
- Eye: a live screenshot with three raiders shows three separate silhouettes at three
  depths; a hunter mid-charge under a parked craft; a raider leaving forward.

**Excluded here.** A diving (ram) raider role, a ring formation on the top wall, a hunter
idle glow, a WAVE CLEAR banner, a wave-clear score bonus.

---

### S3. Gem lines: wall objects in playable sequences

**Player experience.** Gems and mines come in short, readable phrases instead of random
dots. A gem phrase is the visible shape of a swing: the line shows where a hold and a
release carry the craft. A mine phrase always has a clear line through it, marked by gems.
Slow yellow sections ask for precision, green sections for flow, blue sections for big
air. Between phrases there is a short rest. Orbs and the rare extra life stay scattered
finds.

**Mechanisms.**

- **Shared swing step.** `craft.ts` exports `stepSwing(state, steerTarget, gravityK, dt)`:
  the steer ramp, the torque with its soft cap, and `stepPendulum`. `updateCraft` calls it.
  The sequencer's ghost and the validator call the same function. There is no copy of the
  integrator anywhere.
- **Pure flight lookups.** `flight.tierSpeedOf(level, tier)` and
  `flight.gravityOf(level, speed)` return what `targetSpeed` and `gravityForSpeed` return
  for that level, without reading the live state.
- **Phrase data** (`src/world/phrases.ts`, static):

  ```ts
  type Steer = -1 | 0 | 1
  interface Phrase {
    id: 'arc' | 'pump' | 'jump' | 'weave' | 'loop' | 'scatter'
    tiers: readonly (0 | 1 | 2)[]          // tiers it may appear in
    minTuned: number                       // tuning level it unlocks at
    weight: readonly [number, number, number] // pick weight per tier
    load: 0 | 1 | 2                        // how busy it makes the wall (pressure)
    script: readonly { steer: Steer; t?: number; untilTop?: true }[] // ghost input
    gems: { from: number; to: number; every: number }   // ghost times with a gem on the path
    mines?: readonly { t: number; deg: number; abs?: true; minTuned?: number }[]
      // deg: offset from the ghost angle at time t, or an absolute angle from the
      // bottom when abs; minTuned adds the mine only from that tuning level
  }
  ```

  A phrase is mirrored left or right with `rand()` by negating every angle and steer.
- **Ghost traces.** The ghost starts each phrase at rest at the bottom and runs the script
  through `stepSwing` at `1 / PHYSICS.HZ` with the steady speed and gravity of the tier.
  With tier-relative gravity the angle-over-time trace of a phrase depends on the tier and
  not on the level, so one trace per phrase and tier is computed when the session is
  created and stored in a preallocated `Float32Array`. An item at ghost time `t` sits at
  `phraseStart + tierSpeed * t` and at the ghost angle (plus `deg` for mines).
- **Library (version 1).**

  | id | tiers | load | script (start values) | gems | mines |
  |---|---|---|---|---|---|
  | arc | all | 0 | hold 0.45 s, release 1.4 s | 4, on the rise, the apex and the fall | none |
  | pump | all (slow from T 1) | 1 | 0.3 hold, 0.3 free, 0.35 reverse, 0.3 free, 0.4 hold, 0.9 free | 6 along the path | none |
  | jump | slow, normal | 1 | arc script | 3 over the apex | 1 floor mine under the apex (`abs`, 0 deg); a second from T 3 |
  | weave | slow, normal | 2 | 0.25, then alternating 0.4 s holds, 0.6 free | 4 on the apexes | 2 on the outside of the turns at +/-65 deg from the ghost; 4 from T 3 |
  | loop | fast (normal from T 3) | 2 | hold `untilTop`, release 1.0 s | 7 around the ring | none, ever |
  | scatter | all | 1 | none | 2 to 3 gems at random mid-wall angles, at least 1.2 s apart | 1 to 2 mines, each at least 1.0 s from the next and at least `MINE_CLEAR` from any gem within 0.6 s |

  Per-tier weights make slow sections mostly jump and weave, normal sections mostly pump
  and arc, fast sections mostly loop and arc. `scatter` holds about a quarter of the weight
  in every tier, so the tube does not feel on rails.
- **Director** (`src/world/sequencer.ts`, owned by the session):
  - Plans ahead to `craft.distance + SEQUENCE.HORIZON`. Picks by tier, tuning level and
    weight with `rand()`, never one of the last two phrases.
  - Leaves a gap of `GAP` seconds between phrases (shorter with tuning level).
  - A phrase never crosses a section boundary. No phrase starts within
    `BOUNDARY_CLEAR[tier]` seconds after a boundary, so the speed ease and the level
    banner happen in calm air and the ghost's steady-speed assumption holds.
  - **Gem budget.** It schedules at least `SEQUENCE.GEMS_PER_CYCLE` gems in every cycle
    and at most 4 more. If it is behind when the last section starts, it adds arcs.
  - **Mine budget.** Per section and tier: `MINES_PER_SECTION[tier] / bombMult(T) / ease`.
    The director picks phrases and mine variants to land within one mine of the budget.
  - **Level-up rescale.** The tube ahead is planned for the current level. When the level
    rises at a boundary, every pending item moves to
    `boundary + (worldDistance - boundary) * newSlowSpeed / oldSlowSpeed`. The horizon is
    shorter than a slow section, so all pending items are slow-tier items and stay valid.
  - `pressureAt(distance)` returns the `load` of the phrase covering that distance, else 0.
    The session passes it to `enemies.setPressure` every frame.
  - `reset()` plans from distance 0 at once, so the title screen shows a filled tube. The
    first phrase of a run is an arc starting at `FIRST_AT`.
- **Field feed mode** (`world/field.ts`). `FieldConfig.feed: true`: slots start parked
  (`visible = false`). `spawn(worldDistance, theta): boolean` arms a parked slot at an exact
  place, with no angle sampling and no `avoid`. A slot that passes behind or finishes its
  pop parks. The hit test, `triggered`, pops, `onHit` declining, `occupies`, `visit`,
  `onMiss` and `onNear` behave the same in both modes. A failed `spawn` (pool empty) is
  counted and reported by the sim. Gems and mines are feed fields. Orbs and the extra life
  stay random fields; their `avoid` checks the feed fields through `occupies`.
- **Pools.** Gems 16, mines 12, sized for the horizon at the slow tier.
- **Gem gate.** `flight.gemQuota(level) = round(SEQUENCE.GEMS_PER_CYCLE * quotaFraction(T))`
  with `quotaFraction(T) = min(QUOTA_FRACTION_MAX, GEM_QUOTA_FRACTION + QUOTA_FRACTION_STEP * T)`.
  The quota is known at the start of a level and does not depend on what was spawned. The
  HUD gem row shows at most `HUD.GEM_PIPS_MAX` pips; with a larger quota the pips fill in
  proportion and the `got/quota` text stays exact.
- **Score.** `TREASURE.SCORE` is 150, so the gem income of a fully collected cycle stays
  near today's (24 x 150 against about 14 x 250). The best score is stored under a new
  local-storage key; the stored value of the earlier version is left in place.
- **Switch.** `SEQUENCE.ENABLED`. When false, gems and mines are random fields as in the
  baseline game. The sims run both settings.

**Constants (start values).**

```ts
export const SEQUENCE = {
  ENABLED: true,
  HORIZON: 280,                       // units planned ahead (past the visible rings)
  FIRST_AT: 70,
  GAP: [1.2, 0.7],                    // s between phrases at tuning level 0 and 12+
  BOUNDARY_CLEAR: [2.0, 1.0, 1.0],    // s after a boundary, per tier entered
  GEMS_PER_CYCLE: 24,
  MINES_PER_SECTION: [4, 4, 3],       // slow, normal, fast at tuning level 0
  MINE_CLEAR: 0.87,                   // rad: HAZARD.CAPTURE_ANGLE + 0.25
  GEM_EVERY_MIN: 0.25,                // s, closest gem spacing on a path
}
// LEVELS.GEM_QUOTA_FRACTION: 0.5, QUOTA_FRACTION_STEP: 0.02, QUOTA_FRACTION_MAX: 0.75
// HUD.GEM_PIPS_MAX: 12, TREASURE.SCORE: 150, TREASURE.COUNT: 16, HAZARD.COUNT: 12
```

**Acceptance.**

- New `npm run sim:sequence` (`scripts/sequence-sim.ts`), for every phrase x allowed tier x
  tuning level 0 to 20 x mirror x mode:
  - A replay of the script through `stepSwing` collects every gem and touches no mine.
  - Every mine keeps at least `MINE_CLEAR` from the ghost through its capture window.
  - The trace at tuning level 0 and 20 differs by less than 0.01 rad.
  - Over 200 seeded cycles per mode: no phrase crosses a section boundary or starts inside
    `BOUNDARY_CLEAR`; gems per cycle are within `[GEMS_PER_CYCLE, GEMS_PER_CYCLE + 4]`;
    mines per section are within one of the budget; no failed `spawn`; after a level-up
    rescale the replay still collects every gem of the pending phrases.
  - An open-loop input-jitter model (+/-80 ms on every duration and on the start) collects
    at least 75% of the gems of arc and pump. This grades phrases against each other; it is
    not a prediction of human catch rates.
- `sim:fields`: feed-mode checks (park, spawn, `onMiss`, `occupies`) next to the random ones.
  `sim:levels`: quota per level and mode from the new formula.
- Bots on ORION versus baseline:
  - Oracle: `gemShare` at least 95% (baseline 79%), 0 lives lost to mines.
  - Good: `gemShare` at least 85% (baseline 83%). Kid: `gemShare` not below baseline 58%.
  - `upperShare` and `wallBinsUsed` of the average bot above baseline; `gemChainMedian` of
    the good bot at least 4.
  - `deadAirLongest` median at most 3.5 s with waves and phrases together.
  - Lives lost to mines per minute for kid and average not above baseline by more than
    20%; `chainHits` not above baseline.
  - Spinner: `gemShare` under 35%.
  - Seconds with an enemy bolt in flight and a mine within 1 s ahead: below baseline.
- Performance: live harness at a slow-tier string, 1280x720: p95 frame time not above the
  baseline run's by more than 2 ms.
- Eye: live screenshots of a slow arc (the gems read as a curve ahead), a fast loop (a ring
  around the tube), a jump (floor mine under the arc), a weave, and the title screen with a
  filled tube.

**Excluded here.** Fork, staircase and hang phrases, sequenced orbs and extra lives, a
clean-string score bonus.

---

### S4. Physical feel: camera and hull (visual only)

**Player experience.** Fast feels fast: the view widens in blue sections and tightens in
yellow ones. A hit jolts the view and slows time for a moment, so the cause is readable.
The hull shows its momentum: it yaws and rolls into the direction it is sliding and stays
slewed while the swing carries after the key is released.

**Mechanisms.**

- `flight.speed01(speed)`: 0 at the level's slow-tier speed, 1 at its fast-tier speed.
- **Speed FOV** (`render/scene.ts`, `render/camera.ts`). `scene.resize()` computes the base
  vertical FOV with the `HFOV_MAX` clamp. `stage.setFovOffset(deg)` adds an offset and
  applies the clamp after it. The rig smooths `CAMERA.FOV_SPEED * speed01` with
  `CAMERA.FOV_LAG` and updates the projection only when the value moved by more than 0.05
  degrees.
- **Shake** (`render/shake.ts`). One `trauma` scalar in 0..1, `add(n)`, linear decay.
  Offset = max offset x trauma squared x a sum of three fixed-frequency sines per axis.
  Applied after `lookAt` as a small x/y position offset and a roll. Damage adds
  `SHAKE_DAMAGE`, a kill adds `SHAKE_KILL`, a mine near miss adds `SHAKE_NEAR`. The shake
  never touches the craft state or the aim.
- **Hit slow-down** (`loop.ts`). A `timeScale` multiplies the frame time that feeds the
  fixed-step accumulator; rendering keeps the real frame time. On a lost life it holds
  `HITSTOP.SCALE` for `HITSTOP.HOLD` seconds and eases back over `HITSTOP.EASE`. The
  headless harness and the sims call `session.step` directly and are not affected.
- **Hull attitude** (`world/ship.ts`). The hull parts sit in an inner `pivot` group. The
  outer group keeps `rotation.z = theta`. Per frame:
  `slip = atan2(omega * RIDE_RADIUS, speed)`;
  yaw target = `clamp(SHIP.YAW_FOLLOW * slip, +/-SHIP.YAW_MAX)`;
  roll target = `clamp(-SHIP.BANK * steerSignal - SHIP.BANK_OMEGA * omega, +/-0.8)`.
  Each is smoothed with `1 - exp(-dt / SHIP.ATTITUDE_LAG)`. The nose turns toward the
  direction of travel. The title preview resets the pivot to identity. Hit windows are
  unchanged.

**Constants (start values).**

```ts
// CAMERA
FOV_SPEED: 6, FOV_LAG: 0.35,
// FEEL
SHAKE: { MAX_ROLL_DEG: 1.2, MAX_OFFSET: 0.25, DECAY: 1.6,
         DAMAGE: 0.6, KILL: 0.1, NEAR: 0.08 },
HITSTOP: { SCALE: 0.35, HOLD: 0.18, EASE: 0.35 },
// SHIP
YAW_FOLLOW: 0.5, YAW_MAX: 0.3, BANK_OMEGA: 0.06, ATTITUDE_LAG: 0.08,
```

**Acceptance.**

- Bots: `playtest:compare` shows no `CHANGED` mark on any metric against the result file
  of the S3 build. This proves the slice is visual only.
- A small sim or assert: after `add(1)` the shake offset is exactly 0 after `1 / DECAY`
  seconds; the FOV stays within `[base, base + FOV_SPEED]` and the horizontal FOV never
  exceeds `HFOV_MAX` at a 21:9 aspect; the pivot yaw has the sign of omega and is back
  within 0.01 rad 0.5 s after omega reaches 0.
- Eye: slow and fast tier screenshots at the same theta show the FOV difference with no
  edge strobing at level 10 fast; a frame 0.1 s after a forced hit shows the offset view
  and a frame 1 s later shows the normal view; hull poses at omega +5, 0, -5 for all three
  hulls (nine images) with the nose turned into the travel direction; the title preview
  looks as in the baseline. Live harness frame times as in S3.

**Excluded here.** An omega kick or speed dip on a hit, a camera pull on acceleration,
`LOOK_AHEAD` scaling, any change to `ORBIT_FOLLOW`, `ROLL_FOLLOW`, `AIM_FOLLOW`.

---

### S5. Swing: momentum matters high on the wall (keep or revert)

This is the only slice that changes the tuned handling. It ships enabled only if every
keep criterion passes. Otherwise `CLIMB.FADE` is 0, which is identical to the handling
before this slice.

**Why.** Measured on the baseline game: holding one key from rest takes the craft over the
top in 1.09 s (slow tier) and 0.92 s (fast tier) and then loops about 0.7 times a second.
No pumping is needed, and the gravity tiers change almost nothing. The good bot loops 12.5
times a minute. The design intent in `CLAUDE.md` ("pump left-right-left to ride high, or
loop over the top") is not what the constants produce.

**Player experience.** Below the horizontal the craft handles exactly as before: same
snap, same reversal, same taps. Above the horizontal the thrust weakens, so height comes
from momentum. In heavy yellow sections one hold carries the craft high on the wall, where
it hangs and falls back; a pump or a dive is needed to go over the top. In light blue
sections one committed hold still loops. Holding a key is a way to ride high on the wall,
not an endless spin.

**Mechanism** (`craft.ts` inside `stepSwing`, before the soft cap).

```ts
// h: angle from the bottom, 0..PI.  up: 1 when the torque pushes away from the bottom.
const h = Math.abs(angleDiff(theta, 0))
const up = clamp((Math.sign(steerTorque) * Math.sin(theta)) / CLIMB.UP_SOFT, 0, 1)
steerTorque *= 1 - CLIMB.FADE * smoothstep(CLIMB.START, CLIMB.END, h) * up
```

The `up` term makes the factor continuous through the top, so there is no step in torque
when the craft crosses it. Gravity, damping, the steer ramp and the soft spin cap are
unchanged. The sequencer ghost and the bots use `stepSwing`, so they follow automatically.

**Constants (start values, tuned in this slice to the targets below).**

```ts
export const CLIMB = { FADE: 0.7, START: 1.57, END: 2.36, UP_SOFT: 0.35 }
```

**Swing targets** (new `scripts/swing-sim.ts`, `npm run sim:swing`, which also records the
same numbers with `FADE = 0`):

| measurement | with `FADE = 0` | target |
|---|---|---|
| rest to 45 and 90 degrees, held key, every tier | 0.35 / 0.54 to 0.59 s | identical within 1% |
| reversal from 5 rad/s near the bottom | 0.18 s | identical within 1% |
| reach of a 0.2 s tap, slow / fast | 56 / 77 degrees | identical within 1% |
| slow tier, one hold from rest | over the top in 1.09 s | peaks between 120 and 165 degrees, does not cross |
| slow tier, key held for 10 s | spins | no full loop; settles at a hang angle between 105 and 150 degrees |
| slow tier, one counter-swing then hold | - | crosses the top |
| normal tier, one hold from rest | over in 1.00 s | crosses in 1.1 to 1.6 s |
| fast tier, one hold from rest | over in 0.92 s | crosses in at most 1.2 s |

**Keep criteria (all must pass, else revert to `FADE = 0`).**

1. Every swing target above.
2. `npm run sim:sequence` passes with the tuned `CLIMB` and with `FADE = 0`, so the owner
   can switch the change off with one constant and the phrases stay flyable. The loop
   phrase uses `untilTop` and appears only in tiers where one hold crosses the top.
3. Bots on ORION against the result file of the S4 build: kid and average `gemShare` not
   lower by more than 3 points; kid and average `hitsPerMin` not higher by more than the
   noise column; oracle at most 0.3 lives lost per 15 minutes; tapper `boltsHitShare`
   still under 15%.
4. Good bot `loops` per minute between 2 and 8 (baseline 12.5). Spinner: median level at
   most 3 or `hitsPerMin` at least twice the average bot's.
5. Eye: a live run with the good bot shows loops in blue sections and high hangs in yellow
   sections, with no visible stall or jerk at the top.

**Excluded here.** Any change to `STEER_TORQUE`, `STEER_ATTACK`, `STEER_RELEASE`,
`DAMPING_C`, `GRAVITY_K`, `STEER_OMEGA_MAX`, the gravity floor, or the integrator. Extra
settle damping near rest.

---

### S6. Difficulty curve on ORION, MILKY WAY for kids, hand-over

**Player experience.** ORION is calm for two levels, asks for real play from level 3, and
a run of a practiced adult ends somewhere in the teens after several minutes, by attrition
that reads as fair. Lives are scarce enough to matter and the weapon bar is a resource.
MILKY WAY is gentler from the first second. QUASAR is hard from the start but not a wall.

**Levers this slice may move** (constants only; no new mechanism):

- Waves: roster, alive cap and hunter rows of the wave table, `aggression` span,
  `FIRE_COOLDOWN` ends, breather ends, `HUNT_TRACK` ends, `WAVE.TIME`.
- Sequencer: `MINES_PER_SECTION`, `minTuned` of phrases and mine variants, tier weights,
  `GAP`, `GEM_QUOTA_FRACTION` / `QUOTA_FRACTION_STEP` / `QUOTA_FRACTION_MAX`.
- Economy: `EXTRA_LIFE.SPAWN_SPACING` and jitter, `PICKUP.SPAWN_SPACING`,
  `ENERGY.PER_ORB`, `ENEMY.ENERGY_REFUND`, `TREASURE.SCORE`, `ENEMY.SCORE`.
- Modes: `ease`, `slope`, `offset` in `DIFFICULTY.MODES`.
- Not movable: the fairness constants of section 2, the pendulum constants, `CLIMB` after
  the S5 decision, capture windows.

Three new pressures must not land on the same level: the hunter arrives at ORION level 3,
the extra weave and jump mines at level 4, the aggression ramp is felt from level 4 to 5.

**Targets** (60 seeded runs, cap 900 s; baseline in brackets):

| bot, mode | metric | target |
|---|---|---|
| good, ORION | lives lost per minute at L3 to L5 | 0.8 to 1.4 (0.37 to 0.44) |
| good, ORION | alive at the cap | at most 30% (95%) |
| good, ORION | median level | 10 to 18 (31, at the cap) |
| average, ORION | median level | 6 to 10 (22) |
| average, ORION | median time | 180 to 330 s (670) |
| average, ORION | `hitsPerMin` at L1 to L2 | at most 0.8 (0.67, 0.64 at L3) |
| average, ORION | `gateFirstTry` | at least 85% at L1 to L2, 55 to 75% at L4 to L6 |
| good, ORION | `gateFirstTry` at L1 to L6 | at least 85% |
| kid, MILKY WAY | median level / median time | at least 6 / at least 240 s (7 / 217 s) |
| kid, MILKY WAY | `hitsPerMin` at L1 | at most 0.8 (1.2) |
| kid, MILKY WAY | `gateFirstTry` at L1 to L3 | at least 60% |
| kid, ORION | median level | 3 to 6 (7) |
| good, QUASAR | median time | at least 150 s |
| oracle, all three modes | lives lost per 15 minutes | at most 0.3 (0.1 on ORION) |
| camper, ORION | `hitsPerMin` | at least 1.5 times the average bot's (1.48 against 1.44) |
| camper, ORION | median level | below the average bot's (17 against 22) |
| spinner, ORION | median level | at most 3 |
| good and average, ORION | `lifeBalance` | at most 0.35 (0.97 and 0.81) |
| average, ORION | `meanCharge` / `emptyGunShare` | 40 to 65% / 1 to 6% (64 to 85% / 0 to 0.2%) |
| every bot | final blow | no single cause above 60% of deaths |
| every bot | `raiders4PlusShare` / `deadAirLongest` median | at most 5% / at most 3.5 s |

When two targets cannot both be met, fairness comes first (oracle, tapper,
`tellToArrivalMin`), then the kid on MILKY WAY, then the ORION curve.

**Hand-over.**

- `playtest/baseline.json` stays the record of the game before this spec. The final
  results are written next to it as `playtest/next-level.json`.
- A final live session: `npm run playtest:live` with the good bot on ORION for 180 s and
  the kid bot on MILKY WAY to game over. The engineer looks at every screenshot: gem lines
  at each tier, a wave in formation, a hunter charge, the level and repeat banners, the
  game-over panel. Frame times are reported.
- `CLAUDE.md` (spec, constants, repo structure, dev commands, milestones) and `README.md`
  describe the game as built. `playtest/README.md` lists the new bots, metrics and sims.
- A short note for the owner lists the one-constant switches: `SEQUENCE.ENABLED`,
  `CLIMB.FADE`, `HITSTOP.SCALE`, `CAMERA.FOV_SPEED`.

## 4. Deliberately excluded

- **Tube bends with centripetal load.** Deferred. Reason: it touches the tube buffer, five
  placement sites, the camera and the integrator at once, the far tube can leave the frame,
  and the phrase ghost would have to model the load. Revisit when S1 to S6 are accepted by
  the owner and he asks for more from the movement.
- **Diver (telegraphed ram) raider.** Deferred. Reason: a third behavior with a second,
  different tell. Revisit if deep ORION levels play thin after S6.
- **Omega kick and speed dip on a hit.** Takes control away at the moment the player reads
  the hit and can chain into a second hit.
- **Settle damping near rest.** Edits the tuned integrator for a gain that only bots can
  measure, and makes resting at the bottom easier, which the hunter is there to punish.
- **Score bonuses** (clean string, chain, wave clear) and **score popups.** Score stays
  gems + kills times the level multiplier. Popups crowd the view around the ship.
- **Ring formation, hunter idle glow, white hull flash, bolt-graze cue.** White stays one
  signal: a shot is coming down this line.
- **Fork, staircase and hang phrases, sequenced orbs and extra lives.** A second pass
  after the six phrases are tuned.
- **New controls, new HUD widgets, new object types.**

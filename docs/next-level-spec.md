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
  - The fast-to-slow step at a cycle boundary has no cue of its own: it always falls on
    the same frame as `levelup` or `repeat`, which mark the boundary.
  - Gem ladder - the gem chime pitch follows the chain on a pentatonic ladder from C6, eight
    steps, then holds. When the same gem also reaches the quota, only `ready` plays.
  - `charge` - rising saw 300 to 900 Hz over `ENEMY.CHARGE_TIME`, panned by
    `sin(angleDiff(raiderTheta, craftTheta))`. It is audible from its first 30 ms and its
    gain is `0.45 + 0.55 * near^2` (near = 1 on the craft's line, 0 across the tube), so
    the tell is heard under gunfire and stays softer than the player's shot.
  - `chip` - short bright tick.
  - `loop` - rising swoosh with a 0.12 s attack, so it lands on the tube flash. `whoosh` -
    short panned filtered noise for a mine near miss.
  - `waveClear` - soft two-note chime (event arrives in S2).
- Tube (`world/tube.ts`): `flash(strength)` sets a decaying scalar applied as
  `ringMat.color.setScalar(1 + boost)` and the same on the longitudinal material. No buffer
  rewrite. Level-up uses `FEEL.TUBE_FLASH.PEAK`, a loop uses 0.4 of it.
- HUD (`hud.ts`): the level banner reads `LEVEL N` with the multiplier as a sub-line. A
  smaller amber banner reads `REPEAT - got/quota GEMS` for 1.6 s, with the gems still
  missing as a sub-line (`3 MORE GEMS TO ADVANCE`; collected gems carry over into the
  repeated cycle). Both banners sit in the upper part of the view (top 11% and 15%), above
  the tube's vanishing point, where raiders and their tells appear. They freeze while the
  game is paused. The gem row pulses once on
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
  panel with the cause line. Ear check in the browser: ladder, ready, levelup, repeat,
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
  type At = number | readonly [apex: number, offset: number]
    // a ghost time in s, or a time relative to the n-th turning point of the trace
    // (apex -1 = the end of the script)
  interface Phrase {
    id: 'arc' | 'pump' | 'jump' | 'weave' | 'loop' | 'scatter'
    unlock: readonly [number | null, number | null, number | null]
      // tuning level it unlocks at in the slow / normal / fast tier (null = never)
    weight: readonly [number, number, number] // pick weight per tier
    load: 0 | 1 | 2                        // how busy it makes the wall (pressure)
    spacing?: readonly [number, number, number]
      // per tier: other phrases between two uses of this one at least (default 2)
    script: readonly { steer: Steer; t?: number | PerTier; untilDeg?: PerTier }[]
      // ghost input: hold for t seconds (one value, or one per tier), or until the
      // ghost is untilDeg degrees from the bottom (per tier)
    gems: { from: At; to: At; count: number } | readonly At[] // ghost times with a gem on the path
    mines?: readonly { at: At; deg: number; abs?: true; minTuned?: number }[]
      // deg: offset from the ghost angle at that time (farther up the wall, on the
      // ghost's side), or an absolute angle from the bottom when abs; minTuned adds the
      // mine only from that tuning level
  }
  ```

  Times are tied to turning points because gravity differs per tier: "the gem on the
  apex" then sits on the apex in every tier. A phrase is mirrored left or right with
  `rand()` by negating every angle and steer.
- **Ghost traces.** The ghost starts each phrase at rest at the bottom and runs the script
  through `stepSwing` at `1 / PHYSICS.HZ` with the steady speed and gravity of the tier.
  With tier-relative gravity the angle-over-time trace of a phrase depends on the tier and
  not on the level, so one trace per phrase and tier is computed when the session is
  created and stored in a preallocated `Float32Array`. An item at ghost time `t` sits at
  `phraseStart + tierSpeed * t` and at the ghost angle (plus `deg` for mines). A phrase
  lasts from ghost time 0 to 0.1 s after its last item.
- **Library (version 1).**

  | id | tiers | load | script | gems | mines |
  |---|---|---|---|---|---|
  | arc | all | 0 | hold 0.58 / 0.5 / 0.45 s (slow / normal / fast), release 1.4 s. The apex is at about 117 / 122 / 142 degrees | 4, on the rise, the apex and the fall | none |
  | pump | all (slow from T 1) | 1 | 0.3 hold, 0.3 free, 0.35 reverse, 0.3 free, 0.7 / 0.66 / 0.58 hold, 1.2 free. The third swing ends at about 110 to 120 degrees | 6: a pair on each of the three turning points | none at first; from T 4 a floor mine under the third swing, from T 7 one on the far wall (75 deg) during the second turn |
  | jump | all | 1 | arc script | 3 over the apex | 1 floor mine under the apex (`abs`, 0 deg); a second beside it at -40 deg from T 3; a third at +40 deg from T 6 (a wall across the floor) |
  | weave | slow, normal | 2 | 0.3, then three alternating 0.5 s holds, 0.6 free | 4 on the turning points | 2 on the outside of the second and third turn at 60 deg from the ghost; a third on the fourth turn from T 3. None above the first turn, where a craft may still be coming down the wall |
  | loop | fast (normal from T 1) | 2 | hold to 132 deg (normal) / 115 deg (fast), release 1.75 s | 7 around the ring, starting where the hold ends | none, ever |
  | scatter | all | 1 | none | 2 to 3 gems at random angles 55 to 145 deg from the bottom, 1.2 to 1.7 s apart, each within 2.0 rad of the one before | 0 to 2 mines (3 from T 3) within 80 deg of the bottom, 1.0 to 1.5 s apart, each at least `MINE_CLEAR` from any gem within 0.6 s |

  The loop is released on the way up, so the ghost crosses the top at an easy pace: a
  craft that is late keeps holding and catches up, one that is early lets go and waits.
  Per-tier weights make slow sections mostly weave and jump. Normal sections mix pump,
  arc and loop with the mine phrases. In fast sections almost half of the phrases are
  loops, and a loop may follow a loop there (`spacing` 0), so a fast section usually
  holds one or two rings. `scatter` holds about a quarter of the phrases in every tier,
  so the tube does not feel on rails. The arc and the third swing of the pump reach above
  the horizontal in every tier, so every tier asks for a swing high up the wall.
- **Director** (`src/world/sequencer.ts`, owned by the session):
  - Works one section at a time. When the planning horizon
    (`craft.distance + SEQUENCE.HORIZON`) reaches a section, it picks that section's
    phrases by tier, tuning level and weight with `rand()`, never one of the last two
    phrases unless the phrase's `spacing` allows it, and spreads them evenly over the section. The phrases are placed on the
    wall as the horizon reaches them.
  - Leaves a rest of at least `GAP` seconds between phrases (shorter with tuning level).
    The gem budget, not the time, limits how many phrases a section holds, so the usual
    rest is about 1.4 s.
  - A phrase never crosses a section boundary. No phrase starts within
    `BOUNDARY_CLEAR[tier]` seconds after a boundary (counted as the distance the craft
    covers in that time while it eases to the new speed), so the speed ease and the level
    banner happen in calm air and the ghost's steady-speed assumption holds.
  - **Gem budget.** It schedules at least `SEQUENCE.GEMS_PER_CYCLE` gems in every cycle
    and at most `GEMS_EXTRA_MAX` more, with a share for each section
    (`GEMS_CUMULATIVE_MIN` / `GEMS_CUMULATIVE_MAX`).
  - **Mine budget.** Per section and tier: `MINES_PER_SECTION[tier] / bombMult(T) / ease`.
    The director picks phrases and mine variants to land within one mine of the budget.
    A mine that would sit on an orb or an extra life is left out, and the no-repeat rule
    can leave a section without a mine phrase, so about 2% of sections miss the window.
  - A section is planned up to 16 times and the plan closest to both budgets is kept. The
    last try takes the phrase with the most gems every time.
  - A scripted phrase that would land on an orb or an extra life moves on by up to four
    steps of `SPAWN_CLEAR.NUDGE`; a scatter draws another angle.
  - **Level-up rescale.** The tube ahead is planned for the current level. When the level
    rises at a boundary, every pending item moves to
    `boundary + (worldDistance - boundary) * newSlowSpeed / oldSlowSpeed`. The horizon is
    shorter than a slow section, so all pending items are slow-tier items and stay valid.
  - `pressureAt(distance)` returns the `load` of the phrase covering that distance, else 0.
    The session passes it to `enemies.setPressure` every frame.
  - `reset()` plans from distance 0 at once, so the title screen shows a filled tube. The
    first phrase of a run is an arc up the right wall starting at `FIRST_AT`. The first
    `WARMUP_PHRASES` phrases of a run carry no mines, so the first mine comes about 10 s
    into a run. A difficulty change on the title screen plans the tube again for the new
    speeds.
- **Field feed mode** (`world/field.ts`). `FieldConfig.feed: true`: slots start parked
  (`visible = false`). `spawn(worldDistance, theta): boolean` arms a parked slot at an exact
  place, with no angle sampling and no `avoid`. A slot that passes behind or finishes its
  pop parks. The hit test, `triggered`, pops, `onHit` declining, `occupies`, `visit`,
  `onMiss` and `onNear` behave the same in both modes. A failed `spawn` (pool empty) is
  counted and reported by the sim. Gems and mines are feed fields. Orbs and the extra life
  stay random fields; their `avoid` checks the feed fields through `occupies`.
- **Pools.** Gems 24, mines 12, sized for the horizon at the slow tier.
- **Gem gate.** `flight.gemQuota(level) = round(SEQUENCE.GEMS_PER_CYCLE * quotaFraction(T))`
  with `quotaFraction(T) = min(QUOTA_FRACTION_MAX, mode.quotaMax, GEM_QUOTA_FRACTION + QUOTA_FRACTION_STEP * T)`.
  The quota is known at the start of a level and does not depend on what was spawned. It
  stays at least 3 gems under `GEMS_PER_CYCLE` in every mode (`sim:levels` I2b). The
  HUD gem row shows at most `HUD.GEM_PIPS_MAX` pips; with a larger quota the pips fill in
  proportion and the `got/quota` text stays exact.
- **Score.** `TREASURE.SCORE` is 110, so the gem income of a fully collected cycle stays
  near today's (about 36 x 110 against about 14 x 250). The best score is stored under a new
  local-storage key; the stored value of the earlier version is left in place.
- **Switch.** `SEQUENCE.ENABLED`. When false, gems and mines are random fields as in the
  baseline game. The sims run both settings.

**Constants (as built).**

```ts
export const SEQUENCE = {
  ENABLED: true,
  HORIZON: 280,                       // units planned ahead (past the visible rings)
  FIRST_AT: 70,
  WARMUP_PHRASES: 3,                  // the first phrases of a run carry no mines
  GAP: [1.1, 0.7],                    // least s between phrases at tuning level 0 and GAP_FULL_T
  GAP_FULL_T: 12,
  BOUNDARY_CLEAR: [2.0, 1.0, 1.0],    // s after a boundary, per tier entered
  GEMS_PER_CYCLE: 32,
  GEMS_EXTRA_MAX: 8,
  GEMS_CUMULATIVE_MAX: [12, 23],      // gems scheduled by the end of the slow / normal section at most
  GEMS_CUMULATIVE_MIN: [8, 16],       // ... and at least
  MINES_PER_SECTION: [3.6, 2.2, 1.6], // slow, normal, fast at tuning level 0
  MINE_CLEAR: HAZARD.CAPTURE_ANGLE + 0.25, // 0.87 rad
  GEM_EVERY_MIN: 0.25,                // s, closest gem spacing on a path
  SCATTER: { GEM_GAP: [1.2, 1.7], MINE_GAP: [1.0, 1.5], MINE_FIRST: [0.3, 0.8], MINES_3_FROM: 3,
             GEM_DEG: [55, 145], GEM_REACH: 2.0, MINE_DEG: [0, 80], NEAR: 0.6 },
}
// LEVELS.GEM_QUOTA_FRACTION: 0.48, QUOTA_FRACTION_STEP: 0.12, QUOTA_FRACTION_MAX: 0.85
// HUD.GEM_PIPS_MAX: 12, TREASURE.SCORE: 110, TREASURE.COUNT: 24, HAZARD.COUNT: 12
```

A cycle offers 32 to 40 gems (36 on average). Three phrases per section at the library's
gem counts need about 33, and the upper end leaves room for two loops (14 gems) in the
fast section. With 24 to 28 the sections came out half empty. The quota is 15 gems at
tuning level 0, 19 and 23 at tuning levels 1 and 2, and 27 from tuning level 3 (set in
S6): always at least 5 gems under the fewest a cycle offers.

**Acceptance.**

- New `npm run sim:sequence` (`scripts/sequence-sim.ts`), for every phrase x allowed tier x
  tuning level 0 to 20 x mirror x mode:
  - A replay of the script through `stepSwing` collects every gem and touches no mine.
  - Every mine keeps at least `MINE_CLEAR` from the ghost through its capture window.
  - The trace at tuning level 0 and 20 differs by less than 0.01 rad.
  - Over 200 seeded cycles per mode: no phrase crosses a section boundary or starts inside
    `BOUNDARY_CLEAR`; gems per cycle are within
    `[GEMS_PER_CYCLE, GEMS_PER_CYCLE + GEMS_EXTRA_MAX]`; mines per section are within one
    of the budget in at least 97% of sections and never more than 3 away; no failed
    `spawn`; after a level-up rescale the replay still collects every gem of the pending
    phrases.
  - An open-loop input-jitter model (+/-80 ms on every duration and on the start) collects
    at least 75% of the gems of arc and pump. This grades phrases against each other; it is
    not a prediction of human catch rates.
- `sim:fields`: feed-mode checks (park, spawn, `onMiss`, `occupies`) next to the random ones.
  `sim:levels`: quota per level and mode from the new formula.
- Bots on ORION versus baseline:
  - Oracle: `gemShare` at least 95% (baseline 79%), 0 lives lost to mines.
  - Good: `gemShare` at least 85% (baseline 83%). Kid: `gemShare` not below baseline 58%.
  - `upperShare` of the average bot not below baseline (17.5%); `gemChainMedian` of the
    good bot at least 4. `wallBinsUsed` of the average bot is a known gap, see below.
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

**Where the build differs from the first acceptance (for the owner).**

- **Wall use.** The first target was `upperShare` and `wallBinsUsed` of the average bot
  above baseline (17.5% / 10.8). The build gives 17.5% / 10.0, and 4.0 loops per minute
  against 5.9 (good bot 5.8 against 12.5, oracle 11.3 against 19.2). In the baseline the
  bots crossed the top by holding a key to reach gems spread over the whole wall. S5
  treats that free spin as a fault and asks for 2 to 8 loops per minute from the good
  bot. Gem lines offer about 3.5 rings per minute and the bots fly them. More rings than
  that made fast sections repeat themselves, so the top of the tube is used a little
  less than in the baseline. This is a deliberate trade-off.
- **Oracle.** The `gemShare` target of 95% is measured with the oracle's `nearBias` of
  0.9 (`scripts/playtest/bot.ts`). That oracle collects 86% of the old random fields,
  where the baseline oracle collected 79%.
- **Mines per section.** "Within one of the budget" holds in at least 97% of sections,
  never more than 3 off, not in every section.
- **Gems per cycle.** 32 to 40 instead of 24 to 28. The quota counts from 32. S6 set the
  quota (see there).
- **Mine pressure.** Mines are a weaker threat than in the baseline (`threatsPerMin` of
  the average bot 34 against 59). S6 owns the pressure.

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
   phrase holds to a per-tier angle (`untilDeg`) and appears only in tiers where that
   hold carries the ghost over the top.
3. Bots on ORION against the result file of the S4 build: kid and average `gemShare` not
   lower by more than 3 points; kid and average `hitsPerMin` not higher by more than the
   noise column; oracle at most 0.3 lives lost per 15 minutes; tapper `boltsHitShare`
   still under 15%.
4. Good bot `loops` per minute between 2 and 8 (baseline 12.5). Spinner: median level at
   most 3 or `hitsPerMin` at least twice the average bot's.
5. Eye: a live run with the good bot shows loops in blue sections and high hangs in yellow
   sections, with no visible stall or jerk at the top.

**Decision (as built): `CLIMB.FADE` is 0.** The handling is the hand-tuned one. The
mechanism, `npm run sim:swing` and the constants stay in the code, switched off.

The best setting found was `FADE 0.9, START 1.57, END 2.3, UP_SOFT 0.7`. Measured with it
against the build before this slice (60 seeded runs per bot, ORION):

| keep criterion | measured | result |
|---|---|---|
| 1. Swing targets | all met: below the horizontal identical step by step; slow hold peaks at 138 degrees and hangs at 115; counter-swing crosses in 1.75 s; normal 1.21 s; fast 1.02 s | pass |
| 2. `sim:sequence` with the fade and with `FADE = 0` | with the fade the loop gem line of normal sections does not cross the top (the ghost stops at 159 degrees). It passes only with the hold raised from 132 to 160 degrees, which changes that gem line for `FADE = 0` too | fail with the phrase data as reviewed |
| 3. Bots | kid `gemShare` -2.0 points, average -2.5 points; `hitsPerMin` inside the noise; oracle 0 lives lost; tapper 0%. The average bot repeats 4.0 levels per run instead of 2.9 | pass, with a real cost for the average bot |
| 4. Loops | good bot 3.9 loops per minute; spinner median level 1. With `FADE = 0` the same criterion also passes: 5.8 loops per minute, spinner median level 1 | pass, and already met without the fade |
| 5. No stall at the top | the craft crosses the top two to three times slower: median slowest pace at a crossing 1.2 rad/s in normal and 1.7 in fast sections against 3.4 and 3.3 (good bot). In slow sections the bots stop looping (2 crossings in 100 minutes against 43), and the counter-swing crossing creeps over the top at 0.9 rad/s | fail |

Two findings behind the decision:

- The free spin that this slice was written against is gone since the gem lines: the
  good bot loops 5.8 times a minute (12.5 in the baseline) and the spinner does not pass
  level 1.
- Slow and normal gravity are close (11.0 and 8.0). A fade strong enough to stop a held
  key in slow sections leaves the same hold in normal sections with little pace at the
  top. No setting gave a hang in slow sections and a brisk crossing in normal ones.

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
| average, ORION | `gateFirstTry` | at least 85% at L1 to L2, 60 to 80% at L4 to L8 |
| oracle, ORION | level repeats | near zero; the quota at least 3 gems under the fewest a cycle offers |
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

**As built.** The values below are the game as it is. Where a slice above gives another
number for the same constant (S2: fire cooldown, breather, wave time, aggression span,
MILKY WAY ease), this section is the current one.

```ts
// LEVELS
GEM_QUOTA_FRACTION: 0.48, QUOTA_FRACTION_STEP: 0.12, QUOTA_FRACTION_MAX: 0.85, // quota 15, 19, 23, then 27
AGGRESSION_FROM: 2, AGGRESSION_SPAN: 10,                 // full aggression at ORION level 13
DEEP_FROM: 8, DEEP_SPAN: 7,                              // deep pressure over ORION levels 9 to 16 (S7)
TABLE bombSpacingMult: 1.0, 0.95, 0.85, 0.72, 0.66; BOMB_MULT_STEP: 0.02, BOMB_MULT_FLOOR: 0.6
// DIFFICULTY.MODES: MILKY WAY { slope: 0.4, ease: 2.2, quotaMax: 0.7 }; ORION and QUASAR quotaMax: 1
// ENEMY
FIRE_COOLDOWN_EARLY: 3.0, FIRE_COOLDOWN: 1.15, FIRE_COOLDOWN_DEEP: 0.7,
DEEP_COOLDOWN_K: 0.5, DEEP_STAGGER_K: 0.6,               // factors at full deep pressure (S7)
BOUNDARY_HOLD: { BEFORE: 1.1, AFTER: 1.5, RESUME: [0.3, 1.0] },
WAVE: { TIME: 40, BREATHER: { BASE: 5, MIN: 2.5 } }, ENGAGE_TIME: 18,
// SEQUENCE
GEMS_PER_CYCLE: 32, GEMS_EXTRA_MAX: 8, WARMUP_PHRASES: 3,
MINES_PER_SECTION: [3.6, 2.2, 1.6],
// phrases.ts: pump mines from T 4 and T 7, a third jump mine from T 6
// economy
EXTRA_LIFE: { SPAWN_START: 4500, SPAWN_SPACING: 18000, SPAWN_JITTER: 4000 },
PICKUP.SPAWN_SPACING: 280,
// presentation
RENDER.FAR_SCALE: { NEAR: 15, FAR: 110, GAIN: 0.5, RAIDER_GAIN: 1.0 },
AUDIO.SFX: charge 0.5, loop 1.1 (no brake cue); SHIP.PREVIEW_RIGHT: 7.4,
```

What each change does, measured with `--cfg` on single levers before it was set:

- **Gem gate.** A cycle offers 32 to 40 gems and the quota tops out at 27, so the gate
  never depends on how many gems a cycle happens to hold. With a quota of 27 against a
  minimum of 28 the oracle passed only 73% of the cycles that offered 28 to 30 gems, and
  both live sessions showed `REPEAT - 26/27 GEMS`. Over 400 runs the average bot passes
  73, 85, 76, 78, 78% of levels 4 to 8 on the first cycle, the good bot 95 to 98%, and the
  oracle repeats 0.2 levels in 15 minutes. A cap of 0.87 (quota 28) gives the average bot
  73, 78, 64, 68, 68%. MILKY WAY caps the quota at 22: with 27 the kid bot passed 45, 27
  and 18% of levels 7 to 9 on the first cycle; it now reaches level 10 (median).
- **Fire hold at a cycle boundary.** Lives were lost about twice as often in the first
  second after a level-up as on average (good bot x2.3, average bot x1.9), all to bolts
  whose tell started in the last moments of the fast section. `BOUNDARY_HOLD` lets no
  tell start from 1.1 s before the boundary until 1.5 s after it, and `RESUME` spreads the
  first tells after it. In 600 runs no life is lost in the first 2.2 s after a level-up;
  the rate from 2.2 to 5 s is 1.0 to 1.25 times the mean. Lives lost per minute fall by
  about a tenth.
- **Mine-free opening.** The first three phrases of a run carry no mines. Before, a weave
  with two mines could be the second phrase of a run, 5 to 6 s in. In 600 runs no bot
  loses a life in the first 10 s.
- **Far-object scale.** Wall objects grow to 1.5x at the far end of the tube (2x merged
  far mines and gems into one blob at the vanishing point); raiders keep 2x, so a squad
  and its white tell stand out from them.

- **Extra lives** were the reason the game was easy: a cross every 20 to 50 seconds gave
  back almost every life lost (`lifeBalance` 0.94 to 0.98). With the first cross 1.3 to
  2.3 minutes into a run and the next every 3 to 4 minutes, the same hit rates end a run.
  A first test with a cross every 9000 units and nothing else changed took the average
  bot from the 900 s cap to about 500 s.
- **Fire cooldown** is the only raider lever that moved the hit rate. The bots destroy
  most raiders soon after they reach their lanes (median kill distance 44 units), so a
  shorter cooldown is what lets a raider fire before it dies. Hits per bolt stay near
  2.8% (good) and 5% (average) at any rate of fire,
  so lives lost follow the bolts per minute (average bot: 14 before, 22 now; baseline 18).
  Reinforce delay, breather, roster size and the hunter's slide speed did not move it.
- **A second hunter earlier makes the game easier**, not harder: a hunter fires only when
  it sits on the player's line, a weaver fires all the time, and the bots are hit while
  they line up on a weaver. Two hunters from T 2 halved the average bot's hits at levels
  3 to 9. `WAVE_HUNTERS2_FROM` stays 9.
- **Mines.** The budget steps up at ORION level 4 and reaches two thirds more mines per
  second at level 9. A budget above that pushed the director into weave + jump + scatter
  in every slow section and halved the rings in fast sections (`sim:sequence` B4 failed),
  so the floor is 0.6 and the fast-tier budget is a little lower than before.
- **Orbs** are a third rarer, which brings the average bot's weapon charge into the
  target band. The good bot runs dry 6% of the time in a long run.
- **`ENGAGE_TIME` 18** (a raider that is not shot holds its lane longer) and
  **`FIRE_COOLDOWN_EARLY`**, `ENGAGE_TIME`, the `TABLE` rows and the two economy spawn
  starts are not in the lever list above. They are constants of the same mechanisms.
- **MILKY WAY** reaches the kid target through `ease` 2.2 and `slope` 0.4 alone. Its
  hunter arrives at level 5.

**Deep pressure.** With the cap of 12 alone the good bot reached a median of level 26 on
ORION and was alive at the 900 s cap in 43 to 50% of runs: past level 13 nothing got harder
except the speed. A second ramp, the deep pressure, is 0 up to tuning level
`LEVELS.DEEP_FROM` (8, ORION level 9) and 1 from `DEEP_FROM + DEEP_SPAN` (15, ORION
level 16). It multiplies the fire cooldown by 1 down to `ENEMY.DEEP_COOLDOWN_K` (0.5) and
the fire stagger by 1 down to `ENEMY.DEEP_STAGGER_K` (0.6): 0.35 s cooldown and 0.21 s
between tells at full pressure. Fire slots (2), the tell (0.45 s), bolt speed and the
raider cap (4) are as before, so the shortest tell-to-arrival stays 0.80 s. Levels 1 to 8
on ORION are untouched. Measured, good bot on ORION, 60 runs: alive at cap 43% -> 27%
(seeds 101 to 160: 50% -> 37%), median level 26 -> 21. Lives lost per minute at levels 8 to
20, before: 0.46, 0.58, 0.55, 0.51, 0.59, 0.82, 0.33, 0.68, 0.58, 0.68, 0.53, 0.66, 0.67;
after: 0.46, 0.58, 0.37, 0.70, 0.68, 0.89, 1.21, 0.73, 0.91, 1.06, 0.64, 0.73, 1.01.
Tried and not taken: a third hunter from tuning level 12 (the good bot lived longer, 58 to
63% alive at cap), a shorter breather, denser mines past the table and a faster hunter slide
(no clear effect or easier); the cooldown factor alone needed 0.4 for the same result.
QUASAR starts 2.5 tuning levels higher, so the pressure arrives earlier there (good bot
17% alive at cap, median level 17).

**Measured** (`playtest/next-level.json`, 60 seeded runs, cap 900 s):

| bot, mode | metric | target | measured | |
|---|---|---|---|---|
| good, ORION | lives lost per minute at L3 to L5 | 0.8 to 1.4 | 0.41, 0.17, 0.20 | fail |
| good, ORION | alive at the cap | at most 30% | 7% | pass |
| good, ORION | median level | 10 to 18 | 16 (p10 10, p90 28), 464 s | pass |
| average, ORION | median level | 6 to 10 | 7 (p10 4, p90 11) | pass |
| average, ORION | median time | 180 to 330 s | 230 s (p10 111, p90 374) | pass |
| average, ORION | `hitsPerMin` at L1 to L2 | at most 0.8 | 0.26, 0.68 | pass |
| average, ORION | `gateFirstTry` | at least 85% at L1 to L2, 60 to 80% at L4 to L8 | 100%, 100%; 90, 91, 83, 73, 73% (60 runs); 73, 85, 76, 78, 78% (400 runs) | pass over 400 runs, L5 is above the band; the 60-run sample is above it at L4 to L6 |
| good, ORION | `gateFirstTry` at L1 to L6 | at least 85% | 100, 100, 100, 100, 98, 97% | pass |
| oracle, ORION | level repeats | near zero | 0.2 per 15 minutes, none before level 9 | pass |
| kid, MILKY WAY | median level / median time | at least 6 / at least 240 s | 10 / 322 s | pass |
| kid, MILKY WAY | `hitsPerMin` at L1 | at most 0.8 | 0.20 | pass |
| kid, MILKY WAY | `gateFirstTry` at L1 to L3 | at least 60% | 100, 98, 97% | pass |
| kid, ORION | median level | 3 to 6 | 3 (107 s) | pass |
| good, QUASAR | median time | at least 150 s | 421 s (level 14) | pass |
| oracle, all three modes | lives lost per 15 minutes | at most 0.3 | 0.03 / 0.00 / 0.03 (ORION / MILKY WAY / QUASAR) | pass |
| camper, ORION | `hitsPerMin` | at least 1.5 times the average bot's | 0.99 against 1.09 | fail |
| camper, ORION | median level | below the average bot's | 7 against 7 (243 s against 230 s) | fail |
| spinner, ORION | median level | at most 3 | 1 | pass |
| good and average, ORION | `lifeBalance` | at most 0.35 | 0.30 and 0.15 | pass |
| average, ORION | `meanCharge` / `emptyGunShare` | 40 to 65% / 1 to 6% | 63% / 1.1% | pass |
| every bot | final blow | no single cause above 60% | raider bolts 88 to 98% of the deaths of kid, average, good and camper; mines 53 to 100% for spinner, passive and tapper | fail |
| every bot | `raiders4PlusShare` / `deadAirLongest` median | at most 5% / at most 3.5 s | 0% / at most 2.5 s | pass |
| tapper, ORION | `boltsHitShare` (fairness) | under 15% | 0% | pass |
| every bot | `tellToArrivalMin` (fairness) | at least 0.80 s | 0.80 s | pass |

**The targets that are not met, and why.**

- **Good bot, lives lost at levels 3 to 5.** The good bot is hit about 2.5 to 3 times
  less often than the average bot under any setting tried. A rate of 0.8 for the good bot
  means about 2 for the average bot, who then dies after two minutes at level 4, outside
  its own targets (level 6 to 10, 180 to 330 s). The targets for the two bots cannot both
  hold with these bots. The build keeps the average bot's targets and the good bot's
  median level; the good bot loses 0.2 to 0.4 lives a minute at levels 3 to 5 and about
  0.5 from level 6. The curve has no cliff: average bot 0.26, 0.68, 0.76, 0.98, 0.83,
  1.19, 1.39, 1.01 lives a minute at levels 1 to 8.
- **Camper.** A player who never shoots and keeps off the raiders' lines is hit by 2% of
  the bolts, the average bot by 5%, because shooting means lining up with a raider. The
  camper faces more than twice the bolts and ends up with the same hit rate, and it
  reaches the same level as the average bot. What it loses is score (median 65,100 against
  166,600). No constant changed that; a raider that punishes not shooting is the diver of
  section 4.
- **Final blow.** Mines sit off the gem lines by design, so the average bot is hit by a
  mine about once in 12 minutes. Bolts would have to be cut to a tenth, or mines made ten times
  denser, to bring one cause under 60%. Both would break the curve or the gem lines. The
  baseline did not meet this either (average bot: bolts 74% of deaths).

**Also moved against earlier slices.** Seconds per minute with a bolt in flight and a mine
close ahead rose from 1.6 in the build before this slice to 2.2 for the average bot (S3
asked for a value below the baseline game's). This is the added pressure itself: more
bolts per minute.

**Live session** (1280 x 720, real GPU): good bot on ORION for 180 s reached level 7 with
two ships left; average bot on ORION for 150 s, with the first cycle forced to repeat,
reached level 5 with all three ships. 120 fps mean, p95 frame time 10.0 ms, worst frame
10 ms in both. The screenshots show the title with the ship preview beside the text
column, a mine-free weave 7 s into the run, gem lines in each tier, far mines and gems
as separate shapes, a raider's white tell standing out from them, the LEVEL and REPEAT
banners above the vanishing point with the tube centre free, and no bolt in flight in
the frames after a level change.

### S7. Life shards: fighting earns lives back (as built)

Added after the owner played S1 to S6: avoiding the raiders cost nothing, and lives came
back on a timer. This slice has no earlier plan in this document; this section is the record.

**What the player gets.** Every destroyed raider leaves a small green cross (a life
shard) on the wall where it died, on the line the player shot along. It scrolls in like a
gem and is caught by riding into it. While a ship is missing, each caught shard fills one
segment of a green bar next to the ships and plays one step of a tone that rises across the
whole set; a full bar restores one ship with the 1-up cue and the green hull flash, and the
bar starts again. The last raider of every Nth fully destroyed squad leaves a large cross
in place of the shard: a whole ship at once. A caught cross of either size also returns
weapon charge. At full lives a caught cross pays score. A missed cross is gone. A player
who never shoots earns no lives.

**Rules.**
- A hit always costs one whole life. Shards never make a fraction of a life usable.
- Every kill drops a shard. At full lives `game.addShard()` returns 0 and the session
  pays `LIFE_SHARD.FULL_SCORE` (110, one gem) x the level multiplier, so progress cannot
  build up at full lives and a cross is never visible but uncollectable.
- Progress (`game.shards`) is kept when a life is lost and cleared by a reset.
- Shards per life: `LIFE_SHARD.PER_LIFE` (4) + `PER_LIFE_STEP` (1.5) per tuning level past
  `PER_LIFE_HOLD` (2), rounded, at most `PER_LIFE_MAX` (20). `session.preUpdate` sets `game.shardsPerLife`;
  a set already started keeps its size, so the bar never moves backward. On ORION that is
  4 on levels 1 to 3, 6 at level 4, 10 at level 7, 20 from level 14; MILKY WAY grows slower, QUASAR starts higher.
- Squad cross: `enemies.ts` passes `last` to `onKill` when the kill destroys the whole
  squad (nobody left to enter, nobody got away). The session counts destroyed squads and
  drops the extra-life cross on the count `EXTRA_LIFE.SQUAD_EVERY` (3) + `SQUAD_EVERY_STEP`
  (1) per tuning level, at most `SQUAD_EVERY_MAX` (12), then counts again. The cross
  restores one life, or pays `EXTRA_LIFE.FULL_SCORE` (750) x the level multiplier at full lives.
- Charge: a caught shard returns `LIFE_SHARD.CHARGE` (6, two shots), a caught cross
  `EXTRA_LIFE.CHARGE` (20, as much as an orb). `ENEMY.ENERGY_REFUND` is 4 per kill. Orbs
  are `PICKUP.SPAWN_SPACING` 240 apart.
- Hit area: the outer hit cone `GUN.HIT_ANGLE` (0.29 rad, the drawn half-span of the
  raider) is multiplied by the raider's far scale in `enemies.tryKill`, so a bolt that
  crosses the drawn wing deals 1 damage (2 kill). The kill cone `HIT_ANGLE_KILL` (0.14 rad)
  has one size at every distance.
- Placement (`dropShard` in `session.ts`): the raider's angle, at the raider's distance but
  never closer than `LEAD_SECONDS` (1.2 s) of flight, stepped forward off a mine. The
  shard pool holds `COUNT` (8); with the pool empty a kill drops nothing.
- The shard is the extra-life cross at `LIFE_SHARD.SCALE` (0.6), a fifth wall field (feed
  mode), with `CAPTURE_ANGLE` 0.60 rad and `CAPTURE_Z` 2.6. A dropped shard or cross grows
  in over `GROW_TIME` (0.35 s) from a small size with a slight overshoot (`growTime` in
  `world/field.ts`), so the eye is led from the kill burst to the cross.
- With `EXTRA_LIFE.ENABLED = false` the cross field is a feed field filled by destroyed
  squads. Setting it to true makes it the distance-timed field and switches the squad cross off.
- HUD: after the ship glyphs, a green cross and a segmented bar (one segment per shard of
  the set), shown only while a ship is missing and not on the game-over screen; the next
  ship's glyph brightens in the same green as the bar fills. The title legend names both
  crosses. Sound: `shard`, one rising pair per catch; its pitch follows the progress through
  the set, and the completing shard plays the 1-up. A cross caught at full lives plays the
  top step.
- Session events: `shardDropped`, `shardCollected(count, restored)`, `shardMissed`,
  `crossDropped`, `bonusCollected(big)`; `lifeCollected` fires when a life is restored.

**Why the set and the squad count grow with the level.** One fixed number cannot serve
both an ordinary and a skilled player: deeper levels bring more raiders, so more kills and
more destroyed squads per minute. Measured on ORION (60 runs, cap 900 s): with the catch
window at 0.60 rad the bots catch about 70% of their shards (0.40 rad: kid 39%, average
57%; the owner caught about 1 in 3). With that window and a set capped at 12 the good bot
was alive at the cap in 53% of runs without any squad cross; a cross on every 3rd squad at
every level raised that to 73%. A cross on every 8th squad left the kid bot with 0.1
crosses per run. The values above give the kid a cross early and keep it rare at depth.

**Measured** (`playtest/next-level.json`, 60 runs per bot, cap 900 s):

| Bot, mode | lifeBalance | Median level | Median time | Alive at cap | Shards caught | Mean charge |
|---|---|---|---|---|---|---|
| kid, ORION | 0.42 | 5 | 196 s | 0% | 71% | 87% |
| average, ORION | 0.61 | 14 | 575 s | 5% | 75% | 93% |
| good, ORION | 0.82 | 27 | 900 s | 77% | 75% | 94% |
| good, QUASAR | 0.68 | 26 | 894 s | 48% | 74% | 94% |
| kid, MILKY WAY | 0.48 | 14 | 526 s | 5% | 68% | 90% |
| camper, ORION | 0 | 7 | 197 s | 0% | - | 98% |

The oracle is alive at the cap in every run in all three modes.

**Sims.** `npm run sim` checks M1 to M9: a kill at full lives drops a shard and catching
it pays score, a drop while a life is missing is at least `LEAD_SECONDS` ahead, a caught
shard is progress and not a life, progress survives a lost life, a full set restores
exactly one life, a reset clears shards and progress, the cross field follows its switch,
and a destroyed squad leaves a cross that restores a whole life.

**Known weaknesses.**
- With the hit cone at the drawn wing size the good bot is alive at the 900 s cap in 77%
  of its ORION runs (32% with the 0.24 rad cone): it kills faster and is hit less (0.50
  hits per minute, was 0.66). The deep levels are too easy for a skilled player and are
  not tuned again yet.
- The bots cannot calibrate weapon charge for a person: their gun is never empty, while the
  owner ran dry often before the charge from crosses and the closer orbs. With these
  values charge may no longer be a constraint for an accurate player.
- At high speed or after a close kill the shard appears farther down the line than the
  explosion (the `LEAD_SECONDS` rule), not exactly where the raider died.
- A shard is 1/4 of a life on levels 1 to 3 and 1/20 from level 14 on ORION; the squad cross is
  the whole-life reward at every level.
- This slice adds one HUD element and one object type, which section 4 excludes for S1 to S6.

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

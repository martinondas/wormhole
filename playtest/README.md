# Playtest harness

Bot players that play the real game and measure how it plays. The bots run `src/session.ts`,
the same gameplay module the browser runs, and press only what a player can press: left,
right, fire.

Two result files are stored here. Both are produced by a run and can be regenerated. They are
references, not gates.

- `baseline.json` is the game before the gem lines and the raider squads. It shows where the
  game came from.
- `next-level.json` is a snapshot of the current game, with the per-level tables.

Runs are seeded: the same bot, mode and seed always give the same result. So a pure refactor
can be checked by regenerating a file and comparing it with the stored one.

## Commands

| Command | What it does |
|---|---|
| `npm run playtest -- <options>` | Headless runs of one or more bots, prints a table |
| `npm run playtest:compare` | Runs the baseline set and prints the baseline against the current game |
| `npm run playtest:baseline` | Overwrites `playtest/baseline.json` with the current game. Only when a new baseline is agreed |
| `npm run playtest:next` | Overwrites `playtest/next-level.json` with the current game |
| `npm run playtest:live -- <options>` | One bot plays the real browser build, saves screenshots and frame times |

To compare a change against the current snapshot, use the options of `playtest:next` in
`package.json` with `--compare playtest/next-level.json` in place of `--out`.

Options of `npm run playtest`:

- `--bot <names>` a comma list or `all`
- `--difficulty milkyway,orion,quasar` or `all` (default `orion`)
- `--runs <n>` seeded runs per bot and mode, `--seed <n>` the first seed
- `--max-seconds <n>` time cap per run
- `--matrix baseline` the baseline set: every bot on ORION, kid on MILKY WAY, good on QUASAR
- `--matrix next` the baseline set plus the oracle on MILKY WAY and on QUASAR
- `--out file.json` machine-readable results (`--keep-runs` adds every single run)
- `--compare file.json` prints deltas against an earlier `--out` file
- `--levels` adds the per-level table for each bot
- `--set bot.key=value` changes one bot limit for this call, to study the bots
- `--cfg GROUP.KEY=value` changes one number of `src/config.ts` for this call, to try a tuning
  value before editing the file, for example `--cfg ENEMY.HUNT_TRACK.0=2`. A value the game
  reads only once at load (a pool size) is not affected
- `--workers <n>` worker threads

Options of `npm run playtest:live`: `--bot`, `--difficulty`, `--seed`, `--max-seconds`,
`--shot-every <n>` (seconds of game time between screenshots), `--out <dir>`, `--width`,
`--height`, `--software` (software WebGL). The defaults are in the header of
`scripts/playtest.ts` and `scripts/playtest-live.ts`.

Reading a comparison: a row marked `CHANGED` moved by more than the run-to-run noise (two
standard errors). Other deltas can be chance. A metric added after the stored file was
recorded shows 0 in that file's column.

The live harness starts its own dev server and stops it at the end. Besides timed screenshots
it saves screenshots of feedback events, named after the event: among them the level gate
when it opens, when it is near and when the craft passes it. It refuses an `--out`
directory inside the repository. Without `--out` it writes to `$PLAYTEST_LIVE_DIR`, or to the
system temp directory.

## The bots

All bots share one steering method: a short look-ahead search. The bot tries a few simple key
plans, rolls the real craft physics forward for each, and takes the plan that collects, dodges
and aims best. The limits in `scripts/playtest/bot.ts` make the difference.

| Bot | What it is for |
|---|---|
| kid | The weakest player: slow reactions, short sight, loose aim, lapses of attention, avoids the top of the tube |
| average | An ordinary player |
| good | A skilled player: plans swings and waits, leads targets |
| oracle | Perfect information, no reaction delay, no error. A hit on the oracle points to an unfair situation |
| camper | An average player who never shoots and keeps away from raiders. Shows whether avoiding the fight pays |
| spinner | Holds one steer key and the fire key for the whole run. Shows whether an endless spin pays |
| tapper | Rests at the bottom, collects nothing, shoots a raider on its line and taps away from a firing tell. Its bolt hits are the "I dodged and it still hit me" case |
| passive | No input |

Every bot except the oracle has limits: delayed sight, fog distance, error in judged angles,
a wandering aim, a limited number of objects in mind, key presses that land late, and a
slightly wrong feel for the swing. The bots do not read hidden state. They see the angle and
distance of wall objects, raiders and bolts, and a raider's firing tell.

The bot limits are estimates, not measurements of people. Two observations anchor them: how
far a child once got in the game, and the owner's report that many raiders at once are hard
to manage.

## Principles

Notes from use so far, not rules.

- Bots of different skill play the real gameplay module, not a model of it.
- Runs are seeded, so a result can be reproduced.
- A bot with perfect information and no reaction delay approximates the question "was this
  death unfair".
- Bots that only exploit (camp, spin, tap) show whether a degenerate strategy pays.
- A change is judged by how the measures move for several skill levels at once, not by one
  number. More is not always better: check that the change moved the measure it was meant to move.

## What the bots miss

- They aim better than a person. This is inferred from the owner's reports on ammunition and
  wing hits, not measured. So they understate how often a person runs dry or misses.
- They cannot see or hear. Readability, sound and feel need a person, or at least the
  screenshots of the live harness.
- They can show a problem without showing its weight. The bots showed the low catch rate of
  the green crosses, but it was the owner's play that made it a priority.

## How it was used so far

One example of a workflow that worked. Future sessions are free to find better ways.

1. A design panel proposed changes, and they were written as a spec.
2. The work was built in slices. Each slice was measured against the stored results, and its
   live screenshots were looked at.
3. The owner played. His sessions corrected the bots several times: the decision notes in
   [docs/next-level-spec.md](../docs/next-level-spec.md) record where.

## Metrics

Per run, then mean, median, p10 and p90 over the runs of one bot and mode. `SCALAR_KEYS` in
`scripts/playtest/metrics.ts` is the current list, with a one-line meaning for each.

- **Outcome**: `time`, `level`, `score`, `capped` (alive at the time cap).
- **Damage**: `hitsPerMin`, `livesLost` and by cause (`livesLostMine`, `livesLostBolt`,
  `livesLostRam`),
  `timeToFirstHit`, `chainHits` (a life lost right after the invulnerability of the previous
  hit ended).
- **Progression**: `secondsPerLevel` (mean seconds a completed level took), `gateSeconds` (of
  which from the quota met to the gate passed), `gems` / `gemsOffered` / `gemShare`, `orbs` /
  `orbsOffered`, `gemChainMedian` / `gemChainMax` (gems in a row without a miss).
- **Lives regained**: `extraLives` (every life regained), `shardsDropped` / `shardsCaught` /
  `shardCatchShare` / `livesFromShards` (the small crosses left by kills), `crossesDropped` /
  `crossesCaught` (the large crosses, from destroyed squads and bonus crosses), `lifeBalance` (lives regained
  divided by lives lost).
- **Gun**: `emptyGunShare`, `meanCharge`, `shots`, `accuracy`, `kills`, `killsPerMin`,
  `killDistanceMedian`, `killsBeyond60Share` (how far ahead raiders die).
- **Enemy fire**: `boltsAtPlayer`, `boltsAimedShare` (fired down the player's line at the
  moment the bolt leaves), `tellsAimedShare` (the tell started on the player's line, dodged or
  not), `boltsHitShare`, `boltsDodgedShare`, `tellToArrivalMin` (shortest time from a tell to
  the bolt reaching the ship).
- **Raiders**: `raidersMean`, `raidersMax`, `raiders4PlusShare`, `clumpShare` (two raiders so
  close that they read as one), `wavesClearedPerMin`, `raiderFreeShare` (the breathers).
- **Pacing**: `threatsPerMin`, `intensityCV` (spread of threats over time, 0 means flat),
  `quietShare`, `deadAirLongest` / `deadAirShare` (nothing to collect, dodge or fight),
  `boltMinePerMin` (a bolt in flight and a mine close ahead at once).
- **Use of the wall**: `bottomShare` (time within 15 degrees of the bottom), `upperShare`
  (time more than 105 degrees from the bottom), `wallBinsUsed`, `loops`, `loopsPerMin`.
- **Input**: `reversalsPerMin`, `pressesPerMin`, `steerDuty`.
- **Mines**: `mineCloseCalls`, `nearMissPerMin`.
- **Per level** (`--levels`): for each level, how many runs reached it and ended there, the
  main measures above at that level, `level time` (seconds the level took, over the runs that
  passed its gate) and `gate wait` (of which after the quota was met).

## Sims

Each sim is a fast headless check of one part of the game.

| Command | What it checks |
|---|---|
| `npm run sim` | Combat: gun, raiders, waves, the cap on simultaneous fire, tells, bolts, crosses from kills, the bonus cross, lives |
| `npm run sim:levels` | Level math: speeds, the gem quota and the level gate, waves per mode |
| `npm run sim:fields` | Wall fields: placement, separation between kinds, miss and near-miss events |
| `npm run sim:sequence` | Gem lines: every phrase can be flown and its mines stay clear of the line, budgets, section boundaries, input jitter, a difficulty change on the title |
| `npm run sim:feel` | The visual feel layer: shake, speed field of view, hull attitude, hit-stop, far-object scale. Also that the steering torque has no step around the tube |

## What the harness needs from the game

- `src/session.ts` is the single place that wires the gameplay and reports events through
  `SessionFx`. The recorder hears the same events as the browser.
- Fields, raiders and bolts have read-only `visit()` methods. The bots and metrics see the
  world only through them.
- Gameplay randomness goes through `src/util/rng.ts`, never `Math.random`.
- A new kind of object or threat must be added to `scripts/playtest/perception.ts` and to the
  bot's event list in `scripts/playtest/bot.ts`. Otherwise the bots cannot see it. The level
  gate is not listed: it is harmless and cannot be missed, so the bots do not need to see it.
- The bots read hit windows and speeds from `src/config.ts`. A mechanic that config does not
  describe must be taught to the bot.
- A raider's role is not reported. A hunter looks like any raider, and the bots know it only
  by how it moves and by its firing tell.

Two things break a live session, and neither is a game fault. A Mac that goes to sleep stops
the run: keep it awake for unattended runs. And the dev server reloads the page when a file
under `src/` is saved, which ends the session: do not edit the game while a session runs.

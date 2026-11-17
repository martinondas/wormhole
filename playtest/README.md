# Playtest harness

Bot players that play the real game and measure how it plays. Every gameplay change
is judged against a recorded result file.

- `baseline.json` is the game before the next-level work (random gem and mine fields,
  raiders without waves). It stays as the reference of where the game came from.
- `next-level.json` is the game as it is now, with the per-level tables. Compare a
  new change against it: `npm run playtest -- --matrix next --runs 60 --seed 1
  --max-seconds 900 --compare playtest/next-level.json`.

The bots run `src/session.ts`, the same gameplay module the browser runs. They press
only what a player can press: left, right, fire.

## Commands

| Command | What it does |
|---|---|
| `npm run playtest -- --bot good --runs 40` | Headless runs of one or more bots, prints a table |
| `npm run playtest:compare` | Runs the baseline set again and prints baseline vs current |
| `npm run playtest:baseline` | Overwrites `playtest/baseline.json`. Only when a new baseline is agreed |
| `npm run playtest:next` | Overwrites `playtest/next-level.json` with the game as it is now. After an accepted tuning change |
| `npm run playtest:live -- --bot good --max-seconds 90 --out <dir>` | One bot plays the real browser build, saves screenshots and frame times |

Options of `npm run playtest`:

- `--bot kid,average,good,oracle,camper,spinner,tapper,passive` or `all`
- `--difficulty milkyway,orion,quasar` or `all` (default `orion`)
- `--runs <n>` seeded runs per bot and mode (default 40), `--seed <n>` first seed (default 1)
- `--max-seconds <n>` time cap per run (default 600; the baseline uses 900)
- `--matrix baseline` the baseline set: every bot on ORION, kid on MILKY WAY, good on QUASAR
- `--matrix next` the baseline set plus the oracle on MILKY WAY and on QUASAR, so the fairness guard runs in every mode
- `--out file.json` machine-readable results (`--keep-runs` adds every single run)
- `--compare file.json` prints deltas against an earlier `--out` file
- `--levels` adds the per-level pacing table for each bot
- `--set bot.key=value` changes one bot limit for this call, to study the bots
- `--cfg GROUP.KEY=value` changes one number of `src/config.ts` for this call, to try a tuning value before editing the file, for example `--cfg ENEMY.HUNT_TRACK.0=2.4`. A true/false switch takes 0 or 1: `--cfg SEQUENCE.ENABLED=0` plays the game with random gem and mine fields instead of gem lines. A value the game reads only once at load (pool sizes) is not affected
- `--workers <n>` worker threads (default: cores minus one, at most 8)

The baseline set (600 runs, about 73 hours of play) takes about one minute.
A run is reproducible: the same bot, mode and seed always give the same result.

Besides the timed screenshots, the live harness saves one screenshot per feedback
event (READY, level up, repeat, loop, hit, near miss, a raider's firing tell, a
cleared wave, and each kind of gem line in each tier half a second before the craft
reaches it, named `phrase-<kind>-t<tier>`; at most three of each, named after the event), plus a second shot
0.45 s after a level or repeat banner, once it is fully shown, one about 0.3 s after
a firing tell starts, when the raider's nose is white, and one 1 s after a hit
(`hit-after`), when the view jolt and the hit slow-down are over. `--force-repeat` holds the gem count at 0 during the fast section of
the first cycle, so the first cycle repeats and the REPEAT banner can be checked.

The live harness starts its own vite dev server on a free port and stops it at the
end. It refuses an `--out` directory inside the repository. Without `--out` it writes
to `$PLAYTEST_LIVE_DIR`, or to the system temp directory.

Two things break a live session, and neither is a game fault. A Mac that goes to sleep
stops the run in the middle: for unattended runs keep it awake with
`caffeinate -dimsu` on AC power (a closed lid without it sleeps anyway). And the dev
server reloads the page when a file under `src/` is saved, which ends the session
with "Execution context was destroyed": do not edit the game while a session runs.

## The bots

All bots share one steering method: a short look-ahead search. The bot tries a few
simple key plans, rolls the real craft physics forward for each, and takes the plan
that collects, dodges and aims best. The limits below make the difference.

| Bot | Reaction | Sees ahead | Other limits |
|---|---|---|---|
| kid | 350 ms | 90 units | re-plans 5 times a second, misjudges angles, sprays the gun, loses attention about every 8 s, avoids the top of the tube |
| average | 250 ms | 120 units | re-plans 8 times a second, plans one swing and one reversal, loose aim |
| good | 180 ms | 160 units | re-plans 12 times a second, plans swings and waits, leads targets |
| oracle | none | everything spawned | no error at all, and a strong preference for the next pickup over later ones (`nearBias`). Its hits show situations that are unfair |
| camper | 250 ms | 120 units | an average player who never shoots and keeps away from raiders. Measures the safe-spot exploit |
| spinner | - | - | holds one steer key (left or right, by seed) and the fire key for the whole run. Measures the endless-spin exploit |
| tapper | 250 ms | raiders only | rests at the bottom and collects nothing. Shoots a raider on its line; when a raider on its line shows the firing tell, it taps 150 ms away and lets go. Its bolt hits are the "I dodged and it still hit me" case |
| passive | - | - | no input |

What every bot except the oracle is limited by: delayed sight of the world, fog
distance, error in judged angles (larger for far objects), a wandering aim error, a
limited number of objects kept in mind, a minimum key-hold time, key presses that
land a little late, and a slightly wrong feel for the swing (a different error in
each run). `nearBias` sets how much less a pickup at the end of the look-ahead counts
than one right now. The oracle sees a whole gem line at once and its key plans are
coarse, so with the default bias it gave up the next gem for a plan that only looked
richer; it uses a strong bias instead. The other bots keep the default. The bots do not read hidden state. They see angle and distance of wall
objects, raiders and bolts, and the raider's firing glow. Speeds are worked out
from two looks, the way a player does.

The bot limits are estimates, not measurements of people. Two facts anchor them:
a child once reached about level 17 on ORION, and the owner finds four or more
raiders hard to manage. Use the bots to compare two versions of the game, not as
exact predictions of what a person will reach. Reluctance to hang near the top of
the tube (`topAversion`) is an assumption.

## Metrics

Per run, then mean, median, p10 and p90 over the runs of one bot and mode.

- **time, level, score, capped**: how long the run lasted, the level reached, the score, and whether the run was still alive at the time cap.
- **hitsPerMin, livesLostMine / Bolt / Ram, deathCauses, timeToFirstHit**: damage by cause.
- **levelRepeats**: gem-gate failures (a cycle that ended without a level-up).
- **gems / gemsOffered / gemShare, orbs / orbsOffered, extraLives**: what was collected of what passed. `extraLives` counts every life regained (a completed shard set, or an extra-life cross when `EXTRA_LIFE.ENABLED` is on).
- **shardsDropped, shardsCaught, shardCatchShare, livesFromShards**: life shards left by kills, how many the bot caught, the share caught, and the lives restored by completed sets.
- **crossesDropped, crossesCaught**: whole-life crosses left by destroyed squads, and how many the bot caught.
- **emptyGunShare, meanCharge, shots, accuracy, kills, killsPerMin**: the gun. Accuracy is bolts that struck a raider divided by shots.
- **boltsAtPlayer, boltsAimedShare, boltsHitShare, boltsDodgedShare**: enemy fire. "Aimed" means the bolt was fired down the player's line and would hit if the player did not move.
- **tellsAimedShare**: share of enemy bolts whose firing tell started while the player was on that line. A hunter fires only then, so this counts aimed shots even when the player moved away during the tell (`boltsAimedShare` looks at the moment the bolt leaves, after the player reacted). Also per level in the `--levels` table (`tells aimed`).
- **raidersMean, raidersMax, raiders4PlusShare, raiderHist**: raiders in play (nearer than 90 units, not leaving).
- **raiderFreeShare, wavesClearedPerMin**: wave pacing. Share of time with no raider in play and no enemy bolt in flight (the breathers), and waves destroyed to the last member per minute.
- **deadAirLongest, deadAirShare**: time with nothing to collect, dodge or fight in the next 1.5 s.
- **threatsPerMin, intensityCV, quietShare, timeline**: pacing. A threat event is an enemy bolt, a mine that passes, or a raider fly-by. `intensityCV` is the spread of threats per 5 s (0 means flat). `quietShare` is the share of 5 s windows with at most one threat.
- **bottomShare, upperShare, wallBinsUsed, loops, thetaHist**: how much of the wall is used.
- **reversalsPerMin, pressesPerMin, steerDuty**: how busy the hands are.
- **mineCloseCalls**: mines that passed just outside the hit cone.
- **killDistanceMedian, killsBeyond60Share**: how far ahead of the ship raiders die, and the share killed more than 60 units ahead.
- **clumpShare**: share of time with two live raiders within 0.4 rad and 10 units of each other (they read as one).
- **tellToArrivalMin**: shortest time from a raider's charge start to its bolt reaching the ship plane. The report shows the minimum over all runs.
- **lifeBalance**: lives regained divided by lives lost (lives lost floored at 1).
- **chainHits**: lives lost within 1.0 s after the i-frames of the previous hit ended.
- **gateFirstTry**: share of levels whose first cycle ended with the gem quota met (per level in the `--levels` table).
- **gemChainMedian, gemChainMax**: runs of consecutive gems without a miss.
- **nearMissPerMin, loopsPerMin**: the session's `mineNearMiss` and `loopCompleted` events per minute.
- **boltMinePerMin**: seconds per minute with an enemy bolt in flight and a mine less than 1 s ahead (two threats at once).
- **perLevel**: for each level, share of runs that reached it, share that ended there, hits per minute, threats and pickups per 5 s, gem share, kills per minute, repeats, raiders in play.

## What the numbers say now

`next-level.json`, 60 seeded runs per bot, cap 900 s (in brackets: `baseline.json`).

| Bot, mode | Median level | Median time | Lives lost per minute |
|---|---|---|---|
| kid, MILKY WAY | 10 (7) | 335 s (217 s) | 0.82 (2.07) |
| kid, ORION | 4 (7) | 126 s (229 s) | 1.74 (2.16) |
| average, ORION | 9 (22) | 301 s (670 s) | 1.01 (1.44) |
| good, ORION | 21 (31, the cap) | 654 s (900 s, the cap) | 0.69 (0.62) |
| good, QUASAR | 17 (31) | 512 s (900 s) | 0.80 (0.71) |
| camper, ORION | 7 (17) | 225 s (545 s) | 0.94 (1.48) |
| oracle, every mode | 31 | 900 s | 0.00 (0 to 0.03 lives lost per 15 minutes) |

Lives lost per minute are not higher than in the baseline up to level 9. From level 9 to
16 the raiders fire faster and their tells come closer together (`LEVELS.DEEP_FROM` /
`DEEP_SPAN`, `ENEMY.DEEP_COOLDOWN_K` / `DEEP_STAGGER_K`), so the good bot loses more there. Runs are shorter because
lives no longer arrive on a timer every 20 to 50 seconds: they are earned back by
killing raiders and catching the green crosses they drop (`lifeBalance`: kid 0.42, average
bot 0.61, good bot 0.82, camper 0; baseline 0.77 for the average bot). A life costs 4
shards on levels 1 to 3 and at most 20 (ORION: from level 14); the last raider of every 3rd to
12th destroyed squad drops a whole life. The good bot is alive at the 900 s cap in 77% of
its ORION runs and 48% of its QUASAR runs, which is too many: the deep levels are not
tuned again for the hit cone at the drawn wing size. Shards caught of shards dropped: kid 71%,
average 76%, good 74%. The bots' gun is never empty (mean charge 80 to 89%), because a
caught cross returns charge; the bots aim better than a person, so this number does not
show how often a person runs dry.

The gem gate on ORION, measured before the squad cross, share of levels passed on the first cycle at
levels 4 to 8, average bot: 76, 80, 75, 69, 72% (60 runs); 74, 80, 76, 70, 80% (120 runs,
seeds 1 to 120, before the deep pressure, which starts at level 9). Levels 1 to 3 are at 98 to 100%.

The figures in the next paragraph were measured before the life shards and have
not been measured again since.

In 600 runs of the kid, average and good bots on ORION (200 each, seeds 1000 to 1199)
no life was lost in the first 2.2 s after a level-up (the raiders hold their fire across
a cycle boundary) and none in the first 10 s of a run (it opens without mines).

## Sims

Each sim is a fast headless check of one part of the game. All of them must pass
after a change, together with `npm run typecheck` and `npm run build`.

| Command | What it checks |
|---|---|
| `npm run sim` | Combat: gun, raiders, waves, fire slots, tells, bolts, the fire hold at a cycle boundary |
| `npm run sim:levels` | Level math: boundaries, speeds, gem gate and quota (always at least 3 gems under the fewest a cycle offers), wave table per mode, where each step in pressure lands |
| `npm run sim:fields` | Wall fields: spawn separation between kinds, feed mode, miss and near-miss events |
| `npm run sim:sequence` | Gem lines: every phrase can be flown and keeps its mines clear of the line, gem and mine budgets, section boundaries, the mine-free opening of a run |
| `npm run sim:feel` | Camera shake, speed FOV, hull attitude, hit slow-down, far-object scale (wall objects and raiders) |
| `npm run sim:swing` | The swing per gravity tier, with and without `CLIMB.FADE` |

## Comparing against the baseline

1. Make the change.
2. Run `npm run playtest:compare`. It uses the same bots, modes, seeds and time cap as the baseline.
3. Read the deltas per bot. A row marked `CHANGED` moved by more than the run-to-run noise (two standard errors); other deltas can be chance. A metric added after the baseline was recorded shows 0 in the baseline column. More is not always better. Check that the change moved the metric it was meant to move, and that the oracle still takes no hits.
4. Run `npm run playtest:live` and look at the screenshots. The numbers do not show how the game looks.

## What the harness needs from the game

- `src/session.ts` stays the single place that wires the gameplay, and reports events through `SessionFx` (pickups, damage, cycle ends, gem chains, loops, near misses, raider charge starts, cleared waves). The recorder hears the same events as the browser.
- Fields, raiders and bolts keep their read-only `visit()` methods (`src/world/field.ts`, `enemies.ts`, `projectiles.ts`). The bots and metrics see the world only through them.
- Gameplay randomness goes through `src/util/rng.ts`, never `Math.random`.
- Raiders report their phase through `visit()`: `approach`, `engage`, `depart` (falling behind) and `exit` (leaving forward, harmless). The role (weaver or hunter) is not reported: a hunter looks like any raider, and the bots know it only by how it moves and by its firing tell.
- A new kind of object or threat must be added to `scripts/playtest/perception.ts` and to the bot's event list in `scripts/playtest/bot.ts`, otherwise the bots cannot see it (life shards are `KIND_SHARD`: wanted while a life is missing). Gem lines need nothing new: their gems and mines are objects of the gem and mine fields, which the bots already see. The session also reports `phrasePlaced`, `phraseAhead`, `sectionPlanned` and `cyclePlanned` for the sims and the live screenshots; the bots do not read them.
- The bots read hit windows and speeds from `src/config.ts`. A mechanic that config does not describe must be taught to the bot.

# Playtest harness

Bot players that play the real game and measure how it plays. Every gameplay change
is judged against `baseline.json`, the record of the game before the change.

The bots run `src/session.ts`, the same gameplay module the browser runs. They press
only what a player can press: left, right, fire.

## Commands

| Command | What it does |
|---|---|
| `npm run playtest -- --bot good --runs 40` | Headless runs of one or more bots, prints a table |
| `npm run playtest:compare` | Runs the baseline set again and prints baseline vs current |
| `npm run playtest:baseline` | Overwrites `playtest/baseline.json`. Only when a new baseline is agreed |
| `npm run playtest:live -- --bot good --max-seconds 90 --out <dir>` | One bot plays the real browser build, saves screenshots and frame times |

Options of `npm run playtest`:

- `--bot kid,average,good,oracle,camper,passive` or `all`
- `--difficulty milkyway,orion,quasar` or `all` (default `orion`)
- `--runs <n>` seeded runs per bot and mode (default 40), `--seed <n>` first seed (default 1)
- `--max-seconds <n>` time cap per run (default 600; the baseline uses 900)
- `--matrix baseline` the baseline set: every bot on ORION, kid on MILKY WAY, good on QUASAR
- `--out file.json` machine-readable results (`--keep-runs` adds every single run)
- `--compare file.json` prints deltas against an earlier `--out` file
- `--levels` adds the per-level pacing table for each bot
- `--set bot.key=value` changes one bot limit for this call, to study the bots
- `--workers <n>` worker threads (default: cores minus one, at most 8)

The baseline set (480 runs, about 72 hours of play) takes about one minute.
A run is reproducible: the same bot, mode and seed always give the same result.

The live harness starts its own vite dev server on a free port and stops it at the
end. It refuses an `--out` directory inside the repository. Without `--out` it writes
to `$PLAYTEST_LIVE_DIR`, or to the system temp directory.

## The bots

All bots share one steering method: a short look-ahead search. The bot tries a few
simple key plans, rolls the real craft physics forward for each, and takes the plan
that collects, dodges and aims best. The limits below make the difference.

| Bot | Reaction | Sees ahead | Other limits |
|---|---|---|---|
| kid | 350 ms | 90 units | re-plans 5 times a second, misjudges angles, sprays the gun, loses attention about every 8 s, avoids the top of the tube |
| average | 250 ms | 120 units | re-plans 8 times a second, plans one swing and one reversal, loose aim |
| good | 180 ms | 160 units | re-plans 12 times a second, plans swings and waits, leads targets |
| oracle | none | everything spawned | no error at all. Its hits show situations that are unfair |
| camper | 250 ms | 120 units | an average player who never shoots and keeps away from raiders. Measures the safe-spot exploit |
| passive | - | - | no input |

What every bot except the oracle is limited by: delayed sight of the world, fog
distance, error in judged angles (larger for far objects), a wandering aim error, a
limited number of objects kept in mind, a minimum key-hold time, key presses that
land a little late, and a slightly wrong feel for the swing (a different error in
each run). The bots do not read hidden state. They see angle and distance of wall
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
- **gems / gemsOffered / gemShare, orbs / orbsOffered, extraLives**: what was collected of what passed.
- **emptyGunShare, meanCharge, shots, accuracy, kills, killsPerMin**: the gun. Accuracy is bolts that struck a raider divided by shots.
- **boltsAtPlayer, boltsAimedShare, boltsHitShare, boltsDodgedShare**: enemy fire. "Aimed" means the bolt was fired down the player's line and would hit if the player did not move.
- **raidersMean, raidersMax, raiders4PlusShare, raiderHist**: raiders in play (nearer than 90 units, not leaving).
- **deadAirLongest, deadAirShare**: time with nothing to collect, dodge or fight in the next 1.5 s.
- **threatsPerMin, intensityCV, quietShare, timeline**: pacing. A threat event is an enemy bolt, a mine that passes, or a raider fly-by. `intensityCV` is the spread of threats per 5 s (0 means flat). `quietShare` is the share of 5 s windows with at most one threat.
- **bottomShare, upperShare, wallBinsUsed, loops, thetaHist**: how much of the wall is used.
- **reversalsPerMin, pressesPerMin, steerDuty**: how busy the hands are.
- **mineCloseCalls**: mines that passed just outside the hit cone.
- **perLevel**: for each level, share of runs that reached it, share that ended there, hits per minute, threats and pickups per 5 s, gem share, kills per minute, repeats, raiders in play.

## Comparing against the baseline

1. Make the change.
2. Run `npm run playtest:compare`. It uses the same bots, modes, seeds and time cap as the baseline.
3. Read the deltas per bot. A row marked `CHANGED` moved by more than the run-to-run noise (two standard errors); other deltas can be chance. More is not always better. Check that the change moved the metric it was meant to move, and that the oracle still takes no hits.
4. Run `npm run playtest:live` and look at the screenshots. The numbers do not show how the game looks.

## What the harness needs from the game

- `src/session.ts` stays the single place that wires the gameplay, and reports events through `SessionFx`.
- Fields, raiders and bolts keep their read-only `visit()` methods (`src/world/field.ts`, `enemies.ts`, `projectiles.ts`). The bots and metrics see the world only through them.
- Gameplay randomness goes through `src/util/rng.ts`, never `Math.random`.
- A new kind of object or threat must be added to `scripts/playtest/perception.ts` and to the bot's event list in `scripts/playtest/bot.ts`, otherwise the bots cannot see it.
- The bots read hit windows and speeds from `src/config.ts`. A mechanic that config does not describe must be taught to the bot.

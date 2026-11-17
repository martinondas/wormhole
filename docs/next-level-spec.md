# Wormhole - design and decision notes

A record of discovery: what each part of the game is for, which trade-offs came up, what we
chose, and what we tried and rejected. Nothing here is set in stone. Play and evidence override
any note. The code and `src/config.ts` are the only source of current behaviour and values.

Each feature has the intended experience, the trade-off, the current choice in words, and
dated notes. "Bots" are the playtest bots of [playtest/README.md](../playtest/README.md).
The difficulty target is the owner's choice: the game is tuned for the owner on the middle
mode (ORION).

## Feedback and feel

**Experience.** The game explains itself. The player hears and sees when the gem quota is met,
when a level advances and why a level repeats. A threat is heard before it is seen. Fast feels
fast, and a hit is readable: the player sees what caused it.

**Trade-off.** More feedback makes the game easier to read, but every extra signal competes
for the same small view around the ship, and the handling must stay as tuned.

**Current choice.**
- Level events are banners with a sound. The banners sit above the vanishing point of the tube,
  so they do not cover raiders or their firing tells.
- Gems in a row play rising tones. A raider's firing tell is a rising sound from its side that
  stays audible under gunfire. A loop, a mine near miss and a cleared wave have their own cues.
  The game-over panel names the cause.
- The feel layer is visual only: the field of view widens with speed, the view shakes on a
  hit, time slows for a moment on a lost life (hit-stop), and the hull yaws and rolls with its
  momentum. None of it changes the craft state or the hit windows, so the bots measure the same
  game with or without it.
- Far objects are drawn larger so they can be seen in time. Raiders grow more than wall
  objects, so a squad and its tell stand out.
- White-hot means one thing: a shot comes down this line.

**Notes.**
- 2026-11 - Swing change, rejected. Goal: a more physical swing, where height comes from
  momentum. We tried weakening the steering torque high on the wall. In measurement one gem
  line could not be completed near the top in the normal tier, and crossing the top took much
  longer. The endless spin it was meant to stop is already unrewarding with gem lines: a bot
  that only holds a key does not progress. It was built, switched off, then deleted. "More
  realistic physics" is so far the visual-only feel layer.
- 2026-11 - Rejected by reasoning: a spin kick or a speed dip on a hit. It takes control away
  at the moment the player reads the hit, and can lead straight into a second hit.
- 2026-11 - Rejected by reasoning: extra damping near rest. It changes the tuned swing for a
  gain only bots can measure, and makes resting at the bottom easier.
- 2026-11 - Rejected: score popups (they crowd the view around the ship), and a white hull
  flash, a glow on an idle hunter and a bolt-graze cue (they weaken the one meaning of white).
- 2026-11 - Far-object scale: with the same large scale for everything, far mines and gems
  merged into one blob at the vanishing point. Chosen: a smaller scale for wall objects than
  for raiders.
- 2026-11 - The owner heard the gem tones and likes them. The newer cues (a cross caught at
  full lives, the large cross) have not been heard by a person.

## Raider squads

**Experience.** Raiders are opponents with variety, not a constant drizzle. They arrive as a
squad with a shape, the fight has a rhythm with pauses, and no place on the wall is safe to park.

**Trade-off.** Pressure against readability. More raiders and more fire add pressure, but many
raiders at once are hard to manage, and fire from all of them reads as luck, not as a fight.

**Current choice.**
- A wave director sends squads in formations, each member in its own depth lane, with only a
  few in the fight at once. A destroyed squad is followed by a breather.
- One member can be a hunter. It follows the player, stops on the player's line and fires down
  it. It holds its angle while it shows the tell, so the tell marks the exact line.
- A cap limits how many raiders show a tell or fire at once. Every shot is announced, with a
  minimum time between the tell and the arrival of the bolt.
- Raiders hold their fire around a level boundary, while speed and gravity change and the
  banner shows.
- Raiders that outlast their wave leave forward, never back through the ship.
- Deeper levels raise the fire rate in steps. The cap on simultaneous fire and the announced
  shot stay the same at every level.
- When a demanding gem line is ahead, no new wave starts and hunters hold their fire.
- Bolts move relative to the ship and steering is angular, so aiming and dodging are equally
  fair at every speed.

**Notes.**
- 2026-11 - The owner's complaint: raiders always behaved the same and bunched up, many at once
  were hard to manage, and it was easy to move to a spot they never went. Chosen: squads with
  formations, few in the fight at once, and one hunter that follows.
- 2026-11 - A second hunter earlier, rejected. It made the game easier for the bots. A hunter
  fires only when it sits on the player's line, while the other raiders fire all the time, and
  the bots are hit mostly while they line up on a target.
- 2026-11 - Of the raider levers we tried, only the fire rate moved how often the bots are
  hit. The delay between squad members, the breather length, the squad size and the hunter's
  speed did not.
- 2026-11 - Lives were lost clearly more often right after a level-up, all to shots announced
  in the last moments of the fast section. Chosen: the fire hold around the boundary.
- 2026-11 - Deep levels: once the first ramp ended, only speed got harder and the skilled bot
  rarely died. Chosen: a second ramp on the fire rate. Tried and not taken: a third hunter (the
  skilled bot lived longer), shorter breathers, denser mines and a faster hunter (no clear effect).
- 2026-11 - Hit area. Raiders are drawn larger at distance so they can be seen. The hit area
  did not grow with them, and the owner's shots through the visible wing did not count. Chosen:
  the outer hit area follows the drawn size (a wing hit damages, a second one kills), and the
  instant-kill centre has one size at every distance. Consequence, open: the game is clearly
  easier for the skilled bot at deep levels. Making lives more expensive did not help. The
  likely lever is raider fire at deep levels.
- 2026-11 - A squad whose last raider is shot while it flies away: the owner found it
  frustrating that this did not count. Chosen: a squad counts as destroyed when every member is
  killed, also one shot while it flies away. A member that gets out of reach means the squad is
  not destroyed. The chime for a destroyed squad and the progress toward the squad cross follow
  this rule.
- 2026-11 - Camping. A bot that never shoots and parks away from raiders measures whether
  avoiding the fight pays. It earns no lives and little score, but it is hit no more often than
  a fighter. Open.
- Earlier - The cap on simultaneous fire came from playtest: deaths under fire from many
  raiders read as luck. With the cap, incoming fire is a rhythm that does not grow with the
  number of raiders.

## Gem lines

**Experience.** Gems show the swing that collects them. A line is a readable shape on the wall:
hold where it climbs, let go where it turns. Mines mark the edges of the path, and the gems
mark the clear way through. Each tier asks for something different.

**Trade-off.** Authored sequences against freedom. Lines teach the swing and reward skill, but
a tube made only of lines feels like rails, and the same line too often feels repetitive.

**Current choice.**
- Phrases are data: a key script, with gems and mines placed relative to the path. A simulated
  pilot flies the script with the real integrator, and the gems sit on its path. So a phrase
  is flyable by construction, and a sim checks every phrase in every tier where it appears.
- Phrase times are tied to the turning points of the swing, because gravity differs per tier.
- A director picks phrases per section by tier and level, within a gem budget and a mine
  budget, with a rest between phrases. It avoids repeating the same phrase back to back.
- Some phrases are loose scatters, so the tube does not feel like rails.
- No phrase crosses a section boundary, and the air is calm right after one.
- A run opens with warm-up phrases that carry no mines.
- The gem gate: the quota is known at the start of a level and does not depend on what
  appeared. A cycle offers more gems than the highest quota, so a few misses are allowed.
- Orbs are scattered finds, not part of the lines. Different kinds of objects never appear on
  top of each other.

**Notes.**
- 2026-11 - The owner asked for objects "not random but in playable sequences", and later said
  he loves "the gem progression with tones and their placements in lines".
- 2026-11 - A quota close to the number of gems on offer made near-perfect players repeat a
  level by two or three gems. Chosen: more gems on offer than the highest quota. An early
  level can still be repeated by a narrow margin. Open if it annoys.
- 2026-11 - Too few gems per cycle left sections half empty. More rings over the top in fast
  sections made those sections repeat themselves. Chosen: fewer rings. The top of the tube is
  used a little less than with random placement. This is a deliberate trade-off.
- 2026-11 - A mine budget above a certain point forced the same mine phrases into every slow
  section and pushed the rings out of fast sections. Chosen: a floor on how dense mines get.
- 2026-11 - Mines are a weak threat next to raider fire, because they sit off the lines by
  design. A mine pattern that asks more of a skilled player without causing deaths by luck is
  open design work.
- Earlier - The gate exists because a player could coast through levels by dodging alone.
  Score has no distance term for the same reason: passive flight earned more than progress.

## Lives and economy

**Experience.** Fighting pays. A lost ship can be won back, the player sees the reward coming
and has to catch it. The weapon bar is a resource, but an empty gun is a setback, not the end.

**Trade-off.** Generous enough for an average player to recover, without making a skilled
player close to unkillable. And charge scarce enough to matter, without leaving a person who
aims less well than a bot with an empty gun.

**Current choice.**
- Every destroyed raider leaves a small green cross on the wall ahead. While a ship is
  missing, caught crosses fill a bar, and a full bar restores a ship. With all ships intact a
  cross pays score.
- The last raider of every Nth fully destroyed squad leaves a large cross that restores a whole
  ship. N grows with the level.
- Now and then a large bonus cross appears on the wall on its own, not earned by a kill, far
  enough ahead to be seen coming. It is rare by intent, so that not fighting is never enough.
  Like every green cross, it restores a whole ship if one is missing, pays score otherwise,
  and returns weapon charge. Code: `dropBonus` in `src/session.ts`.
- The number of small crosses per ship grows with the level, after a short hold at the start.
  `LIFE_SHARD.*` and `EXTRA_LIFE.*` in `src/config.ts` hold these levers.
- A hit always costs a whole ship. Progress on the bar survives a lost ship, and the bar never
  moves backward.
- Crosses and kills return a little weapon charge. Blue orbs are the main refill (`ENERGY.*`,
  `PICKUP.*`).

**Notes.**
- 2026-11 - Lives on a timer, replaced. A green cross appeared on a timer and gave a life.
  Measured with bots, it returned most lost lives without any fighting, also to a player who
  never shot, and avoiding raiders cost nothing. The owner asked for fighting to pay. Chosen:
  kills leave small crosses, a set of them restores a ship, and progress shows as a bar. The
  owner's requirements: "seeing the reward coming is absolutely necessary", and the catch
  stays (no instant award).
- 2026-11 - The first version left a cross only while a ship was missing. The owner found that
  confusing ("killing an enemy when no lives are missing creates no little green cross").
  Chosen: every kill leaves one, and with all ships intact it pays score. A cross that flies
  through uncollected was rejected by reasoning (visible but useless) and never built.
- 2026-11 - The owner caught only a small share of the crosses while dodging, and the weakest
  bot caught a similar share. Chosen: a wider catch window and more lead time for close
  kills. Consequence: after a close kill the cross appears farther down the line than the
  explosion.
- 2026-11 - Bonus cross. The owner's original idea was an unexpected bonus that restores a
  whole life, not tied to a kill. The first build tied the large cross only to destroyed
  squads. Now both exist. The bonus cross is the rare form of the timed life above, too rare to
  live on. We measured several intervals with the bot that never shoots and with bots of three
  skill levels. Chosen: the shortest interval at which the never-shooting bot still cannot live
  on it and the skilled bot is not harder to kill. Open: no person has played it yet.
- 2026-11 - One fixed number of crosses per life could not serve both the average and the
  skilled bot: either the skilled bot became close to unkillable or the average bot got
  nothing. Chosen: the set grows with the level. The owner asked for the early set to stay small.
- 2026-11 - Weapon charge. We made orbs scarcer to make charge a resource. The owner then ran
  dry repeatedly, while the bots never did (they aim better). Chosen: crosses return a little
  charge, a kill refunds a little, and orbs are somewhat closer together. Open: the bots
  cannot calibrate this.

## Difficulty curve and modes

**Experience.** The first levels are a warm-up. After that the game asks for real play, keeps
getting harder and never plateaus, but stays fair: a death has a cause the player could see.

**Trade-off.** One curve has to serve a beginner and a skilled player. Speed is the cheapest
lever, but speed alone ends in a wall of pure reflex.

**Current choice.**
- Speed rises with every level, by a shrinking step, so reaction windows tighten without
  collapsing.
- Deep pressure comes mainly from content: raiders and their fire rate first, mines second.
- New kinds of pressure arrive on different levels, not all at once.
- The three modes are one mapping from the played level to a tuning level, plus an ease factor
  per mode (`DIFFICULTY.MODES`). The mapping alone changes little at the first level, so the
  gentle mode also eases raider fire, breathers and mines from the start, and caps its gem
  quota. The score multiplier follows the tuning level, so a harder mode pays more and one
  best score stays honest.

**Notes.**
- 2026-11 - Under every setting we tried, the skilled bot is hit far less often than the
  average bot. Targets for both could not hold at once in the middle levels. Chosen: tune for
  the average bot there, and add the deep fire ramp for the skilled one.
- 2026-11 - The gentle mode's quota cap exists because the weakest bot kept repeating its
  deeper levels with the standard quota.
- 2026-11 - The owner played a first run after these changes and called it engaging.
- Earlier - A flat speed step per level made deep levels unplayable for a child who got there,
  while nothing else grew ("too fast, too few enemies"). That is the origin of the shrinking
  step and of pressure from content.

## Deliberately left out or deferred

- **Tube bends that load the swing.** Deferred: it touches the tube, object placement, the
  camera and the integrator at once, and the simulated pilot would have to model it. Revisit
  when the owner asks for more from the movement.
- **A diving raider with its own tell.** Deferred: a third behaviour with a second, different
  tell to learn. Revisit if camping still pays or deep levels play thin.
- **More phrases, and orbs inside the lines.** Deferred until the current phrases are settled.
  Revisit for the open mine question above.
- **Score bonuses** (clean line, chain, cleared wave). Left out: score stays gems and kills
  times the level multiplier, which is simple to learn. Revisit if skilled play feels unrewarded.
- **Raiders that never leave.** Not built: raiders leave forward when their time is up. The
  fire ramp carries deep pressure. Revisit if deep levels play thin.
- **Bolt speed for looks.** Bolts can look slow against fast walls at deep levels. This is a
  question of feel, not fairness. Revisit when a person plays deep levels.

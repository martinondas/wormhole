# Audio assets

Drop your mp3 files here with these exact names (paths/volumes live in
`src/config.ts` under `AUDIO` - rename there if your files differ):

| File             | Plays when                                     |
|------------------|------------------------------------------------|
| `menu.mp3`       | title screen + game-over screen (loops)        |
| `music.mp3`      | during a run (loops)                           |
| `accelerate.mp3` | ~3s layer over the music when the speed tier steps up |
| `shoot.mp3`      | player fires the forward gun                   |
| `orb.mp3`        | energy orb collected                           |
| `gem.mp3`        | treasure gem collected                         |
| `enemy-fire.mp3` | a raider fires a bolt                          |
| `kill.mp3`       | a raider is destroyed                          |
| `hit.mp3`        | the ship loses a life (silent during i-frames) |
| `gameover.mp3`   | the run ends                                   |

A missing file is logged to the console and skipped - it never breaks the run,
so you can add them one at a time. Vite copies this folder verbatim into
`dist/`. Audio unlocks on the first key/pointer press (browser autoplay policy);
press **M** to mute (persists in localStorage).

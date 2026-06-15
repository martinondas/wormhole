# Wormhole

> A small, polished retro-inspired Tron-style tube flyer. Ride the inside of an endless neon wormhole.

![Wormhole gameplay](docs/screenshot.png)

Wormhole is a chase-cam craft on a constant forward run down the inside of a long
circular tube, rendered as glowing neon wireframe on near-black. It is
retro-INSPIRED, not retro-cheap: the look should read as a modern machine doing a
vector look, not a 1990s mockup.

The soul of the game is the movement. The craft is not free-flying - it hangs near
the bottom of the tube under a gravity-like pull and steers only left / right,
climbing the curved wall like a pendulum. Pumping left-right-left builds amplitude
to ride high up the wall, or all the way over the top.

## Controls

| Action | Keys |
|--------|------|
| Steer / swing up the walls | Left / Right arrows, or A / D |
| Throttle | Up arrow, or W |
| Brake (eases toward a floor, never stops) | Down arrow, or S |
| Boost | Shift (or Space) |
| Restart (after game over) | Space or Enter |

## Gameplay

- Energy drains continuously - collect **blue orbs** to refill it.
- Grab **gold gems** for score.
- Dodge **red spiky mines** - a hit costs one of your three ships (with brief
  invulnerability after).
- The run ends when energy or ships run out. Your local best score persists.

## Running it

Requirements: Node.js + npm. Targets current Chrome and Safari on macOS.

```bash
npm install
npm run dev       # then open the printed localhost URL
```

Build a static, fully offline bundle:

```bash
npm run build     # output in dist/ - runs offline from a local folder
npm run preview
```

There is no backend and no accounts. The best score is kept in `localStorage`.

## Tech

TypeScript (strict) + Vite + Three.js. No game engine.

- The neon glow is GPU bloom (`UnrealBloomPass`), on by default - it is the look,
  not an afterthought.
- Glowing strokes use fat lines (`Line2`); the ship and the wall objects (orbs,
  gems, mines) are edge-lit solids - glowing edges over a near-black fill - built
  procedurally in code so the whole game stays offline and on-aesthetic.
- The pendulum physics runs on a fixed timestep (semi-implicit Euler), decoupled
  from rendering, so the swing feels weighty and momentum-driven.
- All feel constants live grouped in `src/config.ts` for fast tuning.

## Status

Early but playable.

- **Built**: scrolling wireframe tube, procedural edge-lit ship, damped-driven
  pendulum physics, banking chase cam, throttle / boost; energy orbs, treasure
  gems, and hazard mines on a generic "wall field" engine, lives, a minimal
  in-theme HUD, score, and a deep-space backdrop with stars.
- **Next**: a forward gun + enemies, then a difficulty ramp with distance.

See [CLAUDE.md](CLAUDE.md) for the full design spec, physics model, architecture,
and roadmap.

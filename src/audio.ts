import { AUDIO } from './config'

// Web Audio mixer for the game. Architecture mirrors the rest of the codebase:
// createAudio() owns all state and exposes a tiny API; main.ts is the single
// wiring point that calls play(...) at the existing game-event sites (it imports
// neither game state nor the systems, exactly like the field onHit closures).
//
// Routing:  bufferSource/<audio> -> (sfxBus | musicBus) -> master -> destination
//  - SFX: each mp3 is fetched + decoded once into an AudioBuffer, then played via
//    a throwaway BufferSourceNode per trigger. Sources are fire-and-forget, so
//    overlapping shots/hits "just work" with no pooling.
//  - Music: a looping <audio> element streamed through a MediaElementSourceNode
//    (avoids decoding a multi-MB track into RAM). Ducked, not stopped, on
//    game-over so resuming on restart is a single gain ramp.
//
// Browser autoplay policy: the context starts suspended. arm() unlocks it (and
// starts music) on the first key / pointer gesture. Until then the game is silent.

export type SfxName = keyof typeof AUDIO.SFX
export type MusicName = keyof typeof AUDIO.MUSIC

export interface Audio {
  arm(): void // unlock the context on the first pointer gesture (click-to-focus)
  unlock(): void // resume the context now (call from a user-gesture handler)
  play(name: SfxName): void
  playMusic(name: MusicName): void // switch the looping music track
  playAccel(): void // one-shot accelerate layer over the music (speed step-up)
  toggleMute(): void
  readonly muted: boolean
}

const MUTE_KEY = 'wormhole.muted'

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function saveMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0')
  } catch {
    /* storage unavailable (private mode) - ignore */
  }
}

// No-op fallback so callers never need to null-check when Web Audio is missing.
function silentAudio(): Audio {
  return {
    arm() {},
    unlock() {},
    play() {},
    playMusic() {},
    playAccel() {},
    toggleMute() {},
    muted: true,
  }
}

export function createAudio(): Audio {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    console.warn('[audio] Web Audio unavailable - running silent')
    return silentAudio()
  }
  const ctx = new Ctor()

  let muted = loadMuted()

  const master = ctx.createGain()
  master.gain.value = muted ? 0 : AUDIO.MASTER_VOLUME
  master.connect(ctx.destination)

  const sfxBus = ctx.createGain()
  sfxBus.gain.value = AUDIO.SFX_VOLUME
  sfxBus.connect(master)

  const musicBus = ctx.createGain()
  musicBus.gain.value = AUDIO.MUSIC_VOLUME
  musicBus.connect(master)

  // --- SFX: load + decode each mp3 once, with one persistent gain per sound --
  // Each sound owns a single GainNode (its config volume) wired to the bus once.
  // play() then allocates only a throwaway BufferSourceNode, which the graph
  // releases when it finishes - so nothing accumulates on the bus over a run.
  const buffers = new Map<SfxName, AudioBuffer>()
  const sfxGains = new Map<SfxName, GainNode>()
  for (const [name, def] of Object.entries(AUDIO.SFX) as [SfxName, { src: string; volume: number }][]) {
    const gain = ctx.createGain()
    gain.gain.value = def.volume
    gain.connect(sfxBus)
    sfxGains.set(name, gain)
    fetch(def.src)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => buffers.set(name, decoded))
      .catch((err) => console.warn(`[audio] could not load ${def.src}:`, err.message ?? err))
  }

  // --- accelerate: one-shot layer over the music (its own gain -> master) ----
  let accelBuffer: AudioBuffer | null = null
  let accelSrc: AudioBufferSourceNode | null = null
  fetch(AUDIO.ACCEL.SRC)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => (accelBuffer = decoded))
    .catch((err) => console.warn(`[audio] could not load ${AUDIO.ACCEL.SRC}:`, err.message ?? err))

  // --- music: one looping streamed <audio> element per track ----------------
  // Only the `desired` track sounds; the rest are paused. desired is set by
  // playMusic() and (re)applied on unlock, so a track requested while the
  // context is still locked (autoplay policy) begins the moment it unlocks.
  const musicEls = new Map<MusicName, HTMLAudioElement>()
  for (const [name, src] of Object.entries(AUDIO.MUSIC) as [MusicName, string][]) {
    const el = new window.Audio(src)
    el.loop = true
    el.preload = 'auto'
    ctx.createMediaElementSource(el).connect(musicBus)
    musicEls.set(name, el)
  }
  let desired: MusicName | null = null

  // Only the desired track plays; mute is a master-gain concern, so the element
  // keeps streaming (silently) when muted - unmuting is then instant.
  function applyMusic(): void {
    for (const [name, el] of musicEls) {
      if (name === desired) {
        if (el.paused) void el.play().catch(() => {}) // locked or missing file - ignore
      } else if (!el.paused) {
        el.pause()
      }
    }
  }

  function unlock(): void {
    if (ctx.state === 'suspended') void ctx.resume()
    applyMusic() // start (or retry) the desired track now that we have a gesture
  }

  return {
    arm(): void {
      // pointerdown only: clicking to focus the canvas wakes the menu track,
      // while keyboard unlock is owned by main.ts (it must order start-music
      // ahead of unlock so the menu track never blips before a run begins).
      window.addEventListener('pointerdown', unlock, { once: true })
    },

    unlock,

    play(name: SfxName): void {
      if (muted) return
      const buf = buffers.get(name)
      if (!buf) return // not yet loaded, missing, or failed to decode
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(sfxGains.get(name)!) // gain created alongside the buffer above
      src.start()
    },

    playMusic(name: MusicName): void {
      if (desired === name) return
      desired = name
      applyMusic()
    },

    // Play the first ACCEL.SECONDS of the accelerate clip over the music, fading
    // out at the end. Retriggers cleanly (stop any in-flight one first), so rapid
    // step-ups never stack. Each play uses a throwaway source + gain (disconnected
    // on end), like play() - nothing accumulates.
    playAccel(): void {
      if (muted || !accelBuffer) return
      if (accelSrc) {
        try {
          accelSrc.stop()
        } catch {
          /* already ended - ignore */
        }
      }
      const now = ctx.currentTime
      const dur = AUDIO.ACCEL.SECONDS
      const fade = Math.min(AUDIO.ACCEL.FADE, dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(AUDIO.ACCEL.VOLUME, now)
      g.gain.setValueAtTime(AUDIO.ACCEL.VOLUME, now + dur - fade)
      g.gain.linearRampToValueAtTime(0, now + dur)
      const src = ctx.createBufferSource()
      src.buffer = accelBuffer
      src.connect(g)
      g.connect(master)
      src.onended = () => g.disconnect()
      src.start(now)
      src.stop(now + dur)
      accelSrc = src

      // duck the music for the duration so the accelerate sting cuts through,
      // then ramp it back. (musicBus gain is otherwise constant, so this owns it.)
      const m = AUDIO.MUSIC_VOLUME
      musicBus.gain.cancelScheduledValues(now)
      musicBus.gain.setValueAtTime(musicBus.gain.value, now)
      musicBus.gain.linearRampToValueAtTime(m * AUDIO.ACCEL.DUCK, now + 0.12)
      musicBus.gain.setValueAtTime(m * AUDIO.ACCEL.DUCK, now + dur - fade)
      musicBus.gain.linearRampToValueAtTime(m, now + dur)
    },

    toggleMute(): void {
      muted = !muted
      master.gain.setTargetAtTime(muted ? 0 : AUDIO.MASTER_VOLUME, ctx.currentTime, AUDIO.MUTE_RAMP)
      saveMuted(muted)
    },

    get muted(): boolean {
      return muted
    },
  }
}

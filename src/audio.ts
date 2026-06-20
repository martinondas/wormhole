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
  toggleMusic(): void // mute / unmute MUSIC only (menu + play tracks); SFX unaffected
  readonly musicMuted: boolean
}

const MUSIC_MUTE_KEY = 'wormhole.musicMuted'

function loadMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUSIC_MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function saveMusicMuted(m: boolean): void {
  try {
    localStorage.setItem(MUSIC_MUTE_KEY, m ? '1' : '0')
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
    toggleMusic() {},
    musicMuted: false,
  }
}

export function createAudio(): Audio {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    console.warn('[audio] Web Audio unavailable - running silent')
    return silentAudio()
  }
  const ctx = new Ctor()

  let musicMuted = loadMusicMuted()

  const master = ctx.createGain()
  master.gain.value = AUDIO.MASTER_VOLUME
  master.connect(ctx.destination)

  const sfxBus = ctx.createGain()
  sfxBus.gain.value = AUDIO.SFX_VOLUME
  sfxBus.connect(master)

  // The M mute rides on the musicBus only, so SFX (sfxBus) keep playing when the
  // music is off. Both music tracks (menu + play) route through here.
  const musicBus = ctx.createGain()
  musicBus.gain.value = musicMuted ? 0 : AUDIO.MUSIC_VOLUME
  musicBus.connect(master)

  // --- procedural SFX (file-less cues) ---------------------------------------
  // Tiny Web Audio bleeps in the vector spirit, so the build stays self-contained
  // (no asset files). Each generator schedules throwaway nodes into the per-sfx
  // gain `out` at time `now` and disconnects them on end, so nothing accumulates
  // (same fire-and-forget contract as a decoded BufferSource in play()).
  type Synth = (out: AudioNode, now: number) => void

  const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 3.0), ctx.sampleRate)
  const noise = noiseBuf.getChannelData(0)
  for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1

  // one enveloped oscillator: pitch f0 -> f1 over dur, click-free attack + decay
  function blip(out: AudioNode, now: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number): void {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, now)
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peak, now + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    osc.connect(g)
    g.connect(out)
    osc.start(now)
    osc.stop(now + dur + 0.02)
    osc.onended = (): void => { osc.disconnect(); g.disconnect() }
  }

  const SYNTHS: Record<string, Synth> = {
    gem(out, now) { blip(out, now, 'triangle', 880, 880, 0.09, 0.7); blip(out, now + 0.07, 'triangle', 1320, 1320, 0.14, 0.7) },
    enemyFire(out, now) { blip(out, now, 'sawtooth', 620, 180, 0.13, 0.6) },
    kill(out, now) { blip(out, now, 'square', 720, 110, 0.22, 0.7) },
    gameover(out, now) { blip(out, now, 'triangle', 440, 90, 0.9, 0.7) },
    hit(out, now) {
      // bomb blast, three layers: a sharp CRACK, a booming filtered-noise BODY that
      // sweeps down into a long low RUMBLE, and a SUB boom underneath. Big + long
      // (~2.6s) so losing a life detonates rather than pops.
      const dur = 2.6

      // body + rumble: noise through a lowpass sweeping from a bright onset down to
      // a deep rumble over the whole blast; slow exponential decay = lingering tail.
      const body = ctx.createBufferSource()
      body.buffer = noiseBuf
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(3500, now)
      lp.frequency.exponentialRampToValueAtTime(35, now + dur)
      const bg = ctx.createGain()
      bg.gain.setValueAtTime(1.1, now)
      bg.gain.exponentialRampToValueAtTime(0.0001, now + dur)
      body.connect(lp); lp.connect(bg); bg.connect(out)
      body.start(now)
      body.stop(now + dur + 0.02)
      body.onended = (): void => { body.disconnect(); lp.disconnect(); bg.disconnect() }

      // crack: a very short bright noise transient for the sharp initial punch
      const crack = ctx.createBufferSource()
      crack.buffer = noiseBuf
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 1200
      const cg = ctx.createGain()
      cg.gain.setValueAtTime(0.95, now)
      cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
      crack.connect(hp); hp.connect(cg); cg.connect(out)
      crack.start(now)
      crack.stop(now + 0.08)
      crack.onended = (): void => { crack.disconnect(); hp.disconnect(); cg.disconnect() }

      // sub boom: the chest-thump low end, sweeping deep with a slow ~1.6s decay
      blip(out, now, 'sine', 90, 22, 1.6, 1.2)
    },
  }

  // --- SFX: one persistent gain per sound; file cues decode once, synth cues
  // generate on demand. play() allocates only a throwaway source per trigger,
  // which the graph releases when it finishes - nothing accumulates over a run.
  const buffers = new Map<SfxName, AudioBuffer>()
  const sfxGains = new Map<SfxName, GainNode>()
  const synthByName = new Map<SfxName, Synth>()
  for (const [name, def] of Object.entries(AUDIO.SFX) as [SfxName, { src?: string; synth?: string; volume: number }][]) {
    const gain = ctx.createGain()
    gain.gain.value = def.volume
    gain.connect(sfxBus)
    sfxGains.set(name, gain)
    if (def.synth && SYNTHS[def.synth]) {
      synthByName.set(name, SYNTHS[def.synth]!)
      continue // generated procedurally - nothing to fetch
    }
    if (!def.src) continue
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
    // 'metadata' (not 'auto'): defer the full multi-MB fetch until el.play() runs
    // on the first unlock gesture, instead of pulling it during page load. Music
    // cannot sound before unlock anyway (autoplay policy), so this only moves the
    // download off the startup critical path.
    el.preload = 'metadata'
    ctx.createMediaElementSource(el).connect(musicBus)
    musicEls.set(name, el)
  }
  let desired: MusicName | null = null

  // Only the desired track plays; the M mute lives on the musicBus, so a muted
  // element keeps streaming (silently) and unmuting is instant.
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
      // SFX are never silenced by M (that mutes music only) - always play.
      const gain = sfxGains.get(name)
      if (!gain) return
      const buf = buffers.get(name)
      if (buf) {
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(gain)
        src.start()
        return
      }
      // no decoded buffer: a synth cue (or a file still loading / failed)
      const synth = synthByName.get(name)
      if (synth) synth(gain, ctx.currentTime)
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
      // the accelerate sting ducks + layers over the music, so it follows the
      // music mute rather than playing on its own when the music is off.
      if (musicMuted || !accelBuffer) return
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

    toggleMusic(): void {
      musicMuted = !musicMuted
      const t = ctx.currentTime
      // cancel any in-flight accelerate-duck ramp so the mute is authoritative
      musicBus.gain.cancelScheduledValues(t)
      musicBus.gain.setTargetAtTime(musicMuted ? 0 : AUDIO.MUSIC_VOLUME, t, AUDIO.MUTE_RAMP)
      saveMusicMuted(musicMuted)
    },

    get musicMuted(): boolean {
      return musicMuted
    },
  }
}

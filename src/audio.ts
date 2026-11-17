import { AUDIO, BLAST_FX, ENEMY, FEEL } from './config'
import { clamp } from './util/math'

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
  // pan -1 (left) .. 1 (right); gain multiplies the cue's volume; step picks the
  // pitch of a laddered cue (the gem chime climbs with the gem chain; for the
  // shard tone it is 0 for the first shard of a set .. 1 for the last before the completing one).
  play(name: SfxName, pan?: number, gain?: number, step?: number): void
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

// Gem chime ladder: a major pentatonic from C6, one step per gem in a chain.
const GEM_LADDER = [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637].slice(0, FEEL.CHAIN_STEPS)

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
  type Synth = (out: AudioNode, now: number, step: number) => void

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

  // filtered noise: a white-noise burst through one sweeping filter, with a swell
  // envelope (attack to peak, then decay). Used for whooshes and swooshes.
  function sweep(out: AudioNode, now: number, type: BiquadFilterType, f0: number, f1: number, q: number, attack: number, dur: number, peak: number): void {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuf
    const filt = ctx.createBiquadFilter()
    filt.type = type
    filt.Q.value = q
    filt.frequency.setValueAtTime(f0, now)
    filt.frequency.exponentialRampToValueAtTime(f1, now + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peak, now + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    src.connect(filt); filt.connect(g); g.connect(out)
    src.start(now, Math.random() * 2) // a random offset so repeats do not sound identical
    src.stop(now + dur + 0.02)
    src.onended = (): void => { src.disconnect(); filt.disconnect(); g.disconnect() }
  }

  // An explosion in three layers: a sharp crack, a noise body whose low-pass sweeps
  // from `bright` Hz down into a long rumble, and a sub boom from `subHz` underneath.
  function boom(out: AudioNode, now: number, dur: number, bright: number, subHz: number, subDur: number, peak: number): void {
    // body + rumble: the slow exponential decay is the lingering tail
    const body = ctx.createBufferSource()
    body.buffer = noiseBuf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(bright, now)
    lp.frequency.exponentialRampToValueAtTime(35, now + dur)
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(1.1 * peak, now)
    bg.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    body.connect(lp); lp.connect(bg); bg.connect(out)
    body.loop = true // a boom can outlast the noise buffer
    body.start(now, Math.random() * 0.3) // a random offset so the links of a chain do not sound identical
    body.stop(now + dur + 0.02)
    body.onended = (): void => { body.disconnect(); lp.disconnect(); bg.disconnect() }

    // crack: a very short bright noise transient for the initial punch
    const crack = ctx.createBufferSource()
    crack.buffer = noiseBuf
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1200
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.95 * peak, now)
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
    crack.connect(hp); hp.connect(cg); cg.connect(out)
    crack.start(now)
    crack.stop(now + 0.08)
    crack.onended = (): void => { crack.disconnect(); hp.disconnect(); cg.disconnect() }

    // sub boom: the chest-thump low end
    blip(out, now, 'sine', subHz, 22, subDur, 1.2 * peak)
  }

  const SYNTHS: Record<string, Synth> = {
    // two-note chime; the upper note climbs the gem ladder with the chain
    gem(out, now, step) {
      const top = GEM_LADDER[clamp(step, 0, GEM_LADDER.length - 1)]!
      blip(out, now, 'triangle', top / 1.5, top / 1.5, 0.09, 0.7)
      blip(out, now + 0.07, 'triangle', top, top, 0.14, 0.7)
    },
    // quota met: three quick rising blips that end above the gem ladder
    gateOpen(out, now) {
      const notes = [1568, 2093, 3136] // G6 C7 G7
      for (let i = 0; i < notes.length; i++) blip(out, now + i * 0.075, 'triangle', notes[i]!, notes[i]!, i === 2 ? 0.3 : 0.1, 0.65)
    },
    // level up: a fanfare in square + triangle, the last note held - fuller and
    // slower than the extra-life arpeggio, which is plain triangle and quick
    levelup(out, now) {
      const notes = [523, 659, 784, 1047] // C5 E5 G5 C6
      const step = 0.11
      for (let i = 0; i < notes.length; i++) {
        const last = i === notes.length - 1
        const dur = last ? 0.75 : 0.13
        blip(out, now + i * step, 'triangle', notes[i]!, notes[i]!, dur, 0.55)
        blip(out, now + i * step, 'square', notes[i]! / 2, notes[i]! / 2, dur, 0.16)
      }
      blip(out, now + 3 * step, 'triangle', 784, 784, 0.75, 0.3) // G5 under the held C6
    },
    // a raider's firing tell: a saw whine rising over the charge, cut when it fires.
    // It is audible from the first 30 ms (a tell that swells only at the end warns too late).
    charge(out, now) {
      const dur = ENEMY.CHARGE_TIME
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(300, now)
      osc.frequency.exponentialRampToValueAtTime(900, now + dur)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 2200
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, now)
      g.gain.linearRampToValueAtTime(0.12, now + 0.03)
      g.gain.exponentialRampToValueAtTime(0.5, now + dur * 0.92)
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.04)
      osc.connect(lp); lp.connect(g); g.connect(out)
      osc.start(now)
      osc.stop(now + dur + 0.06)
      osc.onended = (): void => { osc.disconnect(); lp.disconnect(); g.disconnect() }
    },
    chip(out, now) { blip(out, now, 'square', 2600, 1900, 0.035, 0.45) },
    loop(out, now) { sweep(out, now, 'bandpass', 350, 3200, 1.6, 0.12, 0.55, 0.9) },
    whoosh(out, now) { sweep(out, now, 'bandpass', 2200, 500, 1.2, 0.03, 0.24, 0.9) },
    waveClear(out, now) {
      blip(out, now, 'sine', 1047, 1047, 0.22, 0.5)
      blip(out, now + 0.14, 'sine', 1568, 1568, 0.38, 0.5)
    },
    // a whole-life cross appeared ahead: three soft rising notes (G5 C6 E6), a call
    // to go and get it, softer than the 1-up that catching it plays
    cross(out, now) {
      blip(out, now, 'sine', 784, 784, 0.12, 0.5)
      blip(out, now + 0.1, 'sine', 1047, 1047, 0.12, 0.5)
      blip(out, now + 0.2, 'sine', 1319, 1319, 0.3, 0.5)
    },
    enemyFire(out, now) { blip(out, now, 'sawtooth', 620, 180, 0.13, 0.6) },
    kill(out, now) { blip(out, now, 'square', 720, 110, 0.22, 0.7) },
    // dull dry-fire "tock": a short low square drop, no pitch reward - reads as an
    // empty trigger, not a shot. Deliberately quiet + brief so it informs, not nags.
    empty(out, now) { blip(out, now, 'square', 160, 70, 0.05, 0.32) },
    life(out, now) {
      // a "1-up": four rising notes of a major arpeggio (C5 E5 G5 C6) plus a
      // high sparkle an octave up. Bright triangle tone reads as a reward and is
      // clearly distinct from the gem's two-note chime - "you gained a ship".
      const notes = [523, 659, 784, 1047]
      const step = 0.085
      for (let i = 0; i < notes.length; i++) blip(out, now + i * step, 'triangle', notes[i]!, notes[i]!, 0.13, 0.6)
      blip(out, now + notes.length * step, 'triangle', 1568, 1568, 0.22, 0.5) // G6 sparkle tail
    },
    // a caught life shard: one rising pair. `step` runs from 0 for the first shard of
    // a set to 1 for the last one before the completing shard, so the pitch climbs across the whole set, from C5
    // to just under C6, where the 1-up cue of the completing shard ends
    shard(out, now, step) {
      const n = 523 * Math.pow(2, (11 / 12) * clamp(step, 0, 1)) // C5 .. B5
      blip(out, now, 'triangle', n, n, 0.1, 0.6)
      blip(out, now + 0.075, 'triangle', n * 1.5, n * 1.5, 0.16, 0.5)
    },
    gameover(out, now) { blip(out, now, 'triangle', 440, 90, 0.9, 0.7) },
    // a life lost: the loudest boom in the game, so it lands like a bomb
    hit(out, now) { boom(out, now, 2.6, 3500, 90, 1.6, 1) },
    // A mine detonation: the same kind of boom, darker, deeper and longer than the
    // life-lost one, so the two are told apart: a rumble, not a bang. Its noise
    // starts at the top of the band of the charge whine (the `charge` synth) and sinks
    // below it in about a second while it fades, so a raider's tell is heard through it.
    // `step` is the chain link (AUDIO.BLAST), so a chain is one long rumble with a run
    // of thumps on top.
    blast(out, now, step) {
      const at = now + step * BLAST_FX.RIPPLE
      const pitch = Math.pow(2, (step * AUDIO.BLAST.LINK_SEMITONES) / 12)
      const dur = step === 0 ? AUDIO.BLAST.BOOM_TIME : AUDIO.BLAST.BOOM_TIME_LINK
      boom(out, at, dur, 900, 55 * pitch, dur * 0.8, Math.pow(AUDIO.BLAST.LINK_GAIN, step))
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

    play(name: SfxName, pan = 0, gain = 1, step = 0): void {
      // SFX are never silenced by M (that mutes music only) - always play.
      const bus = sfxGains.get(name)
      if (!bus) return
      // a panned or scaled cue gets its own short-lived gain + panner in front of
      // the cue's bus, released after the longest cue has ended
      let out: AudioNode = bus
      if (pan !== 0 || gain !== 1) {
        const g = ctx.createGain()
        g.gain.value = gain
        const p = ctx.createStereoPanner()
        p.pan.value = clamp(pan, -1, 1)
        g.connect(p)
        p.connect(bus)
        out = g
        setTimeout(() => { g.disconnect(); p.disconnect() }, 3500)
      }
      const buf = buffers.get(name)
      if (buf) {
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(out)
        src.start()
        return
      }
      // no decoded buffer: a synth cue (or a file still loading / failed)
      const synth = synthByName.get(name)
      if (synth) synth(out, ctx.currentTime, step)
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

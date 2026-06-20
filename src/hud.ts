import { ENERGY, LIVES } from './config'

// Minimal in-theme HUD as a DOM overlay (crisp text, no bloom interference):
// score + distance top-left, best top-right, an energy bar + speed bottom,
// and a centered game-over panel. Thin green vector styling.
export interface HudState {
  score: number
  distance: number
  speed: number
  energy01: number // 0..1
  lives: number
  over: boolean
  started: boolean // false on the title screen (before the first run begins)
  muted: boolean
  flightMode: string // experimental flight mode readout (testing)
  best: number
}

export interface Hud {
  update(s: HudState): void
}

const CSS = `
#hud { position:fixed; inset:0; pointer-events:none; z-index:10;
  font-family:'Courier New',ui-monospace,monospace; text-transform:uppercase;
  letter-spacing:2px; color:#7dffa6; text-shadow:0 0 6px rgba(80,255,150,0.55); }
#hud .corner { position:absolute; font-size:15px; line-height:1.5; }
#hud .tl { top:18px; left:20px; }
#hud .tr { top:18px; right:20px; text-align:right; }
#hud .dim { opacity:0.6; }
#hud .lives { position:absolute; left:20px; bottom:58px; font-size:14px; letter-spacing:4px; }
#hud .lives .lost { opacity:0.22; }
#hud .meter { position:absolute; left:20px; bottom:20px; width:260px; }
#hud .meter .lbl { font-size:12px; opacity:0.8; margin-bottom:4px; }
#hud .track { height:9px; border:1px solid rgba(125,255,166,0.5); border-radius:1px;
  box-shadow:0 0 5px rgba(80,255,150,0.35); overflow:hidden; }
#hud .fill { height:100%; width:100%; background:#5dff9b;
  box-shadow:0 0 8px currentColor; transition:width 0.08s linear; }
#hud .spd { position:absolute; right:20px; bottom:20px; font-size:15px; text-align:right; }
#hud .mute { position:absolute; right:20px; top:44px; font-size:12px; color:#ff8a6a;
  text-shadow:0 0 6px rgba(255,120,90,0.55); opacity:0; transition:opacity 0.15s; }
#hud .mute.show { opacity:0.9; }
#hud .over .hint { font-size:12px; opacity:0.5; }
#hud .over { position:absolute; inset:0; display:none; flex-direction:column;
  align-items:center; justify-content:center; gap:14px; text-align:center;
  background:radial-gradient(ellipse at center, rgba(0,8,14,0.55), rgba(0,4,9,0.8)); }
#hud .over.show { display:flex; }
#hud .over h1 { font-size:34px; margin:0; color:#9affc0; letter-spacing:5px; }
#hud .over .big { font-size:22px; }
#hud .over .blink { font-size:15px; opacity:0.85; animation:wh-blink 1.1s steps(2,end) infinite; }
@keyframes wh-blink { 50% { opacity:0.15; } }
`

function pad(n: number, width: number): string {
  return Math.max(0, Math.floor(n)).toString().padStart(width, '0')
}

export function createHud(): Hud {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'hud'
  root.innerHTML = `
    <div class="corner tl"><div id="wh-score">SCORE 0000000</div><div id="wh-dist" class="dim">DIST 0000</div><div id="wh-grav" class="dim">MODE NORMAL</div></div>
    <div class="corner tr"><div id="wh-best" class="dim">BEST 0000000</div></div>
    <div class="lives" id="wh-lives">SHIPS</div>
    <div class="meter"><div class="lbl">ENERGY</div><div class="track"><div class="fill" id="wh-energy"></div></div></div>
    <div class="spd" id="wh-spd">SPD 00</div>
    <div class="mute" id="wh-mute">&#9836; MUTED</div>
    <div class="over" id="wh-over">
      <h1 id="wh-over-title">ENERGY DEPLETED</h1>
      <div class="big" id="wh-over-score">SCORE 0000000</div>
      <div id="wh-over-best" class="dim">BEST 0000000</div>
      <div class="blink">PRESS SPACE TO RESTART</div>
    </div>
    <div class="over" id="wh-title">
      <h1>WORMHOLE</h1>
      <div class="big dim">VECTOR TUBE</div>
      <div class="blink">PRESS SPACE TO START</div>
      <div class="hint">ARROWS STEER &nbsp;-&nbsp; SPACE FIRES &nbsp;-&nbsp; M MUTES</div>
    </div>`
  document.body.appendChild(root)

  const $ = (id: string): HTMLElement => root.querySelector('#' + id) as HTMLElement
  const elScore = $('wh-score')
  const elDist = $('wh-dist')
  const elGrav = $('wh-grav')
  const elBest = $('wh-best')
  const elLives = $('wh-lives')
  const elEnergy = $('wh-energy')
  const elSpd = $('wh-spd')
  const elMute = $('wh-mute')
  const elOver = $('wh-over')
  const elTitle = $('wh-title')
  const elOverTitle = $('wh-over-title')
  const elOverScore = $('wh-over-score')
  const elOverBest = $('wh-over-best')

  // ship glyphs: bright for remaining, dim for spent (shows the max at a glance)
  let lastLives = -1
  function renderLives(lives: number): void {
    if (lives === lastLives) return
    lastLives = lives
    let glyphs = ''
    for (let i = 0; i < LIVES.START; i++) {
      glyphs += `<span class="${i < lives ? '' : 'lost'}">&#9650;</span>`
    }
    elLives.innerHTML = 'SHIPS ' + glyphs
  }

  // hud.update() runs every render frame. The DOM only changes a few times a
  // second (a score tick, an energy step, a state flip), so each field caches its
  // last-written value and writes (and re-formats) only on a real change. This
  // skips the per-frame textContent/style/classList churn (forced style recalc)
  // and the string allocations that went with it.
  let lastScore = -1
  let lastDist = -1
  let lastBest = -1
  let lastSpd = -1
  let lastMode = ''
  let lastEnergyTenths = -1
  let lastColor = ''
  let lastMuted = false
  let lastTitle = false
  let lastOver = false
  let lastOverTitle = ''
  let lastOverScore = -1
  let lastOverBest = -1

  return {
    update(s: HudState): void {
      const score = Math.max(0, Math.floor(s.score))
      if (score !== lastScore) { elScore.textContent = 'SCORE ' + pad(score, 7); lastScore = score }
      const dist = Math.max(0, Math.floor(s.distance))
      if (dist !== lastDist) { elDist.textContent = 'DIST ' + pad(dist, 4); lastDist = dist }
      const best = Math.max(0, Math.floor(s.best))
      if (best !== lastBest) { elBest.textContent = 'BEST ' + pad(best, 7); lastBest = best }
      const spd = Math.max(0, Math.floor(s.speed))
      if (spd !== lastSpd) { elSpd.textContent = 'SPD ' + pad(spd, 2); lastSpd = spd }
      if (s.flightMode !== lastMode) { elGrav.textContent = 'MODE ' + s.flightMode.toUpperCase(); lastMode = s.flightMode }
      renderLives(s.lives)

      const e = Math.max(0, Math.min(1, s.energy01))
      const tenths = Math.round(e * 1000) // 0..1000 -> width to 0.1%
      if (tenths !== lastEnergyTenths) { elEnergy.style.width = (tenths / 10).toFixed(1) + '%'; lastEnergyTenths = tenths }
      const color = e <= ENERGY.CRITICAL ? '#ff5a5a' : e <= ENERGY.LOW ? '#ffd24d' : '#5dff9b'
      if (color !== lastColor) {
        elEnergy.style.background = color
        elEnergy.style.color = color // drives the box-shadow glow
        lastColor = color
      }

      if (s.muted !== lastMuted) { elMute.classList.toggle('show', s.muted); lastMuted = s.muted }
      const titleShow = !s.started && !s.over
      if (titleShow !== lastTitle) { elTitle.classList.toggle('show', titleShow); lastTitle = titleShow }
      if (s.over !== lastOver) { elOver.classList.toggle('show', s.over); lastOver = s.over }
      if (s.over) {
        const title = s.lives <= 0 ? 'SHIP DESTROYED' : 'ENERGY DEPLETED'
        if (title !== lastOverTitle) { elOverTitle.textContent = title; lastOverTitle = title }
        if (score !== lastOverScore) { elOverScore.textContent = 'SCORE ' + pad(score, 7); lastOverScore = score }
        if (best !== lastOverBest) { elOverBest.textContent = 'BEST ' + pad(best, 7); lastOverBest = best }
      }
    },
  }
}

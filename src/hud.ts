import { ENERGY } from './config'

// Minimal in-theme HUD as a DOM overlay (crisp text, no bloom interference):
// score + distance top-left, best top-right, an energy bar + speed bottom,
// and a centered game-over panel. Thin green vector styling.
export interface HudState {
  score: number
  distance: number
  speed: number
  energy01: number // 0..1
  over: boolean
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
#hud .meter { position:absolute; left:20px; bottom:20px; width:260px; }
#hud .meter .lbl { font-size:12px; opacity:0.8; margin-bottom:4px; }
#hud .track { height:9px; border:1px solid rgba(125,255,166,0.5); border-radius:1px;
  box-shadow:0 0 5px rgba(80,255,150,0.35); overflow:hidden; }
#hud .fill { height:100%; width:100%; background:#5dff9b;
  box-shadow:0 0 8px currentColor; transition:width 0.08s linear; }
#hud .spd { position:absolute; right:20px; bottom:20px; font-size:15px; text-align:right; }
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
    <div class="corner tl"><div id="wh-score">SCORE 0000000</div><div id="wh-dist" class="dim">DIST 0000</div></div>
    <div class="corner tr"><div id="wh-best" class="dim">BEST 0000000</div></div>
    <div class="meter"><div class="lbl">ENERGY</div><div class="track"><div class="fill" id="wh-energy"></div></div></div>
    <div class="spd" id="wh-spd">SPD 00</div>
    <div class="over" id="wh-over">
      <h1>ENERGY DEPLETED</h1>
      <div class="big" id="wh-over-score">SCORE 0000000</div>
      <div id="wh-over-best" class="dim">BEST 0000000</div>
      <div class="blink">PRESS SPACE TO RESTART</div>
    </div>`
  document.body.appendChild(root)

  const $ = (id: string): HTMLElement => root.querySelector('#' + id) as HTMLElement
  const elScore = $('wh-score')
  const elDist = $('wh-dist')
  const elBest = $('wh-best')
  const elEnergy = $('wh-energy')
  const elSpd = $('wh-spd')
  const elOver = $('wh-over')
  const elOverScore = $('wh-over-score')
  const elOverBest = $('wh-over-best')

  return {
    update(s: HudState): void {
      elScore.textContent = 'SCORE ' + pad(s.score, 7)
      elDist.textContent = 'DIST ' + pad(s.distance, 4)
      elBest.textContent = 'BEST ' + pad(s.best, 7)
      elSpd.textContent = 'SPD ' + pad(s.speed, 2)

      const e = Math.max(0, Math.min(1, s.energy01))
      elEnergy.style.width = (e * 100).toFixed(1) + '%'
      const color = e <= ENERGY.CRITICAL ? '#ff5a5a' : e <= ENERGY.LOW ? '#ffd24d' : '#5dff9b'
      elEnergy.style.background = color
      elEnergy.style.color = color // drives the box-shadow glow

      elOver.classList.toggle('show', s.over)
      if (s.over) {
        elOverScore.textContent = 'SCORE ' + pad(s.score, 7)
        elOverBest.textContent = 'BEST ' + pad(s.best, 7)
      }
    },
  }
}

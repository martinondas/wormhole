import { ENERGY, LIVES, GUN } from './config'

// Minimal in-theme HUD as a DOM overlay (crisp text, no bloom interference):
// level / score / best top-left, run time top-right, ships + weapon charge
// bottom-left, mode + speed bottom-right, and centered title / level-up /
// game-over panels. Thin green vector styling.
export interface HudState {
  score: number
  speed: number
  energy01: number // 0..1 (weapon charge)
  lives: number
  elapsed: number // seconds of active play this run (run timer)
  over: boolean
  started: boolean // false on the title screen (before the first run begins)
  paused: boolean // a live run paused back to the intro/menu screen (Esc)
  musicMuted: boolean // music toggled off via M (SFX still play)
  flightMode: string // experimental flight mode readout (testing)
  level: number // current level (1-based for display)
  best: number
}

export interface Hud {
  update(s: HudState): void
}

const CSS = `
#hud { position:fixed; inset:0; pointer-events:none; z-index:10;
  font-family:'Courier New',ui-monospace,monospace; text-transform:uppercase;
  letter-spacing:2px; color:#7dffa6; text-shadow:0 0 6px rgba(80,255,150,0.55); }
#hud .corner { position:absolute; font-size:22px; line-height:1.5; }
#hud .tl { top:18px; left:20px; }
#hud .tr { top:18px; right:20px; text-align:right; }
#hud .br { bottom:20px; right:20px; text-align:right; }
#hud .dim { opacity:0.6; }
#hud .lives { position:absolute; left:20px; bottom:78px; font-size:21px; letter-spacing:6px; }
#hud .lives .lost { opacity:0.22; }
#hud .meter { position:absolute; left:20px; bottom:20px; width:390px; }
#hud .meter .lbl { font-size:18px; opacity:0.8; margin-bottom:6px; }
#hud .track { height:14px; border:1px solid rgba(125,255,166,0.5); border-radius:1px;
  box-shadow:0 0 7px rgba(80,255,150,0.35); overflow:hidden; }
#hud .fill { height:100%; width:100%; background:#3d7dff; color:#3d7dff;
  box-shadow:0 0 8px currentColor; transition:width 0.08s linear; }
#hud .meter .lbl.empty { color:#ff5a5a; opacity:1; animation:wh-blink 0.9s steps(2,end) infinite; }
#hud .track.empty { border-color:rgba(255,90,90,0.85); box-shadow:0 0 10px rgba(255,90,90,0.55); }
#hud .mute { position:absolute; right:20px; top:50px; font-size:18px; color:#ff8a6a;
  text-shadow:0 0 6px rgba(255,120,90,0.55); opacity:0; transition:opacity 0.15s; }
#hud .mute.show { opacity:0.9; }
#hud .over .hint { font-size:12px; opacity:0.5; }
#hud .over { position:absolute; inset:0; display:none; flex-direction:column;
  align-items:center; justify-content:center; gap:14px; text-align:center;
  background:radial-gradient(ellipse at center, rgba(0,6,12,0.6), rgba(0,3,8,0.78));
  backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); }
#hud .over.show { display:flex; }
#hud .over h1 { font-size:34px; margin:0; color:#9affc0; letter-spacing:5px; }
#hud .over .lvl { font-size:30px; color:#9affc0; letter-spacing:4px; }
#hud .over .big { font-size:22px; }
#hud .over .blink { font-size:15px; opacity:0.85; animation:wh-blink 1.1s steps(2,end) infinite; }
#hud .over .intro { max-width:560px; margin:0; font-size:14px; line-height:1.6;
  letter-spacing:1px; opacity:0.88; text-transform:none; }
#hud .over .mission { max-width:560px; margin:0; font-size:13px; letter-spacing:2px;
  color:#9affc0; opacity:0.95; }
#hud .over .legend { max-width:560px; margin:0; font-size:12px; line-height:1.5;
  letter-spacing:1px; opacity:0.72; text-transform:none; }
#hud .over .keys { display:grid; grid-template-columns:auto auto; gap:5px 18px;
  font-size:13px; align-items:baseline; }
#hud .over .keys .k { text-align:right; color:#9affc0; letter-spacing:2px; }
#hud .over .keys .a { text-align:left; opacity:0.65; letter-spacing:2px; }
@keyframes wh-blink { 50% { opacity:0.15; } }
#hud .levelup { position:absolute; top:30%; left:0; right:0; text-align:center;
  font-size:77px; letter-spacing:12px; font-weight:bold; color:#9affc0;
  text-shadow:0 0 18px rgba(80,255,150,0.85), 0 0 44px rgba(80,255,150,0.5);
  opacity:0; will-change:opacity,transform; }
#hud .levelup.show { animation:wh-levelup 2.2s ease-out forwards; }
@keyframes wh-levelup {
  0%   { opacity:0; transform:scale(0.7); }
  14%  { opacity:1; transform:scale(1.06); }
  26%  { transform:scale(1.0); }
  74%  { opacity:1; }
  100% { opacity:0; transform:scale(1.0); }
}
`

function pad(n: number, width: number): string {
  return Math.max(0, Math.floor(n)).toString().padStart(width, '0')
}

// Run timer as MM:SS.X (tenths). e.g. 127.34s -> "02:07.3".
function fmtTime(sec: number): string {
  const s = Math.max(0, sec)
  const tenths = Math.floor((s * 10) % 10)
  return pad(s / 60, 2) + ':' + pad(s % 60, 2) + '.' + tenths
}

export function createHud(): Hud {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'hud'
  root.innerHTML = `
    <div class="corner tl"><div id="wh-level">LEVEL 1</div><div id="wh-score">SCORE 0000000</div><div id="wh-best" class="dim">BEST 0000000</div></div>
    <div class="corner tr"><div id="wh-time">TIME 00:00.0</div></div>
    <div class="lives" id="wh-lives">SHIPS</div>
    <div class="meter"><div class="lbl" id="wh-weplbl">WEAPON</div><div class="track" id="wh-track"><div class="fill" id="wh-energy"></div></div></div>
    <div class="corner br"><div id="wh-grav" class="dim">MODE NORMAL</div><div id="wh-spd">SPD 00</div></div>
    <div class="mute" id="wh-mute">&#9836; MUSIC OFF</div>
    <div class="levelup" id="wh-levelup">LEVEL 2</div>
    <div class="over" id="wh-over">
      <h1 id="wh-over-title">SHIP DESTROYED</h1>
      <div class="lvl" id="wh-over-level">REACHED LEVEL 1</div>
      <div class="big" id="wh-over-score">SCORE 0000000</div>
      <div id="wh-over-time">TIME 00:00.0</div>
      <div id="wh-over-best" class="dim">BEST 0000000</div>
      <div class="blink">PRESS ENTER TO CONTINUE</div>
    </div>
    <div class="over" id="wh-title">
      <h1>WORMHOLE</h1>
      <p class="intro">A wormhole has torn open - a fold in spacetime no craft has crossed and returned from, where relativity bends time and minutes inside are years back home. You are the pilot sent in: ride its gravity deeper and faster into the unknown.</p>
      <p class="mission">MISSION - chart the deepest passage through spacetime, and live to bring it back.</p>
      <p class="legend">Blue orbs refill energy &middot; gold is score &middot; red mines and magenta raiders end the run - shoot the raiders before they shoot you.</p>
      <div class="keys">
        <span class="k">ARROWS / A D</span><span class="a">STEER UP THE WALLS</span>
        <span class="k">SPACE</span><span class="a">FIRE</span>
        <span class="k">M</span><span class="a">MUSIC ON / OFF</span>
        <span class="k">ESC</span><span class="a">PAUSE / MENU</span>
        <span class="k">P</span><span class="a">SHOW FPS / PERFORMANCE METRICS</span>
      </div>
      <div class="blink" id="wh-title-prompt">PRESS SPACE TO START</div>
    </div>`
  document.body.appendChild(root)

  const $ = (id: string): HTMLElement => root.querySelector('#' + id) as HTMLElement
  const elScore = $('wh-score')
  const elLevel = $('wh-level')
  const elGrav = $('wh-grav')
  const elBest = $('wh-best')
  const elTime = $('wh-time')
  const elLives = $('wh-lives')
  const elEnergy = $('wh-energy')
  const elWepLbl = $('wh-weplbl')
  const elTrack = $('wh-track')
  const elSpd = $('wh-spd')
  const elMute = $('wh-mute')
  const elOver = $('wh-over')
  const elTitle = $('wh-title')
  const elTitlePrompt = $('wh-title-prompt')
  const elOverScore = $('wh-over-score')
  const elOverLevel = $('wh-over-level')
  const elOverTime = $('wh-over-time')
  const elOverBest = $('wh-over-best')
  const elLevelUp = $('wh-levelup')

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
  let lastLevel = -1
  let lastBannerLevel = 1 // last level a "LEVEL N" banner fired for (1 = no banner for the start level)
  let lastBest = -1
  let lastTimeTenths = -1
  let lastSpd = -1
  let lastMode = ''
  let lastEnergyTenths = -1
  let lastColor = ''
  let lastEmpty = false
  let lastMusicMuted = false
  let lastTitle = false
  let lastPrompt = ''
  let lastOver = false
  let lastOverScore = -1
  let lastOverLevel = -1
  let lastOverTime = -1
  let lastOverBest = -1

  return {
    update(s: HudState): void {
      const score = Math.max(0, Math.floor(s.score))
      if (score !== lastScore) { elScore.textContent = 'SCORE ' + pad(score, 7); lastScore = score }
      const level = Math.max(1, Math.floor(s.level))
      if (level !== lastLevel) { elLevel.textContent = 'LEVEL ' + level; lastLevel = level }
      // Big "LEVEL N" banner for ~2s when a new level is reached during a live run
      // (not level 1, the start). Fires once per level-up; the reflow restarts the
      // CSS animation, and lastBannerLevel tracks the level so a restart re-arms it.
      if (s.level > lastBannerLevel && s.level >= 2 && s.started && !s.over) {
        elLevelUp.textContent = 'LEVEL ' + Math.floor(s.level)
        elLevelUp.classList.remove('show')
        void elLevelUp.offsetWidth // force reflow so the animation replays each level-up
        elLevelUp.classList.add('show')
      }
      lastBannerLevel = s.level
      if (s.over) elLevelUp.classList.remove('show') // don't linger over the game-over panel
      const best = Math.max(0, Math.floor(s.best))
      if (best !== lastBest) { elBest.textContent = 'BEST ' + pad(best, 7); lastBest = best }
      // run timer (MM:SS.X): write only when the displayed tenth changes (~10/s)
      const timeTenths = Math.floor(Math.max(0, s.elapsed) * 10)
      if (timeTenths !== lastTimeTenths) { elTime.textContent = 'TIME ' + fmtTime(s.elapsed); lastTimeTenths = timeTenths }
      const spd = Math.max(0, Math.floor(s.speed))
      if (spd !== lastSpd) { elSpd.textContent = 'SPD ' + pad(spd, 2); lastSpd = spd }
      if (s.flightMode !== lastMode) { elGrav.textContent = 'MODE ' + s.flightMode.toUpperCase(); lastMode = s.flightMode }
      renderLives(s.lives)

      // weapon charge: blue normally, yellow when low (below LOW), red when empty
      // (less than one shot's worth, so the gun is inert). Empty also flips the
      // label to a blinking RECHARGE and reddens the track frame.
      const e = Math.max(0, Math.min(1, s.energy01))
      const tenths = Math.round(e * 1000) // 0..1000 -> width to 0.1%
      if (tenths !== lastEnergyTenths) { elEnergy.style.width = (tenths / 10).toFixed(1) + '%'; lastEnergyTenths = tenths }
      const empty = e < GUN.COST / ENERGY.MAX
      const color = empty ? '#ff5a5a' : e <= ENERGY.LOW ? '#ffd24d' : '#3d7dff'
      if (color !== lastColor) {
        elEnergy.style.background = color
        elEnergy.style.color = color // drives the box-shadow glow
        lastColor = color
      }
      if (empty !== lastEmpty) {
        elWepLbl.textContent = empty ? 'RECHARGE' : 'WEAPON'
        elWepLbl.classList.toggle('empty', empty)
        elTrack.classList.toggle('empty', empty)
        lastEmpty = empty
      }

      if (s.musicMuted !== lastMusicMuted) { elMute.classList.toggle('show', s.musicMuted); lastMusicMuted = s.musicMuted }
      const titleShow = (!s.started && !s.over) || s.paused
      if (titleShow !== lastTitle) { elTitle.classList.toggle('show', titleShow); lastTitle = titleShow }
      const prompt = s.paused ? 'PRESS ESC TO RESUME' : 'PRESS SPACE TO START'
      if (prompt !== lastPrompt) { elTitlePrompt.textContent = prompt; lastPrompt = prompt }
      if (s.over !== lastOver) { elOver.classList.toggle('show', s.over); lastOver = s.over }
      // game-over panel. The title is static ("SHIP DESTROYED") - lives are the
      // only fail condition now, so it is not computed here. elapsed is frozen at
      // game-over, so the time line writes once on the run-ending edge.
      if (s.over) {
        if (score !== lastOverScore) { elOverScore.textContent = 'SCORE ' + pad(score, 7); lastOverScore = score }
        if (level !== lastOverLevel) { elOverLevel.textContent = 'REACHED LEVEL ' + level; lastOverLevel = level }
        if (timeTenths !== lastOverTime) { elOverTime.textContent = 'TIME ' + fmtTime(s.elapsed); lastOverTime = timeTenths }
        if (best !== lastOverBest) { elOverBest.textContent = 'BEST ' + pad(best, 7); lastOverBest = best }
      }
    },
  }
}

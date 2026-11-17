import { ENERGY, LIVES, GUN, DIFFICULTY, HUD } from './config'
import { type DamageCause } from './session'

// Minimal in-theme HUD as a DOM overlay (crisp text, no bloom interference):
// level / score / best top-left, run time top-right, ships + weapon charge
// bottom-left, mode + speed bottom-right, and centered title / level-up /
// game-over panels. Thin green vector styling.
export interface HudState {
  score: number
  speed: number
  energy01: number // 0..1 (weapon charge)
  lives: number
  shards: number // life shards caught toward the next life
  shardsPerLife: number // shards that restore one life at the current level
  gemsThisLevel: number // gems counted toward the current level's quota
  gemQuota: number // gems that open the current level's gate
  elapsed: number // seconds of active play this run (run timer)
  over: boolean
  started: boolean // false on the title screen (before the first run begins)
  paused: boolean // a live run paused back to the intro/menu screen (Esc)
  musicMuted: boolean // music toggled off via M (SFX still play)
  flightMode: string // experimental flight mode readout (testing)
  level: number // current level (1-based for display)
  best: number
  difficultyIndex: number // selected DIFFICULTY.MODES index (HUD corner + game-over panel)
  deathCause: DamageCause | undefined // what cost the last life, named on the game-over panel
}

export interface Hud {
  update(s: HudState): void
  flashGemHint(): void // one-time "collect gems to advance" reminder on the first run
  showLevel(level: number, multiplier: number): void // big LEVEL N banner with the score multiplier (1-based level)
  showGate(): void // short banner: the quota is met and the level gate is ahead
  pulseGems(): void // the gem row pulses once (quota met)
  // Render the title-screen selector rows. Called on init and on a menu keypress
  // (not per frame): row 0 = SHIP active, 1 = DIFFICULTY active; the active row
  // brightens and gets the cycle arrows.
  setMenu(shipName: string, diffIndex: number, row: number): void
}

const CSS = `
/* translateZ(0) keeps the whole overlay on its own GPU compositor layer: the
   browser composites it as ONE cached texture over the canvas, instead of
   re-rasterizing this full-screen, text-shadow-heavy overlay every frame as the
   canvas updates beneath it. Without it, that per-frame repaint costs ~25ms on
   Apple Silicon / ProMotion-Retina (120fps -> 30fps); 60Hz machines hid it. */
#hud { position:fixed; inset:0; pointer-events:none; z-index:10; transform:translateZ(0);
  font-family:'Courier New',ui-monospace,monospace; text-transform:uppercase;
  letter-spacing:2px; color:#7dffa6; text-shadow:0 0 6px rgba(80,255,150,0.55); }
#hud .corner { position:absolute; font-size:22px; line-height:1.5; }
#hud .tl { top:18px; left:20px; }
#hud .tr { top:18px; right:20px; text-align:right; }
#hud .br { bottom:20px; right:20px; text-align:right; }
#hud .dim { opacity:0.6; }
#hud .gems { font-size:16px; letter-spacing:3px; color:#f1c34a; text-shadow:0 0 6px rgba(255,200,70,0.5); }
#hud .gems .rem { opacity:0.3; }
#hud .gems .open { color:#9affc0; letter-spacing:2px; }
#hud .lives { position:absolute; left:20px; bottom:78px; font-size:21px; letter-spacing:6px; }
#hud .lives .lost { opacity:0.22; }
#hud .lives .filling { color:#5dff7a; text-shadow:0 0 8px rgba(70,255,110,0.9); }
#hud .lives .shardbar { display:inline-block; vertical-align:middle; margin-left:10px; letter-spacing:0; color:#5dff7a;
  text-shadow:0 0 8px rgba(70,255,110,0.9); font-size:19px; }
#hud .lives .shardbar .trk { display:inline-block; vertical-align:middle; margin-left:7px; width:156px; height:11px;
  border:1px solid rgba(93,255,122,0.6); box-shadow:0 0 7px rgba(70,255,110,0.35); position:relative; overflow:hidden; }
#hud .lives .shardbar .fill { position:absolute; left:0; top:0; bottom:0; background:#5dff7a; box-shadow:0 0 8px rgba(70,255,110,0.9); }
#hud .lives .shardbar .ticks { position:absolute; inset:0;
  background-image:linear-gradient(90deg, transparent calc(100% - 1.5px), rgba(2,10,5,0.95) calc(100% - 1.5px)); }
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
  background:radial-gradient(ellipse at center, rgba(0,6,12,0.6), rgba(0,3,8,0.78)); }
/* blur only the game-over panel: the TITLE panel keeps the scene sharp so the
   rotating 3D ship preview (drawn by the canvas beneath) reads crisply, with a
   lighter gradient - darkest behind the centered text, thin at the edges. */
#hud #wh-over { backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); }
#hud #wh-title { background:radial-gradient(ellipse at center, rgba(0,6,12,0.62), rgba(0,3,8,0.35)); }
#hud .over.show { display:flex; }
#hud .menu { display:flex; flex-direction:column; gap:7px; font-size:15px; }
#hud .menu .mrow { display:flex; gap:16px; justify-content:center; opacity:0.45; }
#hud .menu .mrow.on { opacity:1; }
#hud .menu .cap { min-width:150px; text-align:right; color:#9affc0; letter-spacing:3px; }
#hud .menu .val { min-width:190px; text-align:left; letter-spacing:3px; }
#hud .menu .mrow.on .val { color:#f1c34a; text-shadow:0 0 9px rgba(255,200,70,0.55); }
#hud.paused .menu { display:none; }
#hud .dpips { font-size:0.75em; letter-spacing:2px; }
#hud .dpips .rem { opacity:0.3; }
#hud .over h1 { font-size:34px; margin:0; color:#9affc0; letter-spacing:5px; }
#hud .over .lvl { font-size:30px; color:#9affc0; letter-spacing:4px; }
#hud .over .big { font-size:22px; }
#hud .over .blink { font-size:15px; opacity:0.85; animation:wh-blink 1.1s steps(2,end) infinite; }
/* the only way on from the game-over panel: larger, brighter, and never dimmer than half */
#hud #wh-over .blink { font-size:18px; color:#9affc0; opacity:1; animation-name:wh-blink-soft; }
@keyframes wh-blink-soft { 50% { opacity:0.5; } }
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
#hud .gemhint { position:absolute; top:120px; left:0; right:0; text-align:center;
  font-size:18px; letter-spacing:3px; color:#f1c34a; text-shadow:0 0 10px rgba(255,200,70,0.6);
  opacity:0; pointer-events:none; }
#hud .gemhint.show { animation:wh-gemhint 4.5s ease-out forwards; }
@keyframes wh-gemhint { 0%{opacity:0;} 12%{opacity:0.95;} 75%{opacity:0.95;} 100%{opacity:0;} }
/* The level and gate banners sit in the upper part of the view, above the tube's
   vanishing point: raiders and their firing tells appear there at a level change. */
#hud .levelup { position:absolute; top:11%; left:0; right:0; text-align:center;
  font-size:77px; letter-spacing:12px; font-weight:bold; color:#9affc0;
  text-shadow:0 0 18px rgba(80,255,150,0.85), 0 0 44px rgba(80,255,150,0.5);
  opacity:0; will-change:opacity,transform; }
#hud .levelup.show { animation:wh-levelup 2.2s ease-out forwards; }
#hud .levelup .sub { font-size:28px; letter-spacing:8px; color:#ffe2a0;
  text-shadow:0 0 3px #000, 0 0 8px rgba(0,0,0,0.9), 0 0 16px rgba(255,200,70,0.7); margin-top:6px; }
#hud .gatecue { position:absolute; top:15%; left:0; right:0; text-align:center;
  font-size:34px; letter-spacing:7px; font-weight:bold; color:#ffe9a8;
  text-shadow:0 0 3px #000, 0 0 8px rgba(0,0,0,0.9), 0 0 16px rgba(255,210,90,0.7);
  opacity:0; will-change:opacity,transform; }
#hud .gatecue.show { animation:wh-gatecue 1.6s ease-out forwards; }
#hud.paused .levelup, #hud.paused .gatecue { animation-play-state:paused; }
@keyframes wh-gatecue {
  0%   { opacity:0; transform:translateY(-8px); }
  12%  { opacity:1; transform:translateY(0); }
  78%  { opacity:1; }
  100% { opacity:0; transform:translateY(0); }
}
#hud .gems { transform-origin:left center; will-change:transform; }
#hud .gems.pulse { animation:wh-gempulse 0.7s ease-out; }
@keyframes wh-gempulse {
  0%   { transform:scale(1); }
  30%  { transform:scale(1.35); }
  100% { transform:scale(1); }
}
#hud .over .cause { font-size:20px; letter-spacing:4px; color:#ff6a5a;
  text-shadow:0 0 8px rgba(255,90,70,0.6); }
@keyframes wh-levelup {
  0%   { opacity:0; transform:scale(0.7); }
  14%  { opacity:1; transform:scale(1.06); }
  26%  { transform:scale(1.0); }
  74%  { opacity:1; }
  100% { opacity:0; transform:scale(1.0); }
}
`

// Game-over cause line, by the cause of the last life lost.
const CAUSE_TEXT: Record<DamageCause, string> = { mine: 'HIT BY MINE', bolt: 'RAIDER BOLT', ram: 'RAIDER RAM' }

// Score multiplier as shown on the level banner: 1.5 -> "1.5", 2 -> "2", 2.25 -> "2.25".
function fmtMult(m: number): string {
  return String(Math.round(m * 100) / 100)
}

// Restart a one-shot CSS animation: drop the class, force a reflow, add it back.
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
}

function pad(n: number, width: number): string {
  return Math.max(0, Math.floor(n)).toString().padStart(width, '0')
}

// Difficulty readout pieces (title selector + HUD corner + game-over panel): the
// mode's own name/color plus a 3-slot threat meter - filled triangles up to the
// mode's rank, dim outlines for the rest - so the danger level reads at a glance.
function diffMode(i: number): (typeof DIFFICULTY.MODES)[number] {
  return DIFFICULTY.MODES[i] ?? DIFFICULTY.MODES[0]!
}
function diffPips(i: number): string {
  let pips = ''
  for (let k = 0; k < DIFFICULTY.MODES.length; k++) {
    pips += k <= i ? '&#9650;' : '<span class="rem">&#9651;</span>'
  }
  return `<span class="dpips">${pips}</span>`
}
function diffLabel(i: number): string {
  const m = diffMode(i)
  return `<span style="color:${m.color}">${m.name} ${diffPips(i)}</span>`
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
    <div class="corner tl"><div id="wh-level">LEVEL 1</div><div id="wh-gems" class="gems">GEMS</div><div id="wh-score">SCORE 0000000</div><div id="wh-best" class="dim">BEST 0000000</div></div>
    <div class="corner tr"><div id="wh-time">TIME 00:00.0</div></div>
    <div class="lives" id="wh-lives">SHIPS</div>
    <div class="meter"><div class="lbl" id="wh-weplbl">WEAPON</div><div class="track" id="wh-track"><div class="fill" id="wh-energy"></div></div></div>
    <div class="corner br"><div id="wh-grav" class="dim">MODE NORMAL</div><div id="wh-diff"></div><div id="wh-spd">SPD 00</div></div>
    <div class="mute" id="wh-mute">&#9836; MUSIC OFF</div>
    <div class="gemhint" id="wh-gemhint">COLLECT GEMS TO ADVANCE</div>
    <div class="levelup" id="wh-levelup">LEVEL 2</div>
    <div class="gatecue" id="wh-gatecue">GATE AHEAD</div>
    <div class="over" id="wh-over">
      <h1 id="wh-over-title">SHIP DESTROYED</h1>
      <div class="cause" id="wh-over-cause"></div>
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
      <p class="legend">Blue orbs recharge your weapon &middot; gold gems score and unlock the next level &middot; red mines and magenta raiders cost a ship - shoot the raiders before they shoot you &middot; downed raiders drop green crosses: small ones rebuild a lost ship piece by piece, a large one from the last raider of a squad is a whole ship, and each tops up the weapon.</p>
      <div class="menu">
        <div class="mrow" id="wh-menu-ship"><span class="cap">SHIP</span><span class="val" id="wh-menu-ship-val"></span></div>
        <div class="mrow" id="wh-menu-diff"><span class="cap">DIFFICULTY</span><span class="val" id="wh-menu-diff-val"></span></div>
      </div>
      <div class="keys">
        <span class="k">ARROWS / A D</span><span class="a">STEER UP THE WALLS</span>
        <span class="k">SPACE</span><span class="a">FIRE</span>
        <span class="k">&#9650; &#9660; &#9664; &#9654;</span><span class="a">CHOOSE SHIP + DIFFICULTY</span>
        <span class="k">M</span><span class="a">MUSIC ON / OFF</span>
        <span class="k">ESC</span><span class="a">PAUSE / MENU</span>
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
  const elGems = $('wh-gems')
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
  const elGateCue = $('wh-gatecue')
  const elOverCause = $('wh-over-cause')
  const elGemHint = $('wh-gemhint')
  const elDiff = $('wh-diff')
  const elMenuShip = $('wh-menu-ship')
  const elMenuDiff = $('wh-menu-diff')
  const elMenuShipVal = $('wh-menu-ship-val')
  const elMenuDiffVal = $('wh-menu-diff-val')

  // ship glyphs: bright for remaining, dim for spent (shows the max at a glance)
  // While a life is missing, a green cross (the life shard's shape) and a segmented
  // bar follow the ships: one segment fills per shard caught toward the next ship,
  // and that ship's glyph brightens in the shard green as the set fills. The bar
  // and the brightened glyph are not shown on the game-over screen.
  let lastLives = -1
  let lastShards = -1
  let lastPerLife = -1
  let lastLivesOver = false
  function renderLives(lives: number, shards: number, perLife: number, over: boolean): void {
    if (lives === lastLives && shards === lastShards && perLife === lastPerLife && over === lastLivesOver) return
    lastLives = lives
    lastShards = shards
    lastPerLife = perLife
    lastLivesOver = over
    const fill = Math.min(1, shards / perLife)
    let glyphs = ''
    for (let i = 0; i < LIVES.START; i++) {
      if (i === lives && shards > 0 && !over) {
        glyphs += `<span class="filling" style="opacity:${(0.25 + 0.6 * fill).toFixed(2)}">&#9650;</span>`
      } else glyphs += `<span class="${i < lives ? '' : 'lost'}">&#9650;</span>`
    }
    if (lives < LIVES.START && !over) {
      glyphs +=
        `<span class="shardbar">&#10010;<span class="trk"><span class="fill" style="width:${(fill * 100).toFixed(1)}%"></span>` +
        `<span class="ticks" style="background-size:${(100 / perLife).toFixed(3)}% 100%"></span></span></span>`
    }
    elLives.innerHTML = 'SHIPS ' + glyphs
  }

  // gem quota pips: filled gold diamond per collected gem, dim outline per remaining,
  // with a numeric tail so it stays readable as the quota climbs. At the quota it
  // flips to GATE (the level gate is ahead; the row stays full until the craft is
  // through it). Rebuilt only when the count or quota changes (a few times per
  // level), like renderLives.
  let lastGot = -1
  let lastQuota = -1
  function renderGems(gems: number, quota: number): void {
    const got = Math.min(Math.max(0, gems), Math.max(0, quota))
    if (got === lastGot && quota === lastQuota) return
    lastGot = got
    lastQuota = quota
    if (quota <= 0) {
      elGems.innerHTML = ''
      return
    }
    // at most GEM_PIPS_MAX pips: a larger quota fills them in proportion (the first
    // gem lights a pip, the last pip waits for the last gem), and the got/quota text
    // stays exact
    const shown = Math.min(quota, HUD.GEM_PIPS_MAX)
    const filled = got >= quota ? shown : Math.min(shown - 1, Math.ceil((got * shown) / quota))
    let pips = ''
    for (let i = 0; i < shown; i++) pips += i < filled ? '&#9670;' : '<span class="rem">&#9671;</span>'
    const tail = got >= quota ? ' <span class="open">GATE &#9656;</span>' : ` ${got}/${quota}`
    elGems.innerHTML = 'GEMS ' + pips + tail
  }

  // hud.update() runs every render frame. The DOM only changes a few times a
  // second (a score tick, an energy step, a state flip), so each field caches its
  // last-written value and writes (and re-formats) only on a real change. This
  // skips the per-frame textContent/style/classList churn (forced style recalc)
  // and the string allocations that went with it.
  let lastScore = -1
  let lastLevel = -1
  let lastCause: DamageCause | undefined
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
  let lastOverMode = -1
  let lastOverTime = -1
  let lastOverBest = -1
  let lastDiff = -1
  let lastPausedCls = false

  return {
    update(s: HudState): void {
      const score = Math.max(0, Math.floor(s.score))
      if (score !== lastScore) { elScore.textContent = 'SCORE ' + pad(score, 7); lastScore = score }
      const level = Math.max(1, Math.floor(s.level))
      if (level !== lastLevel) { elLevel.textContent = 'LEVEL ' + level; lastLevel = level }
      renderGems(s.gemsThisLevel, s.gemQuota)
      if (s.over !== lastOver && s.over) {
        // banners do not linger over the game-over panel
        elLevelUp.classList.remove('show')
        elGateCue.classList.remove('show')
      }
      const best = Math.max(0, Math.floor(s.best))
      if (best !== lastBest) { elBest.textContent = 'BEST ' + pad(best, 7); lastBest = best }
      // run timer (MM:SS.X): write only when the displayed tenth changes (~10/s)
      const timeTenths = Math.floor(Math.max(0, s.elapsed) * 10)
      if (timeTenths !== lastTimeTenths) { elTime.textContent = 'TIME ' + fmtTime(s.elapsed); lastTimeTenths = timeTenths }
      const spd = Math.max(0, Math.floor(s.speed))
      if (spd !== lastSpd) { elSpd.textContent = 'SPD ' + pad(spd, 2); lastSpd = spd }
      if (s.flightMode !== lastMode) {
        // the readout matters only in the pinned test modes (G key), not in the game
        elGrav.textContent = 'MODE ' + s.flightMode.toUpperCase()
        elGrav.style.display = s.flightMode === 'sections' ? 'none' : ''
        lastMode = s.flightMode
      }
      if (s.difficultyIndex !== lastDiff) { elDiff.innerHTML = diffLabel(s.difficultyIndex); lastDiff = s.difficultyIndex }
      // hide the selector rows while PAUSED (same title panel, but mid-run the
      // ship/difficulty must not change under the frozen game)
      if (s.paused !== lastPausedCls) { root.classList.toggle('paused', s.paused); lastPausedCls = s.paused }
      renderLives(s.lives, s.shards, s.shardsPerLife, s.over)

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
      // game-over panel. The title is static ("SHIP DESTROYED"): lives are the
      // only fail condition. elapsed is frozen at
      // game-over, so the time line writes once on the run-ending edge.
      if (s.over) {
        if (s.deathCause !== lastCause) { elOverCause.textContent = s.deathCause ? CAUSE_TEXT[s.deathCause] : ''; lastCause = s.deathCause }
        if (score !== lastOverScore) { elOverScore.textContent = 'SCORE ' + pad(score, 7); lastOverScore = score }
        if (level !== lastOverLevel || s.difficultyIndex !== lastOverMode) { elOverLevel.textContent = 'REACHED LEVEL ' + level + ' - ' + diffMode(s.difficultyIndex).name; lastOverLevel = level; lastOverMode = s.difficultyIndex }
        if (timeTenths !== lastOverTime) { elOverTime.textContent = 'TIME ' + fmtTime(s.elapsed); lastOverTime = timeTenths }
        if (best !== lastOverBest) { elOverBest.textContent = 'BEST ' + pad(best, 7); lastOverBest = best }
      }
    },

    // Play the one-time gem reminder (fades in then out). The reflow restarts
    // the CSS animation; main calls this once, on the first run of the session.
    flashGemHint(): void {
      replay(elGemHint, 'show')
    },

    showLevel(level: number, multiplier: number): void {
      elGateCue.classList.remove('show')
      elLevelUp.innerHTML = `LEVEL ${Math.floor(level)}<div class="sub">SCORE x${fmtMult(multiplier)}</div>`
      replay(elLevelUp, 'show')
    },

    showGate(): void {
      elGemHint.classList.remove('show') // both sit in the same place
      replay(elGateCue, 'show')
    },

    pulseGems(): void {
      replay(elGems, 'pulse')
    },

    setMenu(shipName: string, diffIndex: number, row: number): void {
      elMenuShip.classList.toggle('on', row === 0)
      elMenuDiff.classList.toggle('on', row === 1)
      // the difficulty value keeps its threat color even when the row is inactive
      // (inline style wins over the active-row gold), so the signal never hides
      elMenuShipVal.innerHTML = row === 0 ? `&#9664; ${shipName} &#9654;` : shipName
      const label = diffLabel(diffIndex)
      elMenuDiffVal.innerHTML = row === 1 ? `&#9664; ${label} &#9654;` : label
    },
  }
}

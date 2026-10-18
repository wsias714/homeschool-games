// Player names come from the local server's /names.js (private). Public default is Player 1/2/3.
var PN = Object.assign({ P1: 'Player 1', P2: 'Player 2', P3: 'Player 3' }, (typeof window !== 'undefined' && window.PLAYER_NAMES) || {});
'use strict';

// ── Board ─────────────────────────────────────────────────────────────────────
const W = 900, H = 640;
const canvas = document.getElementById('gc');
const ctx = canvas.getContext('2d');

// ── Tunable choices ───────────────────────────────────────────────────────────
const SHIP1_COLOR = '#b06bff';   // P1
const SHIP2_COLOR = '#36e07a';   // P2
const ASTEROID_BURST = 'rocks';

// ── Shields ──────────────────────────────────────────────────────────────────
const MAX_SHIELDS = 5;
const DMG_ASTEROID = 0.5, DMG_ALIEN_BODY = 1, DMG_ALIEN_SHOT = 1;
const HIT_IFRAMES = 50, RESPAWN_FR = 150, RESPAWN_SHIELDS = 2, RESPAWN_IFRAMES = 120;

// ── Ship movement ─────────────────────────────────────────────────────────────
const SHIP_R = 15, SHIP_ACCEL = 0.16, SHIP_SPEED = 4.2;

// ── Ship models (picked at each base) ──────────────────────────────────────────
const SHIP_MODELS = ['arrow', 'xwing', 'trek', 'tie', 'bomb', 'airplane', 'falcon', 'destroyer'];
const SHIP_MODEL_NAMES = { arrow:'STAR DART', xwing:'X-WING', trek:'STARCRUISER', tie:'TIE FIGHTER',
  bomb:'BOMBER', airplane:'JET', falcon:'FALCON', destroyer:'STAR DESTROYER' };

// ── Weapons (randomly assigned at each base) ────────────────────────────────────
const WEAPONS = ['dots', 'beam', 'shock', 'double', 'grenade', 'tri'];
const WEAPON_NAMES = { dots:'BLASTER', beam:'LASER', shock:'SHOCKWAVE', double:'DOUBLE', grenade:'DETONATOR', tri:'TRI-SHOT' };
const WEAPON_CD = { dots:12, double:14, shock:30, grenade:28, tri:16 };
const BOLT_SPD = 11, BOLT_LIFE = 80, BOLT_R = 4, BOLT_DMG = 3;
const DOUBLE_OFFSET = 9, DOUBLE_DMG = 2;
const TRI_SPREAD = 0.45, TRI_DMG = 2;
const BEAM_DPS = 12, BEAM_W = 9;
const SHOCK_SPD = 3, SHOCK_GROW = 2.2, SHOCK_MAXR = 82, SHOCK_DMG = 3;
const GREN_SPD = 5, GREN_RANGE = 300, GREN_R = 78, GREN_DMG = 4;

// ── Asteroids ─────────────────────────────────────────────────────────────────
const AST_SIZES = {
  big: { r: 34, hp: 3, score: 1, next: 'med' },
  med: { r: 22, hp: 2, score: 2, next: 'sml' },
  sml: { r: 12, hp: 1, score: 3, next: null  },
};
const AST_SPD_MIN = 0.22, AST_SPD_RND = 0.45;

// ── Aliens ────────────────────────────────────────────────────────────────────
const ALIEN_R = 14, ALIEN_SHOT_SPD = 2.0;
const GRUNT  = { hp: 3, score: 5 };
const HUNTER = { hp: 5, score: 9 };    // tougher, fires a 3-way spread
const GUNNER = { hp: 4, score: 8 };    // fires color-matched double/tri spreads (late sectors)
const SEEKER = { hp: 4, score: 10 };   // launches a heatseeker missile (late sectors)
const HUNTER_SHOT_SPD = 2.7, GUNNER_SHOT_SPD = 2.4;

// ── Heatseeker missiles (co-op: the OTHER player shoots them down) ──────────────
const DMG_MISSILE = 1;
const MISSILE_SPD = 2.5, MISSILE_TURN = 0.055, MISSILE_LIFE = 430, MISSILE_R = 6;

// ── Comets (race-sector dodge hazards — fast, can't be shot) ────────────────────
const COMET_SPD = 6.5, COMET_R = 9;

// ── Earth boss + space city ────────────────────────────────────────────────────
const BOSS_HP = 60, BOSS_MISSILE_CD = 240, BOSS_SHOT_CD = 100, BOSS_R = 58;  // big Death Star
const CITY_SEGMENTS = 7, CITY_SEG_HP = 3, STATION_DESTROY_FR = 300, STATION_PENALTY = 4;
// Boss finale (escalating death sequence before the win screen)
const BOSS_DIE_FR = 200, BOSS_DIE_BIG_BOOMS = [140, 90, 40];
// Boss superlaser beam (fires during 'vulnerable', telegraphed by boss.charge)
const BOSS_BEAM_CHARGE_FR = 70, BOSS_BEAM_DUR = 50, BOSS_BEAM_COOLDOWN = 260, BOSS_BEAM_DPS = 4, BOSS_BEAM_W = 14;
// Decorative Death Star (sectors 2 & 3 — visual only, no combat, no HP)
const DECOR_STAR_SECTORS = [1, 2], DECOR_STAR_R = 46, DECOR_STAR_POS = { x: W*0.78, y: 90 };

// ── Sectors / map ─────────────────────────────────────────────────────────────
const TOTAL_SECTORS = 12;
const NORMAL_SECTORS = 10;       // sectors 1..10 are the free-pick normal sectors
const RACE_IDX = 10;             // sector 11 = asteroid-field dodge race
const EARTH_IDX = 11;            // sector 12 = Earth boss finale
const isRace  = i => i === RACE_IDX;
const isEarth = i => i === EARTH_IDX;
// Race + travel tuning
const RACE_GOAL_FR = 1500;       // ~25s of dodging to cross the field
const RACE_AST_SPD = 2.6;        // asteroids stream downward this fast
const TRAVEL_FR = 150;           // regular-speed cruise from the field to Earth
const EARTH_WAVES = 2;           // reinforcement waves after the first

// ── Moon base / docking ───────────────────────────────────────────────────────
const BASE_PARK_Y = 110, PAD_R = 56, RECHARGE_FR = 16;
const STRIP_DX = 44, STRIP_HALF = 17, STRIP_LEN = 120;   // per-ship landing strip (steer in slowly)
const LAND_TIMEOUT = 600;   // ~10s: proceed even if a kid never lands
const GEARUP_FR = 600;      // 10s window to change your gun/ship
const MAP_TIMEOUT = 900;    // ~15s: auto-pick a sector
const WARP_FR = 150;

const GAME_KEYS = new Set([
  'KeyW','KeyA','KeyS','KeyD','Space',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',
  'KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','AltLeft','ControlLeft',
]);

// ── State ─────────────────────────────────────────────────────────────────────
let ships, bullets, alienShots, asteroids, aliens, particles, stars, warpRocks, sectorBg;
let base, sectors, curSector, mapCursor, phase, phaseTimer, scrollSpd;
let shake, fc, banner, bannerTimer, startTime, winElapsed, flash;
let raceProgress, raceSpawnTimer, earthReinforce;   // finale-sector state
let missiles, comets, boss, stations, stationTimer, allies; // finale systems
let decorStar; // decorative (non-combat) Death Star, sectors 2 & 3 only
let mLE = false, mRE = false, mFE = false;   // map-input edge state
let mouseFire = false;                        // toddler-proof: mouse/trackpad buttons fire P1
const keys = {};
// Any of these space-adjacent keys also fires Player 1 (so mashing near the spacebar just shoots).
const P1_FIRE = new Set(['Space','KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','AltLeft','ControlLeft']);

function init() {
  beamSound(false);
  ships = [
    makeShip(0, PN.P1.toUpperCase(), SHIP1_COLOR, 0, { up:'KeyW', down:'KeyS', left:'KeyA', right:'KeyD', fire:'Space' }),
    makeShip(1, PN.P2.toUpperCase(), SHIP2_COLOR, 1, { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', fire:'Enter' }),
  ];
  bullets = []; alienShots = []; asteroids = []; aliens = []; particles = []; warpRocks = [];
  missiles = []; comets = []; boss = null; stations = []; stationTimer = 0; flash = 0; allies = []; decorStar = null;
  stars = makeStars(120);
  base = null; shake = 0; fc = 0; scrollSpd = 0.6; banner = ''; bannerTimer = 0;
  sectors = []; for (let i = 0; i < TOTAL_SECTORS; i++) sectors.push({ cleared: false });
  curSector = 0; mapCursor = 0; winElapsed = 0;
  startTime = Date.now();
  startSector(0);
  upPanel();
}

function makeShip(id, name, col, weaponIdx, controls) {
  return {
    id, name, col, controls,
    x: 0, y: 0, vx: 0, vy: 0, face: { x: 0, y: -1 },
    weaponIdx, weapon: WEAPONS[weaponIdx],
    modelIdx: 0, model: SHIP_MODELS[0],
    fireCd: 0, score: 0,
    shields: MAX_SHIELDS, alive: true, invuln: 0, respawn: 0,
    beam: null, beamActive: false,
    landed: false, _rc: 0, _le: false, _re: false, _ue: false, _de: false,
  };
}

function makeStars(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.6 + 0.4, tw: Math.random()*Math.PI*2, depth: 0.4 + Math.random()*1.0 });
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const lerp = (a,b,t) => a + (b-a)*t;
const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
const dst  = (x1,y1,x2,y2) => Math.hypot(x2-x1, y2-y1);
const pick = arr => arr[(Math.random()*arr.length)|0];
function rr(x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function distToSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1, l2=dx*dx+dy*dy;
  let t = l2 ? ((px-x1)*dx+(py-y1)*dy)/l2 : 0; t = clamp(t,0,1);
  return Math.hypot(px-(x1+dx*t), py-(y1+dy*t));
}
const aliveShips = () => ships.filter(s => s.alive);
function setBanner(txt, frames){ banner = txt; bannerTimer = frames; }
// Player-1 fires on the spacebar, any space-adjacent key, or a mouse/trackpad button (toddler-proof).
function firePressed(t) {
  if (t.id === 0) { if (mouseFire) return true; for (const c of P1_FIRE) if (keys[c]) return true; return false; }
  return !!keys[t.controls.fire];
}
function setWeapon(s, w){ s.weapon = w; s.weaponIdx = WEAPONS.indexOf(w); }
function setModel(s, m){ s.model = m; s.modelIdx = SHIP_MODELS.indexOf(m); }
function fmtTime(ms){ const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${('0'+(s%60)).slice(-2)}`; }

// ── Per-sector background ──────────────────────────────────────────────────────
function makeSectorBg(n) {
  if (isEarth(n)) return { kind: 'earth' };                       // big low-orbit Earth
  if (isRace(n))  return { kind: 'race', destHue: 205 };          // racing toward the home planet
  const hues = [265, 200, 320, 150, 30, 230];
  const bg = { kind: 'normal', nebulas: [], planet: null };
  bg.nebulas.push({ x: 140+Math.random()*180, y: 150+Math.random()*120, r: 150+Math.random()*90, hue: hues[n % hues.length] });
  bg.nebulas.push({ x: W-160-Math.random()*180, y: 360+Math.random()*160, r: 140+Math.random()*100, hue: hues[(n+2) % hues.length] });
  if (n % 2 === 0) bg.planet = { x: 120 + Math.random()*(W-240), y: 120 + Math.random()*180, r: 46 + Math.random()*40, hue: hues[(n+4)%hues.length] };
  return bg;
}

// ── Sectors ───────────────────────────────────────────────────────────────────
const normalCleared = () => { let c = 0; for (let i = 0; i < NORMAL_SECTORS; i++) if (sectors[i].cleared) c++; return c; };

function startSector(idx) {
  curSector = idx;
  base = null;
  asteroids = []; aliens = []; alienShots = []; bullets = []; warpRocks = [];
  missiles = []; comets = []; boss = null; stations = []; stationTimer = 0; allies = []; decorStar = null;
  sectorBg = makeSectorBg(idx);
  ships.forEach((s, i) => {
    s.x = W*0.5 + (i === 0 ? -70 : 70); s.y = H*0.84;
    s.vx = 0; s.vy = 0; s.face = { x:0, y:-1 }; s.landed = false; s._rc = 0;
  });

  if (isRace(idx)) {
    phase = 'race'; scrollSpd = 4; raceProgress = 0; raceSpawnTimer = 0;
    setBanner('ASTEROID FIELD! Dodge UP toward the planet!', 220);
    upPanel(); return;
  }
  if (isEarth(idx)) {
    phase = 'fighting'; scrollSpd = 0.9; earthReinforce = EARTH_WAVES;
    boss = { x: W/2, y: 108, hp: BOSS_HP, maxHp: BOSS_HP, state: 'waves', shotCd: BOSS_SHOT_CD, missileCd: BOSS_MISSILE_CD, hurt: 0, dieT: 0, charge: 0,
      beamState: 'idle', beamT: 0, beam: null, _diePhase: 0 };
    // Connected space city along the Earth — segments with HP (takes lots of damage).
    stations = [];
    for (let i = 0; i < CITY_SEGMENTS; i++) stations.push({ x: 70 + i*(W-140)/(CITY_SEGMENTS-1), y: H - 38, hp: CITY_SEG_HP, maxHp: CITY_SEG_HP, h: 24 + ((i*37) % 4)*7, smoke: 0 });
    // A few friendly NPC defenders launch from the city.
    allies = []; for (let i = 0; i < 3; i++) spawnAlly(stations[(i*2) % stations.length].x);
    spawnEarthWave(true);
    setBanner('SECTOR 12 — EARTH! Defend the space city & beat the boss!', 240);
    upPanel(); return;
  }

  phase = 'fighting'; scrollSpd = 0.6;
  if (DECOR_STAR_SECTORS.includes(idx)) decorStar = { x: DECOR_STAR_POS.x, y: DECOR_STAR_POS.y };
  const sn = idx + 1;                                   // sector number 1..10
  const nAst   = Math.min(9, 2 + sn);
  const nAlien = Math.min(7, 1 + Math.floor(sn/1.5));
  const nHunter = sn >= 5 ? Math.min(nAlien, sn >= 8 ? 3 : 2) : 0;
  const late    = idx >= 7;                             // sectors 8–10: add a gunner + a seeker
  const nGunner = late ? 1 : 0, nSeeker = late ? 1 : 0;
  const nGrunt  = Math.max(0, nAlien - nHunter - nGunner - nSeeker);
  const tot = nGrunt + nHunter + nGunner + nSeeker;
  for (let i = 0; i < nAst; i++) spawnAsteroid();
  let ai = 0;
  const beforeAliens = aliens.length;
  for (let i = 0; i < nGrunt; i++)  spawnAlien(ai++, tot, 'grunt');
  for (let i = 0; i < nHunter; i++) spawnAlien(ai++, tot, 'hunter');
  for (let i = 0; i < nGunner; i++) spawnAlien(ai++, tot, 'gunner');
  for (let i = 0; i < nSeeker; i++) spawnAlien(ai++, tot, 'seeker');
  // Sectors 2 & 3 only: aliens visually fly out of the decorative Death Star (no combat effect).
  if (decorStar) for (let i = beforeAliens; i < aliens.length; i++) { aliens[i].x = decorStar.x + (Math.random()-0.5)*40; aliens[i].y = decorStar.y + 14; }
  setBanner(`SECTOR ${sn} — CLEAR THE ALIENS & ASTEROIDS!`, 200);
  upPanel();
}

function spawnEarthWave(first) {
  const nG = first ? 3 : 2, nH = first ? 2 : 2, nGun = first ? 1 : 1, tot = nG + nH + nGun;
  const before = aliens.length;
  let ai = 0;
  for (let i = 0; i < nG; i++)   spawnAlien(ai++, tot, 'grunt');
  for (let i = 0; i < nH; i++)   spawnAlien(ai++, tot, 'hunter');
  for (let i = 0; i < nGun; i++) spawnAlien(ai++, tot, 'gunner');
  for (let i = 0; i < (first ? 3 : 2); i++) spawnAsteroid();
  // Aliens fly OUT of the boss mothership.
  if (boss) for (let i = before; i < aliens.length; i++) { aliens[i].x = boss.x + (Math.random()-0.5)*40; aliens[i].y = boss.y + 14; }
}

function checkSectorClear() {
  if (phase !== 'fighting' || asteroids.length || aliens.length) return;
  if (isEarth(curSector)) return;   // Earth is decided by the boss (see updateBoss), not empty arrays
  sectors[curSector].cleared = true;
  const clearedCount = sectors.filter(s => s.cleared).length;
  if (clearedCount >= TOTAL_SECTORS) {
    phase = 'won'; winElapsed = Date.now() - startTime; beamSound(false); playWin();
    setBanner('', 0);
  } else {
    phase = 'baseIncoming';
    base = { x: W/2, y: -110, parked: false, blink: 0, planetHue: 30 + Math.random()*300 };
    setBanner('SECTOR CLEAR! LAND ON THE MOON BASE', 240);
  }
}

// ── Asteroids ───────────────────────────────────────────────────────────────
function spawnAsteroid(opts) {
  opts = opts || {};
  const size = opts.size || 'big'; const info = AST_SIZES[size];
  let x, y;
  if (opts.x !== undefined) { x = opts.x; y = opts.y; }
  else { x = 40 + Math.random()*(W-80); y = -40 - Math.random()*120; }
  const ang = opts.ang !== undefined ? opts.ang : Math.atan2((H*0.5)-y, (W*0.5)-x) + (Math.random()-0.5)*1.2;
  const spd = opts.spd !== undefined ? opts.spd : AST_SPD_MIN + Math.random()*AST_SPD_RND;
  const verts = 9 + ((Math.random()*4)|0); const lumps = [];
  for (let i = 0; i < verts; i++) lumps.push(0.72 + Math.random()*0.4);
  asteroids.push({ x, y, size, r: info.r, hp: info.hp, vx: Math.cos(ang)*spd + (opts.vx||0), vy: Math.sin(ang)*spd + (opts.vy||0), ang: Math.random()*Math.PI*2, spin: (Math.random()-0.5)*0.04, lumps });
}

function damageAsteroid(a, dmg, owner) {
  a.hp -= dmg;
  if (a.hp > 0) { sparks(a.x, a.y, '#d8c4a0'); return; }
  const idx = asteroids.indexOf(a); if (idx >= 0) asteroids.splice(idx, 1);
  const info = AST_SIZES[a.size];
  addScore(owner, info.score); boom(a.x, a.y, a.r); playBoom(a.size);
  shake = Math.min(14, shake + (a.size==='big'?9 : a.size==='med'?5 : 3));
  if (info.next) for (let i = 0; i < 2; i++) spawnAsteroid({ size: info.next, x: a.x, y: a.y, ang: Math.random()*Math.PI*2, vx: a.vx*0.4, vy: a.vy*0.4 });
  checkSectorClear();
}

function updateAsteroids(dt) {
  const k = dt/16.67;
  if (phase === 'race') {
    // Race: asteroids stream straight down and fly past — no bouncing.
    asteroids.forEach(a => { a.x += a.vx*k; a.y += a.vy*k; a.ang += a.spin*k; });
    asteroids = asteroids.filter(a => a.y < H + 60 && a.x > -60 && a.x < W + 60);
    return;
  }
  asteroids.forEach(a => {
    a.x += a.vx*k; a.y += a.vy*k; a.ang += a.spin*k;
    const m = a.r;
    if (a.x < m)   { a.x = m;   a.vx = Math.abs(a.vx); }
    if (a.x > W-m) { a.x = W-m; a.vx = -Math.abs(a.vx); }
    if (a.y < m)   { a.y = m;   a.vy = Math.abs(a.vy); }
    if (a.y > H-m) { a.y = H-m; a.vy = -Math.abs(a.vy); }
  });
}

// ── Race + travel ──────────────────────────────────────────────────────────────
function updateRace(dt) {
  const k = dt/16.67;
  raceProgress += k / RACE_GOAL_FR;
  raceSpawnTimer -= k;
  if (raceSpawnTimer <= 0) {
    raceSpawnTimer = 13 + Math.random()*10;
    const n = 1 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) spawnAsteroid({
      size: pick(['sml','sml','med','med','big']), x: 40 + Math.random()*(W-80), y: -40,
      ang: Math.PI/2 + (Math.random()-0.5)*0.5, spd: RACE_AST_SPD + Math.random()*1.6,
    });
  }
  // Comets zip through in quick bursts.
  if (Math.random() < 0.014*k) { const burst = 1 + (Math.random() < 0.5 ? 1 : 0); for (let i = 0; i < burst; i++) spawnComet(); }
  if (raceProgress >= 1) {
    sectors[RACE_IDX].cleared = true;
    aliveShips().forEach(s => { s.shields = MAX_SHIELDS; });   // reward: full shields before Earth
    asteroids = [];
    phase = 'travel'; phaseTimer = 0; scrollSpd = 6;
    setBanner('THROUGH THE FIELD! Approaching Earth…', TRAVEL_FR);
    upPanel();
  }
}

function updateTravel(dt) {
  const k = dt/16.67;
  phaseTimer += k;
  scrollSpd = lerp(scrollSpd, 5, 0.05*k);
  if (phaseTimer >= TRAVEL_FR) { scrollSpd = 0.9; startSector(EARTH_IDX); }
}

// ── Earth boss ─────────────────────────────────────────────────────────────────
function winEarth() {
  sectors[EARTH_IDX].cleared = true;
  phase = 'won'; winElapsed = Date.now() - startTime; beamSound(false); playWin(); setBanner('', 0);
}
function damageBoss(dmg, owner) {
  if (!boss || boss.state !== 'vulnerable') return;
  boss.hp -= dmg; boss.hurt = 6; addScore(owner, 1); sparks(boss.x, boss.y, '#ffd24a');
  if (boss.hp <= 0) {
    boss.hp = 0; boss.state = 'dead'; boss.dieT = BOSS_DIE_FR; boss._diePhase = 0;
    boom(boss.x, boss.y, 90); playBoom('big'); shake = 20;
    missiles = []; alienShots = []; boss.beam = null;
    setBanner('BOSS DOWN!! EARTH IS SAVED!', 200);
  }
}
function updateBoss(dt) {
  if (!boss) return;
  const k = dt/16.67;
  if (boss.hurt > 0) boss.hurt -= k;
  if (boss.state === 'dead') {
    boss.dieT -= k; shake = Math.max(shake, 8);
    // Base layer: small chain-reaction bursts across the hull.
    if (fc % 4 === 0) boom(boss.x + (Math.random()-0.5)*90, boss.y + (Math.random()-0.5)*44, 44);
    // Escalation: a few progressively bigger bursts as dieT counts down, each firing once.
    while (boss._diePhase < BOSS_DIE_BIG_BOOMS.length && boss.dieT <= BOSS_DIE_BIG_BOOMS[boss._diePhase]) {
      const r = 60 + boss._diePhase*15;
      boom(boss.x + (Math.random()-0.5)*70, boss.y + (Math.random()-0.5)*40, r);
      playBoom('big'); shake = Math.min(20, shake + 10);
      boss._diePhase++;
    }
    // Finale: one huge burst + a full-screen whiteout, then a brief hold before the win screen.
    if (boss._diePhase === BOSS_DIE_BIG_BOOMS.length && boss.dieT <= 20) {
      boom(boss.x, boss.y, 130); playBoom('big'); shake = 20; flash = 1.0;
      boss._diePhase++;   // only fire this beat once
    }
    if (boss.dieT <= 0) winEarth();
    return;
  }
  boss.x = W/2 + Math.sin(fc*0.012)*70;
  // Wave progression — aliens fly out of the boss; once spent, the core is exposed.
  if (boss.state === 'waves' && aliens.length === 0 && asteroids.length === 0) {
    if (earthReinforce > 0) { earthReinforce--; spawnEarthWave(false); setBanner('MORE ALIENS LAUNCHING!', 150); }
    else { boss.state = 'vulnerable'; setBanner('BOSS CORE EXPOSED — BLAST IT!', 220); }
  }
  // The boss only attacks once its wave aliens are gone and the core is exposed (keeps it fair).
  if (boss.state === 'vulnerable') {
    boss.charge = Math.min(1, boss.charge + 0.02*k);
    boss.missileCd -= k;
    if (boss.missileCd <= 0) {
      boss.missileCd = BOSS_MISSILE_CD;
      const alive = aliveShips();
      if (alive.length) { for (let n = 0; n < 3; n++) spawnMissile(alive[n % alive.length].id, boss.x + (Math.random()-0.5)*60, boss.y + 30); playMissile(); }
    }
    boss.shotCd -= k;
    if (boss.shotCd <= 0) {
      boss.shotCd = BOSS_SHOT_CD;
      const tgt = nearestShip(boss.x, boss.y);
      if (tgt) { const a0 = Math.atan2(tgt.y-boss.y, tgt.x-boss.x); [-0.25,0,0.25].forEach(da => alienShots.push({ x: boss.x, y: boss.y+24, vx: Math.cos(a0+da)*2.4, vy: Math.sin(a0+da)*2.4, life: 320, kind:'hunter' })); playHunterShot(); }
    }
    updateBossBeam(k, dt);
  }
}

// Superlaser beam: telegraphed charge (reuses boss.charge, already driving the dish glow) → brief
// fire (locked aim angle, not homing — readable/dodgeable for kids) → cooldown. Fires only while
// the core is exposed. Damage goes through hitShip() same as every other hazard: capped, i-framed,
// never a hard kill.
function updateBossBeam(k, dt) {
  const dx = -BOSS_R*0.42, dy = -BOSS_R*0.42;   // dish offset, matches drawBoss()
  if (boss.beamState === 'idle') {
    if (boss.charge >= 1) { boss.beamState = 'charging'; boss.beamT = 0; }
  } else if (boss.beamState === 'charging') {
    boss.beamT += k;
    if (boss.beamT >= BOSS_BEAM_CHARGE_FR) {
      boss.beamState = 'firing'; boss.beamT = 0;
      const tgt = nearestShip(boss.x, boss.y);
      boss._beamAngle = tgt ? Math.atan2(H - boss.y, tgt.x - boss.x) : Math.PI/2;
      playHunterShot();
    }
  } else if (boss.beamState === 'firing') {
    boss.beamT += k;
    const ox = boss.x + dx, oy = boss.y + dy, a = boss._beamAngle;
    boss.beam = { x1: ox, y1: oy, x2: ox + Math.cos(a)*900, y2: oy + Math.sin(a)*900 };
    const dmg = BOSS_BEAM_DPS * (dt/1000);
    aliveShips().forEach(s => { if (s.invuln <= 0 && distToSeg(s.x, s.y, boss.beam.x1, boss.beam.y1, boss.beam.x2, boss.beam.y2) < SHIP_R + BOSS_BEAM_W) hitShip(s, dmg); });
    if (boss.beamT >= BOSS_BEAM_DUR) { boss.beamState = 'cooldown'; boss.beamT = 0; boss.beam = null; boss.charge = 0; }
  } else if (boss.beamState === 'cooldown') {
    boss.beamT += k;
    if (boss.beamT >= BOSS_BEAM_COOLDOWN) boss.beamState = 'idle';
  }
}

// ── Space stations on Earth (defend — no hard loss, drama + score) ──────────────
function updateStations(dt) {
  const k = dt/16.67;
  stations.forEach(s => { if (s.hp <= 0) s.smoke += k; });
  if (!stations.some(s => s.hp > 0)) return;   // city fully ruined — no further drama, no loss
  stationTimer += k;
  if (stationTimer >= STATION_DESTROY_FR) {
    stationTimer = 0;
    const hit = pick(stations.filter(s => s.hp > 0));
    hit.hp--; boom(hit.x, hit.y - hit.h*0.5, 30); playBoom('big'); shake = Math.min(16, shake + 8); flash = Math.max(flash, 0.4);
    ships.forEach(sh => { sh.score = Math.max(0, sh.score - STATION_PENALTY); }); upPanel();
    if (hit.hp <= 0) { hit.smoke = 0; boom(hit.x, hit.y - hit.h*0.4, 44);
      setBanner(stations.some(s => s.hp > 0) ? 'A city block fell! Defend the rest!' : 'The space city is in ruins — beat the boss!', 160); }
    else setBanner('The space city is under attack!', 110);
  }
}

// ── Ally NPC defenders (launch from the space city to help) ─────────────────────
function spawnAlly(fromX) {
  allies.push({ x: fromX, y: H - 60, vx: 0, vy: 0, hoverX: 150 + Math.random()*(W-300), hoverY: 300 + Math.random()*170, fireCd: Math.random()*40, col: '#bfe9ff' });
}
function nearestEnemy(x, y) {
  let best = null, bd = Infinity;
  aliens.forEach(al => { const d = dst(x,y,al.x,al.y); if (d < bd) { bd = d; best = { x: al.x, y: al.y }; } });
  if (!best && boss && boss.state === 'vulnerable') best = { x: boss.x, y: boss.y };
  return best;
}
function updateAllies(dt) {
  const k = dt/16.67;
  allies.forEach(a => {
    a.vx = lerp(a.vx, (a.hoverX - a.x)*0.04, 0.1*k); a.vy = lerp(a.vy, (a.hoverY - a.y)*0.04, 0.1*k);
    a.x += a.vx*k; a.y += a.vy*k;
    if (Math.random() < 0.005*k) { a.hoverX = 150 + Math.random()*(W-300); a.hoverY = 300 + Math.random()*180; }
    a.fireCd -= k;
    if (a.fireCd <= 0) {
      const tgt = nearestEnemy(a.x, a.y);
      if (tgt) { a.fireCd = 24 + Math.random()*16; const d = Math.hypot(tgt.x-a.x, tgt.y-a.y) || 1;
        bullets.push({ type:'bolt', x: a.x, y: a.y, vx: (tgt.x-a.x)/d*BOLT_SPD, vy: (tgt.y-a.y)/d*BOLT_SPD, owner: null, col: a.col, life: BOLT_LIFE, dmg: 2 }); }
      else a.fireCd = 24;
    }
  });
}
function drawAlly(a) {
  ctx.save(); ctx.translate(a.x, a.y);
  ctx.fillStyle = a.col; ctx.shadowColor = a.col; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(0,-9); ctx.lineTo(7,8); ctx.lineTo(0,4); ctx.lineTo(-7,8); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0,-1,2,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(120,255,160,0.95)'; ctx.fillRect(-1,-14,2,3);   // friendly marker
  ctx.restore();
}

// ── Aliens ──────────────────────────────────────────────────────────────────
const ALIEN_STATS = { grunt: GRUNT, hunter: HUNTER, gunner: GUNNER, seeker: SEEKER };
function spawnAlien(i, total, kind) {
  const stats = ALIEN_STATS[kind] || GRUNT;
  const aggressive = kind !== 'grunt';
  aliens.push({
    kind, x: (W/(total+1))*(i+1) + (Math.random()-0.5)*40, y: -40 - Math.random()*120,
    targetY: (aggressive ? 120 : 70) + Math.random()*150,
    phase: Math.random()*Math.PI*2,
    swaySpd: (aggressive ? 0.016 : 0.011) + Math.random()*0.011,
    swayAmp: 60 + Math.random()*70,
    hp: stats.hp, shotCd: 90 + Math.random()*140,
    baseX: 100 + Math.random()*(W-200),
  });
}

function damageAlien(al, dmg, owner) {
  al.hp -= dmg;
  const sc = { grunt:'#9bffd0', hunter:'#ffb070', gunner:'#7fe0ff', seeker:'#caa0ff' }[al.kind] || '#9bffd0';
  if (al.hp > 0) { sparks(al.x, al.y, sc); return; }
  const idx = aliens.indexOf(al); if (idx >= 0) aliens.splice(idx, 1);
  addScore(owner, (ALIEN_STATS[al.kind] || GRUNT).score);
  boom(al.x, al.y, al.kind==='grunt'?26:32); playBoom('big'); shake = Math.min(15, shake + 8);
  checkSectorClear();
}

function updateAliens(dt) {
  const k = dt/16.67;
  aliens.forEach(al => {
    al.phase += al.swaySpd*k;
    al.y = lerp(al.y, al.targetY, (al.kind==='hunter'?0.018:0.014)*k);
    if (al.kind === 'hunter') {
      const tgt = nearestShip(al.x, al.y);
      if (tgt) al.baseX = lerp(al.baseX, tgt.x, 0.006*k);   // slowly stalk
    }
    al.x = clamp(al.baseX + Math.sin(al.phase)*al.swayAmp, ALIEN_R, W-ALIEN_R);
    al.shotCd -= k;
    if (al.shotCd <= 0) {
      const tgt = nearestShip(al.x, al.y);
      if (al.kind === 'hunter') {
        al.shotCd = 150 + Math.random()*120;
        if (tgt) { const a0 = Math.atan2(tgt.y-al.y, tgt.x-al.x);
          [-0.32, 0, 0.32].forEach(da => alienShots.push({ x: al.x, y: al.y, vx: Math.cos(a0+da)*HUNTER_SHOT_SPD, vy: Math.sin(a0+da)*HUNTER_SHOT_SPD, life: 280, kind:'hunter' }));
          playHunterShot(); }
      } else if (al.kind === 'gunner') {
        al.shotCd = 150 + Math.random()*110;
        if (tgt) {
          const a0 = Math.atan2(tgt.y-al.y, tgt.x-al.x);
          const tri = Math.random() < 0.5;
          const col = tri ? '#c08bff' : '#5be0ff';                 // violet=tri, cyan=double (match player guns)
          const spread = tri ? [-0.4, 0, 0.4] : [-0.16, 0.16];
          spread.forEach(da => alienShots.push({ x: al.x, y: al.y, vx: Math.cos(a0+da)*GUNNER_SHOT_SPD, vy: Math.sin(a0+da)*GUNNER_SHOT_SPD, life: 300, kind:'gunner', col }));
          playHunterShot();
        }
      } else if (al.kind === 'seeker') {
        al.shotCd = 220 + Math.random()*120;
        if (tgt) { spawnMissile(tgt.id, al.x, al.y); playMissile(); }
      } else {
        al.shotCd = 130 + Math.random()*140;
        if (tgt) { const dx = tgt.x-al.x, dy = tgt.y-al.y, d = Math.hypot(dx,dy)||1;
          alienShots.push({ x: al.x, y: al.y, vx: dx/d*ALIEN_SHOT_SPD, vy: dy/d*ALIEN_SHOT_SPD, life: 280, kind:'grunt' });
          playAlienShot(); }
      }
    }
  });
}

function nearestShip(x, y) {
  let best = null, bd = Infinity;
  aliveShips().forEach(s => { const d = dst(x,y,s.x,s.y); if (d < bd) { bd = d; best = s; } });
  return best;
}

function updateAlienShots(dt) {
  const k = dt/16.67;
  for (let i = alienShots.length-1; i >= 0; i--) {
    const b = alienShots[i];
    b.x += b.vx*k; b.y += b.vy*k; b.life -= k;
    if (b.life <= 0 || b.x < -20 || b.x > W+20 || b.y < -20 || b.y > H+20) { alienShots.splice(i,1); continue; }
    for (const s of aliveShips()) if (s.invuln <= 0 && dst(b.x,b.y,s.x,s.y) < SHIP_R+4) { alienShots.splice(i,1); hitShip(s, DMG_ALIEN_SHOT); break; }
  }
}

// ── Heatseeker missiles ───────────────────────────────────────────────────────
function spawnMissile(targetId, x, y) {
  const tgt = ships[targetId];
  const a = tgt ? Math.atan2(tgt.y - y, tgt.x - x) : Math.PI/2;
  missiles.push({ x, y, vx: Math.cos(a)*MISSILE_SPD, vy: Math.sin(a)*MISSILE_SPD, target: targetId, hp: 1, life: MISSILE_LIFE, col: ships[targetId] ? ships[targetId].col : '#fff' });
}
function destroyMissile(m, owner) {
  const idx = missiles.indexOf(m); if (idx >= 0) missiles.splice(idx, 1);
  boom(m.x, m.y, 16); if (owner != null) addScore(owner, 3);
}
function updateMissiles(dt) {
  const k = dt/16.67;
  for (let i = missiles.length-1; i >= 0; i--) {
    const m = missiles[i]; m.life -= k;
    const tgt = ships[m.target];
    if (tgt && tgt.alive) {
      // Steer toward the target, capped turn rate.
      const want = Math.atan2(tgt.y - m.y, tgt.x - m.x);
      let cur = Math.atan2(m.vy, m.vx);
      let d = want - cur; while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2;
      cur += clamp(d, -MISSILE_TURN*k, MISSILE_TURN*k);
      m.vx = Math.cos(cur)*MISSILE_SPD; m.vy = Math.sin(cur)*MISSILE_SPD;
    }
    m.x += m.vx*k; m.y += m.vy*k;
    if (fc % 2 === 0) particles.push({ x: m.x - m.vx*2, y: m.y - m.vy*2, vx:(Math.random()-0.5), vy:(Math.random()-0.5), r: 2+Math.random()*2, life: 1, decay: 0.09, col: '#ff8a3a' });
    if (m.life <= 0 || m.x < -30 || m.x > W+30 || m.y < -30 || m.y > H+30) { missiles.splice(i,1); continue; }
    if (tgt && tgt.alive && tgt.invuln <= 0 && dst(m.x, m.y, tgt.x, tgt.y) < SHIP_R + 5) { missiles.splice(i,1); hitShip(tgt, DMG_MISSILE); }
  }
}

// ── Comets (race dodge hazards) ────────────────────────────────────────────────
function spawnComet() {
  const x = 40 + Math.random()*(W-80);
  const a = Math.PI/2 + (Math.random()-0.5)*0.7;
  comets.push({ x, y: -30, vx: Math.cos(a)*COMET_SPD, vy: Math.sin(a)*COMET_SPD, r: COMET_R, tail: [] });
}
function updateComets(dt) {
  const k = dt/16.67;
  for (let i = comets.length-1; i >= 0; i--) {
    const c = comets[i];
    c.tail.unshift({ x: c.x, y: c.y }); if (c.tail.length > 8) c.tail.pop();
    c.x += c.vx*k; c.y += c.vy*k;
    if (c.y > H + 40 || c.x < -40 || c.x > W + 40) { comets.splice(i,1); continue; }
    for (const s of aliveShips()) if (s.invuln <= 0 && dst(c.x, c.y, s.x, s.y) < c.r + SHIP_R) { hitShip(s, DMG_ASTEROID); break; }
  }
}

// ── Score / shields ───────────────────────────────────────────────────────────
function addScore(owner, pts) { const s = ships[owner]; if (s) s.score += pts; upPanel(); }

function hitShip(t, dmg) {
  if (!t.alive || t.invuln > 0) return;
  t.shields = Math.max(0, t.shields - (dmg || 1));
  t.invuln = HIT_IFRAMES; sparks(t.x, t.y, t.col); shake = Math.min(12, shake + 5); playHit();
  if (t.shields <= 0) killShip(t);
  upPanel();
}
function killShip(t) {
  t.alive = false; t.respawn = RESPAWN_FR; t.beam = null; t.beamActive = false; t.landed = false;
  boom(t.x, t.y, 30); playBoom('big'); shake = Math.min(16, shake + 11);
  setBanner(`${t.name} GOES DOWN — hang on, respawning!`, 130); upPanel();
}
function respawnShip(t) {
  t.alive = true; t.shields = RESPAWN_SHIELDS; t.invuln = RESPAWN_IFRAMES;
  t.x = W*0.5 + (t.id === 0 ? -70 : 70); t.y = H*0.84; t.vx = 0; t.vy = 0; upPanel();
}

// ── Particles ─────────────────────────────────────────────────────────────────
function boom(cx, cy, r) {
  const n = ASTEROID_BURST === 'dust' ? 22 : 16;
  for (let i = 0; i < n; i++) {
    const a = Math.random()*Math.PI*2, s = (ASTEROID_BURST === 'dust' ? 1 : 2.5) + Math.random()*(r/8);
    particles.push({ x: cx, y: cy, vx: Math.cos(a)*s, vy: Math.sin(a)*s, r: (ASTEROID_BURST === 'dust' ? 2 : 3) + Math.random()*(r/9), life: 1, decay: 0.018 + Math.random()*0.02, col: ASTEROID_BURST === 'dust' ? '#b9c2d8' : ['#ffcf6b','#ff7a3a','#e8dcc0','#9a8366'][(Math.random()*4)|0] });
  }
}
function sparks(cx, cy, col) {
  for (let i = 0; i < 8; i++) { const a = Math.random()*Math.PI*2, s = 2+Math.random()*4; particles.push({ x: cx, y: cy, vx: Math.cos(a)*s, vy: Math.sin(a)*s, r: 2+Math.random()*2, life: 1, decay: 0.05, col }); }
}
function updatePfx() {
  for (let i = particles.length-1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.97; p.vy *= 0.97; p.life -= p.decay; p.r *= 0.975; if (p.life <= 0) particles.splice(i,1); }
}

// ── Ship update + weapons ──────────────────────────────────────────────────────
function applyMovement(t, k) {
  const c = t.controls; let tx = 0, ty = 0;
  if (keys[c.left]) tx -= 1; if (keys[c.right]) tx += 1; if (keys[c.up]) ty -= 1; if (keys[c.down]) ty += 1;
  if (tx || ty) { const m = Math.hypot(tx,ty); tx/=m; ty/=m; t.face.x = tx; t.face.y = ty; }
  const sp = phase === 'docking' ? SHIP_SPEED*0.5 : SHIP_SPEED;   // careful, slow approach when docking
  t.vx = lerp(t.vx, tx*sp, SHIP_ACCEL*k); t.vy = lerp(t.vy, ty*sp, SHIP_ACCEL*k);
  t.x = clamp(t.x + t.vx*k, SHIP_R, W-SHIP_R); t.y = clamp(t.y + t.vy*k, SHIP_R, H-SHIP_R);
  if ((tx || ty) && fc % 2 === 0) particles.push({ x: t.x - t.face.x*14, y: t.y - t.face.y*14, vx: -t.face.x*1.2 + (Math.random()-0.5), vy: -t.face.y*1.2 + (Math.random()-0.5), r: 2+Math.random()*2, life: 1, decay: 0.08, col: t.col });
}

function updateShip(t, dt) {
  const k = dt/16.67;
  if (!t.alive) { t.respawn -= k; if (t.respawn <= 0) respawnShip(t); return; }
  if (t.invuln > 0) t.invuln -= k;
  t.beamActive = false;

  if (phase === 'fighting' || phase === 'race') {
    applyMovement(t, k);
    if (t.weapon === 'beam') { t.beamActive = firePressed(t); if (t.beamActive) fireBeam(t, dt); else t.beam = null; }
    else { t.beam = null; if (t.fireCd > 0) t.fireCd -= k; if (firePressed(t) && t.fireCd <= 0) { fireWeapon(t); t.fireCd = WEAPON_CD[t.weapon] || 14; } }
    return;
  }
  // Base intermission
  t.beam = null;
  if (t.landed) { t.vx = 0; t.vy = 0; if (phase === 'gearup') updateGearupSelect(t); return; }
  if (phase === 'baseIncoming' || phase === 'docking') applyMovement(t, k);
  else { t.vx = 0; t.vy = 0; }
}

function updateGearupSelect(t) {
  const c = t.controls;
  const l = !!keys[c.left], r = !!keys[c.right], u = !!keys[c.up], d = !!keys[c.down];
  // ← / →  cycle the WEAPON (override the random gun you were handed)
  if (l && !t._le) { setWeapon(t, WEAPONS[(t.weaponIdx + WEAPONS.length - 1) % WEAPONS.length]); playSelect(); upPanel(); }
  if (r && !t._re) { setWeapon(t, WEAPONS[(t.weaponIdx + 1) % WEAPONS.length]); playSelect(); upPanel(); }
  // ↑ / ↓  cycle the SHIP
  if (u && !t._ue) { setModel(t, SHIP_MODELS[(t.modelIdx + SHIP_MODELS.length - 1) % SHIP_MODELS.length]); playSelect(); }
  if (d && !t._de) { setModel(t, SHIP_MODELS[(t.modelIdx + 1) % SHIP_MODELS.length]); playSelect(); }
  t._le = l; t._re = r; t._ue = u; t._de = d;
}

function fireWeapon(t) {
  const f = t.face;
  if (t.weapon === 'dots') { pushBolt(t, f, 0, BOLT_DMG); playBlast(); }
  else if (t.weapon === 'double') { const px = -f.y, py = f.x; pushBolt(t, f, DOUBLE_OFFSET, DOUBLE_DMG, px, py); pushBolt(t, f, -DOUBLE_OFFSET, DOUBLE_DMG, px, py); playBlast(); }
  else if (t.weapon === 'tri') { const a0 = Math.atan2(f.y, f.x); [-TRI_SPREAD, 0, TRI_SPREAD].forEach(da => pushBolt(t, { x: Math.cos(a0+da), y: Math.sin(a0+da) }, 0, TRI_DMG)); playBlast(); }
  else if (t.weapon === 'shock') { bullets.push({ type:'shock', x: t.x + f.x*SHIP_R, y: t.y + f.y*SHIP_R, vx: f.x*SHOCK_SPD, vy: f.y*SHOCK_SPD, r: 8, prevR: 0, owner: t.id, col: '#5bd9ff' }); playShock(); }
  else if (t.weapon === 'grenade') { bullets.push({ type:'grenade', x: t.x + f.x*SHIP_R, y: t.y + f.y*SHIP_R, vx: f.x*GREN_SPD, vy: f.y*GREN_SPD, traveled: 0, owner: t.id, col: '#ff9a3a' }); playGrenade(); }
}

function pushBolt(t, dir, off, dmg, px, py) {
  px = px === undefined ? -dir.y : px; py = py === undefined ? dir.x : py;
  bullets.push({ type:'bolt', x: t.x + dir.x*SHIP_R + px*off, y: t.y + dir.y*SHIP_R + py*off, vx: dir.x*BOLT_SPD, vy: dir.y*BOLT_SPD, owner: t.id, col: t.col, life: BOLT_LIFE, dmg });
}

function fireBeam(t, dt) {
  const len = 1200;
  const x1 = t.x + t.face.x*SHIP_R, y1 = t.y + t.face.y*SHIP_R, x2 = t.x + t.face.x*len, y2 = t.y + t.face.y*len;
  t.beam = { x1, y1, x2, y2 };
  const dmg = BEAM_DPS * (dt/1000);
  for (let i = asteroids.length-1; i >= 0; i--) { const a = asteroids[i]; if (distToSeg(a.x,a.y,x1,y1,x2,y2) < a.r + BEAM_W) damageAsteroid(a, dmg, t.id); }
  for (let i = aliens.length-1; i >= 0; i--)    { const al = aliens[i];  if (distToSeg(al.x,al.y,x1,y1,x2,y2) < ALIEN_R + BEAM_W) damageAlien(al, dmg, t.id); }
  for (let i = missiles.length-1; i >= 0; i--)  { const m = missiles[i];  if (distToSeg(m.x,m.y,x1,y1,x2,y2) < MISSILE_R + BEAM_W) destroyMissile(m, t.id); }
  if (boss && boss.state === 'vulnerable' && distToSeg(boss.x,boss.y,x1,y1,x2,y2) < BOSS_R + BEAM_W) damageBoss(dmg, t.id);
}

function detonate(x, y, owner) {
  boom(x, y, GREN_R); boom(x, y, GREN_R*0.6); playBoom('big'); shake = Math.min(18, shake + 13);
  for (let i = asteroids.length-1; i >= 0; i--) { const a = asteroids[i]; if (dst(x,y,a.x,a.y) < GREN_R + a.r) damageAsteroid(a, GREN_DMG, owner); }
  for (let i = aliens.length-1; i >= 0; i--)    { const al = aliens[i];  if (dst(x,y,al.x,al.y) < GREN_R + ALIEN_R) damageAlien(al, GREN_DMG, owner); }
  for (let i = missiles.length-1; i >= 0; i--)  { const m = missiles[i];  if (dst(x,y,m.x,m.y) < GREN_R) destroyMissile(m, owner); }
  if (boss && boss.state === 'vulnerable' && dst(x,y,boss.x,boss.y) < GREN_R + BOSS_R) damageBoss(GREN_DMG, owner);
}

function updateBullets(dt) {
  const k = dt/16.67;
  for (let i = bullets.length-1; i >= 0; i--) {
    const b = bullets[i];
    if (b.type === 'shock') {
      b.x += b.vx*k; b.y += b.vy*k; b.prevR = b.r; b.r += SHOCK_GROW*k;
      for (let j = asteroids.length-1; j >= 0; j--) { const a = asteroids[j]; const d = dst(b.x,b.y,a.x,a.y); if (d <= b.r && d > b.prevR) damageAsteroid(a, SHOCK_DMG, b.owner); }
      for (let j = aliens.length-1; j >= 0; j--)    { const al = aliens[j];  const d = dst(b.x,b.y,al.x,al.y); if (d <= b.r && d > b.prevR) damageAlien(al, SHOCK_DMG, b.owner); }
      for (let j = missiles.length-1; j >= 0; j--)  { const m = missiles[j]; const d = dst(b.x,b.y,m.x,m.y); if (d <= b.r && d > b.prevR) destroyMissile(m, b.owner); }
      if (boss && boss.state === 'vulnerable') { const bd = dst(b.x,b.y,boss.x,boss.y) - BOSS_R; if (bd <= b.r && bd > b.prevR) damageBoss(SHOCK_DMG, b.owner); }
      if (b.r >= SHOCK_MAXR) bullets.splice(i,1);
      continue;
    }
    if (b.type === 'grenade') {
      b.x += b.vx*k; b.y += b.vy*k; b.traveled += GREN_SPD*k;
      let blew = false;
      for (const a of asteroids) if (dst(b.x,b.y,a.x,a.y) < a.r + 8) { blew = true; break; }
      if (!blew) for (const al of aliens) if (dst(b.x,b.y,al.x,al.y) < ALIEN_R + 8) { blew = true; break; }
      if (blew || b.traveled >= GREN_RANGE || b.x<-20||b.x>W+20||b.y<-20||b.y>H+20) {
        if (b.x>-20&&b.x<W+20&&b.y>-20&&b.y<H+20) detonate(b.x, b.y, b.owner);
        bullets.splice(i,1);
      }
      continue;
    }
    b.x += b.vx*k; b.y += b.vy*k; b.life -= k;
    if (b.life <= 0 || b.x<-20||b.x>W+20||b.y<-20||b.y>H+20) { bullets.splice(i,1); continue; }
    let hit = false;
    for (let j = asteroids.length-1; j >= 0; j--) { const a = asteroids[j]; if (dst(b.x,b.y,a.x,a.y) < a.r + BOLT_R) { damageAsteroid(a, b.dmg, b.owner); hit = true; break; } }
    if (!hit) for (let j = aliens.length-1; j >= 0; j--) { const al = aliens[j]; if (dst(b.x,b.y,al.x,al.y) < ALIEN_R + BOLT_R) { damageAlien(al, b.dmg, b.owner); hit = true; break; } }
    if (!hit) for (let j = missiles.length-1; j >= 0; j--) { const m = missiles[j]; if (dst(b.x,b.y,m.x,m.y) < MISSILE_R + BOLT_R) { destroyMissile(m, b.owner); hit = true; break; } }
    if (!hit && boss && boss.state === 'vulnerable' && dst(b.x,b.y,boss.x,boss.y) < BOSS_R + BOLT_R) { damageBoss(b.dmg, b.owner); hit = true; }
    if (hit) bullets.splice(i,1);
  }
}

function checkShipContact() {
  aliveShips().forEach(t => {
    if (t.invuln > 0) return;
    for (const a of asteroids) if (dst(a.x,a.y,t.x,t.y) < a.r + SHIP_R) {
      const dx = t.x-a.x, dy = t.y-a.y, d = Math.hypot(dx,dy)||1;
      t.vx = dx/d*6; t.vy = dy/d*6; a.vx = -dx/d*0.8; a.vy = -dy/d*0.8; hitShip(t, DMG_ASTEROID); return;
    }
    for (const al of aliens) if (dst(al.x,al.y,t.x,t.y) < ALIEN_R + SHIP_R) { hitShip(t, DMG_ALIEN_BODY); return; }
  });
}

// ── Moon base / docking / gear-up / map / warp ─────────────────────────────────
function landStripX(t) { return base.x + (t.id === 0 ? -STRIP_DX : STRIP_DX); }
function landSlot(t) { return { x: landStripX(t), y: base.y + 8 }; }
// A ship docks by steering up its own narrow strip and reaching the pad near the base.
function tryDock(t) {
  const sx = landStripX(t);
  return Math.abs(t.x - sx) < STRIP_HALF && t.y < base.y + 24 && t.y > base.y - 26;
}

function rechargeLanded(k) {
  aliveShips().forEach(t => {
    if (t.landed && t.shields < MAX_SHIELDS) { t._rc += k; if (t._rc >= RECHARGE_FR) { t._rc = 0; t.shields = Math.min(MAX_SHIELDS, t.shields + 1); playRecharge(); sparks(t.x, t.y, '#9bf'); upPanel(); } }
  });
}

function assignWeapons() {
  // Each ship gets a fresh random weapon, different from its last and from the other ship.
  let w0 = pick(WEAPONS.filter(w => w !== ships[0].weapon)) || pick(WEAPONS);
  let w1 = pick(WEAPONS.filter(w => w !== ships[1].weapon && w !== w0)) || pick(WEAPONS.filter(w => w !== w0));
  setWeapon(ships[0], w0); setWeapon(ships[1], w1); upPanel();
}

function selectableSectors() { const out = []; for (let i = 0; i < NORMAL_SECTORS; i++) if (!sectors[i].cleared) out.push(i); return out; }
function firstSelectable() { const s = selectableSectors(); return s.length ? s[0] : 0; }

function updateBase(dt) {
  const k = dt/16.67;
  if (phase === 'baseIncoming') {
    base.y = lerp(base.y, BASE_PARK_Y, 0.04*k);
    if (base.y > BASE_PARK_Y - 1.5) { base.y = BASE_PARK_Y; base.parked = true; phase = 'docking'; phaseTimer = 0; }
  } else if (phase === 'docking') {
    phaseTimer += k; base.blink += k;
    aliveShips().forEach(t => {
      if (!t.landed && tryDock(t)) { t.landed = true; const s = landSlot(t); t.x = s.x; t.y = s.y; t.vx = 0; t.vy = 0; playRecharge(); }
    });
    rechargeLanded(k);
    const alive = aliveShips();
    if ((alive.length > 0 && alive.every(t => t.landed)) || phaseTimer > LAND_TIMEOUT) {
      assignWeapons(); phase = 'gearup'; phaseTimer = 0; ships.forEach(s => { s._le = true; s._re = true; s._ue = true; s._de = true; });
      setBanner('NEW GUN!  ← → gun   ↑ ↓ ship', 150);
    }
  } else if (phase === 'gearup') {
    phaseTimer += k; base.blink += k; rechargeLanded(k);
    if (phaseTimer >= GEARUP_FR) {
      if (normalCleared() >= NORMAL_SECTORS) {
        // All normal sectors done → finale: warp into the asteroid-field race.
        curSector = RACE_IDX; phase = 'warping'; phaseTimer = 0; warpRocks = [];
        setBanner('FINAL APPROACH — INTO THE ASTEROID FIELD!', WARP_FR); playWarp();
      } else {
        phase = 'map'; phaseTimer = 0; mapCursor = firstSelectable(); mLE = mRE = mFE = true;
      }
    }
  } else if (phase === 'map') {
    phaseTimer += k;
    handleMapInput();
    if (phaseTimer > MAP_TIMEOUT) confirmMap();
  } else if (phase === 'warping') {
    phaseTimer += k; base.y += 6*k; scrollSpd = lerp(scrollSpd, 16, 0.08*k);
    if (fc % 4 === 0) warpRocks.push({ x: Math.random()*W, y: -40, r: 8+Math.random()*26, spd: 14+Math.random()*16, ang: Math.random()*6.28 });
    warpRocks.forEach(w => { w.y += w.spd*k; w.ang += 0.1*k; });
    warpRocks = warpRocks.filter(w => w.y < H + 60);
    if (phaseTimer >= WARP_FR) { scrollSpd = 0.6; startSector(curSector); }
  }
}

function unclearedList() { const out = []; for (let i = 0; i < TOTAL_SECTORS; i++) if (!sectors[i].cleared) out.push(i); return out; }

function handleMapInput() {
  const left  = !!(keys['KeyA'] || keys['ArrowLeft']);
  const right = !!(keys['KeyD'] || keys['ArrowRight']);
  const fire  = !!(keys['Space'] || keys['Enter']);
  const list = selectableSectors();
  if (list.length) {
    let pos = list.indexOf(mapCursor); if (pos < 0) { mapCursor = list[0]; pos = 0; }
    if (left && !mLE)  { mapCursor = list[(pos + list.length - 1) % list.length]; playSelect(); }
    if (right && !mRE) { mapCursor = list[(pos + 1) % list.length]; playSelect(); }
  }
  if (fire && !mFE) confirmMap();
  mLE = left; mRE = right; mFE = fire;
}

function confirmMap() {
  const list = selectableSectors();
  if (!list.length) return;
  if (!list.includes(mapCursor)) mapCursor = list[0];
  curSector = mapCursor;
  phase = 'warping'; phaseTimer = 0; warpRocks = [];
  setBanner(`WARP! → SECTOR ${curSector+1}`, WARP_FR); playWarp();
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let lastTs = null;
function loop(ts) {
  const dt = lastTs ? Math.min(ts-lastTs, 50) : 16; lastTs = ts; fc++;
  ships.forEach(t => updateShip(t, dt));
  if (phase === 'fighting') {
    updateAsteroids(dt); updateAliens(dt); updateAlienShots(dt); updateMissiles(dt); updateBullets(dt); checkShipContact();
    if (isEarth(curSector)) { updateBoss(dt); updateStations(dt); updateAllies(dt); }
  }
  else if (phase === 'race') { updateRace(dt); updateAsteroids(dt); updateComets(dt); updateBullets(dt); checkShipContact(); }
  else if (phase === 'travel') { updateTravel(dt); updateBullets(dt); }
  else { updateBullets(dt); if (base && phase !== 'won') updateBase(dt); }
  updatePfx();
  if (bannerTimer > 0) bannerTimer -= dt/16.67;
  if (shake > 0) shake = Math.max(0, shake - dt*0.04);
  if (flash > 0) flash = Math.max(0, flash - dt*0.004);
  beamSound(ships.some(s => s.alive && s.weapon === 'beam' && s.beamActive));
  render();
  requestAnimationFrame(loop);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0,0,W,H);
  ctx.save();
  if (shake > 0.3) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
  drawSpace();
  if (stations.length) drawStations();
  if (phase === 'warping') drawWarpRocks();
  if (base) drawBase();
  if (boss) drawBoss();
  if (decorStar) drawDecorDeathStar();
  asteroids.forEach(drawAsteroid);
  comets.forEach(drawComet);
  aliens.forEach(drawAlien);
  alienShots.forEach(drawAlienShot);
  missiles.forEach(drawMissile);
  bullets.forEach(drawBullet);
  ships.forEach(t => { if (t.weapon === 'beam' && t.beam) drawBeam(t); });
  drawPfx();
  allies.forEach(drawAlly);
  ships.forEach(drawShip);
  if (phase === 'gearup') ships.forEach(t => { if (t.alive && t.landed) drawGearup(t); });
  ctx.restore();
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash*0.5})`; ctx.fillRect(0,0,W,H); }
  drawHUD();
  if (phase === 'race') drawRaceHUD();
  if (phase === 'map') drawMap();
  if (phase === 'won') drawWon();
}

function drawRaceHUD() {
  const x = W - 26, y0 = 70, h = H - 160;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(x-8, y0-8, 16, h+16, 6); ctx.fill();
  ctx.fillStyle = 'rgba(120,200,255,0.25)'; rr(x-5, y0, 10, h, 4); ctx.fill();
  const p = clamp(raceProgress, 0, 1);
  ctx.fillStyle = '#7dff9c'; rr(x-5, y0 + h*(1-p), 10, h*p, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
  ctx.fillText('🌍', x, y0 - 12); ctx.fillText(Math.floor(p*100)+'%', x, y0 + h + 22);
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 12px Arial';
  ctx.fillText('SECTOR 11 — DODGE UP THROUGH THE FIELD!', W/2, 24);
  ctx.textAlign = 'left';
}

function drawEarth() {
  // Big home planet curving along the bottom — "low orbit" look.
  const cx = W/2, cy = H + 250, r = 430;
  const g = ctx.createRadialGradient(cx - 120, cy - 160, 60, cx, cy, r);
  g.addColorStop(0, '#6fb6ff'); g.addColorStop(0.55, '#2f6fc0'); g.addColorStop(1, '#123a78');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
  // Land masses
  ctx.fillStyle = 'rgba(60,160,90,0.85)';
  [[-150,-150,70,34],[40,-185,90,40],[210,-120,60,30],[-40,-120,40,22]].forEach(([dx,dy,rx,ry]) => {
    ctx.beginPath(); ctx.ellipse(cx+dx, cy+dy, rx, ry, 0.3, 0, Math.PI*2); ctx.fill();
  });
  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 7; i++) { const a = i*0.7 + fc*0.0015; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a)*300, cy - 175 + Math.sin(a)*60, 46, 16, 0, 0, Math.PI*2); ctx.fill(); }
  // Atmosphere rim glow
  ctx.strokeStyle = 'rgba(150,210,255,0.5)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(cx, cy, r+3, Math.PI*1.15, Math.PI*1.85); ctx.stroke();
}

function drawRaceBg() {
  // Destination planet ahead (top) you're racing toward.
  const cx = W/2, cy = -40, r = 170, hue = sectorBg.destHue;
  const g = ctx.createRadialGradient(cx - 50, cy + 40, 30, cx, cy, r);
  g.addColorStop(0, `hsl(${hue},55%,60%)`); g.addColorStop(1, `hsl(${hue},55%,28%)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = `hsla(${hue},70%,80%,0.4)`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(cx, cy, r*1.6, r*0.4, 0.2, 0, Math.PI*2); ctx.stroke();
}

function drawSpace() {
  ctx.fillStyle = '#05060f'; ctx.fillRect(0,0,W,H);
  if (sectorBg && sectorBg.kind === 'earth') drawEarth();
  if (sectorBg && sectorBg.kind === 'race')  drawRaceBg();
  if (sectorBg && sectorBg.kind === 'normal') {
    sectorBg.nebulas.forEach(nb => {
      const g = ctx.createRadialGradient(nb.x, nb.y, 10, nb.x, nb.y, nb.r);
      g.addColorStop(0, `hsla(${nb.hue},70%,55%,0.20)`); g.addColorStop(0.5, `hsla(${nb.hue},70%,45%,0.10)`); g.addColorStop(1, 'rgba(5,6,15,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nb.x, nb.y, nb.r, 0, Math.PI*2); ctx.fill();
    });
    if (sectorBg.planet) {
      const p = sectorBg.planet;
      const g = ctx.createRadialGradient(p.x - p.r*0.3, p.y - p.r*0.3, p.r*0.2, p.x, p.y, p.r);
      g.addColorStop(0, `hsl(${p.hue},45%,62%)`); g.addColorStop(1, `hsl(${p.hue},50%,26%)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = `hsla(${p.hue},60%,75%,0.35)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r*1.5, p.r*0.42, -0.4, 0, Math.PI*2); ctx.stroke();
    }
  }
  const warping = phase === 'warping';
  stars.forEach(s => {
    s.y += scrollSpd * s.depth; if (s.y > H) { s.y = 0; s.x = Math.random()*W; }
    if (warping) { ctx.strokeStyle = `rgba(150,180,255,${0.5*s.depth})`; ctx.lineWidth = s.r; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - scrollSpd*s.depth*2.2); ctx.stroke(); }
    else { const a = 0.4 + 0.6*Math.abs(Math.sin(fc*0.03 + s.tw)); ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); }
  });
}

function drawWarpRocks() {
  warpRocks.forEach(w => {
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.ang);
    ctx.fillStyle = 'rgba(120,110,100,0.25)'; ctx.fillRect(-w.r*0.5, -w.r, w.r, w.r*3);
    ctx.fillStyle = '#6f6253'; ctx.beginPath(); ctx.arc(0, 0, w.r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(w.r*0.2, -w.r*0.2, w.r*0.3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

function drawAsteroid(a) {
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.ang);
  ctx.beginPath();
  a.lumps.forEach((lp, i) => { const ang = (i/a.lumps.length)*Math.PI*2, rr2 = a.r*lp; const px = Math.cos(ang)*rr2, py = Math.sin(ang)*rr2; i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
  ctx.closePath(); ctx.fillStyle = '#6f6253'; ctx.fill(); ctx.strokeStyle = '#3c352b'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.arc(a.r*0.2,-a.r*0.15,a.r*0.22,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(-a.r*0.3,a.r*0.25,a.r*0.16,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawAlien(al) {
  const hunter = al.kind === 'hunter';
  ctx.save(); ctx.translate(al.x, al.y);
  if (al.kind === 'gunner') {
    ctx.fillStyle = '#2f5a66'; ctx.beginPath(); ctx.ellipse(0, 3, ALIEN_R+1, ALIEN_R*0.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#16323a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#1a3a42'; ctx.fillRect(-9, 6, 4, 7); ctx.fillRect(5, 6, 4, 7);            // twin barrels
    ctx.fillStyle = '#5be0ff'; ctx.shadowColor = '#5be0ff'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(0, -2, ALIEN_R*0.5, Math.PI, 0); ctx.fill(); ctx.shadowBlur = 0;
    for (let i = 0; i < al.hp; i++) { ctx.fillStyle = '#7fe0ff'; ctx.fillRect(-Math.min(al.hp,5)*2.5 + i*5, -ALIEN_R-5, 3, 2); }
    ctx.restore(); return;
  }
  if (al.kind === 'seeker') {
    ctx.fillStyle = '#3a2f5a'; ctx.beginPath(); ctx.ellipse(0, 3, ALIEN_R+1, ALIEN_R*0.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#1f1633'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#c0392b'; ctx.fillRect(-10, 5, 3, 6); ctx.fillRect(7, 5, 3, 6);            // missile tips
    ctx.fillStyle = '#caa0ff'; ctx.shadowColor = '#caa0ff'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(0, -2, ALIEN_R*0.5, Math.PI, 0); ctx.fill(); ctx.shadowBlur = 0;
    for (let i = 0; i < al.hp; i++) { ctx.fillStyle = '#caa0ff'; ctx.fillRect(-Math.min(al.hp,5)*2.5 + i*5, -ALIEN_R-5, 3, 2); }
    ctx.restore(); return;
  }
  if (hunter) {
    // Spiky red warship
    ctx.fillStyle = '#7a2630';
    ctx.beginPath(); ctx.ellipse(0, 3, ALIEN_R+2, ALIEN_R*0.55, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#3a1016'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#3a1016';
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i*6, 6); ctx.lineTo(i*6-2, 12); ctx.lineTo(i*6+2, 12); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = '#ff5a3c'; ctx.shadowColor = '#ff5a3c'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0, -1, ALIEN_R*0.5, Math.PI, 0); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();
    for (let i = 0; i < al.hp; i++) { ctx.fillStyle = '#ff7a5a'; ctx.fillRect(-Math.min(al.hp,5)*2.5 + i*5, -ALIEN_R-6, 3, 2); }
  } else {
    ctx.fillStyle = '#4a5568'; ctx.beginPath(); ctx.ellipse(0, 4, ALIEN_R, ALIEN_R*0.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#2a3040'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#7affc0'; ctx.shadowColor = '#7affc0'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(0, -2, ALIEN_R*0.5, Math.PI, 0); ctx.fill(); ctx.shadowBlur = 0;
    const bl = 0.5 + 0.5*Math.sin(fc*0.2 + al.x*0.1); ctx.fillStyle = `rgba(255,80,120,${0.4+bl*0.6})`;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i*8, 7, 1.8, 0, Math.PI*2); ctx.fill(); }
    for (let i = 0; i < al.hp; i++) { ctx.fillStyle = '#7affc0'; ctx.fillRect(-6 + i*5, -ALIEN_R-4, 3, 2); }
  }
  ctx.restore();
}

function drawAlienShot(b) {
  const col = b.col || (b.kind === 'hunter' ? '#ffb02e' : '#ff6a86');
  ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.kind === 'grunt' ? 4 : 5, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
}

function drawMissile(m) {
  const ang = Math.atan2(m.vy, m.vx);
  ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(ang);
  ctx.strokeStyle = m.col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.55 + 0.45*Math.sin(fc*0.4);  // target-colored lock
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI*2); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = '#d8dde6'; rr(-6, -3, 12, 6, 2); ctx.fill();
  ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(7,0); ctx.lineTo(2,-3); ctx.lineTo(2,3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#888'; ctx.beginPath(); ctx.moveTo(-6,-3); ctx.lineTo(-10,-5); ctx.lineTo(-6,0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6,3); ctx.lineTo(-10,5); ctx.lineTo(-6,0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,160,60,${0.6+0.4*Math.random()})`; ctx.beginPath(); ctx.moveTo(-6,-2); ctx.lineTo(-13-Math.random()*4,0); ctx.lineTo(-6,2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawComet(c) {
  for (let i = c.tail.length-1; i >= 0; i--) { const t = c.tail[i], a = 1 - i/c.tail.length; ctx.fillStyle = `rgba(150,220,255,${a*0.5})`; ctx.beginPath(); ctx.arc(t.x, t.y, c.r*(0.3+a*0.6), 0, Math.PI*2); ctx.fill(); }
  ctx.shadowColor = '#bfe9ff'; ctx.shadowBlur = 16; ctx.fillStyle = '#eaf7ff'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#9fd8ff'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r*0.6, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
}

// Shared sphere rendering (gradient, panel lines, trench, craters) — used by both the real combat
// boss (drawBoss) and the decorative sectors-2/3 Death Star (drawDecorDeathStar). Pure visuals,
// no combat/HP/state reads, so it's safe to reuse for the non-combat decorative version.
function drawDeathStarSphere(R) {
  const g = ctx.createRadialGradient(-R*0.35, -R*0.35, R*0.2, 0, 0, R);
  g.addColorStop(0, '#b9c0cc'); g.addColorStop(0.6, '#7c8493'); g.addColorStop(1, '#3c424e');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#2a2f38'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
  for (let yy = -R+10; yy < R; yy += 11) { const w = Math.sqrt(Math.max(0, R*R - yy*yy)); ctx.beginPath(); ctx.moveTo(-w, yy); ctx.lineTo(w, yy); ctx.stroke(); }
  ctx.fillStyle = '#2c313b'; ctx.fillRect(-R, -4, R*2, 6);
  ctx.strokeStyle = '#1c2028'; ctx.lineWidth = 1; ctx.strokeRect(-R, -4, R*2, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; [[-26,-22,7],[18,-30,5],[30,18,6],[-34,16,5]].forEach(([cx,cy,cr]) => { ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill(); });
}

function drawBoss() {
  const vuln = boss.state === 'vulnerable' || boss.state === 'dead', R = BOSS_R;
  ctx.save(); ctx.translate(boss.x, boss.y);
  if (boss.hurt > 0) ctx.globalAlpha = 0.6;
  drawDeathStarSphere(R);
  // Superlaser dish (upper-left), charges/glows when the core is exposed
  const dx = -R*0.42, dy = -R*0.42;
  ctx.fillStyle = '#2a2f38'; ctx.beginPath(); ctx.arc(dx, dy, 15, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#555c69'; ctx.lineWidth = 1.5; ctx.stroke();
  if (vuln) {
    const ch = boss.charge || 0;
    const chargeUp = boss.beamState === 'charging' ? boss.beamT / BOSS_BEAM_CHARGE_FR : 0;
    ctx.shadowColor = '#ff5a3c'; ctx.shadowBlur = 14 + 10*Math.abs(Math.sin(fc*0.15)) + 20*chargeUp;
    ctx.fillStyle = `rgba(255,${70+Math.floor(120*Math.abs(Math.sin(fc*0.15)))},50,${0.6+0.4*ch})`;
    ctx.beginPath(); ctx.arc(dx, dy, 8 + 4*chargeUp, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
  }
  else { ctx.fillStyle = '#1d2129'; ctx.beginPath(); ctx.arc(dx, dy, 7, 0, Math.PI*2); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.restore();
  // beam coords are world-space (computed in updateBossBeam), so draw after restoring the translate
  if (boss.beamState === 'firing' && boss.beam) drawBeam({ beam: boss.beam, col: '#ff5a3c' }, BOSS_BEAM_W);
}

// Decorative Death Star for sectors 2 & 3 — visual only, no HP bar, no combat, no update function
// needed (static position, drawn straight from decorStar.x/y).
function drawDecorDeathStar() {
  ctx.save(); ctx.translate(decorStar.x, decorStar.y);
  drawDeathStarSphere(DECOR_STAR_R);
  const dx = -DECOR_STAR_R*0.42, dy = -DECOR_STAR_R*0.42;
  ctx.fillStyle = '#2a2f38'; ctx.beginPath(); ctx.arc(dx, dy, 11, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#555c69'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#1d2129'; ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawStations() {
  // Glowing connector tubes between standing blocks (the "space city").
  ctx.strokeStyle = 'rgba(150,200,255,0.4)'; ctx.lineWidth = 3;
  for (let i = 0; i < stations.length-1; i++) { const a = stations[i], b = stations[i+1]; if (a.hp > 0 && b.hp > 0) { ctx.beginPath(); ctx.moveTo(a.x, a.y-10); ctx.lineTo(b.x, b.y-10); ctx.stroke(); } }
  stations.forEach(s => {
    if (s.hp > 0) {
      const dmg = s.hp < s.maxHp;
      ctx.fillStyle = dmg ? '#9aa0ac' : '#cfd6e2'; rr(s.x-12, s.y-s.h, 24, s.h, 3); ctx.fill();
      ctx.strokeStyle = '#8a92a0'; ctx.lineWidth = 1; rr(s.x-12, s.y-s.h, 24, s.h, 3); ctx.stroke();
      ctx.fillStyle = dmg ? '#5a7088' : '#7fc8ff';
      for (let wy = s.y-s.h+5; wy < s.y-4; wy += 8) { ctx.fillRect(s.x-8, wy, 5, 5); ctx.fillRect(s.x+3, wy, 5, 5); }
      ctx.fillStyle = '#dfe5ef'; ctx.beginPath(); ctx.arc(s.x, s.y-s.h, 10, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#8a92a0'; ctx.beginPath(); ctx.moveTo(s.x, s.y-s.h-10); ctx.lineTo(s.x, s.y-s.h-18); ctx.stroke();
      ctx.fillStyle = '#9bf'; ctx.beginPath(); ctx.arc(s.x, s.y-s.h-19, 2, 0, Math.PI*2); ctx.fill();
      if (dmg) { const a = 0.3 + 0.2*Math.sin(fc*0.1 + s.x); ctx.fillStyle = `rgba(80,80,90,${a})`; ctx.beginPath(); ctx.arc(s.x + Math.sin(fc*0.06+s.x)*3, s.y-s.h-6, 4, 0, Math.PI*2); ctx.fill(); }
    } else {
      ctx.fillStyle = '#3a2a22'; rr(s.x-12, s.y-8, 24, 8, 2); ctx.fill();
      const a = 0.35 + 0.3*Math.sin(fc*0.1 + s.x);
      ctx.fillStyle = `rgba(90,90,100,${a})`; ctx.beginPath(); ctx.arc(s.x + Math.sin(fc*0.05+s.x)*3, s.y-16-(s.smoke % 30)*0.4, 5, 0, Math.PI*2); ctx.fill();
    }
  });
}

function drawBullet(b) {
  if (b.type === 'shock') {
    ctx.strokeStyle = b.col; ctx.shadowColor = b.col; ctx.shadowBlur = 12;
    const a = clamp(1 - b.r/SHOCK_MAXR, 0, 1); ctx.globalAlpha = 0.5 + a*0.5;
    ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.stroke();
    ctx.lineWidth = 2; ctx.globalAlpha = 0.3 + a*0.3; ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1,b.r-7), 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  } else if (b.type === 'grenade') {
    const p = 0.5 + 0.5*Math.sin(fc*0.5); ctx.shadowColor = b.col; ctx.shadowBlur = 14; ctx.fillStyle = b.col;
    ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = `rgba(255,255,180,${0.6+p*0.4})`; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
  } else {
    const len = 12, m = Math.hypot(b.vx,b.vy)||1, ux = b.vx/m, uy = b.vy/m;
    ctx.shadowColor = b.col; ctx.shadowBlur = 9; ctx.strokeStyle = b.col; ctx.lineWidth = BOLT_R; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x-ux*len, b.y-uy*len); ctx.lineTo(b.x+ux*4, b.y+uy*4); ctx.stroke(); ctx.shadowBlur = 0;
  }
}

function drawBeam(t, w = BEAM_W) {
  const b = t.beam;
  ctx.save(); ctx.shadowColor = t.col; ctx.shadowBlur = 16;
  ctx.strokeStyle = t.col; ctx.globalAlpha = 0.35 + 0.15*Math.sin(fc*0.6); ctx.lineWidth = w*2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(b.x1,b.y1); ctx.lineTo(b.x2,b.y2); ctx.stroke();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(b.x1,b.y1); ctx.lineTo(b.x2,b.y2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.restore();
}

// ── Ship rendering (4 selectable models) ───────────────────────────────────────
function drawShip(t) {
  if (!t.alive) {
    ctx.fillStyle = `rgba(255,255,255,${0.3+0.3*Math.sin(fc*0.3)})`; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`${t.name}...`, W*0.5 + (t.id===0?-70:70), H*0.84); ctx.textAlign = 'left'; return;
  }
  if (t.invuln > 0 && Math.floor(fc/4)%2 === 0) return;
  const ang = Math.atan2(t.face.y, t.face.x) + Math.PI/2;
  ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(ang);
  ctx.shadowColor = t.col; ctx.shadowBlur = 12;
  drawShipModel(t.model, t.col); ctx.shadowBlur = 0;
  ctx.restore();
}

function drawShipModel(model, col) {
  const dark = 'rgba(255,255,255,0.55)';
  if (model === 'xwing') {
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-13,-9); ctx.lineTo(13,9); ctx.moveTo(13,-9); ctx.lineTo(-13,9); ctx.stroke();   // X wings
    ctx.fillStyle = '#cfd6e2'; [[-13,-9],[13,-9],[-13,9],[13,9]].forEach(([x,y]) => { ctx.fillRect(x-1.5,y-1.5,3,3); });   // cannons
    ctx.fillStyle = col; rr(-3.5,-SHIP_R-1,7,SHIP_R*2,2); ctx.fill();   // fuselage
    ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(0,-4,3,0,Math.PI*2); ctx.fill();   // cockpit
  } else if (model === 'trek') {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0,-6,12,8,0,0,Math.PI*2); ctx.fill();   // saucer
    ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(0,-7,3.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = col; rr(-3,-2,6,14,2); ctx.fill();   // neck/hull
    ctx.strokeStyle = col; ctx.lineWidth = 3;            // nacelles
    [[-9,4],[9,4]].forEach(([x]) => { ctx.beginPath(); ctx.moveTo(x*0.5,2); ctx.lineTo(x,2); ctx.stroke(); ctx.fillStyle = '#9bd4ff'; ctx.fillRect(x-2,-2,4,12); ctx.fillStyle = '#e0584a'; ctx.fillRect(x-2,-4,4,3); });
  } else if (model === 'tie') {
    ctx.fillStyle = '#3a4250'; rr(-12,-12,5,24,1); ctx.fill(); rr(7,-12,5,24,1); ctx.fill();   // wing panels
    ctx.strokeStyle = '#5a6472'; ctx.lineWidth = 1; for (let y=-10;y<=10;y+=5){ ctx.beginPath(); ctx.moveTo(-12,y); ctx.lineTo(-7,y); ctx.moveTo(7,y); ctx.lineTo(12,y); ctx.stroke(); }
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7,0); ctx.lineTo(7,0); ctx.stroke();   // struts
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0,0,7,0,Math.PI*2); ctx.fill();   // cockpit ball
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0,0,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(0,-1,1.6,0,Math.PI*2); ctx.fill();
  } else if (model === 'bomb') {
    ctx.fillStyle = col; rr(-7, -SHIP_R+2, 14, SHIP_R*2-4, 7); ctx.fill();                       // capsule body
    ctx.fillStyle = '#d8dde6'; ctx.beginPath(); ctx.arc(0, -SHIP_R+4, 7, Math.PI, 0); ctx.fill(); // nose cap
    ctx.fillStyle = col; [-1,1].forEach(s => { ctx.beginPath(); ctx.moveTo(s*6, SHIP_R-6); ctx.lineTo(s*13, SHIP_R+2); ctx.lineTo(s*6, SHIP_R-1); ctx.closePath(); ctx.fill(); }); // tail fins
    ctx.fillStyle = '#ffd24a'; ctx.fillRect(-2, -3, 4, 9);                                        // stripe
    ctx.fillStyle = '#ff7a3a'; ctx.beginPath(); ctx.arc(0, SHIP_R, 3, 0, Math.PI*2); ctx.fill();  // engine
  } else if (model === 'airplane') {
    ctx.fillStyle = col; rr(-3, -SHIP_R-2, 6, SHIP_R*2+2, 3); ctx.fill();                         // fuselage
    ctx.fillStyle = '#cfd6e2'; ctx.beginPath(); ctx.moveTo(0,-SHIP_R-5); ctx.lineTo(3,-SHIP_R+1); ctx.lineTo(-3,-SHIP_R+1); ctx.closePath(); ctx.fill(); // nose
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(-3,-1); ctx.lineTo(-16,10); ctx.lineTo(-3,7); ctx.closePath(); ctx.fill();   // wings
    ctx.beginPath(); ctx.moveTo(3,-1); ctx.lineTo(16,10); ctx.lineTo(3,7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-3,SHIP_R-4); ctx.lineTo(-8,SHIP_R+2); ctx.lineTo(-3,SHIP_R-1); ctx.closePath(); ctx.fill(); // tailplane
    ctx.beginPath(); ctx.moveTo(3,SHIP_R-4); ctx.lineTo(8,SHIP_R+2); ctx.lineTo(3,SHIP_R-1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(0,-5,2.6,0,Math.PI*2); ctx.fill();        // canopy
  } else if (model === 'falcon') {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0,1,SHIP_R-1,SHIP_R-3,0,0,Math.PI*2); ctx.fill();   // saucer
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col; [-1,1].forEach(s => { ctx.beginPath(); ctx.moveTo(s*2,-SHIP_R+3); ctx.lineTo(s*10,-SHIP_R-2); ctx.lineTo(s*9,-SHIP_R+4); ctx.closePath(); ctx.fill(); }); // front mandibles
    ctx.fillStyle = '#05060f'; ctx.beginPath(); ctx.moveTo(-3,-SHIP_R+3); ctx.lineTo(3,-SHIP_R+3); ctx.lineTo(2,-3); ctx.lineTo(-2,-3); ctx.closePath(); ctx.fill(); // notch
    ctx.fillStyle = '#9aa3b2'; ctx.beginPath(); ctx.arc(0,1,4,0,Math.PI*2); ctx.fill();           // dish
    ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(7,5,3,0,Math.PI*2); ctx.fill();           // offset cockpit
  } else if (model === 'destroyer') {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0,-SHIP_R-4); ctx.lineTo(SHIP_R-2,SHIP_R+2); ctx.lineTo(-(SHIP_R-2),SHIP_R+2); ctx.closePath(); ctx.fill(); // wedge
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0,-SHIP_R-2); ctx.lineTo(0,SHIP_R); ctx.stroke(); // keel line
    ctx.fillStyle = '#cdd4e0'; ctx.fillRect(-4, SHIP_R-6, 8, 5);                                  // bridge tower
    ctx.fillStyle = '#9fb0c8'; ctx.fillRect(-2, SHIP_R-9, 4, 3);
    ctx.fillStyle = '#7fd0ff'; ctx.shadowColor = '#7fd0ff'; ctx.shadowBlur = 8; ctx.fillRect(-7, SHIP_R+1, 14, 2); ctx.shadowBlur = 0; // engines
  } else {
    // arrow (default)
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0,-SHIP_R-2); ctx.lineTo(SHIP_R-2,SHIP_R); ctx.lineTo(0,SHIP_R-5); ctx.lineTo(-(SHIP_R-2),SHIP_R); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(0,-2,4,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0,-SHIP_R-2); ctx.lineTo(SHIP_R-2,SHIP_R); ctx.lineTo(0,SHIP_R-5); ctx.lineTo(-(SHIP_R-2),SHIP_R); ctx.closePath(); ctx.stroke();
  }
}

// ── Moon base ─────────────────────────────────────────────────────────────────
function drawBasePlanet() {
  const px = base.x, py = base.y + 192, r = 84, hue = base.planetHue || 210;
  ctx.strokeStyle = 'rgba(150,180,230,0.22)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(px, py, r + 96, (r + 96)*0.5, 0, 0, Math.PI*2); ctx.stroke();
  const g = ctx.createRadialGradient(px - 32, py - 32, 20, px, py, r);
  g.addColorStop(0, `hsl(${hue},50%,60%)`); g.addColorStop(1, `hsl(${hue},55%,26%)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = `hsla(${hue},60%,82%,0.3)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, py, r*1.5, r*0.4, 0.3, 0, Math.PI*2); ctx.stroke();
}

function drawLandingStrips() {
  ships.forEach(t => {
    if (!t.alive) return;
    const sx = landStripX(t), top = base.y - 4, bot = base.y + STRIP_LEN;
    const aligned = t.landed || Math.abs(t.x - sx) < STRIP_HALF;
    const col = t.landed ? '#7dff9c' : (aligned ? '#9bffb0' : 'rgba(140,200,255,0.55)');
    ctx.fillStyle = aligned ? 'rgba(120,255,160,0.12)' : 'rgba(120,200,255,0.06)';
    ctx.fillRect(sx - STRIP_HALF, top, STRIP_HALF*2, bot - top);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([7,7]);
    ctx.beginPath(); ctx.moveTo(sx - STRIP_HALF, top); ctx.lineTo(sx - STRIP_HALF, bot); ctx.moveTo(sx + STRIP_HALF, top); ctx.lineTo(sx + STRIP_HALF, bot); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 2;
    for (let cy = bot - 14; cy > top + 8; cy -= 18) { ctx.beginPath(); ctx.moveTo(sx - 8, cy); ctx.lineTo(sx, cy - 8); ctx.lineTo(sx + 8, cy); ctx.stroke(); }
    ctx.fillStyle = col; ctx.fillRect(sx - STRIP_HALF, top - 3, STRIP_HALF*2, 3);
    ctx.fillStyle = t.col; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center';
    ctx.fillText(t.name, sx, bot + 12); ctx.textAlign = 'left';
  });
}

function drawBase() {
  const x = base.x, y = base.y;
  drawBasePlanet();
  if (phase === 'docking' || phase === 'gearup') drawLandingStrips();
  ctx.fillStyle = '#c2c8d2'; ctx.beginPath(); ctx.ellipse(x, y+18, 86, 30, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#a7adba'; ctx.beginPath(); ctx.ellipse(x, y+24, 86, 22, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = 'rgba(120,126,138,0.7)'; [[-58,16,7],[-30,24,5],[44,18,8],[64,12,5],[10,26,6]].forEach(([cx,cy,cr]) => { ctx.beginPath(); ctx.arc(x+cx, y+cy, cr, 0, Math.PI*2); ctx.fill(); });
  ctx.fillStyle = '#e8edf6'; ctx.beginPath(); ctx.arc(x, y+8, 26, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#cfd6e2'; ctx.fillRect(x-26, y+6, 52, 4);
  ctx.fillStyle = '#7fc8ff'; ctx.beginPath(); ctx.arc(x, y+8, 15, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#4a78a0'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y+8); ctx.lineTo(x, y-7); ctx.stroke();
  [[-46],[46]].forEach(([dx]) => { ctx.fillStyle = '#dfe5ef'; ctx.beginPath(); ctx.arc(x+dx, y+12, 13, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#ffd86b'; ctx.fillRect(x+dx-7, y+6, 4, 5); ctx.fillRect(x+dx+3, y+6, 4, 5); ctx.fillStyle = '#b9c0cc'; ctx.fillRect(x+dx-13, y+11, 26, 3); });
  ctx.strokeStyle = '#aab2c0'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x-26, y+12); ctx.lineTo(x-34, y+12); ctx.moveTo(x+26, y+12); ctx.lineTo(x+34, y+12); ctx.stroke();
  ctx.strokeStyle = '#8a92a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x+20, y-12); ctx.lineTo(x+20, y-28); ctx.stroke();
  const blink = 0.5 + 0.5*Math.sin(fc*0.18); ctx.fillStyle = `rgba(255,70,70,${0.4+blink*0.6})`; ctx.shadowColor = 'red'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x+20, y-30, 3, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.save(); ctx.translate(x-64, y-2); ctx.fillStyle = '#22406e'; rr(-12, -9, 24, 18, 2); ctx.fill(); ctx.strokeStyle = '#4a78c0'; ctx.lineWidth = 0.8; for (let gx=-12; gx<=12; gx+=6){ ctx.beginPath(); ctx.moveTo(gx,-9); ctx.lineTo(gx,9); ctx.stroke(); } ctx.restore();
  ctx.fillStyle = '#dff0ff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'; ctx.fillText('MOON BASE', x, y-40); ctx.textAlign = 'left';
}

// ── Gear-up overlay (per landed ship: new weapon + ship picker) ─────────────────
function drawGearup(t) {
  const cx = t.x, cy = t.y - 80, secs = Math.ceil((GEARUP_FR - phaseTimer)/60);
  ctx.textAlign = 'center';
  ctx.fillStyle = t.col; ctx.font = 'bold 11px Arial';
  ctx.fillText(t.name, cx, cy - 8);
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 11px Arial';
  ctx.fillText(`← ${WEAPON_NAMES[t.weapon]} →`, cx, cy + 8);
  ctx.fillStyle = '#9fd0ff'; ctx.font = 'bold 10px Arial';
  ctx.fillText(`↑ ${SHIP_MODEL_NAMES[t.model]} ↓`, cx, cy + 24);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '9px Arial';
  ctx.fillText(`warp map in ${secs}s`, cx, cy + 38);
  ctx.textAlign = 'left';
}

// ── Sector map (explore the systems) ────────────────────────────────────────────
const MAP_HUES = [265,200,320,150,30,230,180,50,300,120,205,210];
function mapNodePos(i) {
  const row = Math.floor(i/4), colInRow = i%4, col = row%2 === 0 ? colInRow : 3 - colInRow;
  return { x: 160 + col*193, y: 220 + row*135 };
}
function drawMap() {
  ctx.fillStyle = 'rgba(4,6,16,0.9)'; ctx.fillRect(0,0,W,H);
  // Drifting nebula clouds behind the map
  [[200,180,260,265],[710,430,300,200],[470,320,240,320]].forEach(([nx,ny,nr,hue]) => {
    const g = ctx.createRadialGradient(nx,ny,20,nx,ny,nr); g.addColorStop(0,`hsla(${hue},70%,55%,0.10)`); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx,ny,nr,0,Math.PI*2); ctx.fill();
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8fd0ff'; ctx.font = 'bold 26px Arial'; ctx.fillText('CHOOSE YOUR NEXT SYSTEM', W/2, 58);
  const cleared = sectors.filter(s => s.cleared).length;
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 16px Arial'; ctx.fillText(`Systems cleared: ${cleared} / ${TOTAL_SECTORS}`, W/2, 90);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '13px Arial'; ctx.fillText('← →  travel between systems    SPACE / ENTER  warp', W/2, 114);
  // Route line
  ctx.strokeStyle = 'rgba(120,150,220,0.3)'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i < TOTAL_SECTORS; i++) { const p = mapNodePos(i); i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y); }
  ctx.stroke();
  for (let i = 0; i < TOTAL_SECTORS; i++) {
    const p = mapNodePos(i), done = sectors[i].cleared, isCur = i === mapCursor;
    const locked = (isRace(i) || isEarth(i)) && normalCleared() < NORMAL_SECTORS;
    const hue = MAP_HUES[i % MAP_HUES.length];
    // Nebula glow around each system
    const ng = ctx.createRadialGradient(p.x,p.y,4,p.x,p.y,42); ng.addColorStop(0,`hsla(${hue},70%,60%,0.45)`); ng.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(p.x,p.y,42,0,Math.PI*2); ctx.fill();
    if (isCur) { const pl = 0.5+0.5*Math.sin(fc*0.2); ctx.strokeStyle = `rgba(255,221,90,${0.6+pl*0.4})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x,p.y,34,0,Math.PI*2); ctx.stroke(); }
    // The system's planet
    const pg = ctx.createRadialGradient(p.x-8,p.y-8,4,p.x,p.y,22);
    if (locked) { pg.addColorStop(0,'#5a6270'); pg.addColorStop(1,'#2a3038'); }
    else if (isEarth(i)) { pg.addColorStop(0,'#6fb6ff'); pg.addColorStop(1,'#123a78'); }
    else { pg.addColorStop(0,`hsl(${hue},55%,62%)`); pg.addColorStop(1,`hsl(${hue},55%,28%)`); }
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(p.x,p.y,22,0,Math.PI*2); ctx.fill();
    if (i % 3 === 0) { ctx.strokeStyle = `hsla(${hue},60%,80%,0.5)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x,p.y,32,11,0.4,0,Math.PI*2); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial'; ctx.fillText(String(i+1), p.x, p.y+5);
    if (done)   { ctx.fillStyle = '#7dffb0'; ctx.font = 'bold 16px Arial'; ctx.fillText('✓', p.x+22, p.y-16); }
    if (locked) { ctx.fillStyle = '#cdd4e0'; ctx.font = '13px Arial'; ctx.fillText('🔒', p.x, p.y-27); }
    if (isRace(i))  { ctx.fillStyle = '#9fd0ff'; ctx.font = 'bold 9px Arial'; ctx.fillText('FIELD', p.x, p.y+36); }
    if (isEarth(i)) { ctx.fillStyle = '#9fd0ff'; ctx.font = 'bold 9px Arial'; ctx.fillText('EARTH', p.x, p.y+36); }
  }
  ctx.textAlign = 'left';
}

// ── Win screen ─────────────────────────────────────────────────────────────────
function drawWon() {
  ctx.fillStyle = 'rgba(4,6,16,0.9)'; ctx.fillRect(0,0,W,H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 38px Arial'; ctx.fillText('★ EARTH IS SAVED! ALL 12 CLEARED! ★', W/2, 180);
  ctx.fillStyle = '#8fd0ff'; ctx.font = 'bold 22px Arial'; ctx.fillText(`SPACE HEROES: ${PN.P1.toUpperCase()} & ${PN.P2.toUpperCase()}`, W/2, 230);
  ctx.fillStyle = SHIP1_COLOR; ctx.font = 'bold 20px Arial'; ctx.fillText(`${PN.P1}: ${ships[0].score} pts`, W/2, 300);
  ctx.fillStyle = SHIP2_COLOR; ctx.fillText(`${PN.P2}: ${ships[1].score} pts`, W/2, 332);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 26px Arial'; ctx.fillText(`TOTAL: ${ships[0].score + ships[1].score} points`, W/2, 380);
  ctx.fillStyle = '#9bf'; ctx.font = 'bold 20px Arial'; ctx.fillText(`Time: ${fmtTime(winElapsed)}`, W/2, 416);
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '15px Arial'; ctx.fillText('Press RESTART to play again', W/2, 470);
  ctx.textAlign = 'left';
}

function drawPfx() {
  particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.r), 0, Math.PI*2); ctx.fill(); });
  ctx.globalAlpha = 1;
}

function drawHUD() {
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'left';  ctx.fillStyle = SHIP1_COLOR; ctx.fillText(`◀ ${PN.P1.toUpperCase()} — ${WEAPON_NAMES[ships[0].weapon]}`, 14, 24);
  ctx.textAlign = 'right'; ctx.fillStyle = SHIP2_COLOR; ctx.fillText(`${WEAPON_NAMES[ships[1].weapon]} — ${PN.P2.toUpperCase()} ▶`, W-14, 24);
  if (phase === 'fighting' && !boss) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = 'bold 11px Arial'; ctx.fillText(`SECTOR ${curSector+1}   👾 ${aliens.length}   ☄ ${asteroids.length}`, W/2, 24); }
  if (boss && boss.state !== 'dead') {
    const bw = 300, bx = W/2 - bw/2, by = 40;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(bx-3, by-3, bw+6, 14, 4); ctx.fill();
    ctx.fillStyle = boss.state === 'vulnerable' ? '#ff4040' : '#6a6a78';
    rr(bx, by, bw*clamp(boss.hp/boss.maxHp, 0, 1), 8, 3); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial';
    ctx.fillText(boss.state === 'vulnerable' ? 'BOSS — CORE EXPOSED, BLAST IT!' : 'BOSS MOTHERSHIP', W/2, by-6); ctx.textAlign = 'left';
  }
  if (bannerTimer > 0 && banner) { ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,221,90,${Math.min(1,bannerTimer/40)})`; ctx.font = 'bold 19px Arial'; ctx.fillText(banner, W/2, H*0.34); }
  ctx.textAlign = 'left';
}

// ── HTML panel ──────────────────────────────────────────────────────────────
function shieldPips(n, col) {
  let out = '';
  for (let i = 0; i < MAX_SHIELDS; i++) { const frac = clamp(n - i, 0, 1) * 100; out += `<div class="pip" style="background:linear-gradient(90deg, ${col} ${frac}%, #1a2236 ${frac}%)"></div>`; }
  return out;
}
function upPanel() {
  document.getElementById('p1name').textContent = PN.P1.toUpperCase();
  document.getElementById('p2name').textContent = PN.P2.toUpperCase();
  document.getElementById('p1name').style.color = SHIP1_COLOR;
  document.getElementById('p2name').style.color = SHIP2_COLOR;
  document.getElementById('p1score').textContent = '★ ' + ships[0].score;
  document.getElementById('p2score').textContent = '★ ' + ships[1].score;
  document.getElementById('p1shields').innerHTML = shieldPips(ships[0].shields, SHIP1_COLOR);
  document.getElementById('p2shields').innerHTML = shieldPips(ships[1].shields, SHIP2_COLOR);
  const w1 = document.getElementById('p1weap'); if (w1) w1.textContent = WEAPON_NAMES[ships[0].weapon];
  const w2 = document.getElementById('p2weap'); if (w2) w2.textContent = WEAPON_NAMES[ships[1].weapon];
  const lv = document.getElementById('level'); if (lv) lv.textContent = 'SECTOR ' + (curSector+1) + '/' + TOTAL_SECTORS;
}

// ── Sound ─────────────────────────────────────────────────────────────────────
let _ac = null;
const ac = () => { if (!_ac) _ac = new (window.AudioContext||window.webkitAudioContext)(); return _ac; };
function beep(f, d, tp='square', v=0.12, dl=0) {
  try { const a = ac(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.type = tp; o.frequency.value = f; const t = a.currentTime + dl; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t+d); o.start(t); o.stop(t+d+0.01); } catch(_) {}
}
function playBlast()    { beep(880, 0.07, 'square', 0.10); beep(1280, 0.05, 'square', 0.06, 0.01); }
function playShock()    { beep(300, 0.22, 'sine', 0.16); beep(500, 0.18, 'sine', 0.10, 0.04); }
function playGrenade()  { beep(180, 0.12, 'square', 0.14); }
function playBoom(size) { const b = size==='big'?70:size==='med'?110:160; beep(b,0.30,'sawtooth',0.26); beep(b*0.7,0.42,'sawtooth',0.18,0.05); }
function playHit()      { beep(150,0.18,'square',0.2); beep(90,0.22,'sawtooth',0.16,0.03); }
function playAlienShot(){ beep(330,0.10,'sawtooth',0.08); }
function playHunterShot(){ beep(240,0.12,'square',0.10); beep(180,0.12,'sawtooth',0.08,0.02); }
function playMissile()   { beep(520,0.12,'sawtooth',0.10); beep(300,0.20,'sine',0.08,0.05); }
function playRecharge() { beep(660,0.08,'sine',0.14); beep(990,0.10,'sine',0.12,0.05); }
function playSelect()   { beep(720,0.06,'square',0.10); }
function playWarp()     { beep(220,0.5,'sawtooth',0.18); beep(440,0.5,'sine',0.14,0.05); beep(880,0.6,'sine',0.12,0.12); }
function playWin()      { [523,659,784,1047].forEach((f,i)=>beep(f,0.5,'sine',0.18,i*0.16)); }

let beamOsc = null, beamGain = null;
function beamSound(on) {
  if (on) { if (beamOsc) return; try { const a = ac(); beamOsc = a.createOscillator(); beamGain = a.createGain(); const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1000; beamOsc.type = 'sawtooth'; beamOsc.frequency.value = 170; beamGain.gain.value = 0.05; beamOsc.connect(beamGain); beamGain.connect(lp); lp.connect(a.destination); beamOsc.start(); } catch(_) { beamOsc = null; beamGain = null; } }
  else if (beamOsc) { try { beamOsc.stop(); } catch(_) {} beamOsc = null; beamGain = null; }
}

// ── Input ─────────────────────────────────────────────────────────────────────
addEventListener('keydown', e => { keys[e.code] = true;  if (GAME_KEYS.has(e.code)) e.preventDefault(); });
addEventListener('keyup',   e => { keys[e.code] = false; });
// Mouse / trackpad buttons fire Player 1 (and right-click never opens a menu) — toddler-proof.
canvas.addEventListener('mousedown', e => { mouseFire = true; e.preventDefault(); });
addEventListener('mouseup',   () => { mouseFire = false; });
addEventListener('blur',      () => { mouseFire = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('brestart').addEventListener('click', e => { init(); e.currentTarget.blur(); });

// ── Start ─────────────────────────────────────────────────────────────────────
init();
requestAnimationFrame(loop);

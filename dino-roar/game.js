// Player names come from the local server's /names.js (private). Public default is Player 1/2/3.
var PN = Object.assign({ P1: 'Player 1', P2: 'Player 2', P3: 'Player 3' }, (typeof window !== 'undefined' && window.PLAYER_NAMES) || {});
'use strict';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  DINO ROAR — co-op dino-lab defense for two players (P1 & P2)       ║
// ║  Two modes per sector:                                                    ║
// ║    DRIVE TO LAB — top-down: follow the curvy dirt road through the jungle ║
// ║    DEFEND       — first-person turret: rifle + grenade vs charging dinos  ║
// ║  Kid-friendly: no hard game-over. Tunables live right here at the top.    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── Board ──────────────────────────────────────────────────────────────────
const W = 900, H = 640;
const canvas = document.getElementById('gc');
const ctx = canvas.getContext('2d');

// ── Players / identity (kept from Space Blasters muscle memory) ──────────────
const P1_COLOR = '#b06bff';  // P1
const P2_COLOR = '#36e07a';  // P2

// ── Sectors ──────────────────────────────────────────────────────────────────
const TOTAL_SECTORS = 5;          // sector 5 is the hardest final stand
const LAB_MAX = 10;               // lab health pips
const INTER_FR = 90;              // "LAB SECURED" pause before next drive

// ── Transit (top-down route driving) ─────────────────────────────────────────
const T_SEG = 120;                // world length of one road segment
const T_VIEW = 0.92;              // world→pixel zoom
const T_ANCHOR = H * 0.60;        // where the jeep sits on screen (each half)
const ROAD_HALF = 52;             // half-width of the dirt road (world units)
const T_ACCEL = 0.24, T_MAXSPD = 3.6, T_REVSPD = -1.7;
const T_FRICTION = 0.90, T_OFFROAD = 0.30, T_TURN = 0.050;
const T_BUMP_FR = 34;             // stun frames after hitting a dino/tree
const T_RAM_CD = 20, T_RAM_DIST = 78;     // honk/ram a dino just ahead
const T_DINO_SPD = 0.6;           // base world units a road dino creeps/frame
const T_ARRIVE = 0.99;            // progress that counts as "at the lab"
// per-sector: dino spawn interval (frames) + closing-speed multiplier
const T_CFG = [
  { every: 150, spd: 0.80 },
  { every: 128, spd: 0.92 },
  { every: 108, spd: 1.04 },
  { every:  90, spd: 1.18 },
  { every:  70, spd: 1.36 },
];

// ── Flight transit (helicopter / hang glider — forward canyon flight) ────────
// Shared by sector 3 (HELI) and sector 4 (GLIDER): the vehicle always moves
// forward through a canyon; the boys only steer left/right and up/down to
// dodge the canyon walls (and, for the glider, swooping pterodactyls).
const FLY_LEN = 2600;              // world length of the canyon run
const FLY_SPD = { heli: 3.2, glider: 2.6 };     // forward world units/frame
const FLY_VIEW = 0.95;             // world→pixel zoom
const FLY_ANCHOR = H * 0.62;
const FLY_HSPD = { heli: 4.4, glider: 3.6 };    // left/right steer speed
const FLY_VSPD = { heli: 3.2, glider: 2.4 };    // up/down steer speed
const FLY_DRIFT = 0.055;           // glider sinks each frame unless climbing
const CANYON_HALF = 150;           // half-width of the flyable lane (world x)
const FLY_BUMP_FR = 30;
const FLY_ARRIVE = 0.99;
// per-sector obstacle pacing (reuses T_CFG-style tuning per run)
const FLY_CFG = {
  heli:   { every: 92, spd: 1.0 },
  glider: { every: 80, spd: 1.0 },
};

// ── Defend (first-person turret) ─────────────────────────────────────────────
const HZN = H * 0.40;             // horizon line — far dinos appear here, small
const GND = H * 0.93;             // the wall — dinos that reach here chip the lab
const AIM_MINY = HZN - 46, AIM_MAXY = GND - 6;   // crosshair vertical band
const X_SPD_H = 8.6, X_SPD_V = 4.6;              // side-to-side fast, up/down slower
const X_HIT_R = 34;               // rifle forgiveness around the reticle
const FIRE_CD = 9, BLAST_DMG = 1.5;
const GREN_CD = 85, GREN_R = 120, GREN_DMG = 6;  // grenade: big splash, slow reload
const D_ZSPD = 0.0044;            // base depth closed per frame (z 1→0)
const SCOPE_ZOOM = 1.42, ZOOM_EASE = 0.12;       // scope magnifies the far wave
const MUZ = [{ x: W * 0.30, y: H - 4 }, { x: W * 0.70, y: H - 4 }];
// per-sector: how many dinos, spawn interval, speed mult, air share, alphas
const D_CFG = [
  { count: 10, every: 78, spd: 0.78, air: 0.18, alpha: 0 },
  { count: 14, every: 66, spd: 0.90, air: 0.26, alpha: 0 },
  { count: 18, every: 58, spd: 1.00, air: 0.32, alpha: 1 },
  { count: 23, every: 50, spd: 1.12, air: 0.38, alpha: 1 },
  { count: 30, every: 42, spd: 1.28, air: 0.42, alpha: 3 },
];

// ── Dino kinds (hp / score / lab damage / draw size) ─────────────────────────
const DINO = {
  raptor: { hp: 1.5, score: 3,  dmg: 0.5, size: 26, col: '#7cc23a', col2: '#a6e05a', spd: 1.35 },
  trex:   { hp: 5,   score: 8,  dmg: 1.5, size: 48, col: '#3f7a34', col2: '#5fae4a', spd: 0.70 },
  ptero:  { hp: 2,   score: 6,  dmg: 1.0, size: 32, col: '#c98a3a', col2: '#e8b25a', spd: 1.15, air: true },
  alpha:  { hp: 12,  score: 20, dmg: 2.0, size: 66, col: '#c2422c', col2: '#e0664a', spd: 0.55 },
};

// ── Keys ─────────────────────────────────────────────────────────────────────
// toddler-proof: Player 1 fires on Space OR any space-adjacent key OR a mouse button.
const P1_FIRE = new Set(['Space','KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','AltLeft','ControlLeft']);
const GAME_KEYS = new Set([
  'KeyW','KeyA','KeyS','KeyD','Space','KeyQ','KeyE',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Slash',
  'ShiftLeft','ShiftRight',
  'KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','AltLeft','ControlLeft',
]);

// ── State ─────────────────────────────────────────────────────────────────────
let players, particles, tracers, dDinos;
let topLava, farLava;    // lava blobs lobbed by the volcano (top-down view / far horizon view)
let mode, curSector, interTimer, lastTs, fc;
let labHP, breachWobble, zoom;
let banner, bannerTimer, shake, flash, startTime, winElapsed;
let mouseFire = false;
let AUTOPLAY = false;   // attract / smoke-test self-play; never on in normal play
const keys = {};

// ── Tiny utils ────────────────────────────────────────────────────────────────
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const lerp  = (a,b,t) => a + (b-a)*t;
const rand  = (a,b) => a + Math.random()*(b-a);
const TAU = Math.PI*2;
function angDiff(a, b){ let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function rr(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function setBanner(t,f){ banner = t; bannerTimer = f; }
function fmtTime(ms){ const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${('0'+(s%60)).slice(-2)}`; }
function firePressed(p){ return p.id === 0 ? ([...P1_FIRE].some(k => keys[k]) || mouseFire) : !!keys[p.controls.fire]; }
function scopePressed(p){ return p.id === 0 ? !!keys['KeyQ'] : !!keys['Slash']; }
function grenadePressed(p){ return p.id === 0 ? !!keys['KeyE'] : !!keys['ShiftRight']; }

// ── Setup ──────────────────────────────────────────────────────────────────
function makePlayer(id, name, col, controls){
  return { id, name, col, controls, score: 0, t: null, d: null };
}
function init(){
  players = [
    makePlayer(0, PN.P1.toUpperCase(), P1_COLOR, { up:'KeyW', down:'KeyS', left:'KeyA', right:'KeyD', fire:'Space' }),
    makePlayer(1, PN.P2.toUpperCase(), P2_COLOR, { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', fire:'Enter' }),
  ];
  particles = []; tracers = []; dDinos = []; topLava = []; farLava = [];
  curSector = 0; interTimer = 0; lastTs = 0; fc = 0;
  labHP = LAB_MAX; breachWobble = 0; zoom = 1;
  banner = ''; bannerTimer = 0; shake = 0; flash = 0; winElapsed = 0;
  startTime = Date.now();
  startTransit(0);
  upPanel();
}

// ════════════════════════════════════════════════════════════════════════════
//  MODE 1 — DRIVE TO LAB  (top-down: stay on the curvy dirt road to the lab)
// ════════════════════════════════════════════════════════════════════════════
function makePath(seed){
  const pts = [], N = 22, ph = seed * 1.7;
  for (let i = 0; i <= N; i++){
    const y = i * T_SEG;
    const x = Math.sin(i*0.52 + ph)*150 + Math.sin(i*0.21 + ph*1.4)*84;
    pts.push({ x, y });
  }
  const segLen = []; let total = 0;
  for (let i = 0; i < N; i++){ const l = Math.hypot(pts[i+1].x-pts[i].x, pts[i+1].y-pts[i].y); segLen.push(l); total += l; }
  // trees scattered off the road
  const trees = [];
  for (let i = 1; i < N; i++){
    for (const side of [-1, 1]){
      if (Math.random() < 0.85){
        const a = pts[i], b = pts[i+1];
        const tx = b.x-a.x, ty = b.y-a.y, tl = Math.hypot(tx,ty)||1;
        const nx = -ty/tl, ny = tx/tl;            // road normal
        const off = side * (ROAD_HALF + rand(26, 150));
        trees.push({ x: a.x + nx*off, y: a.y + ny*off + rand(-50,50), r: rand(16,30) });
      }
    }
  }
  // a smoking volcano landmark off to one side near the lab end
  const end = pts[N];
  const volcano = { x: end.x - 360, y: end.y - 90 };
  return { pts, N, segLen, total, trees, volcano, lab: end };
}
function pathProject(path, x, y){
  let best = { d2: Infinity, s: 0, px: 0, py: 0 }, acc = 0;
  for (let i = 0; i < path.N; i++){
    const a = path.pts[i], b = path.pts[i+1];
    const abx = b.x-a.x, aby = b.y-a.y, len2 = abx*abx + aby*aby || 1;
    const t = clamp(((x-a.x)*abx + (y-a.y)*aby)/len2, 0, 1);
    const px = a.x + abx*t, py = a.y + aby*t, d2 = (x-px)**2 + (y-py)**2;
    if (d2 < best.d2) best = { d2, s: acc + t*path.segLen[i], px, py };
    acc += path.segLen[i];
  }
  return { dist: Math.sqrt(best.d2), progress: best.s/path.total };
}
function pointAtProgress(path, f){
  let s = clamp(f,0,1) * path.total;
  for (let i = 0; i < path.N; i++){
    if (s <= path.segLen[i] || i === path.N-1){
      const a = path.pts[i], b = path.pts[i+1], t = clamp(s/(path.segLen[i]||1), 0, 1);
      return { x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t), tx: b.x-a.x, ty: b.y-a.y };
    }
    s -= path.segLen[i];
  }
  const e = path.pts[path.N]; return { x: e.x, y: e.y, tx: 0, ty: 1 };
}
function startTransit(sector){
  curSector = sector;
  // sector 3 = helicopter canyon flight, sector 4 = hang glider vs pterodactyls, else drive
  if (sector === 2) return startFlight(sector, 'heli');
  if (sector === 3) return startFlight(sector, 'glider');
  mode = 'transit';
  players.forEach((p,i) => {
    const path = makePath(sector*2 + i);
    const h0 = Math.atan2(path.pts[1].x - path.pts[0].x, path.pts[1].y - path.pts[0].y);
    p.t = { path, x: path.pts[0].x, y: path.pts[0].y, heading: h0, speed: 0,
            progress: 0, arrived: false, bump: 0, ram: 0, dinos: [], spawn: 70, offroad: false };
  });
  setBanner(`DRIVE TO LAB ${sector+1}!`, 130);
  upPanel();
}
function spawnTransitDino(p){
  const cfg = T_CFG[curSector], tt = p.t;
  const ahead = pointAtProgress(tt.path, Math.min(0.97, tt.progress + 0.14));
  const tl = Math.hypot(ahead.tx, ahead.ty) || 1, nx = -ahead.ty/tl, ny = ahead.tx/tl;
  const side = Math.random() < 0.5 ? -1 : 1;
  const off = side * rand(ROAD_HALF + 40, ROAD_HALF + 130);   // start out in the brush off to one side
  const kinds = curSector >= 1 ? ['raptor','raptor','trex','ptero'] : ['raptor','raptor','raptor','ptero'];
  const kind = kinds[(Math.random()*kinds.length)|0];
  tt.dinos.push({ x: ahead.x + nx*off, y: ahead.y + ny*off, kind, wob: Math.random()*TAU });
}
function updateTransitPlayer(p, k){
  const tt = p.t, cfg = T_CFG[curSector];
  if (tt.arrived){ tt.dinos.length = 0; return; }
  const proj = pathProject(tt.path, tt.x, tt.y);
  tt.progress = Math.max(tt.progress, proj.progress);
  tt.offroad = proj.dist > ROAD_HALF;

  // steering + throttle
  let thr = 0, steer = 0;
  if (AUTOPLAY){
    const look = pointAtProgress(tt.path, Math.min(1, proj.progress + 0.05));
    const desired = Math.atan2(look.x - tt.x, look.y - tt.y);
    steer = clamp(angDiff(desired, tt.heading) * 2.4, -1, 1);
    thr = 1;
    // nudge around a dino sitting right in front
    for (const d of tt.dinos){
      const dist = Math.hypot(d.x-tt.x, d.y-tt.y);
      if (dist < 150){ const rel = angDiff(Math.atan2(d.x-tt.x, d.y-tt.y), tt.heading);
        if (Math.abs(rel) < 0.5) steer = clamp(steer + (rel >= 0 ? -0.8 : 0.8), -1, 1); }
    }
  } else {
    if (keys[p.controls.up]) thr += 1;
    if (keys[p.controls.down]) thr -= 1;
    if (keys[p.controls.left]) steer -= 1;
    if (keys[p.controls.right]) steer += 1;
  }
  tt.heading += steer * T_TURN * k;

  const maxs = T_MAXSPD * (tt.offroad ? T_OFFROAD : 1);
  if (thr > 0) tt.speed += T_ACCEL * k;
  else if (thr < 0) tt.speed -= T_ACCEL * k;
  tt.speed *= Math.pow(T_FRICTION, k);
  tt.speed = clamp(tt.speed, T_REVSPD, maxs);
  if (tt.bump > 0){ tt.bump -= k; tt.speed = Math.min(tt.speed, T_MAXSPD*0.3); }
  if (tt.ram > 0) tt.ram -= k;
  tt.x += Math.sin(tt.heading) * tt.speed * k;
  tt.y += Math.cos(tt.heading) * tt.speed * k;

  if (tt.progress >= T_ARRIVE && !tt.arrived){ tt.arrived = true; tt.speed = 0; playArrive(); }

  // spawn + creep dinos toward the jeep; collisions are bumps, never deaths
  tt.spawn -= k;
  if (tt.spawn <= 0 && tt.dinos.length < 5){ spawnTransitDino(p); tt.spawn = cfg.every * rand(0.8, 1.4); }
  const wantRam = !AUTOPLAY && firePressed(p);
  for (let i = tt.dinos.length-1; i >= 0; i--){
    const d = tt.dinos[i];
    let dx = tt.x - d.x, dy = tt.y - d.y, dist = Math.hypot(dx, dy) || 1;
    d.wob += 0.1*k;
    d.x += (dx/dist) * T_DINO_SPD * DINO[d.kind].spd * cfg.spd * k;
    d.y += (dy/dist) * T_DINO_SPD * DINO[d.kind].spd * cfg.spd * k;
    const ahead = angDiff(Math.atan2(d.x-tt.x, d.y-tt.y), tt.heading);
    if (dist < T_RAM_DIST && Math.abs(ahead) < 0.7 && (wantRam || (AUTOPLAY && dist < 40)) && tt.ram <= 0){
      tt.ram = T_RAM_CD; p.score += 1; playRam(); tt.dinos.splice(i,1); continue;
    }
    if (dist < 34 && tt.bump <= 0){
      tt.bump = T_BUMP_FR; tt.speed *= -0.3; shake = Math.max(shake, 9); playHit();
      tt.dinos.splice(i,1); continue;
    }
    if (dist > 1000) tt.dinos.splice(i,1);
  }
}
function updateTransit(k){
  players.forEach(p => updateTransitPlayer(p, k));
  if (players.every(p => p.t.arrived)) goDefend();
}

// ════════════════════════════════════════════════════════════════════════════
//  MODE 1b — FLIGHT TRANSIT  (helicopter canyon run / hang glider vs pteros)
//  Forward auto-scroll through a canyon: steer left/right off the walls,
//  and up/down to hold altitude. A clean forward path — no throttle needed.
// ════════════════════════════════════════════════════════════════════════════
function makeCanyon(seed, vehicle){
  const pts = [], N = 26, ph = seed * 1.9;
  for (let i = 0; i <= N; i++){
    const s = i * (FLY_LEN / N);
    const cx = Math.sin(i*0.42 + ph)*90 + Math.sin(i*0.19 + ph*1.3)*60;
    pts.push({ s, cx });
  }
  // obstacles: canyon-side rock spurs (heli) or rocky crags to weave around (glider)
  const rocks = [];
  for (let i = 2; i < N-1; i++){
    if (Math.random() < 0.55){
      const side = Math.random() < 0.5 ? -1 : 1;
      rocks.push({ s: pts[i].s + rand(-30,30), side, depth: rand(0.35, 0.62) });
    }
  }
  return { pts, N, rocks, vehicle };
}
function canyonCenterAt(path, s){
  const seg = FLY_LEN / path.N;
  const i = clamp(Math.floor(s/seg), 0, path.N-1);
  const t = clamp((s - path.pts[i].s)/seg, 0, 1);
  return lerp(path.pts[i].cx, path.pts[i+1].cx, t);
}
function startFlight(sector, vehicle){
  curSector = sector;
  mode = 'flight';
  players.forEach((p,i) => {
    const path = makeCanyon(sector*2 + i, vehicle);
    p.f = { path, vehicle, s: 0, lane: 0, alt: 0.5, arrived: false,
            bump: 0, obstacles: [], spawn: 60, wob: Math.random()*TAU };
  });
  const label = vehicle === 'heli' ? `CHOPPER RUN — SECTOR ${sector+1}!` : `HANG GLIDE — SECTOR ${sector+1}!`;
  setBanner(label, 130);
  upPanel();
}
function spawnFlightObstacle(p){
  const f = p.f;
  if (f.vehicle === 'heli'){
    // a rock spur jutting from one canyon wall — must steer around it
    const side = Math.random() < 0.5 ? -1 : 1;
    f.obstacles.push({ kind: 'rock', side, lane: side * rand(0.6, 0.95), alt: rand(0.2, 0.8), s: f.s + 900, wob: 0 });
  } else {
    // a pterodactyl swooping across the canyon — must dodge up/down/side
    f.obstacles.push({ kind: 'ptero', lane: rand(-0.8, 0.8), alt: rand(0.15, 0.9), s: f.s + 900, wob: Math.random()*TAU, dir: Math.random()<0.5?-1:1 });
  }
}
function updateFlightPlayer(p, k){
  const f = p.f, veh = f.vehicle;
  if (f.arrived){ f.obstacles.length = 0; return; }
  const spd = FLY_SPD[veh] * FLY_CFG[veh].spd;

  let steer = 0, vert = 0;
  if (AUTOPLAY){
    const center = canyonCenterAt(f.path, f.s + 200);
    steer = clamp((center - f.lane*CANYON_HALF)/CANYON_HALF, -1, 1);
    let nearest = null, nd = Infinity;
    for (const o of f.obstacles){ const ds = o.s - f.s; if (ds > 0 && ds < 260 && ds < nd){ nd = ds; nearest = o; } }
    if (nearest){
      if (Math.abs(nearest.lane - f.lane) < 0.35) steer = clamp(steer + (nearest.lane >= 0 ? -0.9 : 0.9), -1, 1);
      if (Math.abs(nearest.alt - f.alt) < 0.22) vert = nearest.alt >= f.alt ? -1 : 1;
    }
    if (veh === 'glider' && vert === 0) vert = f.alt < 0.5 ? 0.3 : -0.1;
  } else {
    if (keys[p.controls.left]) steer -= 1;
    if (keys[p.controls.right]) steer += 1;
    if (keys[p.controls.up]) vert += 1;
    if (keys[p.controls.down]) vert -= 1;
  }

  f.lane = clamp(f.lane + steer * (FLY_HSPD[veh]/CANYON_HALF) * k, -1, 1);
  if (veh === 'glider' && vert <= 0) vert -= FLY_DRIFT;    // gliders sink without lift
  f.alt = clamp(f.alt + vert * (FLY_VSPD[veh]/100) * k, 0, 1);
  if (f.bump > 0){ f.bump -= k; }
  else { f.s += spd * k; }
  f.wob += 0.08*k;

  // canyon walls: drifting past the lane edge bumps you back (never a hard stop)
  const center = canyonCenterAt(f.path, f.s);
  const worldX = center + f.lane*CANYON_HALF;
  if (Math.abs(f.lane) > 0.97 && f.bump <= 0){
    f.bump = FLY_BUMP_FR; f.lane = clamp(f.lane, -0.9, 0.9); shake = Math.max(shake, 8); playHit();
  }
  // glider can't sink to the canyon floor or soar out the top — soft bounds already via clamp(alt,0,1)
  if (f.alt <= 0.02 && f.bump <= 0 && veh === 'glider'){ f.bump = FLY_BUMP_FR*0.6; f.alt = 0.08; shake = Math.max(shake, 6); playHit(); }

  if (f.s >= FLY_LEN*FLY_ARRIVE && !f.arrived){ f.arrived = true; playArrive(); }

  // spawn + advance obstacles
  f.spawn -= k;
  if (f.spawn <= 0){ spawnFlightObstacle(p); f.spawn = FLY_CFG[veh].every * rand(0.8, 1.3); }
  for (let i = f.obstacles.length-1; i >= 0; i--){
    const o = f.obstacles[i];
    if (o.kind === 'ptero') o.lane += o.dir * 0.006 * k;
    const ds = o.s - f.s;
    if (ds < -200){ f.obstacles.splice(i,1); continue; }
    const close = Math.abs(ds) < 30 && Math.abs(o.lane - f.lane) < 0.22 && Math.abs(o.alt - f.alt) < 0.16;
    if (close && f.bump <= 0){
      f.bump = FLY_BUMP_FR; shake = Math.max(shake, 10); playHit();
      f.obstacles.splice(i,1); continue;
    }
  }
  void worldX;
}
function updateFlight(k){
  players.forEach(p => updateFlightPlayer(p, k));
  if (players.every(p => p.f.arrived)) goDefend();
}

// ════════════════════════════════════════════════════════════════════════════
//  MODE 2 — DEFEND THE LAB  (first-person turret: rifle + grenade)
// ════════════════════════════════════════════════════════════════════════════
function goDefend(){
  mode = 'defend';
  const cfg = D_CFG[curSector];
  dDinos = []; tracers = [];
  labHP = Math.min(LAB_MAX, labHP + 3);   // patch up a little between fights
  players.forEach((p,i) => { p.d = { cx: W/2 + (i ? 150 : -150), cy: GND - 90, fireCd: 0, grenCd: 0, recoil: 0 }; });
  defendSpawnLeft = cfg.count; defendAlphaLeft = cfg.alpha; defendSpawnTimer = 50;
  setBanner(`LAB ${curSector+1} — DEFEND!`, 120);
  upPanel();
}
let defendSpawnLeft = 0, defendAlphaLeft = 0, defendSpawnTimer = 0;
function spawnDDino(){
  const cfg = D_CFG[curSector];
  let kind;
  if (defendAlphaLeft > 0 && defendSpawnLeft <= cfg.alpha){ kind = 'alpha'; defendAlphaLeft--; }
  else if (Math.random() < cfg.air) kind = 'ptero';
  else kind = (curSector >= 2 && Math.random() < 0.28) ? 'trex' : 'raptor';
  const d = DINO[kind];
  dDinos.push({ kind, lane: rand(-1, 1), z: 1, alt: d.air ? rand(0.45, 0.95) : 0,
    spd: d.spd * cfg.spd, wob: Math.random()*TAU, weave: rand(0.18, 0.5),
    hp: d.hp, maxHp: d.hp, born: fc });
  defendSpawnLeft--;
}
// project a defend dino to screen-space {x, y, size, near}
function projDefend(di){
  const info = DINO[di.kind], near = 1 - di.z;
  const lane = di.lane + (info.air ? Math.sin(di.wob)*0.18 : Math.sin(di.wob)*0.06*di.weave);
  const spread = lerp(70, W*0.60, near);
  const x = W/2 + lane*spread;
  const y = info.air ? lerp(HZN-30, H*0.44, near) - di.alt*lerp(8, 40, near)
                     : lerp(HZN, GND, near);
  const size = lerp(0.34, 1.75, near) * info.size;
  return { x, y, size, near };
}
function fireCrosshair(p){
  const d = p.d, m = MUZ[p.id];
  tracers.push({ x1: m.x, y1: m.y, x2: d.cx, y2: d.cy, col: p.col, life: 1 });
  d.recoil = 5; playBlast();
  let best = null, bd = Infinity;
  for (const di of dDinos){
    const s = projDefend(di), reach = Math.max(X_HIT_R, s.size*0.55);
    const dist = Math.hypot(s.x - d.cx, s.y - d.cy);
    if (dist < reach && dist < bd){ bd = dist; best = di; }
  }
  if (best){ const s = projDefend(best); damageDino(best, BLAST_DMG, p, s); }
}
function throwGrenade(p){
  const d = p.d;
  d.grenCd = GREN_CD; playGrenade();
  boom(d.cx, d.cy, 80); shake = Math.max(shake, 10); flash = Math.max(flash, 0.3);
  for (let i = dDinos.length-1; i >= 0; i--){
    const di = dDinos[i], s = projDefend(di);
    if (Math.hypot(s.x - d.cx, s.y - d.cy) < GREN_R + s.size*0.4) damageDino(di, GREN_DMG, p, s);
  }
}
function damageDino(di, dmg, p, s){
  di.hp -= dmg;
  sparks(s.x, s.y - s.size*0.3, p.col);
  if (di.hp <= 0){
    const info = DINO[di.kind];
    p.score += info.score;
    boom(s.x, s.y - s.size*0.3, info.size);
    playBoom(info.size);
    if (di.kind === 'trex' || di.kind === 'alpha') playRoar();
    const idx = dDinos.indexOf(di); if (idx >= 0) dDinos.splice(idx, 1);
    upPanel();
  }
}
function labHit(di, s){
  const info = DINO[di.kind];
  labHP -= info.dmg;
  boom(s.x, s.y, info.size*0.7);
  shake = Math.max(shake, 12); flash = Math.max(flash, 0.7); playHit();
  const idx = dDinos.indexOf(di); if (idx >= 0) dDinos.splice(idx, 1);
  if (labHP <= 0){ labHP = 3; breachWobble = 60; setBanner('LAB BREACH! HOLD THE LINE!', 90); flash = 1; playBreach(); }
  upPanel();
}
function updateDefend(k){
  if (breachWobble > 0) breachWobble -= k;
  const wantScope = players.some(scopePressed);
  zoom = lerp(zoom, wantScope ? SCOPE_ZOOM : 1, ZOOM_EASE);

  players.forEach((p,i) => {
    const d = p.d;
    if (d.recoil > 0) d.recoil -= k;
    if (d.grenCd > 0) d.grenCd -= k;
    d.fireCd -= k;
    if (AUTOPLAY){
      // each boy locks the nearest threat (split so they don't both chase one)
      const sorted = dDinos.slice().sort((a,b) => a.z - b.z);
      const tgt = sorted[i] || sorted[0];
      if (tgt){ const s = projDefend(tgt);
        d.cx = lerp(d.cx, s.x, 0.45); d.cy = lerp(d.cy, clamp(s.y, AIM_MINY, AIM_MAXY), 0.45);
        if (Math.hypot(s.x-d.cx, s.y-d.cy) < X_HIT_R && d.fireCd <= 0){ fireCrosshair(p); d.fireCd = FIRE_CD; } }
      // lob a grenade into a crowd
      if (d.grenCd <= 0){
        let near = 0; for (const di of dDinos){ const s = projDefend(di); if (Math.hypot(s.x-d.cx, s.y-d.cy) < GREN_R) near++; }
        if (near >= 4) throwGrenade(p);
      }
    } else {
      let mx = 0, my = 0;
      if (keys[p.controls.left]) mx -= 1; if (keys[p.controls.right]) mx += 1;
      if (keys[p.controls.up]) my -= 1; if (keys[p.controls.down]) my += 1;
      d.cx = clamp(d.cx + mx*X_SPD_H*k, 26, W-26);
      d.cy = clamp(d.cy + my*X_SPD_V*k, AIM_MINY, AIM_MAXY);
      if (firePressed(p) && d.fireCd <= 0){ fireCrosshair(p); d.fireCd = FIRE_CD; }
      if (grenadePressed(p) && d.grenCd <= 0) throwGrenade(p);
    }
  });

  // dinos close the distance; reaching the wall chips the lab
  for (let i = dDinos.length-1; i >= 0; i--){
    const di = dDinos[i];
    di.wob += 0.12*k;
    di.z -= D_ZSPD * di.spd * k;
    if (di.z <= 0){ labHit(di, projDefend(di)); }
  }

  // spawn the wave
  if (defendSpawnLeft > 0){
    defendSpawnTimer -= k;
    if (defendSpawnTimer <= 0){ spawnDDino(); defendSpawnTimer = D_CFG[curSector].every * rand(0.7, 1.2); }
  } else if (dDinos.length === 0){
    if (curSector >= TOTAL_SECTORS - 1) return goWin();
    mode = 'inter'; interTimer = INTER_FR;
    setBanner(`LAB ${curSector+1} SECURED!`, INTER_FR);
    playSecured();
  }

  for (let i = tracers.length-1; i >= 0; i--){ tracers[i].life -= 0.14*k; if (tracers[i].life <= 0) tracers.splice(i,1); }
}

function goWin(){
  mode = 'win'; winElapsed = Date.now() - startTime; zoom = 1;
  setBanner('ALL LABS SECURED!', 600);
  playWin();
}

// ── Particles (lifted from Space Blasters) ───────────────────────────────────
function boom(cx, cy, r){
  const n = 16;
  for (let i = 0; i < n; i++){ const a = Math.random()*TAU, s = 2 + Math.random()*(r/8); particles.push({ x: cx, y: cy, vx: Math.cos(a)*s, vy: Math.sin(a)*s, r: 3 + Math.random()*(r/9), life:1, decay:0.018+Math.random()*0.02, col: ['#ffcf6b','#ff7a3a','#9bd14a','#6e9a3a'][(Math.random()*4)|0] }); }
}
function sparks(cx, cy, col){
  for (let i = 0; i < 7; i++){ const a = Math.random()*TAU, s = 2+Math.random()*3.5; particles.push({ x: cx, y: cy, vx: Math.cos(a)*s, vy: Math.sin(a)*s, r: 2+Math.random()*2, life:1, decay:0.05, col }); }
}
function updatePfx(k){
  for (let i = particles.length-1; i >= 0; i--){ const p = particles[i]; p.x += p.vx*k; p.y += p.vy*k; p.vx *= 0.97; p.vy *= 0.97; p.life -= p.decay*k; p.r *= 0.985; if (p.life <= 0) particles.splice(i,1); }
}

// ── Lava blobs — the volcano lobs medium chunks of lava (visual only, never hits) ──
const LAVA_EVERY = 55, LAVA_ARC = 46;
function spawnLavaBlob(list){
  const a = rand(-0.55, 0.55) - Math.PI/2;   // mostly upward, slight scatter
  const spd = rand(2.6, 3.8);
  list.push({ x: 0, y: 0, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, t: 0, r: rand(5, 9) });
}
function updateLava(list, k){
  for (let i = list.length-1; i >= 0; i--){
    const b = list[i];
    b.t += k; b.x += b.vx*k; b.y += b.vy*k + b.t*0.05*k; b.vy += 0.05*k;   // gravity arc
    if (b.t > LAVA_ARC) list.splice(i,1);
  }
}
function drawLavaBlobs(list){
  for (const b of list){
    const fade = clamp(1 - b.t/LAVA_ARC, 0, 1);
    ctx.fillStyle = `rgba(255,${120+((1-fade)*60|0)},40,${0.55+0.45*fade})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r*(0.6+0.4*fade), 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(255,220,120,${0.5*fade})`;
    ctx.beginPath(); ctx.arc(b.x, b.y*1, b.r*0.4*fade, 0, TAU); ctx.fill();
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Loop
// ════════════════════════════════════════════════════════════════════════════
function loop(ts){
  const dt = lastTs ? Math.min(ts-lastTs, 50) : 16; lastTs = ts; fc++;
  const k = dt/16.67;
  if (mode === 'transit') updateTransit(k);
  else if (mode === 'flight') updateFlight(k);
  else if (mode === 'defend') updateDefend(k);
  else if (mode === 'inter'){ interTimer -= k; if (interTimer <= 0) startTransit(curSector + 1); }
  updatePfx(k);
  updateLava(topLava, k); updateLava(farLava, k);
  if ((mode === 'transit' || mode === 'flight') && fc % LAVA_EVERY === 0) spawnLavaBlob(topLava);
  if ((mode === 'defend' || mode === 'inter') && fc % LAVA_EVERY === 0) spawnLavaBlob(farLava);
  if (bannerTimer > 0) bannerTimer -= k;
  if (shake > 0) shake = Math.max(0, shake - dt*0.04);
  if (flash > 0) flash = Math.max(0, flash - dt*0.004);
  render();
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(loop);
}

// ════════════════════════════════════════════════════════════════════════════
//  Render
// ════════════════════════════════════════════════════════════════════════════
function render(){
  ctx.clearRect(0,0,W,H);
  if (mode === 'transit') drawTransit();
  else if (mode === 'flight') drawFlight();
  else drawDefend();          // defend / inter / win all draw the compound
  if (flash > 0){ ctx.fillStyle = `rgba(255,255,255,${flash*0.5})`; ctx.fillRect(0,0,W,H); }
  drawHUD();
  if (mode === 'win') drawWon();
}

// ── Shared scenery ───────────────────────────────────────────────────────────
// Top-down caldera + lava lake for the driving view
function drawVolcanoTop(x, y, scale){
  const glow = 0.55 + Math.sin(fc*0.07)*0.18;
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = '#2c2420'; ctx.beginPath(); ctx.ellipse(0, 0, 150, 130, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3a2a22'; ctx.beginPath(); ctx.ellipse(0, 0, 110, 96, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(255,120,30,${0.35*glow})`; ctx.beginPath(); ctx.ellipse(0, 0, 78, 66, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(255,210,80,${glow})`; ctx.beginPath(); ctx.ellipse(0, 0, 44, 38, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.ellipse(0, 0, 16, 13, 0, 0, TAU); ctx.fill();
  // lava cracks creeping out
  ctx.strokeStyle = `rgba(255,140,40,${glow})`; ctx.lineWidth = 5;
  for (let i = 0; i < 5; i++){ const a = i/5*TAU + 0.3; ctx.beginPath(); ctx.moveTo(Math.cos(a)*40, Math.sin(a)*34); ctx.lineTo(Math.cos(a)*140, Math.sin(a)*120); ctx.stroke(); }
  drawLavaBlobs(topLava);
  ctx.restore();
}
// Far mountain silhouette + lava + smoke for the defend horizon
function drawVolcanoFar(cx, baseY, scale){
  const glow = 0.55 + Math.sin(fc*0.06)*0.2;
  ctx.save(); ctx.translate(cx, baseY); ctx.scale(scale, scale);
  // smoke plume
  ctx.fillStyle = 'rgba(60,55,60,0.5)';
  for (let i = 0; i < 4; i++){ const t = (fc*0.4 + i*40)%160; ctx.globalAlpha = 0.4*(1 - t/160); ctx.beginPath(); ctx.arc(Math.sin((fc+i*30)*0.02)*18, -150 - t, 18 + t*0.18, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  // cone
  ctx.fillStyle = '#2a211d'; ctx.beginPath(); ctx.moveTo(-150, 0); ctx.lineTo(-30, -150); ctx.lineTo(30, -150); ctx.lineTo(150, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3a2c25'; ctx.beginPath(); ctx.moveTo(-150, 0); ctx.lineTo(-26, -146); ctx.lineTo(10, -146); ctx.lineTo(60, 0); ctx.closePath(); ctx.fill();
  // crater lava
  ctx.fillStyle = `rgba(255,160,50,${glow})`; ctx.beginPath(); ctx.ellipse(-8, -148, 22, 7, 0, 0, TAU); ctx.fill();
  // lava streaks down the slope
  ctx.strokeStyle = `rgba(255,110,30,${glow})`; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8, -146); ctx.lineTo(-40, -70); ctx.lineTo(-66, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -146); ctx.lineTo(18, -60); ctx.lineTo(34, 0); ctx.stroke();
  ctx.save(); ctx.translate(-8, -148); drawLavaBlobs(farLava); ctx.restore();
  ctx.restore();
}

// ── Transit render (two top-down driver routes side by side) ──────────────────
function drawTransit(){
  drawTransitHalf(players[0], 0);
  drawTransitHalf(players[1], W/2);
  ctx.fillStyle = '#04110a'; ctx.fillRect(W/2 - 3, 0, 6, H);
  ctx.fillStyle = '#5fae4a'; ctx.fillRect(W/2 - 1, 0, 2, H);
}
function drawTransitHalf(p, ox){
  const tt = p.t, path = tt.path, hcx = ox + W/4;
  const w2sx = wx => hcx + (wx - tt.x)*T_VIEW;
  const w2sy = wy => T_ANCHOR - (wy - tt.y)*T_VIEW;
  const vis = (sx, sy, pad=140) => sx > ox-pad && sx < ox+W/2+pad && sy > -pad && sy < H+pad;

  ctx.save();
  ctx.beginPath(); ctx.rect(ox, 0, W/2, H); ctx.clip();
  const sh = (tt.bump > 0) ? (Math.random()-0.5)*7 : 0;
  ctx.translate(sh, 0);

  // jungle floor
  const g = ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#16411f'); g.addColorStop(1,'#0e2e16');
  ctx.fillStyle = g; ctx.fillRect(ox, 0, W/2, H);

  // volcano landmark + lava lake
  { const vx = w2sx(path.volcano.x), vy = w2sy(path.volcano.y); if (vis(vx, vy, 240)) drawVolcanoTop(vx, vy, T_VIEW*0.9); }

  // the dirt road (thick poly through the world)
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#6a4f29'; ctx.lineWidth = ROAD_HALF*2*T_VIEW;
  ctx.beginPath();
  for (let i = 0; i <= path.N; i++){ const x = w2sx(path.pts[i].x), y = w2sy(path.pts[i].y); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); } ctx.stroke();
  ctx.strokeStyle = '#7d5e32'; ctx.lineWidth = (ROAD_HALF*2-12)*T_VIEW; ctx.stroke();
  // center track dashes
  ctx.strokeStyle = 'rgba(40,28,12,0.5)'; ctx.lineWidth = 3; ctx.setLineDash([10, 14]);
  ctx.beginPath();
  for (let i = 0; i <= path.N; i++){ const x = w2sx(path.pts[i].x), y = w2sy(path.pts[i].y); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); } ctx.stroke();
  ctx.setLineDash([]);

  // trees
  for (const t of path.trees){ const x = w2sx(t.x), y = w2sy(t.y); if (vis(x,y)) drawTreeTop(x, y, t.r*T_VIEW); }

  // lab marker at the end of the road
  { const lx = w2sx(path.lab.x), ly = w2sy(path.lab.y); if (vis(lx, ly, 200)) drawLabMarker(lx, ly); }

  // dinos on the road (top-down, facing the jeep)
  for (const d of tt.dinos){ const x = w2sx(d.x), y = w2sy(d.y); if (!vis(x,y)) continue;
    const ang = Math.atan2(tt.x - d.x, tt.y - d.y); drawDinoTopAt(d.kind, x, y, ang, DINO[d.kind].size*T_VIEW, 1, d.wob); }

  // the jeep (always centered at the anchor, rotated to heading)
  drawJeepTop(hcx, T_ANCHOR, tt.heading, p.col, tt.bump > 0);

  // progress + status
  const bw = W/2 - 60, bx = ox + 30, by = 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(bx-3, by-3, bw+6, 16, 5); ctx.fill();
  ctx.fillStyle = p.col; rr(bx, by, bw*clamp(tt.progress,0,1), 10, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(tt.arrived ? '✓ AT LAB' : `${p.name} — FOLLOW THE ROAD`, hcx, by + 30);
  if (!tt.arrived && tt.offroad && fc % 30 < 18){ ctx.fillStyle = '#ffd23a'; ctx.font = 'bold 15px Arial'; ctx.fillText('⚠ OFF ROAD — STEER BACK!', hcx, H - 26); }
  ctx.restore();
}
function drawTreeTop(x, y, r){
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(r*0.3, r*0.3, r*1.05, r*0.9, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1f5026'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2f6e34'; ctx.beginPath(); ctx.arc(-r*0.3, -r*0.3, r*0.7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3f8a40'; ctx.beginPath(); ctx.arc(-r*0.4, -r*0.4, r*0.32, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawLabMarker(x, y){
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, 8, 46, 24, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2d6f8c'; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3f97b8'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();
  ctx.fillStyle = (fc % 40 < 20) ? '#ff5a4a' : '#7a1f17'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText('LAB', 0, -44);
  ctx.restore();
}
function drawJeepTop(x, y, heading, col, bumped){
  ctx.save(); ctx.translate(x, y); ctx.rotate(heading);
  if (bumped && fc % 4 < 2) ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(-19, -25, 40, 54, 8); ctx.fill();
  // tires
  ctx.fillStyle = '#141414';
  for (const wy of [-16, 16]) for (const wx of [-20, 20]){ rr(wx-6, wy-9, 12, 18, 3); ctx.fill(); }
  // body
  ctx.fillStyle = col; rr(-17, -26, 34, 52, 8); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; rr(-17, -26, 34, 16, 8); ctx.fill();
  // hood + grille
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; rr(-13, -24, 26, 9, 3); ctx.fill();
  ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(-11, -25, 3, 0, TAU); ctx.arc(11, -25, 3, 0, TAU); ctx.fill();
  // roll cage + seats (open top)
  ctx.fillStyle = '#23341f'; rr(-13, -10, 26, 30, 5); ctx.fill();
  ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 3; ctx.strokeRect(-13, -8, 26, 26);
  ctx.fillStyle = '#3a2c1c'; rr(-11, -6, 9, 10, 2); ctx.fill(); rr(2, -6, 9, 10, 2); ctx.fill();
  // spare tire on the back
  ctx.fillStyle = '#141414'; ctx.beginPath(); ctx.arc(0, 24, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(0, 24, 3, 0, TAU); ctx.fill();
  ctx.restore();
}

// ── Flight render (forward-scrolling canyon, split-screen per player) ────────
const FLY_HZN = H * 0.34, FLY_GND = H * 0.90;
function flyProj(lane, alt, depth){          // depth: 0 = at camera .. 1 = far away
  const near = 1 - clamp(depth, 0, 1);
  const spread = lerp(CANYON_HALF*0.55, W*0.5, near);
  const x = W/4 + lane*spread;
  const y = lerp(FLY_HZN, FLY_GND, alt) - (1-near)*0;
  const yFar = lerp(FLY_HZN + 10, y, near);
  const size = lerp(0.28, 1.5, near);
  return { x, y: yFar, size, near };
}
function drawFlight(){
  drawFlightHalf(players[0], 0);
  drawFlightHalf(players[1], W/2);
  ctx.fillStyle = '#04110a'; ctx.fillRect(W/2 - 3, 0, 6, H);
  ctx.fillStyle = '#5fae4a'; ctx.fillRect(W/2 - 1, 0, 2, H);
}
function drawFlightHalf(p, ox){
  const f = p.f, veh = f.vehicle, isGlider = veh === 'glider';
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, 0, W/2, H); ctx.clip();
  const sh = (f.bump > 0) ? (Math.random()-0.5)*7 : 0;
  ctx.translate(ox + sh, 0);
  const hw = W/2;

  // sky + canyon floor
  const sky = ctx.createLinearGradient(0,0,0,FLY_HZN);
  if (isGlider){ sky.addColorStop(0,'#3a6ea8'); sky.addColorStop(1,'#8fb8d8'); }
  else { sky.addColorStop(0,'#1a2a44'); sky.addColorStop(1,'#5a3c4a'); }
  ctx.fillStyle = sky; ctx.fillRect(0,0,hw,FLY_HZN);
  const gr = ctx.createLinearGradient(0,FLY_HZN,0,H);
  gr.addColorStop(0,'#5a4632'); gr.addColorStop(1,'#2c2016');
  ctx.fillStyle = gr; ctx.fillRect(0,FLY_HZN,hw,H-FLY_HZN);

  // canyon walls (rocky cliffs converging toward the horizon, framing the lane)
  const wallGlow = 0.5 + Math.sin(fc*0.05)*0.1;
  ctx.fillStyle = '#3a2c22';
  ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(0,FLY_HZN-20); ctx.lineTo(hw*0.30,FLY_HZN); ctx.lineTo(hw*0.12,H); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hw,H); ctx.lineTo(hw,FLY_HZN-20); ctx.lineTo(hw*0.70,FLY_HZN); ctx.lineTo(hw*0.88,H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,140,60,${0.06*wallGlow})`;
  ctx.fillRect(0, FLY_HZN, hw*0.14, H-FLY_HZN); ctx.fillRect(hw*0.86, FLY_HZN, hw*0.14, H-FLY_HZN);

  // distant volcano landmark
  drawVolcanoFar(hw*0.5, FLY_HZN, 0.62);

  // obstacles far→near
  const sorted = f.obstacles.slice().sort((a,b) => (b.s-f.s) - (a.s-f.s));
  for (const o of sorted){
    const depth = clamp((o.s - f.s)/900, 0, 1);
    const s = flyProj(o.lane, o.alt, depth);
    if (o.kind === 'rock') drawCanyonRock(s.x, s.y, s.size);
    else drawPteroObstacle(s.x, s.y, s.size, o.wob);
  }

  // the vehicle (heli or glider), anchored near the bottom, drifts with lane/alt
  const vx = hw/2 + f.lane*(hw*0.30);
  const vy = lerp(FLY_HZN+40, FLY_GND-10, f.alt);
  if (isGlider) drawGliderFront(vx, vy, p.col, f.bump>0, f.wob);
  else drawHeliFront(vx, vy, p.col, f.bump>0, f.wob);

  // progress + status
  const bw = hw - 60, bx = 30, by = 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(bx-3, by-3, bw+6, 16, 5); ctx.fill();
  ctx.fillStyle = p.col; rr(bx, by, bw*clamp(f.s/FLY_LEN,0,1), 10, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  const label = isGlider ? `${p.name} — DODGE THE PTEROS!` : `${p.name} — THREAD THE CANYON!`;
  ctx.fillText(f.arrived ? '✓ THROUGH THE CANYON' : label, hw/2, by + 30);
  ctx.restore();
}
function drawCanyonRock(x, y, size){
  const s = 40*size;
  ctx.save(); ctx.translate(x,y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, s*0.55, s*0.9, s*0.3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#5a4a3a'; ctx.beginPath();
  ctx.moveTo(-s*0.8,s*0.5); ctx.lineTo(-s*0.9,-s*0.1); ctx.lineTo(-s*0.2,-s*0.9); ctx.lineTo(s*0.4,-s*0.7); ctx.lineTo(s*0.85,s*0.1); ctx.lineTo(s*0.6,s*0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7a6650'; ctx.beginPath();
  ctx.moveTo(-s*0.5,s*0.4); ctx.lineTo(-s*0.5,-s*0.1); ctx.lineTo(0,-s*0.6); ctx.lineTo(s*0.4,s*0.3); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawPteroObstacle(x, y, size, wob){
  const s = 46*size, wf = Math.sin(fc*0.28)*(12*size);
  ctx.save(); ctx.translate(x, y + Math.sin(wob)*4);
  ctx.fillStyle = '#9a6a2a';
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-s*1.1,-s*0.26-wf); ctx.lineTo(-s*0.2,s*0.18); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(s*1.1,-s*0.26-wf); ctx.lineTo(s*0.2,s*0.18); ctx.closePath(); ctx.fill();
  ctx.fillStyle = DINO.ptero.col;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-s*0.9,-s*0.13-wf*0.7); ctx.lineTo(-s*0.16,s*0.11); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(s*0.9,-s*0.13-wf*0.7); ctx.lineTo(s*0.16,s*0.11); ctx.closePath(); ctx.fill();
  ctx.fillStyle = DINO.ptero.col2; ctx.beginPath(); ctx.ellipse(0, s*0.05, s*0.2, s*0.28, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e0664a'; ctx.beginPath(); ctx.moveTo(-s*0.15,-s*0.2); ctx.lineTo(0,-s*0.45); ctx.lineTo(s*0.15,-s*0.2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); ctx.moveTo(0,s*0.32); ctx.lineTo(-s*0.12,s*0.08); ctx.lineTo(s*0.12,s*0.08); ctx.closePath(); ctx.fill();
  dotEyes(s*0.08, -s*0.06, s*0.09);
  ctx.restore();
}
function drawHeliFront(x, y, col, bumped, wob){
  ctx.save(); ctx.translate(x, y);
  if (bumped && fc % 4 < 2) ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, 46, 44, 12, 0, 0, TAU); ctx.fill();
  // main rotor blur
  ctx.save(); ctx.rotate(fc*0.9);
  ctx.fillStyle = 'rgba(220,220,220,0.35)'; ctx.beginPath(); ctx.ellipse(0,-40,58,8,0,0,TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#333'; ctx.fillRect(-3,-42,6,10);
  // body
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, 30, 22, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.ellipse(-6, -6, 16, 10, 0, 0, TAU); ctx.fill();
  // cockpit glass
  ctx.fillStyle = '#bfe6f5'; ctx.beginPath(); ctx.ellipse(4, -2, 15, 13, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(0, -6, 6, 4, 0, 0, TAU); ctx.fill();
  // skids
  ctx.strokeStyle = '#222'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-24,26); ctx.lineTo(24,26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-22,16); ctx.lineTo(-24,26); ctx.moveTo(22,16); ctx.lineTo(24,26); ctx.stroke();
  // tail boom + rotor
  ctx.fillStyle = col; ctx.fillRect(-4, 6, 8, 34);
  ctx.save(); ctx.translate(0,40); ctx.rotate(fc*1.3);
  ctx.fillStyle = 'rgba(200,200,200,0.4)'; ctx.beginPath(); ctx.ellipse(0,0,10,2,0,0,TAU); ctx.fill();
  ctx.restore();
  ctx.restore();
}
function drawGliderFront(x, y, col, bumped, wob){
  ctx.save(); ctx.translate(x, y);
  if (bumped && fc % 4 < 2) ctx.globalAlpha = 0.5;
  const flap = Math.sin(wob*1.4)*4;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 40, 40, 10, 0, 0, TAU); ctx.fill();
  // wing (triangular hang-glider sail)
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(0,-30-flap); ctx.lineTo(-56, 8+flap*0.5); ctx.lineTo(-8,4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0,-30-flap); ctx.lineTo(56, 8+flap*0.5); ctx.lineTo(8,4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.moveTo(0,-30-flap); ctx.lineTo(-30, -4+flap*0.3); ctx.lineTo(-8,4); ctx.closePath(); ctx.fill();
  // control bar + pilot
  ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-14,6); ctx.lineTo(14,6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,-4); ctx.lineTo(0,20); ctx.stroke();
  ctx.fillStyle = '#3a2c1c'; ctx.beginPath(); ctx.ellipse(0, 26, 7, 11, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e0b98a'; ctx.beginPath(); ctx.arc(0, 14, 6, 0, TAU); ctx.fill();
  ctx.restore();
}

// ── Top-down detailed dino (driving obstacles) ───────────────────────────────
function drawDinoTopAt(kind, x, y, ang, size, hpFrac, wob){
  const info = DINO[kind], s = size*0.5, step = Math.sin(wob*1.2);
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(0, s*0.45, s*1.0, s*0.5, 0, 0, TAU); ctx.fill();
  if (info.air){
    const wf = Math.sin(wob*2)*s*0.55;
    ctx.fillStyle = info.col;
    for (const sgn of [-1, 1]){ ctx.beginPath(); ctx.moveTo(s*0.1, 0); ctx.lineTo(-s*1.3, sgn*(s*0.8) - wf*sgn); ctx.lineTo(-s*0.2, sgn*s*0.25); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = info.col2;
    for (const sgn of [-1, 1]){ ctx.beginPath(); ctx.moveTo(s*0.1, 0); ctx.lineTo(-s*0.8, sgn*(s*0.5) - wf*sgn*0.6); ctx.lineTo(-s*0.2, sgn*s*0.18); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = info.col; ctx.beginPath(); ctx.ellipse(s*0.25, 0, s*0.7, s*0.28, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); ctx.moveTo(s*1.05, 0); ctx.lineTo(s*0.55, -s*0.16); ctx.lineTo(s*0.55, s*0.16); ctx.closePath(); ctx.fill(); // beak
    ctx.fillStyle = '#e0664a'; ctx.beginPath(); ctx.moveTo(s*0.55, -s*0.18); ctx.lineTo(s*0.1, -s*0.5); ctx.lineTo(s*0.4, -s*0.05); ctx.closePath(); ctx.fill(); // crest
    dotEyes(s*0.55, s*0.15, s*0.1);
    ctx.restore(); return;
  }
  // tail
  ctx.fillStyle = info.col; ctx.beginPath(); ctx.moveTo(-s*1.5, 0); ctx.lineTo(-s*0.5, -s*0.32); ctx.lineTo(-s*0.5, s*0.32); ctx.closePath(); ctx.fill();
  // legs (animated)
  ctx.fillStyle = info.col;
  ctx.save(); ctx.translate(-s*0.05, -s*0.7 - step*s*0.18); rr(-s*0.12, -s*0.18, s*0.3, s*0.5, 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(-s*0.05,  s*0.7 + step*s*0.18); rr(-s*0.12, -s*0.18, s*0.3, s*0.5, 2); ctx.fill(); ctx.restore();
  // body
  ctx.beginPath(); ctx.ellipse(0, 0, s*1.0, s*0.62, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = info.col2; ctx.beginPath(); ctx.ellipse(s*0.1, 0, s*0.6, s*0.38, 0, 0, TAU); ctx.fill();
  // back spikes (alpha/trex)
  if (kind === 'alpha' || kind === 'trex'){ ctx.fillStyle = kind === 'alpha' ? '#7a2418' : '#2c5523';
    for (let i = -1; i <= 2; i++){ ctx.beginPath(); ctx.moveTo(-s*0.3 + i*s*0.34, 0); ctx.lineTo(-s*0.42 + i*s*0.34, -s*0.55); ctx.lineTo(-s*0.18 + i*s*0.34, 0); ctx.closePath(); ctx.fill(); } }
  // head + jaw
  ctx.fillStyle = info.col; ctx.beginPath(); ctx.ellipse(s*0.95, 0, s*0.46, s*0.4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2a0c08'; ctx.beginPath(); ctx.ellipse(s*1.18, 0, s*0.26, s*0.22, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff';
  for (let i = -1; i <= 1; i++){ ctx.beginPath(); ctx.moveTo(s*1.34, i*s*0.13); ctx.lineTo(s*1.18, i*s*0.13 - s*0.05); ctx.lineTo(s*1.18, i*s*0.13 + s*0.05); ctx.closePath(); ctx.fill(); }
  if (kind === 'alpha'){ ctx.fillStyle = '#f0d9a0'; // brow horns
    ctx.beginPath(); ctx.moveTo(s*0.8, -s*0.32); ctx.lineTo(s*1.0, -s*0.62); ctx.lineTo(s*0.95, -s*0.28); ctx.closePath(); ctx.fill(); }
  dotEyes(s*0.92, s*0.2, s*0.11);
  // hp pip for tough ones
  if (hpFrac < 1){ ctx.rotate(-ang); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-14, -s-12, 28, 5); ctx.fillStyle = '#ff6a4a'; ctx.fillRect(-13, -s-11, 26*clamp(hpFrac,0,1), 3); }
  ctx.restore();
}
function dotEyes(fx, dy, r){
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(fx, dy, r, 0, TAU); ctx.arc(fx, -dy, r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(fx, dy, r*0.5, 0, TAU); ctx.arc(fx, -dy, r*0.5, 0, TAU); ctx.fill();
}

// ── Defend render (first-person battlefield) ─────────────────────────────────
function drawDefend(){
  // sky
  const sky = ctx.createLinearGradient(0,0,0,HZN); sky.addColorStop(0,'#1a2a44'); sky.addColorStop(1,'#5a3c4a');
  ctx.fillStyle = sky; ctx.fillRect(0,0,W,HZN);
  // ground
  const gr = ctx.createLinearGradient(0,HZN,0,H); gr.addColorStop(0,'#234a26'); gr.addColorStop(1,'#0c2412');
  ctx.fillStyle = gr; ctx.fillRect(0,HZN,W,H-HZN);

  ctx.save();
  if (shake > 0.3) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
  // scope zoom magnifies the far wave (about the horizon)
  ctx.translate(W/2, HZN); ctx.scale(zoom, zoom); ctx.translate(-W/2, -HZN);

  // volcano on the horizon + distant treeline
  drawVolcanoFar(W*0.30, HZN, 1.0);
  ctx.fillStyle = '#13351c';
  for (let i = 0; i < 14; i++){ const x = (i/13)*W; ctx.beginPath(); ctx.arc(x, HZN, 26 + (i%3)*10, Math.PI, 0); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, HZN, W, 3);
  // ground depth lines for a sense of distance
  ctx.strokeStyle = 'rgba(120,200,120,0.08)'; ctx.lineWidth = 2;
  for (const f of [0.15, 0.35, 0.6, 0.85]){ const y = lerp(HZN, GND, f); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // dinos far→near
  dDinos.slice().sort((a,b) => b.z - a.z).forEach(di => {
    const s = projDefend(di);
    drawDinoFront(di.kind, s.x, s.y, s.size, di.wob, di.hp/di.maxHp);
  });

  drawPfx();
  // tracers
  tracers.forEach(t => { ctx.globalAlpha = Math.max(0, t.life); ctx.strokeStyle = t.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke(); ctx.globalAlpha = 1; });
  ctx.restore();

  // parapet / gun barrels (drawn un-zoomed, the player's own wall)
  drawParapet();
  if (mode === 'defend') players.forEach(drawCrosshair);

  if (mode === 'defend' && zoom > 1.03){ ctx.fillStyle = 'rgba(180,230,180,0.7)'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillText('🔭 SCOPE — FAR WAVE MAGNIFIED', W/2, 74); ctx.textAlign = 'left'; }
}
function drawParapet(){
  // sandbag wall along the bottom — the bird's nest you're firing from
  ctx.fillStyle = '#3a2f1c'; ctx.fillRect(0, H-30, W, 30);
  ctx.fillStyle = '#5a4a2c';
  for (let x = 6; x < W; x += 38){ ctx.beginPath(); ctx.ellipse(x, H-26, 20, 12, 0, Math.PI, 0); ctx.fill(); }
  // two gun barrels in player colors, recoiling when they fire
  players.forEach((p,i) => { const m = MUZ[i], r = (p.d ? p.d.recoil : 0);
    ctx.save(); ctx.translate(m.x, m.y + r*1.2);
    ctx.fillStyle = '#1c1c1c'; rr(-9, -2, 18, 40, 4); ctx.fill();
    ctx.fillStyle = p.col; rr(-9, 30, 18, 12, 4); ctx.fill();
    ctx.fillStyle = '#444'; ctx.beginPath(); ctx.arc(0, -2, 5, 0, TAU); ctx.fill();
    ctx.restore();
  });
}
// head-on "charging at you" dino — detailed, for the defend view
function drawDinoFront(kind, x, y, s, wob, hpFrac){
  const info = DINO[kind]; const c = info.col, c2 = info.col2;
  ctx.save(); ctx.translate(x, y + Math.sin(wob + fc*0.2)*s*0.03);
  const u = s/46;
  if (kind === 'ptero'){
    const wf = Math.sin(fc*0.25)*(10*u);
    // far wing
    ctx.fillStyle = '#9a6a2a';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-50*u, -12*u - wf); ctx.lineTo(-10*u, 8*u); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(50*u, -12*u - wf); ctx.lineTo(10*u, 8*u); ctx.closePath(); ctx.fill();
    // membrane highlight
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-40*u, -6*u - wf*0.7); ctx.lineTo(-8*u, 5*u); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(40*u, -6*u - wf*0.7); ctx.lineTo(8*u, 5*u); ctx.closePath(); ctx.fill();
    // body + crest + beak
    ctx.fillStyle = c2; ctx.beginPath(); ctx.ellipse(0, 2*u, 9*u, 13*u, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e0664a'; ctx.beginPath(); ctx.moveTo(-7*u, -10*u); ctx.lineTo(0, -22*u); ctx.lineTo(7*u, -10*u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); ctx.moveTo(0, 16*u); ctx.lineTo(-6*u, 4*u); ctx.lineTo(6*u, 4*u); ctx.closePath(); ctx.fill();
    frontEyes(-4*u, -3*u, 4*u, 2.6*u);
    hpPip(hpFrac, s); ctx.restore(); return;
  }
  // ground stomper (raptor / trex / alpha)
  const stomp = Math.sin(fc*0.3)*s*0.04;
  ctx.fillStyle = '#000'; ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.ellipse(0, 32*u, 28*u, 7*u, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  // legs with clawed feet
  ctx.fillStyle = c;
  ctx.save(); ctx.translate(-13*u, 6*u + stomp); rr(-5*u, 0, 10*u, 26*u, 3); ctx.fill();
    ctx.fillStyle = '#efe2c0'; for (let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(i*4*u-2*u, 26*u); ctx.lineTo(i*4*u, 32*u); ctx.lineTo(i*4*u+2*u, 26*u); ctx.closePath(); ctx.fill(); } ctx.restore();
  ctx.fillStyle = c;
  ctx.save(); ctx.translate(13*u, 6*u - stomp); rr(-5*u, 0, 10*u, 26*u, 3); ctx.fill();
    ctx.fillStyle = '#efe2c0'; for (let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(i*4*u-2*u, 26*u); ctx.lineTo(i*4*u, 32*u); ctx.lineTo(i*4*u+2*u, 26*u); ctx.closePath(); ctx.fill(); } ctx.restore();
  // body
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 2*u, 25*u, 23*u, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = c2; ctx.beginPath(); ctx.ellipse(0, 8*u, 14*u, 15*u, 0, 0, TAU); ctx.fill();
  // scale speckles
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let i = 0; i < 6; i++){ const a = i/6*TAU; ctx.beginPath(); ctx.arc(Math.cos(a)*13*u, 2*u + Math.sin(a)*11*u, 2.2*u, 0, TAU); ctx.fill(); }
  // little arms
  ctx.fillStyle = c; ctx.save(); ctx.translate(-20*u, -2*u); ctx.rotate(0.5); rr(0, 0, 5*u, 12*u, 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(20*u, -2*u); ctx.rotate(-0.5); rr(-5*u, 0, 5*u, 12*u, 2); ctx.fill(); ctx.restore();
  // head
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, -17*u, 20*u, 17*u, 0, 0, TAU); ctx.fill();
  // brow ridge / horns
  if (kind === 'alpha'){ ctx.fillStyle = '#f0d9a0'; for (const sgn of [-1,1]){ ctx.beginPath(); ctx.moveTo(sgn*10*u, -28*u); ctx.lineTo(sgn*16*u, -44*u); ctx.lineTo(sgn*5*u, -28*u); ctx.closePath(); ctx.fill(); } }
  else if (kind === 'trex'){ ctx.fillStyle = '#2c5523'; ctx.fillRect(-16*u, -30*u, 32*u, 4*u); }
  // open jaw + teeth
  ctx.fillStyle = '#3a0d09'; ctx.beginPath(); ctx.ellipse(0, -8*u, 13*u, 8*u, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = '#fff';
  for (let i = -2; i <= 2; i++){ ctx.beginPath(); ctx.moveTo(i*4.6*u, -11*u); ctx.lineTo(i*4.6*u - 2*u, -4*u); ctx.lineTo(i*4.6*u + 2*u, -4*u); ctx.closePath(); ctx.fill(); }
  // nostrils
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(-5*u, -24*u, 1.6*u, 0, TAU); ctx.arc(5*u, -24*u, 1.6*u, 0, TAU); ctx.fill();
  frontEyes(-8*u, -22*u, 5.5*u, 3.6*u);
  hpPip(hpFrac, s);
  ctx.restore();
}
function frontEyes(dx, y, r, pr){
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(dx, y, r, 0, TAU); ctx.arc(-dx, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#a33'; ctx.beginPath(); ctx.arc(dx, y, pr, 0, TAU); ctx.arc(-dx, y, pr, 0, TAU); ctx.fill();
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(dx, y, pr*0.5, 0, TAU); ctx.arc(-dx, y, pr*0.5, 0, TAU); ctx.fill();
}
function hpPip(hpFrac, s){
  if (hpFrac >= 1) return;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-16, -s*0.85 - 12, 32, 5);
  ctx.fillStyle = '#ff6a4a'; ctx.fillRect(-15, -s*0.85 - 11, 30*clamp(hpFrac,0,1), 3);
}
function drawCrosshair(p){
  const d = p.d;
  ctx.strokeStyle = p.col; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.arc(d.cx, d.cy, 16, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(d.cx-24, d.cy); ctx.lineTo(d.cx-8, d.cy);
  ctx.moveTo(d.cx+8, d.cy); ctx.lineTo(d.cx+24, d.cy);
  ctx.moveTo(d.cx, d.cy-24); ctx.lineTo(d.cx, d.cy-8);
  ctx.moveTo(d.cx, d.cy+8); ctx.lineTo(d.cx, d.cy+24);
  ctx.stroke();
  ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(d.cx, d.cy, 2.5, 0, TAU); ctx.fill();
  // grenade-ready dot under the reticle
  if (d.grenCd <= 0){ ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(d.cx, d.cy+30, 4, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
}
function drawPfx(){
  particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.r), 0, TAU); ctx.fill(); });
  ctx.globalAlpha = 1;
}

// ── HUD (lab health, scores, banner) ─────────────────────────────────────────
function drawHUD(){
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'left';  ctx.fillStyle = P1_COLOR; ctx.fillText(`◀ ${PN.P1.toUpperCase()}  ★${players[0].score}`, 14, 22);
  ctx.textAlign = 'right'; ctx.fillStyle = P2_COLOR; ctx.fillText(`★${players[1].score}  ${PN.P2.toUpperCase()} ▶`, W-14, 22);
  if (mode === 'defend' || mode === 'inter'){
    const n = LAB_MAX, pw = 18, gap = 4, totW = n*(pw+gap)-gap, x0 = W/2 - totW/2, y = 12;
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('LAB', W/2, y+34);
    for (let i = 0; i < n; i++){
      const frac = clamp(labHP - i, 0, 1);
      ctx.fillStyle = '#22351f'; rr(x0+i*(pw+gap), y, pw, 12, 3); ctx.fill();
      if (frac > 0){ ctx.fillStyle = labHP <= 3 ? '#ff5a4a' : '#6fdc4a'; rr(x0+i*(pw+gap), y, pw*frac, 12, 3); ctx.fill(); }
    }
    const rem = defendSpawnLeft + dDinos.length;
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 11px Arial';
    ctx.fillText(`SECTOR ${curSector+1}/${TOTAL_SECTORS}   🦖 ${rem} left`, W/2, 56);
  }
  if (bannerTimer > 0 && banner){ ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,221,90,${Math.min(1,bannerTimer/40)})`; ctx.font = 'bold 22px Arial'; ctx.fillText(banner, W/2, H*0.30); }
  ctx.textAlign = 'left';
}
function drawWon(){
  ctx.fillStyle = 'rgba(4,18,10,0.82)'; ctx.fillRect(0,0,W,H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9fe08a'; ctx.font = 'bold 40px Arial'; ctx.fillText('🦕 ALL LABS SECURED! 🦖', W/2, H*0.30);
  ctx.fillStyle = P1_COLOR; ctx.font = 'bold 22px Arial'; ctx.fillText(`${PN.P1.toUpperCase()}  ★ ${players[0].score}`, W/2, H*0.46);
  ctx.fillStyle = P2_COLOR; ctx.fillText(`${PN.P2.toUpperCase()}  ★ ${players[1].score}`, W/2, H*0.54);
  ctx.fillStyle = '#FFD700'; ctx.font = 'bold 26px Arial'; ctx.fillText(`TEAM TOTAL  ★ ${players[0].score + players[1].score}`, W/2, H*0.64);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 14px Arial'; ctx.fillText(`Time: ${fmtTime(winElapsed)}`, W/2, H*0.71);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = 'bold 12px Arial'; ctx.fillText('Press RESTART ↻ to defend them all again', W/2, H*0.79);
  ctx.textAlign = 'left';
}

// ── HTML panel ───────────────────────────────────────────────────────────────
function upPanel(){
  if (typeof document === 'undefined' || !document.getElementById) return;
  const set = (id, v, prop='textContent') => { const el = document.getElementById(id); if (el) el[prop] = v; };
  const role = mode === 'transit' ? 'DRIVER' : mode === 'flight' ? (curSector===2?'PILOT':'GLIDER') : mode === 'win' ? 'HERO' : 'GUNNER';
  set('p1name', PN.P1.toUpperCase()); set('p2name', PN.P2.toUpperCase());
  set('p1score', '★ ' + players[0].score); set('p2score', '★ ' + players[1].score);
  set('p1role', role); set('p2role', role);
  const el1 = document.getElementById('p1name'); if (el1) el1.style.color = P1_COLOR;
  const el2 = document.getElementById('p2name'); if (el2) el2.style.color = P2_COLOR;
  set('level', `SECTOR ${curSector+1}/${TOTAL_SECTORS}`);
}

// ── Sound (WebAudio beeps, all guarded for headless) ─────────────────────────
let _ac = null;
const ac = () => { if (!_ac) _ac = new (window.AudioContext||window.webkitAudioContext)(); return _ac; };
function beep(f, d, tp='square', v=0.12, dl=0){
  try { const a = ac(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.type = tp; o.frequency.value = f; const t = a.currentTime + dl; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t+d); o.start(t); o.stop(t+d+0.01); } catch(_){}
}
function playBlast()   { beep(840, 0.06, 'square', 0.09); beep(1180, 0.05, 'square', 0.05, 0.01); }
function playGrenade() { beep(90, 0.5, 'sawtooth', 0.3); beep(60, 0.6, 'square', 0.2, 0.04); beep(150, 0.3, 'sawtooth', 0.18, 0.02); }
function playBoom(size){ const b = size>50?70:size>34?110:150; beep(b,0.28,'sawtooth',0.24); beep(b*0.7,0.40,'sawtooth',0.16,0.05); }
function playHit()     { beep(150,0.18,'square',0.20); beep(90,0.22,'sawtooth',0.16,0.03); }
function playRoar()    { beep(120,0.42,'sawtooth',0.26); beep(80,0.55,'sawtooth',0.20,0.06); beep(60,0.6,'sine',0.16,0.12); }
function playRam()     { beep(420,0.08,'square',0.12); beep(260,0.10,'square',0.08,0.03); }
function playArrive()  { beep(660,0.10,'sine',0.14); beep(990,0.12,'sine',0.12,0.06); }
function playSecured() { [523,659,784].forEach((f,i)=>beep(f,0.22,'sine',0.16,i*0.10)); }
function playBreach()  { beep(200,0.5,'sawtooth',0.22); beep(120,0.55,'square',0.16,0.05); }
function playWin()     { [523,659,784,1047,1319].forEach((f,i)=>beep(f,0.45,'sine',0.18,i*0.15)); }

// ── Input ────────────────────────────────────────────────────────────────────
if (typeof addEventListener !== 'undefined'){
  addEventListener('keydown', e => { keys[e.code] = true; if (GAME_KEYS.has(e.code)) e.preventDefault(); });
  addEventListener('keyup',   e => { keys[e.code] = false; });
  addEventListener('mouseup', () => { mouseFire = false; });
  addEventListener('blur',    () => { mouseFire = false; });
}
if (canvas && canvas.addEventListener){
  canvas.addEventListener('mousedown', e => { mouseFire = true; e.preventDefault(); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}
if (typeof document !== 'undefined' && document.getElementById){
  const rb = document.getElementById('brestart');
  if (rb) rb.addEventListener('click', e => { init(); e.currentTarget.blur(); });
}

// ── Start / export ───────────────────────────────────────────────────────────
init();
if (typeof module !== 'undefined' && module.exports){
  module.exports = {
    loop, keys,
    setAutoplay: v => { AUTOPLAY = v; },
    state: () => ({ mode, curSector, labHP, score: players.map(p=>p.score),
      dCount: dDinos.length, spawnLeft: defendSpawnLeft,
      arrived: players.map(p=> (p.t && p.t.arrived) || (p.f && p.f.arrived)) }),
  };
} else if (typeof requestAnimationFrame !== 'undefined'){
  requestAnimationFrame(loop);
}

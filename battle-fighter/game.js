'use strict';
// Battle Fighter -- 2-player co-op world tour. One player runs the aircraft carrier (WASD + Q/E, mash Space to
// launch), the other flies the fighter (arrows, Enter = heat-seeking air-to-air, Right Shift = air-to-ground).
// Five missions on a world map, each with its own scenery and one new thing (subs, bombers, night, a boss).
// The logic half (createState / step) has no DOM so smoke-test.js can run it in plain Node.
// The drawing half only wakes up when a real #gc canvas exists. No real names in this file: P1/P2 only.
(function (root) {

const W = 900, H = 640;
const HORIZON = 300;          // where sky meets sea
const DECK_Y = 500;           // top of the carrier's flight deck
const WATER_Y = DECK_Y + 46;  // carrier waterline
const TOP_SAFE = 74;          // plane stays under the HUD

const TUNE = {
  HULL: 8,                    // carrier can take this many hits (extra room)
  PLANE_HP: 6,                // plane can take this many hits (extra room)
  PRESSES_TO_FIRE: 3,         // mash this many times to launch
  CHARGE_HOLD: 45,            // frames before the charge starts to leak
  CHARGE_LEAK: 0.006,
  FLAK_ELEV: 60,              // launcher aimed at/above this = anti-aircraft, below = missile
  MISSILE_DMG: 2, SHIP_HP: 4, SUB_HP: 2, BOSS_HP: 12, LAND_HP: 3,
  CARRIER_SPEED: 2.2, CARRIER_MIN: 130, CARRIER_MAX: 560,
  PLANE_CRUISE: 3.4, PLANE_BOOST: 5.4, PLANE_CLIMB: 3.6,
  GUN_COOLDOWN: 16, BULLET_SPEED: 8.5,            // Enter: heat-seeking air-to-air missile (unlimited)
  AAM_CONE_DEG: 55, AAM_TURN: 0.14,
  PLANE_INVULN: 70, DOCK_COOLDOWN: 90,
  RALLY_FRAMES: 150, DOWN_FRAMES: 150,
  MAX_BOGIES: 3, MAX_SHIPS: 3,
  PLANE_MISSILES: 4, PLANE_MISSILE_COOLDOWN: 40,   // air-to-surface missiles; refilled by a pass over the carrier
  CONE_DEG: 16, PLANE_CONE_DEG: 30,                // a missile only steers if it is already pointed within this cone of a target
  HOMING: 0.045,
  DEPTH_RANGE: 28, DEPTH_SPEED: 0.9,               // the carrier can slide up/down the screen a little
  LANDING_ASSIST: 900,                             // frames of 'land on the carrier' before the autopilot helps
  SUB_UP: 300, SUB_DOWN: 260, TORPEDO_SPEED: 1.9,  // submarines: frames surfaced / hidden; torpedoes are slow so the carrier can dodge
  CRATE_EVERY: 900, CRATE_FALL: 0.6,               // parachute power-up crates
  RAPID_FRAMES: 600, TRIPLE_SHOTS: 3,
  COMBO_WINDOW: 150,                               // both players score within this many frames = TEAM COMBO
};

// The world tour. lon/lat place the pin on the map; theme picks the scenery; each level adds one new thing.
const LEVELS = [
  { name: 'PACIFIC ISLANDS', place: 'Pacific Ocean', lon: 160, lat: 8, theme: 'sunset',
    need: { ships: 3, land: 2, bogies: 5 }, land: ['radar', 'fuel'], bogieSpeed: 0.9, bombers: 0.2, subs: false, boss: false,
    news: 'Sink the ships, smash the base, shoot down the bogies!' },
  { name: 'NORTH ATLANTIC', place: 'Atlantic Ocean', lon: -30, lat: 55, theme: 'storm',
    need: { ships: 4, land: 3, bogies: 6 }, land: ['radar', 'bunker', 'fuel'], bogieSpeed: 1.0, bombers: 0.25, subs: true, boss: false,
    news: 'NEW: SUBMARINES! Hit them when they pop up. Steer away from torpedoes!' },
  { name: 'DESERT COAST', place: 'Mediterranean Sea', lon: 15, lat: 33, theme: 'desert',
    need: { ships: 4, land: 4, bogies: 8 }, land: ['radar', 'bunker', 'fuel', 'sam'], bogieSpeed: 1.05, bombers: 0.4, subs: true, boss: false,
    news: 'NEW: LOTS OF BOMBERS! Flak them before they reach the carrier.' },
  { name: 'ARCTIC NIGHT', place: 'Arctic Ocean', lon: 40, lat: 74, theme: 'night',
    need: { ships: 5, land: 4, bogies: 8 }, land: ['radar', 'bunker', 'fuel', 'sam'], bogieSpeed: 1.15, bombers: 0.3, subs: true, boss: false,
    news: 'NEW: NIGHT FIGHT! Watch for the blinking lights.' },
  { name: 'VOLCANO FORTRESS', place: 'Ring of Fire', lon: 120, lat: -6, theme: 'volcano',
    need: { ships: 5, land: 4, bogies: 10 }, land: ['radar', 'bunker', 'fuel', 'sam'], bogieSpeed: 1.2, bombers: 0.35, subs: true, boss: true,
    news: 'NEW: BOSS BATTLESHIP! It takes lots of hits. Team up!' },
];
const PLANE_COLORS = ['#3a7bff', '#ff3b3b'];   // alternates blue / red on every launch

const DEG = Math.PI / 180;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ───────────────────────────── state ─────────────────────────────
function createState(seed, round, level) {
  round = round || 0;
  level = clamp(level | 0, 0, LEVELS.length - 1);
  const L = LEVELS[level];
  const S = {
    rng: mulberry32((seed || 1) + round * 7919 + level * 104729),
    t: 0, round, level, L, need: Object.assign({}, L.need), phase: 'play', phaseT: 0, rally: 0, launches: 0,
    carrier: { x: 300, dir: 1, elev: 24, charge: 0, idle: 0, hull: TUNE.HULL, hit: 0, w: 220, recoil: 0, flash: 0, dy: 0 },
    plane: { state: 'deck', stateT: 90, x: 300, y: DECK_Y - 14, vx: 0, vy: 0, dir: 1, hp: TUNE.PLANE_HP, hit: 0,
             colorIdx: (round + 1) % 2, rot: 0, cool: 0, dockCd: 0, trail: [], dockFlash: 0, anyPrev: true, bounce: 0, ammo: TUNE.PLANE_MISSILES, mcool: 0 },
    bogies: [], ships: [], land: [],
    missiles: [], flak: [], bullets: [], enemyShots: [], bombs: [], crates: [],
    parts: [], splashes: [], rings: [],
    goals: { ships: 0, land: 0, bogies: 0 },
    stars: { c: 0, p: 0 },
    spawnT: 120, crateT: 480, banner: '', bannerT: 0, shake: 0, flashT: 0, events: [], fwT: 0,
    power: { rapid: 0, triple: 0 }, floaters: [], lastKill: { c: -9999, p: -9999 }, combos: 0, bossSpawned: false,
  };
  const n = L.land.length;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 760 : 670 + i * 180 / (n - 1);
    S.land.push({ kind: L.land[i], x, y: HORIZON + 20 + (i % 2) * 8, hp: TUNE.LAND_HP, maxhp: TUNE.LAND_HP, dead: false, flash: 0, fireT: 200 + i * 40 });
  }
  for (let i = 0; i < Math.min(TUNE.MAX_SHIPS, L.need.ships); i++) spawnShip(S, 130 + i * 160, 'ship');
  banner(S, L.name, 150);
  return S;
}

function say(S, ev) { S.events.push(ev); }
function banner(S, text, frames) { S.banner = text; S.bannerT = frames || 110; }

// ───────────────────────────── effects ─────────────────────────────
function puff(S, x, y, o) {
  S.parts.push(Object.assign({ x, y, vx: 0, vy: 0, g: 0, life: 30, max: 30, size: 4, grow: 0, color: '#fff', kind: 'dot' }, o));
}
function boom(S, x, y, size) {
  size = size || 1;
  for (let i = 0; i < 16 * size; i++) {
    const a = S.rng() * 6.283, s = (1 + S.rng() * 3.2) * size;
    puff(S, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 22 + S.rng() * 16, max: 38, size: 3 + S.rng() * 4 * size, grow: -0.05,
                    color: ['#ffd23f', '#ff8a1f', '#ff4a1f', '#fff1a8'][(S.rng() * 4) | 0], kind: 'fire' });
  }
  for (let i = 0; i < 5 * size; i++) {
    puff(S, x + (S.rng() - 0.5) * 18, y + (S.rng() - 0.5) * 12, { vx: (S.rng() - 0.5) * 1.2, vy: -0.4 - S.rng() * 0.8, life: 50 + S.rng() * 30, max: 80,
                                                           size: 7 * size, grow: 0.2, color: '#444b5a', kind: 'smoke' });
  }
  if (size >= 1) S.rings.push({ x, y, t: 0, max: 22 + 10 * size });   // shockwave ring
  if (size >= 1.5) S.flashT = Math.max(S.flashT, 6);                 // big ones light up the screen
  S.shake = Math.max(S.shake, 6 * size);
  say(S, size > 1 ? 'bigboom' : 'boom');
}
function splash(S, x, y) {
  S.splashes.push({ x, y, t: 0 });
  for (let i = 0; i < 12; i++) {
    puff(S, x, y, { vx: (S.rng() - 0.5) * 3, vy: -1.5 - S.rng() * 3, g: 0.14, life: 34, max: 34, size: 2.5, color: '#d9f1ff', kind: 'dot' });
  }
  say(S, 'splash');
}

// ───────────────────────────── spawning ─────────────────────────────
function spawnShip(S, x, kind) {
  kind = kind || 'ship';
  const y = kind === 'sub' ? 405 + S.rng() * 25 : kind === 'boss' ? 372 : 330 + S.rng() * 70;
  const hp = kind === 'sub' ? TUNE.SUB_HP : kind === 'boss' ? TUNE.BOSS_HP : TUNE.SHIP_HP;
  S.ships.push({
    kind, x: x || 150 + S.rng() * 400, y, dir: S.rng() < 0.5 ? -1 : 1,
    speed: kind === 'boss' ? 0.25 : 0.35 + S.rng() * 0.3, hp, maxhp: hp,
    fireT: 260 + S.rng() * 260, warn: 0, flash: 0, sinking: 0,
    scale: kind === 'boss' ? 1.2 : 0.6 + (y - 330) / 70 * 0.3, hue: (S.rng() * 3) | 0,
    under: kind === 'sub', subT: kind === 'sub' ? 120 + S.rng() * 120 : 0, fired: false,
  });
}
function spawnBogie(S) {
  const fromLeft = S.rng() < 0.5;
  const bomber = S.rng() < S.L.bombers;
  const y = 90 + S.rng() * (bomber ? 70 : 170);
  S.bogies.push({
    kind: bomber ? 'bomber' : 'jet',
    x: fromLeft ? -40 : W + 40, y, base: y,
    vx: (fromLeft ? 1 : -1) * (bomber ? 1.5 : 2.4 + S.rng() * 1.2) * S.L.bogieSpeed,
    hp: bomber ? 2 : 1, bob: S.rng() * 6.28, fireT: 80 + S.rng() * 120, bombT: 0,
    dying: null, rot: 0, vy: 0, flash: 0, dead: false,
  });
}

// ───────────────────────────── targets and scoring ─────────────────────────────
function groundTargets(S) {          // what missiles can hit: ships on the surface (not diving subs) and live land targets
  const out = [];
  for (const s of S.ships) if (!s.sinking && !s.under) out.push(s);
  for (const l of S.land) if (!l.dead) out.push(l);
  return out;
}
function missileTouches(m, t) {     // ships: the whole hull counts, not just its middle; land targets: a circle
  if (t.sinking === undefined) return dist(m.x, m.y, t.x, t.y) < 26;
  const half = (t.kind === 'boss' ? 92 : t.kind === 'sub' ? 48 : 62) * t.scale;
  return Math.abs(m.x - t.x) < half && m.y > t.y - 34 * t.scale && m.y < t.y + 14 * t.scale;
}
function isDown(t) { return t.sinking ? true : !!t.dead; }

// a TEAM COMBO when both players score close together
function floater(S, x, y, text, seat) { S.floaters.push({ x, y, text, seat, t: 0 }); }
function scored(S, seat) {
  const other = seat === 'c' ? 'p' : 'c';
  S.lastKill[seat] = S.t;
  if (S.t - S.lastKill[other] <= TUNE.COMBO_WINDOW) {
    S.stars.c++; S.stars.p++; S.combos++;
    S.lastKill.c = S.lastKill.p = -9999;
    banner(S, 'TEAM COMBO!', 100); say(S, 'combo');
    floater(S, S.carrier.x, DECK_Y + S.carrier.dy - 100, '+1 ★', 'c'); if (S.plane.state === 'fly') floater(S, S.plane.x, S.plane.y - 30, '+1 ★', 'p');
  }
}

function hitGround(S, t, dmg, seat) {
  seat = seat || 'c';
  if (isDown(t)) return;
  t.hp -= dmg; t.flash = 10;
  if (t.hp > 0) { boom(S, t.x, t.y, 0.6); return; }
  if (t.sinking !== undefined) {           // a ship, sub or the boss
    t.sinking = 1; S.goals.ships++; S.stars[seat]++; floater(S, t.x, t.y - 30, t.kind === 'boss' ? '+3 ★' : '+1 ★', seat);
    if (t.kind === 'boss') { boom(S, t.x, t.y, 2.6); banner(S, 'BOSS SUNK!', 120); S.stars[seat] += 2; }
    else { boom(S, t.x, t.y, 1.6); banner(S, t.kind === 'sub' ? 'SUB SUNK!' : 'SHIP SUNK!', 90); }
    say(S, 'cheer');
  } else {                                 // a land target
    t.dead = true; S.goals.land++; S.stars[seat]++; floater(S, t.x, t.y - 40, '+1 ★', seat); boom(S, t.x, t.y - 6, 1.8); banner(S, 'TARGET DESTROYED!', 90); say(S, 'cheer');
  }
  scored(S, seat);
}

function killBogie(S, b, seat) {
  if (b.dying || b.dead) return;
  S.goals.bogies++; S.stars[seat]++; floater(S, b.x, b.y - 20, '+1 ★', seat);
  banner(S, 'BOGEY DOWN!', 80); say(S, 'cheer');
  if (S.rng() < 0.5) {                      // some explode...
    b.dead = true; boom(S, b.x, b.y, 1.5);
  } else {                                  // ...and some spin into the sea
    b.dying = 'spin'; b.vy = 0.5; b.vx *= 0.6; b.splashY = 330 + S.rng() * 90; say(S, 'whistle');
  }
  scored(S, seat);
}
function hitBogie(S, b, dmg, seat) {
  if (b.dying || b.dead) return;
  b.hp -= dmg; b.flash = 8;
  if (b.hp <= 0) killBogie(S, b, seat);
  else puff(S, b.x, b.y, { vy: -0.3, life: 40, max: 40, size: 6, grow: 0.15, color: '#555', kind: 'smoke' });
}

function hurtCarrier(S, x, y) {
  const c = S.carrier;
  if (S.rally > 0 || c.hull <= 0) return;
  c.hull--; c.hit = 24; boom(S, x, y, 1); S.shake = 10; say(S, 'hurt');
  if (c.hull <= 0) { S.rally = TUNE.RALLY_FRAMES; banner(S, 'RALLY THE FLEET!', TUNE.RALLY_FRAMES); }
}
function hurtPlane(S, x, y) {
  const p = S.plane;
  if (p.state !== 'fly' || p.hit > 0) return;
  p.hp--; p.hit = TUNE.PLANE_INVULN; boom(S, x, y, 0.8); say(S, 'hurt');
  if (p.hp <= 0) { p.state = 'down'; p.stateT = TUNE.DOWN_FRAMES; p.vy = 0.5; p.vx = p.dir * 2; say(S, 'whistle'); }
}

// ───────────────────────────── weapons ─────────────────────────────
function muzzle(c) {               // tip of the launcher barrel: pivot at (72, -6) on the deck, barrel 50 long
  const e = c.elev * DEG;
  return [c.x + c.dir * (72 + Math.cos(e) * 50), DECK_Y + c.dy - 6 - Math.sin(e) * 50];
}
function fireCarrier(S) {
  const c = S.carrier, dir = c.dir, dk = DECK_Y + c.dy;
  const [mx, my] = muzzle(c);
  c.recoil = 10; c.flash = 6;
  if (c.elev >= TUNE.FLAK_ELEV) {                       // anti-aircraft: a fan of three flak shells
    for (const off of [-10, 0, 10]) {
      const a = (c.elev + off) * DEG;
      S.flak.push({ x: mx, y: my, vx: dir * Math.cos(a) * 7.5, vy: -Math.sin(a) * 7.5, life: 62 });
    }
    say(S, 'flak');
  } else {                                              // surface-to-surface missile: it flies where the launcher points
    const rad = c.elev * DEG, base = dir > 0 ? -rad : Math.PI + rad;
    const fan = S.power.triple > 0 ? [-7 * DEG, 0, 7 * DEG] : [0];
    if (S.power.triple > 0) S.power.triple--;
    for (const off of fan) S.missiles.push({ x: mx, y: my, ang: base + off, owner: 'c', cone: TUNE.CONE_DEG * DEG, life: 300 });
    say(S, 'missile');
  }
  for (let i = 0; i < 6; i++) puff(S, mx, my, { vx: dir * (1 + S.rng() * 2), vy: -S.rng() * 1.5, life: 26, max: 26, size: 5, grow: 0.25, color: '#cfd5e0', kind: 'smoke' });
}

function flakBurst(S, f) {
  puff(S, f.x, f.y, { life: 16, max: 16, size: 26, grow: 0.6, color: '#ffe48a', kind: 'fire' });
  for (let i = 0; i < 10; i++) {
    const a = S.rng() * 6.283;
    puff(S, f.x, f.y, { vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5, life: 20, max: 20, size: 2.5, color: '#fff2b0', kind: 'spark' });
  }
  for (const b of S.bogies) if (!b.dying && !b.dead && dist(b.x, b.y, f.x, f.y) < 58) hitBogie(S, b, 1, 'c');
  say(S, 'pop');
}

// ───────────────────────────── main step ─────────────────────────────
function step(S, inp) {
  S.t++;
  if (S.bannerT > 0) S.bannerT--;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - 0.6);
  if (S.flashT > 0) S.flashT--;
  updateParticles(S);
  for (const sp of S.splashes) sp.t++;
  S.splashes = S.splashes.filter(sp => sp.t < 40);
  for (const f of S.floaters) f.t++;
  S.floaters = S.floaters.filter(f => f.t < 60);
  for (const r of S.rings) r.t++;
  S.rings = S.rings.filter(r => r.t < 22);

  if (S.phase === 'win') { winStep(S); return; }

  const c = S.carrier;
  if (c.hit > 0) c.hit--;
  if (c.recoil > 0) c.recoil--;
  if (c.flash > 0) c.flash--;
  if (S.power.rapid > 0) S.power.rapid--;

  if (S.rally > 0) {                                    // hull gone: no-punishment reset. Only the carrier pauses;
    S.rally--;                                          // the fighter keeps flying and nothing can hurt the carrier
    if (S.t % 8 === 0) boom(S, c.x + (S.rng() - 0.5) * 160, DECK_Y + c.dy - 4, 0.6);
    if (S.rally === 0) rallyReset(S);
  } else carrierStep(S, inp.c || {});
  planeStep(S, inp.p || {});
  shipsStep(S);
  landStep(S);
  bogiesStep(S);
  projectilesStep(S);
  cratesStep(S);
  spawnStep(S);

  const g = S.goals, N = S.need;
  if (S.phase === 'play' && g.ships >= N.ships && g.land >= N.land && g.bogies >= N.bogies) {
    S.phase = 'landing'; S.phaseT = 0; banner(S, 'ALL CLEAR!', 150); say(S, 'cheer');   // now the plane has to land on the carrier
    S.crates.length = 0;
  }
  if (S.phase === 'landing') { S.phaseT++; landingCheck(S); }
}

function landingCheck(S) {
  const p = S.plane, c = S.carrier, dk = DECK_Y + c.dy;
  const over = Math.abs(p.x - c.x) < c.w / 2 - 10;
  if (p.state === 'deck' || (p.state === 'fly' && over && p.y >= dk - 52)) touchdown(S);
}
function touchdown(S) {
  const p = S.plane, c = S.carrier;
  p.state = 'landed'; p.x = c.x + c.dir * 14; p.y = DECK_Y + c.dy - 14; p.dir = c.dir; p.vx = 0; p.vy = 0; p.rot = 0;
  S.missiles.length = 0; S.bullets.length = 0; S.flak.length = 0; S.enemyShots.length = 0; S.bombs.length = 0;
  S.bogies = S.bogies.filter(b => !b.dying);
  S.phase = 'win'; S.phaseT = 0; S.fwT = 0;
  banner(S, S.level === LEVELS.length - 1 ? 'WORLD SAVED!' : 'MISSION COMPLETE!', 99999);
  say(S, 'dock'); say(S, 'win');
}
// the autopilot that helps a stuck 'land on the carrier' after a while
function autoLand(S) {
  const p = S.plane, c = S.carrier, dk = DECK_Y + c.dy, dx = c.x - p.x, ty = dk - 44;
  const near = Math.abs(dx) < 170;
  return { left: dx < -25, right: dx > 25, down: near && p.y < ty - 6, up: near && p.y > ty + 6 };
}

function rallyReset(S) {
  S.carrier.hull = TUNE.HULL;
  S.enemyShots.length = 0; S.bombs.length = 0;
  for (const b of S.bogies) if (!b.dying) b.dead = true;
  S.bogies = S.bogies.filter(b => !b.dead);
  for (const s of S.ships) { s.warn = 0; s.fireT = 220 + S.rng() * 150; }
  banner(S, 'BACK IN THE FIGHT!', 90);
}

function carrierStep(S, k) {
  const c = S.carrier;
  if (k.left) { c.x -= TUNE.CARRIER_SPEED; c.dir = -1; }
  if (k.right) { c.x += TUNE.CARRIER_SPEED; c.dir = 1; }
  c.x = clamp(c.x, TUNE.CARRIER_MIN, TUNE.CARRIER_MAX);
  if (k.depthUp) c.dy -= TUNE.DEPTH_SPEED;
  if (k.depthDown) c.dy += TUNE.DEPTH_SPEED;
  c.dy = clamp(c.dy, -TUNE.DEPTH_RANGE, TUNE.DEPTH_RANGE);
  if (k.up) c.elev += 1.2;
  if (k.down) c.elev -= 1.2;
  c.elev = clamp(c.elev, 8, 86);
  const presses = k.presses | 0, need = S.power.rapid > 0 ? 2 : TUNE.PRESSES_TO_FIRE;
  if (presses > 0) {
    c.charge += presses / need; c.idle = 0; say(S, 'tick');
  } else if (++c.idle > TUNE.CHARGE_HOLD) {
    c.charge = Math.max(0, c.charge - TUNE.CHARGE_LEAK);
  }
  if (c.charge >= 0.999) { c.charge = 0; fireCarrier(S); }
}

function planeStep(S, k) {
  const p = S.plane, c = S.carrier, dk = DECK_Y + c.dy;
  if (S.phase === 'landing' && S.phaseT > TUNE.LANDING_ASSIST && p.state === 'fly') k = autoLand(S);
  const rising = !!k.any && !p.anyPrev; p.anyPrev = !!k.any;
  if (p.hit > 0) p.hit--;
  if (p.dockCd > 0) p.dockCd--;
  if (p.dockFlash > 0) p.dockFlash--;
  if (p.cool > 0) p.cool--;
  if (p.mcool > 0) p.mcool--;

  if (p.state === 'deck') {
    p.x = c.x + c.dir * 14; p.y = dk - 14; p.dir = c.dir; p.vx = 0; p.vy = 0; p.rot = 0;
    p.stateT--;
    if (rising || p.stateT <= 0) {            // takeoff needs a fresh key press, not a held key; colour alternates every launch
      p.state = 'fly'; S.launches++; p.colorIdx = (S.launches + S.round) % 2; p.vx = p.dir * TUNE.PLANE_CRUISE; p.vy = -2.4;
      p.hit = 40; p.trail.length = 0; say(S, 'launch');
    }
    return;
  }
  if (p.state === 'down') {
    p.rot += 0.18 * p.dir; p.vy += 0.1; p.x += p.vx * 0.5; p.y += p.vy;
    if (S.t % 3 === 0) puff(S, p.x, p.y, { vy: -0.4, life: 40, max: 40, size: 6, grow: 0.2, color: '#3a3a3a', kind: 'smoke' });
    if (p.y >= dk + 10) { splash(S, p.x, dk + 24); p.state = 'sunk'; p.stateT = 70; }
    return;
  }
  if (p.state === 'sunk') {
    if (--p.stateT <= 0) { p.state = 'deck'; p.stateT = 90; p.hp = TUNE.PLANE_HP; p.ammo = TUNE.PLANE_MISSILES; p.trail.length = 0; banner(S, 'PLANE READY!', 70); }
    return;
  }
  // flying: it cruises on its own; Left/Right turn it (and push it faster), Up/Down climb and dive
  if (p.bounce > 0) p.bounce--;            // after bouncing off an edge, keys can't steer back into it for a moment
  else { if (k.left) p.dir = -1; if (k.right) p.dir = 1; }
  const boosting = (k.left && p.dir < 0) || (k.right && p.dir > 0);
  const tv = p.dir * (boosting ? TUNE.PLANE_BOOST : TUNE.PLANE_CRUISE);
  p.vx += (tv - p.vx) * 0.08;
  const ty = (k.up ? -TUNE.PLANE_CLIMB : 0) + (k.down ? TUNE.PLANE_CLIMB : 0);
  p.vy += (ty - p.vy) * 0.12;
  p.x += p.vx; p.y += p.vy;
  if (p.x < 40) { p.x = 40; p.dir = 1; p.bounce = 28; }
  if (p.x > W - 40) { p.x = W - 40; p.dir = -1; p.bounce = 28; }
  p.y = clamp(p.y, TOP_SAFE, dk - 30);
  p.rot = p.vy * 0.06 * p.dir;
  if (S.t % 2 === 0) { p.trail.push({ x: p.x - p.dir * 28, y: p.y }); if (p.trail.length > 26) p.trail.shift(); }

  const rapid = S.power.rapid > 0;
  if (k.fire && p.cool <= 0) {
    p.cool = rapid ? (TUNE.GUN_COOLDOWN / 2) | 0 : TUNE.GUN_COOLDOWN;
    const a0 = p.dir > 0 ? 0 : Math.PI;
    S.bullets.push({ x: p.x + p.dir * 34, y: p.y, ang: a0, vx: Math.cos(a0) * TUNE.BULLET_SPEED, vy: 0, life: 100, home: true });
    say(S, 'gun');
  }
  if (k.missile && p.mcool <= 0 && p.ammo > 0) {      // air-to-surface missile: points down the way the plane faces
    p.mcool = rapid ? (TUNE.PLANE_MISSILE_COOLDOWN / 2) | 0 : TUNE.PLANE_MISSILE_COOLDOWN; p.ammo--;
    const base = p.dir > 0 ? 0.45 : Math.PI - 0.45;
    const fan = S.power.triple > 0 ? [-0.12, 0, 0.12] : [0];
    if (S.power.triple > 0) S.power.triple--;
    for (const off of fan) S.missiles.push({ x: p.x + p.dir * 22, y: p.y + 8, ang: base + off, owner: 'p', cone: TUNE.PLANE_CONE_DEG * DEG, life: 260 });
    say(S, 'missile');
  }
  // a pass over the deck repairs one hit and reloads the missiles (no landing needed)
  if (p.dockCd <= 0 && Math.abs(p.x - c.x) < c.w / 2 + 20 && p.y > dk - 120 && (p.hp < TUNE.PLANE_HP || p.ammo < TUNE.PLANE_MISSILES)) {
    const fixed = p.hp < TUNE.PLANE_HP;
    if (fixed) p.hp++;
    p.ammo = TUNE.PLANE_MISSILES; p.dockCd = TUNE.DOCK_COOLDOWN; p.dockFlash = 40; say(S, 'dock');
    banner(S, fixed ? 'REPAIRED + RELOADED!' : 'RELOADED!', 60);
  }
  // ramming a bogie hurts both
  for (const b of S.bogies) {
    if (!b.dying && !b.dead && dist(b.x, b.y, p.x, p.y) < 30) { hurtPlane(S, p.x, p.y); killBogie(S, b, 'p'); }
  }
}

function lobShell(S, s, tx) {
  const ty = DECK_Y + S.carrier.dy - 8, T = 100, g = 0.06, y0 = s.y - 14 * s.scale;
  S.enemyShots.push({ kind: 'shell', x: s.x, y: y0, vx: (tx - s.x) / T, vy: (ty - y0) / T - 0.5 * g * T, g, life: 140 });
}
function fireTorpedo(S, s) {
  const c = S.carrier, tx = c.x, ty = WATER_Y + c.dy - 10;
  const a = Math.atan2(ty - s.y, tx - s.x);
  S.enemyShots.push({ kind: 'torpedo', x: s.x, y: s.y + 4, vx: Math.cos(a) * TUNE.TORPEDO_SPEED, vy: Math.sin(a) * TUNE.TORPEDO_SPEED, g: 0, life: 420 });
  banner(S, 'TORPEDO! STEER AWAY!', 90); say(S, 'torpedo');
}
function subStep(S, s) {
  s.subT--;
  if (s.under) {
    if (s.subT <= 0) { s.under = false; s.subT = TUNE.SUB_UP; s.fired = false; splash(S, s.x, s.y); banner(S, 'SUB SURFACING!', 70); say(S, 'sonar'); }
  } else {
    if (!s.fired && s.subT <= TUNE.SUB_UP - 80) { s.fired = true; fireTorpedo(S, s); }
    if (s.subT <= 0) { s.under = true; s.subT = TUNE.SUB_DOWN; splash(S, s.x, s.y); }
  }
}

function shipsStep(S) {
  const c = S.carrier;
  for (const s of S.ships) {
    if (s.flash > 0) s.flash--;
    if (s.sinking) { s.sinking++; if (s.sinking % 6 === 0) puff(S, s.x + (S.rng() - 0.5) * 30 * s.scale, s.y, { vy: -0.5, life: 40, max: 40, size: 6, grow: 0.2, color: '#444', kind: 'smoke' }); continue; }
    s.x += s.dir * s.speed * (s.under ? 1.4 : 1);
    if (s.x < 90) s.dir = 1;
    if (s.x > 600) s.dir = -1;
    if (s.kind === 'sub') { subStep(S, s); continue; }
    if (--s.fireT <= 0) { s.warn = s.kind === 'boss' ? 50 : 36; s.fireT = (s.kind === 'boss' ? 300 : 400) + S.rng() * 280; }
    if (s.warn > 0 && --s.warn === 0) {
      const offs = s.kind === 'boss' ? [-70, 0, 70] : [(S.rng() - 0.5) * 60];
      for (const o of offs) lobShell(S, s, c.x + o);
      say(S, 'shellfire');
    }
  }
  S.ships = S.ships.filter(s => s.sinking < 100);
}

function landStep(S) {
  const p = S.plane;
  for (const l of S.land) {
    if (l.flash > 0) l.flash--;
    if (l.dead) { if (S.t % 14 === 0) puff(S, l.x + (S.rng() - 0.5) * 20, l.y - 6, { vy: -0.7, life: 50, max: 50, size: 6, grow: 0.2, color: '#3a3a3a', kind: 'smoke' }); continue; }
    if (l.kind === 'sam' && p.state === 'fly' && --l.fireT <= 0) {   // the SAM site tosses a slow, dodgeable shot at the plane
      l.fireT = 230 + S.rng() * 120;
      const a = Math.atan2(p.y - (l.y - 10), p.x - l.x);
      S.enemyShots.push({ kind: 'sam', x: l.x, y: l.y - 10, vx: Math.cos(a) * 2.6, vy: Math.sin(a) * 2.6, g: 0, life: 220 });
    }
  }
}

function bogiesStep(S) {
  const p = S.plane, c = S.carrier;
  for (const b of S.bogies) {
    if (b.flash > 0) b.flash--;
    if (b.dying) {
      b.rot += 0.2; b.vy += 0.1; b.x += b.vx; b.y += b.vy;
      if (S.t % 2 === 0) puff(S, b.x, b.y, { vy: -0.3, life: 36, max: 36, size: 5, grow: 0.2, color: S.rng() < 0.4 ? '#ff8a1f' : '#3a3a3a', kind: S.rng() < 0.4 ? 'fire' : 'smoke' });
      if (b.y >= b.splashY) { splash(S, b.x, b.splashY); b.dead = true; }
      continue;
    }
    b.bob += 0.04;
    b.x += b.vx; b.y = b.base + Math.sin(b.bob) * 14;
    if ((b.vx > 0 && b.x > W + 60) || (b.vx < 0 && b.x < -60)) { b.dead = true; continue; }   // flew off: doesn't count, a new one comes
    if (b.kind === 'jet' && p.state === 'fly' && --b.fireT <= 0) {
      b.fireT = 120 + S.rng() * 110;
      if (dist(b.x, b.y, p.x, p.y) < 380) {
        const a = Math.atan2(p.y - b.y, p.x - b.x);
        S.enemyShots.push({ kind: 'bolt', x: b.x, y: b.y, vx: Math.cos(a) * 4.2, vy: Math.sin(a) * 4.2, g: 0, life: 150 });
        say(S, 'bolt');
      }
    }
    if (b.kind === 'bomber') {
      if (b.bombT > 0) b.bombT--;
      if (b.bombT <= 0 && Math.abs(b.x - c.x) < 40) { b.bombT = 140; S.bombs.push({ x: b.x, y: b.y + 10, vy: 0.5 }); say(S, 'whistle'); }
    }
  }
  S.bogies = S.bogies.filter(b => !b.dead);
}

function projectilesStep(S) {
  const p = S.plane, c = S.carrier;
  // air-to-air missiles: heat-seeking, bogies only
  for (const b of S.bullets) {
    if (b.home) {
      let best = null, bd = 99;
      for (const g of S.bogies) {
        if (g.dying || g.dead) continue;
        const d = angDiff(Math.atan2(g.y - b.y, g.x - b.x), b.ang);
        if (Math.abs(d) < TUNE.AAM_CONE_DEG * DEG && Math.abs(d) < bd) { bd = Math.abs(d); best = d; }
      }
      if (best !== null) b.ang += clamp(best, -TUNE.AAM_TURN, TUNE.AAM_TURN);
      b.vx = Math.cos(b.ang) * TUNE.BULLET_SPEED; b.vy = Math.sin(b.ang) * TUNE.BULLET_SPEED;
      if (S.t % 2 === 0) puff(S, b.x - b.vx, b.y - b.vy, { life: 16, max: 16, size: 3, grow: 0.1, color: '#d8dde8', kind: 'smoke' });
    }
    b.x += b.vx; b.y += b.vy; b.life--;
    for (const g of S.bogies) {
      if (!g.dying && !g.dead && b.life > 0 && dist(b.x, b.y, g.x, g.y) < (g.kind === 'bomber' ? 30 : 22)) { b.life = 0; hitBogie(S, g, 1, 'p'); }
    }
  }
  S.bullets = S.bullets.filter(b => b.life > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H);

  // flak
  for (const f of S.flak) {
    f.x += f.vx; f.y += f.vy; f.life--;
    let burst = f.life <= 0;
    for (const g of S.bogies) if (!g.dying && !g.dead && dist(f.x, f.y, g.x, g.y) < 40) burst = true;
    if (burst) { flakBurst(S, f); f.life = -1; }
  }
  S.flak = S.flak.filter(f => f.life > 0);

  // missiles fly where they were pointed; they only steer if a target is already inside their cone
  const gts = groundTargets(S);
  for (const m of S.missiles) {
    m.life--;
    let best = null, bd = 99;
    for (const t of gts) {
      if (isDown(t)) continue;
      const d = angDiff(Math.atan2(t.y - m.y, t.x - m.x), m.ang);
      if (Math.abs(d) < m.cone && Math.abs(d) < bd) { bd = Math.abs(d); best = d; }
    }
    if (best !== null) m.ang += clamp(best, -TUNE.HOMING, TUNE.HOMING);
    m.x += Math.cos(m.ang) * 5.4; m.y += Math.sin(m.ang) * 5.4;
    puff(S, m.x - Math.cos(m.ang) * 8, m.y - Math.sin(m.ang) * 8, { life: 24, max: 24, size: 4, grow: 0.15, color: '#d8dde8', kind: 'smoke' });
    for (const t of gts) {
      if (!isDown(t) && missileTouches(m, t)) { hitGround(S, t, TUNE.MISSILE_DMG, m.owner); m.life = 0; break; }
    }
  }
  S.missiles = S.missiles.filter(m => m.life > 0 && m.x > -40 && m.x < W + 40 && m.y > -40 && m.y < H);

  // enemy shots
  for (const e of S.enemyShots) {
    e.life--;
    if (e.g) e.vy += e.g;
    e.x += e.vx; e.y += e.vy;
    if (e.kind === 'shell') {
      if (e.vy > 0 && e.y >= DECK_Y + c.dy - 8 && Math.abs(e.x - c.x) < c.w / 2 + 6) { hurtCarrier(S, e.x, e.y); e.life = 0; }
      else if (e.y > WATER_Y + c.dy + 20) { splash(S, e.x, e.y); e.life = 0; }
    } else if (e.kind === 'torpedo') {
      const band = WATER_Y + c.dy;
      if (e.y >= band - 26 && e.y <= band + 4 && Math.abs(e.x - c.x) < c.w / 2 - 6) { hurtCarrier(S, e.x, band - 10); e.life = 0; }
      if (S.t % 3 === 0) puff(S, e.x - e.vx * 4, e.y, { vy: -0.2, life: 30, max: 30, size: 2, color: '#e8f6ff', kind: 'dot' });
    } else if (p.state === 'fly' && dist(e.x, e.y, p.x, p.y) < 20) { hurtPlane(S, e.x, e.y); e.life = 0; }
  }
  S.enemyShots = S.enemyShots.filter(e => e.life > 0 && e.x > -40 && e.x < W + 40 && e.y > -40 && e.y < H);

  // bombs
  for (const b of S.bombs) {
    b.vy += 0.07; b.y += b.vy;
    if (b.y >= DECK_Y + c.dy - 10 && Math.abs(b.x - c.x) < c.w / 2) { hurtCarrier(S, b.x, DECK_Y + c.dy - 6); b.y = 9999; }
    else if (b.y > WATER_Y + c.dy + 10) { splash(S, b.x, b.y); b.y = 9999; }
  }
  S.bombs = S.bombs.filter(b => b.y < 9000);
}

// parachute crates: the plane can grab one in the air, or the carrier can catch it on the deck
const CRATE_KINDS = ['repair', 'rapid', 'triple'];
function cratesStep(S) {
  const p = S.plane, c = S.carrier, dk = DECK_Y + c.dy;
  if (S.phase === 'play' && --S.crateT <= 0) {
    S.crateT = TUNE.CRATE_EVERY + S.rng() * 300;
    S.crates.push({ x: 170 + S.rng() * 400, y: 70, kind: CRATE_KINDS[(S.rng() * CRATE_KINDS.length) | 0], sway: S.rng() * 6, gone: false });
    say(S, 'chute');
  }
  for (const cr of S.crates) {
    cr.sway += 0.03; cr.y += TUNE.CRATE_FALL; cr.x += Math.sin(cr.sway) * 0.4;
    if (p.state === 'fly' && dist(cr.x, cr.y, p.x, p.y) < 36) collectCrate(S, cr, 'p');
    else if (cr.y >= dk - 18 && Math.abs(cr.x - c.x) < c.w / 2) collectCrate(S, cr, 'c');
    else if (cr.y > WATER_Y + c.dy + 12) { splash(S, cr.x, cr.y); cr.gone = true; }
  }
  S.crates = S.crates.filter(cr => !cr.gone);
}
function collectCrate(S, cr, seat) {
  cr.gone = true; S.stars[seat]++; floater(S, cr.x, cr.y - 30, '+1 ★', seat);
  if (cr.kind === 'repair') {
    S.carrier.hull = Math.min(TUNE.HULL, S.carrier.hull + 2);
    if (S.plane.state === 'fly') S.plane.hp = TUNE.PLANE_HP;
    banner(S, 'REPAIR KIT!', 90);
  } else if (cr.kind === 'rapid') { S.power.rapid = TUNE.RAPID_FRAMES; banner(S, 'RAPID FIRE!', 90); }
  else { S.power.triple = TUNE.TRIPLE_SHOTS; banner(S, 'TRIPLE MISSILES!', 90); }
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * 6.283;
    puff(S, cr.x, cr.y, { vx: Math.cos(a) * 2.6, vy: Math.sin(a) * 2.6, life: 30, max: 30, size: 3, color: '#9dffbd', kind: 'spark' });
  }
  say(S, 'powerup');
}

function spawnStep(S) {
  const N = S.need;
  const aliveShips = S.ships.filter(s => !s.sinking).length;
  if (aliveShips < TUNE.MAX_SHIPS && S.goals.ships + aliveShips < N.ships) {
    const left = N.ships - S.goals.ships - aliveShips;   // spawns still to come, this one included
    let kind = 'ship';
    if (S.L.boss && left === 1 && !S.bossSpawned) { kind = 'boss'; S.bossSpawned = true; banner(S, 'BOSS BATTLESHIP!', 150); say(S, 'alarm'); }
    else if (S.L.subs && !S.ships.some(s => s.kind === 'sub' && !s.sinking) && S.rng() < 0.45) kind = 'sub';
    spawnShip(S, S.rng() < 0.5 ? 100 : 560, kind);
  }
  const aliveB = S.bogies.filter(b => !b.dying).length;
  if (--S.spawnT <= 0) {
    S.spawnT = 150 + S.rng() * 120;
    if (aliveB < TUNE.MAX_BOGIES && S.goals.bogies + aliveB < N.bogies) spawnBogie(S);
  }
  // never get stuck: if nothing is left to hunt, send another bogie soon
  if (aliveB === 0 && S.goals.bogies < N.bogies && S.spawnT > 60) S.spawnT = 40;
}

function updateParticles(S) {
  for (const q of S.parts) {
    q.vy += q.g; q.x += q.vx; q.y += q.vy; q.size = Math.max(0, q.size + q.grow); q.life--;
  }
  S.parts = S.parts.filter(q => q.life > 0);
  if (S.parts.length > 700) S.parts.splice(0, S.parts.length - 700);
}

function winStep(S) {
  S.phaseT++;
  if (--S.fwT <= 0) {                                   // fireworks!
    S.fwT = 14 + (S.rng() * 16) | 0;
    const x = 120 + S.rng() * (W - 240), y = 110 + S.rng() * 200;
    const col = ['#ff4a4a', '#ffd23f', '#4ad0ff', '#7dff6a', '#ff7bf0', '#ffffff'][(S.rng() * 6) | 0];
    for (let i = 0; i < 44; i++) {
      const a = i / 44 * 6.283, s = 1.4 + S.rng() * 2.4;
      puff(S, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.04, life: 60 + S.rng() * 20, max: 80, size: 4.5, grow: -0.03, color: col, kind: 'spark' });
    }
    say(S, 'firework');
  }
}

// seat -> display name (roles swap every round so the twins take turns on each side)
function roleNames(round, PN) {
  const a = (PN && PN.P1) || 'Player 1', b = (PN && PN.P2) || 'Player 2';
  return round % 2 === 0 ? { c: a, p: b } : { c: b, p: a };
}

// world-tour progress: which levels are open after winning one
function nextProgress(prog, wonLevel) {
  const done = prog.done.indexOf(wonLevel) >= 0 ? prog.done.slice() : prog.done.concat([wonLevel]);
  return { unlocked: Math.max(prog.unlocked, Math.min(LEVELS.length, wonLevel + 2)), done };
}
function sanitizeProgress(v) {
  if (!v || typeof v !== 'object') return { unlocked: 1, done: [] };
  const unlocked = clamp(Number.isInteger(v.unlocked) ? v.unlocked : 1, 1, LEVELS.length);
  const done = Array.isArray(v.done) ? v.done.filter(n => Number.isInteger(n) && n >= 0 && n < LEVELS.length) : [];
  return { unlocked, done: Array.from(new Set(done)) };
}

const API = { W, H, HORIZON, DECK_Y, WATER_Y, TUNE, LEVELS, PLANE_COLORS, createState, step, roleNames, groundTargets,
              nextProgress, sanitizeProgress };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.BattleFighter = API;

// ───────────────────────────── browser: input ─────────────────────────────
if (typeof document === 'undefined' || !document.getElementById('gc')) return;

const keys = {}, tapped = {};
let presses = 0;
let mode = 'map';                 // 'map' (pick a mission) or 'game'
const P1_FIRE = new Set(['Space', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN']);   // left of the fighter's keys only
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyQ', 'KeyE', 'ShiftRight', 'Slash']);
const typing = e => !!(e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable]'));
addEventListener('keydown', e => {
  if (typing(e)) return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  ensureAudio();
  if (mode === 'map') { if (!e.repeat) mapKey(e.code); return; }
  if (!e.repeat && P1_FIRE.has(e.code)) presses++;       // each fresh press counts toward the launch
  keys[e.code] = true; tapped[e.code] = true;
  if (!e.repeat && e.code === 'KeyR' && S.phase === 'win') toMap(true);
});
addEventListener('keyup', e => { if (!typing(e)) keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; presses = 0; });
addEventListener('mousedown', e => {
  if (e.target.id !== 'gc') return;
  ensureAudio();
  if (mode === 'map') mapClick(e); else presses++;      // toddler-proof: clicking charges the launch too
});

function readInput() {
  const pr = presses; presses = 0;
  const k = c => !!(keys[c] || tapped[c]);              // a key pressed and released between two steps still counts once
  const pk = { left: k('ArrowLeft'), right: k('ArrowRight'), up: k('ArrowUp'), down: k('ArrowDown'), fire: k('Enter'), missile: k('ShiftRight') || k('Slash') };
  pk.any = pk.left || pk.right || pk.up || pk.down || pk.fire;
  const out = { c: { left: k('KeyA'), right: k('KeyD'), up: k('KeyW'), down: k('KeyS'), depthUp: k('KeyQ'), depthDown: k('KeyE'), presses: pr }, p: pk };
  for (const c in tapped) delete tapped[c];
  return out;
}

// ───────────────────────────── browser: sound ─────────────────────────────
let AC = null, muted = false;
function ensureAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC && AC.state === 'suspended') AC.resume();
}
function tone(f, d, type, vol, slide) {
  if (!AC || muted) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(vol || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d);
}
const NOISE = {};
function noise(d, vol) {
  if (!AC || muted) return;
  const key = Math.round(d * 100);
  if (!NOISE[key]) {                                   // build each noise length once, then reuse it
    const n = Math.floor(AC.sampleRate * d), buf = AC.createBuffer(1, n, AC.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    NOISE[key] = buf;
  }
  const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = NOISE[key]; g.gain.value = vol || 0.12;
  s.connect(g); g.connect(AC.destination); s.start();
}
const SFX = {
  tick: () => tone(520, 0.05, 'square', 0.05), gun: () => tone(900, 0.06, 'sawtooth', 0.03, -500),
  missile: () => { tone(200, 0.35, 'sawtooth', 0.07, 500); noise(0.3, 0.08); }, flak: () => { tone(140, 0.2, 'square', 0.07, -60); noise(0.15, 0.1); },
  pop: () => noise(0.12, 0.08), boom: () => noise(0.35, 0.14), bigboom: () => { noise(0.6, 0.2); tone(80, 0.5, 'sawtooth', 0.1, -40); },
  splash: () => noise(0.25, 0.07), hurt: () => tone(160, 0.3, 'sawtooth', 0.09, -90), whistle: () => tone(1200, 0.7, 'sine', 0.05, -900),
  cheer: () => { tone(660, 0.09, 'square', 0.06); setTimeout(() => tone(880, 0.14, 'square', 0.06), 90); },
  launch: () => tone(150, 0.6, 'sawtooth', 0.07, 400), dock: () => { tone(700, 0.1, 'sine', 0.07); setTimeout(() => tone(1050, 0.16, 'sine', 0.07), 100); },
  shellfire: () => tone(110, 0.25, 'square', 0.05, -40), bolt: () => tone(500, 0.12, 'sawtooth', 0.03, -250),
  firework: () => { noise(0.25, 0.05); tone(1500, 0.3, 'sine', 0.03, -1200); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'square', 0.07), i * 140)),
  sonar: () => { tone(1400, 0.5, 'sine', 0.06, -200); setTimeout(() => tone(1400, 0.4, 'sine', 0.03, -200), 450); },
  torpedo: () => { tone(90, 0.8, 'sawtooth', 0.05, 40); noise(0.4, 0.05); },
  chute: () => tone(600, 0.4, 'triangle', 0.04, 300),
  powerup: () => [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.1, 'square', 0.05), i * 60)),
  combo: () => [523, 784, 1046, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'square', 0.06), i * 80)),
  alarm: () => [0, 1, 2].forEach(i => setTimeout(() => tone(440, 0.25, 'square', 0.06, 220), i * 320)),
  pick: () => tone(740, 0.06, 'square', 0.04), go: () => { tone(330, 0.12, 'square', 0.06); setTimeout(() => tone(660, 0.2, 'square', 0.06), 110); },
};

// ───────────────────────────── browser: drawing helpers ─────────────────────────────
const canvas = document.getElementById('gc'), ctx = canvas.getContext('2d');
let S = null, round = 0;

function lin(x0, y0, x1, y1, cols, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  cols.forEach((c, i) => g.addColorStop(stops ? stops[i] : i / (cols.length - 1), c));
  return g;
}
function rad(x, y, r0, r1, cols, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  cols.forEach((c, i) => g.addColorStop(stops ? stops[i] : i / (cols.length - 1), c));
  return g;
}
function outlined(text, x, y, fill, stroke, lw) {
  ctx.lineWidth = lw || 5; ctx.strokeStyle = stroke || '#0b1020'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// scenery for each mission
const THEMES = {
  sunset:  { sky: ['#0f2a66', '#3a7bc8', '#ffc58a'], sea: ['#3f8fcf', '#1c5c9c', '#082a52'], sun: { x: 170, y: 270, col: '255,225,150' },
             glitter: '255,240,190', haze: '255,215,170', cloud: '255,255,255', cloudA: 0.7, island: 'tropic' },
  storm:   { sky: ['#26364a', '#566b82', '#a6b5c4'], sea: ['#577790', '#2a4a63', '#0e2236'], sun: null,
             glitter: null, haze: '200,215,230', cloud: '108,120,138', cloudA: 0.9, island: 'snowy', decor: 'snow', icebergs: true },
  desert:  { sky: ['#1a68c0', '#6ab4ea', '#fbe6b5'], sea: ['#4cc8d2', '#1d8aa8', '#0b4466'], sun: { x: 700, y: 95, col: '255,252,225' },
             glitter: '255,255,235', haze: '255,236,200', cloud: '255,255,255', cloudA: 0.5, island: 'desert' },
  night:   { sky: ['#01040f', '#0a1838', '#1d3060'], sea: ['#163058', '#0a1630', '#030812'], moon: { x: 720, y: 92 },
             glitter: '210,225,255', haze: '90,120,190', cloud: '38,50,80', cloudA: 0.55, island: 'night', decor: 'stars' },
  volcano: { sky: ['#1a0606', '#7a2410', '#ff8a3a'], sea: ['#6a3024', '#2a1418', '#0c0608'], sun: { x: 180, y: 262, col: '255,150,80' },
             glitter: '255,170,110', haze: '255,140,80', cloud: '62,40,40', cloudA: 0.8, island: 'volcano', decor: 'ash' },
};
const GR = {};
function grads(name) {                                  // gradients are fixed per theme, so build them once
  if (GR[name]) return GR[name];
  const th = THEMES[name], g = {};
  g.sky = lin(0, 0, 0, HORIZON, th.sky, [0, 0.55, 1]);
  g.sea = lin(0, HORIZON, 0, H, th.sea, [0, 0.28, 1]);
  g.haze = lin(0, HORIZON - 8, 0, HORIZON + 26, ['rgba(' + th.haze + ',0)', 'rgba(' + th.haze + ',.55)', 'rgba(' + th.haze + ',0)'], [0, 0.3, 1]);
  if (th.sun) g.sun = rad(th.sun.x, th.sun.y, 6, 160, ['rgba(255,252,230,1)', 'rgba(' + th.sun.col + ',.9)', 'rgba(' + th.sun.col + ',0)'], [0, 0.14, 1]);
  if (th.moon) g.moon = rad(th.moon.x, th.moon.y, 10, 120, ['rgba(220,230,255,.5)', 'rgba(150,170,230,.15)', 'rgba(120,140,220,0)'], [0, 0.3, 1]);
  g.vig = rad(W / 2, H / 2, H * 0.42, H * 0.9, ['rgba(0,0,0,0)', 'rgba(0,0,0,.38)']);
  return (GR[name] = g);
}

const CLOUDS = [];
{ const r = mulberry32(42); for (let i = 0; i < 10; i++) CLOUDS.push({ x: r() * W, y: 70 + r() * 160, s: 0.6 + r() * 0.9, v: 0.08 + r() * 0.18 }); }
const STARS = [];
{ const r = mulberry32(7); for (let i = 0; i < 110; i++) STARS.push({ x: r() * W, y: 64 + r() * (HORIZON - 80), s: 0.6 + r() * 1.6, p: r() * 6.28 }); }
const FLAKES = [];
{ const r = mulberry32(11); for (let i = 0; i < 90; i++) FLAKES.push({ x: r() * W, y: r() * H, v: 0.4 + r() * 0.9, s: 1 + r() * 2.2, p: r() * 6.28 }); }
const LAVA = [];

function blob(x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, 22 * s, 0, 6.3); ctx.arc(x + 24 * s, y - 8 * s, 28 * s, 0, 6.3); ctx.arc(x + 54 * s, y, 22 * s, 0, 6.3);
  ctx.arc(x + 26 * s, y + 8 * s, 24 * s, 0, 6.3); ctx.fill();
}

function drawBackground(S) {
  const th = THEMES[S.L.theme], g = grads(S.L.theme), t = S.t;
  ctx.fillStyle = g.sky; ctx.fillRect(0, 0, W, HORIZON);
  if (th.decor === 'stars') {
    for (const s of STARS) { ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.03 + s.p)); ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.s, s.s); }
    ctx.globalAlpha = 1;
    drawAurora(t);
  }
  if (g.sun) { ctx.fillStyle = g.sun; ctx.fillRect(0, 0, W, HORIZON + 10); }
  if (th.moon) {
    ctx.fillStyle = g.moon; ctx.fillRect(th.moon.x - 130, th.moon.y - 130, 260, 260);
    ctx.fillStyle = '#eef2ff'; ctx.beginPath(); ctx.arc(th.moon.x, th.moon.y, 26, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(160,170,200,.45)';
    for (const [dx, dy, r] of [[-8, -6, 6], [9, 5, 4], [-2, 11, 3], [10, -10, 3]]) { ctx.beginPath(); ctx.arc(th.moon.x + dx, th.moon.y + dy, r, 0, 6.3); ctx.fill(); }
  }
  for (const c of CLOUDS) {
    const x = ((c.x + t * c.v * (th.decor === 'snow' ? 2.2 : 1)) % (W + 200)) - 100;
    ctx.fillStyle = 'rgba(' + th.cloud + ',' + th.cloudA * 0.4 + ')'; blob(x, c.y + 6, c.s);
    ctx.fillStyle = 'rgba(' + th.cloud + ',' + th.cloudA + ')'; blob(x, c.y, c.s);
  }
  ctx.fillStyle = g.sea; ctx.fillRect(0, HORIZON, W, H - HORIZON);
  const gx = th.sun ? th.sun.x : th.moon ? th.moon.x : null;
  if (gx !== null && th.glitter) {                     // sun or moon glitter on the water
    ctx.fillStyle = 'rgba(' + th.glitter + ',.5)';
    for (let i = 0; i < 26; i++) {
      const y = HORIZON + 3 + i * 5.5, w = 6 + i * 3.2 + Math.sin(t * 0.05 + i) * 5;
      ctx.fillRect(gx - w / 2 + Math.sin(t * 0.03 + i * 1.7) * 6, y, w, 1.6);
    }
  }
  ctx.lineWidth = 1.5;
  for (let r = 0; r < 14; r++) {
    const y = HORIZON + 14 + r * r * 1.9 + r * 6, amp = (1 + r * 0.35) * (th.decor === 'snow' ? 1.8 : 1);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + r * 0.012) + ')';
    ctx.beginPath();
    for (let x = 0; x <= W; x += 14) {
      const yy = y + Math.sin(x * 0.02 + t * 0.03 * (1 + r * 0.05) + r) * amp;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.fillStyle = g.haze; ctx.fillRect(0, HORIZON - 8, W, 34);
  if (th.icebergs) drawIcebergs(t);
}

function drawAurora(t) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 2; k++) {
    ctx.strokeStyle = k ? 'rgba(170,90,255,.10)' : 'rgba(80,255,170,.13)';
    for (let w = 0; w < 5; w++) {
      ctx.lineWidth = 16 - w * 3; ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 20) {
        const y = 110 + k * 34 + Math.sin(x * 0.008 + t * 0.012 + k * 2) * 26 + Math.sin(x * 0.02 + t * 0.02) * 8 + w * 4;
        if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawIcebergs(t) {
  for (const [bx, s] of [[60, 1], [250, 0.7], [470, 0.85]]) {
    const x = ((bx + t * 0.05) % (W + 120)) - 60;
    ctx.fillStyle = '#eaf6fb';
    ctx.beginPath(); ctx.moveTo(x - 34 * s, HORIZON + 8); ctx.lineTo(x - 22 * s, HORIZON - 14 * s); ctx.lineTo(x - 6 * s, HORIZON - 22 * s);
    ctx.lineTo(x + 10 * s, HORIZON - 12 * s); ctx.lineTo(x + 30 * s, HORIZON + 8); ctx.fill();
    ctx.fillStyle = '#9fc9dc';
    ctx.beginPath(); ctx.moveTo(x - 6 * s, HORIZON - 22 * s); ctx.lineTo(x + 10 * s, HORIZON - 12 * s); ctx.lineTo(x + 30 * s, HORIZON + 8); ctx.lineTo(x + 2 * s, HORIZON + 8); ctx.fill();
  }
}

// one island footprint for every theme (the land targets always sit at x 670-850), different paint
function islandBase(mtn, ground, beach) {
  ctx.fillStyle = mtn;
  ctx.beginPath(); ctx.moveTo(560, HORIZON + 8); ctx.lineTo(640, HORIZON - 52); ctx.lineTo(690, HORIZON - 26); ctx.lineTo(760, HORIZON - 78);
  ctx.lineTo(830, HORIZON - 34); ctx.lineTo(900, HORIZON - 58); ctx.lineTo(900, HORIZON + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = ground;
  ctx.beginPath(); ctx.moveTo(600, HORIZON + 40); ctx.quadraticCurveTo(650, HORIZON - 10, 740, HORIZON - 4); ctx.quadraticCurveTo(840, HORIZON - 14, 900, HORIZON - 4);
  ctx.lineTo(900, HORIZON + 44); ctx.closePath(); ctx.fill();
  ctx.fillStyle = beach;
  ctx.beginPath(); ctx.moveTo(592, HORIZON + 44); ctx.quadraticCurveTo(640, HORIZON + 22, 740, HORIZON + 26); ctx.quadraticCurveTo(840, HORIZON + 20, 900, HORIZON + 24);
  ctx.lineTo(900, HORIZON + 46); ctx.closePath(); ctx.fill();
}
function snowCaps(col) {
  ctx.fillStyle = col;
  for (const [x, y] of [[640, -52], [760, -78], [900, -58]]) {
    ctx.beginPath(); ctx.moveTo(x - 16, HORIZON + y + 18); ctx.lineTo(x, HORIZON + y); ctx.lineTo(x + 16, HORIZON + y + 18);
    ctx.lineTo(x + 6, HORIZON + y + 14); ctx.lineTo(x, HORIZON + y + 19); ctx.lineTo(x - 7, HORIZON + y + 13); ctx.fill();
  }
}
function palm(px, trunk, leaf) {
  ctx.strokeStyle = trunk; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, HORIZON + 28); ctx.quadraticCurveTo(px + 4, HORIZON + 8, px + 1, HORIZON - 4); ctx.stroke();
  ctx.fillStyle = leaf;
  for (let i = 0; i < 5; i++) {
    const a = -2.6 + i * 0.55;
    ctx.beginPath(); ctx.moveTo(px + 1, HORIZON - 4);
    ctx.quadraticCurveTo(px + Math.cos(a) * 12, HORIZON - 8 + Math.sin(a) * 10, px + Math.cos(a) * 20, HORIZON + 3 + Math.sin(a) * 10);
    ctx.quadraticCurveTo(px + Math.cos(a) * 12, HORIZON - 2 + Math.sin(a) * 6, px + 1, HORIZON - 4); ctx.fill();
  }
}
function pine(px, col, snow) {
  for (let i = 0; i < 3; i++) {
    const y = HORIZON + 22 - i * 9, w = 11 - i * 3;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(px - w, y); ctx.lineTo(px, y - 13); ctx.lineTo(px + w, y); ctx.fill();
    if (snow) { ctx.fillStyle = snow; ctx.beginPath(); ctx.moveTo(px - w * 0.45, y - 7); ctx.lineTo(px, y - 13); ctx.lineTo(px + w * 0.45, y - 7); ctx.fill(); }
  }
  ctx.fillStyle = '#4a3322'; ctx.fillRect(px - 1.5, HORIZON + 22, 3, 5);
}

function drawIsland(S) {
  const th = THEMES[S.L.theme], t = S.t;
  if (th.island === 'tropic') {
    islandBase('#5a6f8f', '#3d7a4a', '#e8d49a');
    for (const px of [615, 700, 775, 880]) palm(px, '#6b4a2a', '#2e8f3e');
  } else if (th.island === 'snowy') {
    islandBase('#7d8ca0', '#dfe8ef', '#8e9aa6'); snowCaps('#ffffff');
    for (const px of [612, 700, 778, 884]) pine(px, '#1f4a35', '#f2f7fa');
  } else if (th.island === 'desert') {
    ctx.fillStyle = '#c47f45';                          // flat-topped mesas instead of peaks
    ctx.beginPath(); ctx.moveTo(560, HORIZON + 8); ctx.lineTo(600, HORIZON - 36); ctx.lineTo(660, HORIZON - 36); ctx.lineTo(680, HORIZON - 14);
    ctx.lineTo(720, HORIZON - 14); ctx.lineTo(740, HORIZON - 60); ctx.lineTo(820, HORIZON - 60); ctx.lineTo(840, HORIZON - 30); ctx.lineTo(900, HORIZON - 30);
    ctx.lineTo(900, HORIZON + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(120,60,30,.35)'; ctx.fillRect(600, HORIZON - 26, 60, 4); ctx.fillRect(740, HORIZON - 46, 80, 5); ctx.fillRect(740, HORIZON - 32, 80, 3);
    ctx.fillStyle = '#e8b866';
    ctx.beginPath(); ctx.moveTo(600, HORIZON + 40); ctx.quadraticCurveTo(650, HORIZON - 6, 740, HORIZON - 2); ctx.quadraticCurveTo(840, HORIZON - 10, 900, HORIZON - 2);
    ctx.lineTo(900, HORIZON + 44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f6dca0';
    ctx.beginPath(); ctx.moveTo(592, HORIZON + 44); ctx.quadraticCurveTo(640, HORIZON + 22, 740, HORIZON + 26); ctx.quadraticCurveTo(840, HORIZON + 20, 900, HORIZON + 24);
    ctx.lineTo(900, HORIZON + 46); ctx.closePath(); ctx.fill();
    for (const px of [615, 702, 880]) palm(px, '#8a5a2a', '#3f8f3a');
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(598, HORIZON - 4, 8, 30);              // lighthouse
    ctx.fillStyle = '#d83a3a'; ctx.fillRect(598, HORIZON + 4, 8, 5); ctx.fillRect(598, HORIZON + 16, 8, 5);
    ctx.fillStyle = (Math.floor(t / 30) % 2) ? '#fff6b0' : '#a89a50'; ctx.fillRect(597, HORIZON - 10, 10, 6);
  } else if (th.island === 'night') {
    islandBase('#1a2540', '#2a3858', '#3a4664'); snowCaps('#aab6d2');
    for (const px of [612, 700, 778, 884]) pine(px, '#0f2030', '#8090b0');
    drawSearchlights(t);
  } else {   // volcano
    ctx.fillStyle = '#2a1a1a';
    ctx.beginPath(); ctx.moveTo(560, HORIZON + 8); ctx.lineTo(700, HORIZON - 70); ctx.lineTo(748, HORIZON - 122); ctx.lineTo(790, HORIZON - 122);
    ctx.lineTo(840, HORIZON - 70); ctx.lineTo(900, HORIZON - 40); ctx.lineTo(900, HORIZON + 8); ctx.closePath(); ctx.fill();
    const glow = 0.6 + 0.4 * Math.sin(t * 0.08);
    ctx.fillStyle = 'rgba(255,90,20,' + glow + ')'; ctx.fillRect(750, HORIZON - 124, 38, 5);  // crater glow
    ctx.strokeStyle = 'rgba(255,110,30,' + (0.5 + 0.3 * glow) + ')'; ctx.lineWidth = 3;
    for (const [x0, x1, x2] of [[758, 742, 720], [772, 780, 800], [782, 806, 836]]) {          // lava streaks
      ctx.beginPath(); ctx.moveTo(x0, HORIZON - 118); ctx.quadraticCurveTo(x1, HORIZON - 80, x2, HORIZON - 30); ctx.stroke();
    }
    ctx.fillStyle = '#3a2824';
    ctx.beginPath(); ctx.moveTo(600, HORIZON + 40); ctx.quadraticCurveTo(650, HORIZON - 10, 740, HORIZON - 4); ctx.quadraticCurveTo(840, HORIZON - 14, 900, HORIZON - 4);
    ctx.lineTo(900, HORIZON + 44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a3a34';
    ctx.beginPath(); ctx.moveTo(592, HORIZON + 44); ctx.quadraticCurveTo(640, HORIZON + 22, 740, HORIZON + 26); ctx.quadraticCurveTo(840, HORIZON + 20, 900, HORIZON + 24);
    ctx.lineTo(900, HORIZON + 46); ctx.closePath(); ctx.fill();
    // eruption: lava bombs and a smoke plume
    if (t % 9 === 0) LAVA.push({ x: 768, y: HORIZON - 122, vx: (Math.random() - 0.5) * 3, vy: -2.5 - Math.random() * 2.5 });
    for (const l of LAVA) { l.vy += 0.07; l.x += l.vx; l.y += l.vy; }
    for (let i = LAVA.length - 1; i >= 0; i--) if (LAVA[i].y > HORIZON - 40) LAVA.splice(i, 1);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const l of LAVA) { ctx.fillStyle = 'rgba(255,140,40,.9)'; ctx.beginPath(); ctx.arc(l.x, l.y, 3, 0, 6.3); ctx.fill(); ctx.fillStyle = 'rgba(255,80,20,.25)'; ctx.beginPath(); ctx.arc(l.x, l.y, 8, 0, 6.3); ctx.fill(); }
    ctx.restore();
    for (let i = 0; i < 7; i++) {
      const k = ((t * 0.4 + i * 22) % 154) / 154;
      ctx.fillStyle = 'rgba(50,40,40,' + (0.5 * (1 - k)) + ')';
      ctx.beginPath(); ctx.arc(768 + k * 60 + Math.sin(t * 0.02 + i) * 6, HORIZON - 130 - k * 140, 12 + k * 30, 0, 6.3); ctx.fill();
    }
  }
  for (const l of S.land) drawLand(l, t);
}

const SEARCH = [{ x: 702, y: 296, ph: 0 }, { x: 862, y: 292, ph: 2.2 }];
function drawSearchlights(t) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const s of SEARCH) {
    if (!s.g) s.g = rad(s.x, s.y, 0, 420, ['rgba(255,250,210,.32)', 'rgba(255,250,210,0)']);
    const a = -Math.PI / 2 + Math.sin(t * 0.008 + s.ph) * 0.75;
    ctx.fillStyle = s.g; ctx.beginPath(); ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(a - 0.05) * 420, s.y + Math.sin(a - 0.05) * 420); ctx.lineTo(s.x + Math.cos(a + 0.05) * 420, s.y + Math.sin(a + 0.05) * 420);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawWeather(S) {
  const th = THEMES[S.L.theme], t = S.t;
  if (th.decor === 'snow' || th.decor === 'ash') {
    const snow = th.decor === 'snow';
    for (const f of FLAKES) {
      const y = (f.y + t * f.v) % H, x = (f.x + Math.sin(t * 0.02 + f.p) * 14 + (snow ? t * 0.6 : 0)) % W;
      ctx.fillStyle = snow ? 'rgba(255,255,255,.8)' : (f.p > 4.5 ? 'rgba(255,140,60,.8)' : 'rgba(120,110,110,.6)');
      ctx.fillRect(x, y, f.s, f.s);
    }
  }
}

function drawLand(l, t) {
  ctx.save(); ctx.translate(l.x, l.y);
  const dead = l.dead;
  if (l.flash > 0 && !dead) ctx.globalAlpha = 0.55 + (l.flash % 2) * 0.45;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 6, 22, 4, 0, 0, 6.3); ctx.fill();   // ground shadow
  if (l.kind === 'radar') {
    ctx.fillStyle = dead ? '#2a2a2a' : '#7c8794'; ctx.fillRect(-14, -8, 28, 12);
    ctx.fillStyle = dead ? '#222' : '#aab4c0'; ctx.fillRect(-3, -30, 6, 24);
    ctx.save(); ctx.translate(0, -32); ctx.rotate(dead ? 0.8 : t * 0.06);
    ctx.fillStyle = dead ? '#333' : '#e8edf2'; ctx.beginPath(); ctx.ellipse(0, 0, 15, 4, 0, 0, 6.3); ctx.fill(); ctx.restore();
    if (!dead && Math.floor(t / 15) % 2) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(0, -36, 2, 0, 6.3); ctx.fill(); }
  } else if (l.kind === 'bunker') {
    ctx.fillStyle = dead ? '#2a2a2a' : '#6a7a5a'; ctx.beginPath(); ctx.moveTo(-22, 6); ctx.lineTo(-18, -14); ctx.lineTo(18, -14); ctx.lineTo(22, 6); ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-12, -9, 24, 4);
    ctx.fillStyle = dead ? '#222' : '#4a5a3e'; ctx.fillRect(-4, -22, 8, 10); ctx.fillRect(2, -20, 18, 3);
  } else if (l.kind === 'fuel') {
    for (const dx of [-14, 12]) {
      ctx.fillStyle = dead ? '#2a2a2a' : '#d9dde2'; ctx.beginPath(); ctx.ellipse(dx, -8, 12, 14, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = dead ? '#222' : '#e14a3a'; ctx.fillRect(dx - 12, -10, 24, 4);
      if (!dead) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(dx - 7, -18, 3, 10); }
    }
  } else {   // sam
    ctx.fillStyle = dead ? '#2a2a2a' : '#5a6b4e'; ctx.fillRect(-18, -4, 36, 10);
    ctx.save(); ctx.translate(0, -4); ctx.rotate(-0.6);
    ctx.fillStyle = dead ? '#222' : '#cfd6dd'; ctx.fillRect(-4, -26, 8, 28); ctx.fillStyle = dead ? '#222' : '#e14a3a'; ctx.fillRect(-4, -30, 8, 6); ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (dead) { ctx.fillStyle = 'rgba(255,120,30,' + (0.4 + 0.3 * Math.sin(t * 0.3 + l.x)) + ')'; ctx.beginPath(); ctx.arc(0, -4, 8, 0, 6.3); ctx.fill(); }
  else if (l.hp < l.maxhp) pips(0, -48, l.hp, l.maxhp, '#ff5a4a');
  ctx.restore();
}

function pips(x, y, n, max, col) {
  const w = 7, gap = 3, total = max * w + (max - 1) * gap;
  for (let i = 0; i < max; i++) { ctx.fillStyle = i < n ? col : 'rgba(0,0,0,.45)'; ctx.fillRect(x - total / 2 + i * (w + gap), y, w, 5); }
}

function drawShip(s, t) {
  if (s.kind === 'sub') { drawSub(s, t); return; }
  const boss = s.kind === 'boss';
  ctx.save(); ctx.translate(s.x, s.y + (s.sinking ? s.sinking * 0.35 : 0));
  ctx.scale(s.scale * s.dir, s.scale); if (s.sinking) ctx.rotate(Math.min(0.5, s.sinking * 0.01));
  ctx.globalAlpha = s.sinking ? Math.max(0, 1 - s.sinking / 100) : 1;
  const hull = boss ? '#4a5262' : ['#7b8696', '#8a7f74', '#6f8a7d'][s.hue];
  const len = boss ? 1.5 : 1;
  ctx.fillStyle = 'rgba(255,255,255,.35)';                       // wake
  for (let i = 0; i < 3; i++) { const w = 26 - i * 6; ctx.fillRect(-64 * len - i * 14 - ((t * 0.6) % 14), 12 + i * 2, w, 2.5); }
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.ellipse(76 * len, 10, 8, 2.5, 0, 0, 6.3); ctx.fill();   // bow spray
  ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(-62 * len, -2); ctx.lineTo(62 * len, -2); ctx.lineTo(78 * len, -9); ctx.lineTo(60 * len, 14); ctx.lineTo(-56 * len, 14); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-60 * len, -2, 122 * len, 3);
  ctx.fillStyle = '#a82a2a'; ctx.fillRect(-58 * len, 9, 118 * len, 4);
  ctx.fillStyle = boss ? '#6a7282' : '#9aa5b3'; ctx.fillRect(-18, -20, 36, 18); ctx.fillStyle = boss ? '#555d6c' : '#7b8696'; ctx.fillRect(-10, -32, 20, 12);
  ctx.fillStyle = '#ffe9a0'; for (let i = 0; i < 4; i++) ctx.fillRect(-14 + i * 9, -14, 5, 4);
  ctx.strokeStyle = '#444'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(0, -46); ctx.stroke();
  ctx.fillStyle = '#5a6472';
  const turrets = boss ? [44, 68, -46, -70] : [34];
  for (const tx of turrets) { const d = tx > 0 ? 1 : -1; ctx.beginPath(); ctx.arc(tx, -4, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(tx + (d > 0 ? 4 : -22), -8, 18, 3); }
  if (!boss) ctx.fillRect(-52, -9, 14, 7);
  ctx.fillStyle = '#c82828'; ctx.fillRect(0, -46, 10, 6);
  if (boss) { ctx.fillStyle = '#222'; ctx.fillRect(-30, -38, 8, 18); ctx.fillStyle = 'rgba(80,80,80,.5)'; ctx.beginPath(); ctx.arc(-26, -44 - (t % 30) * 0.4, 5 + (t % 30) * 0.1, 0, 6.3); ctx.fill(); }
  if (s.warn > 0 && !s.sinking) { ctx.fillStyle = 'rgba(255,60,40,' + (0.4 + 0.5 * Math.sin(t * 0.7)) + ')'; ctx.beginPath(); ctx.arc(boss ? 70 : 52, -8, 12, 0, 6.3); ctx.fill(); }
  if (s.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-62 * len, -20, 140 * len, 36); }
  ctx.restore();
  if (!s.sinking && s.hp < s.maxhp && !boss) pips(s.x, s.y - 52 * s.scale, s.hp, s.maxhp, '#ff5a4a');
}

function drawSub(s, t) {
  ctx.save(); ctx.translate(s.x, s.y + (s.sinking ? s.sinking * 0.3 : 0)); ctx.scale(s.scale * s.dir, s.scale);
  ctx.globalAlpha = s.sinking ? Math.max(0, 1 - s.sinking / 100) : 1;
  if (s.under && !s.sinking) {                          // hidden: only a periscope and its little V of foam
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-20, -4); ctx.moveTo(14, 0); ctx.lineTo(-20, 4); ctx.stroke();
    ctx.fillStyle = '#20282e'; ctx.fillRect(12, -16, 3, 16); ctx.fillRect(12, -16, 7, 3);
    if (Math.floor(t / 12) % 2) { ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(17, -16, 2, 2); }
  } else {
    ctx.fillStyle = '#26323b'; ctx.beginPath(); ctx.ellipse(0, 0, 48, 10, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#33424d'; ctx.fillRect(-8, -24, 20, 16); ctx.fillRect(2, -32, 3, 9);
    ctx.fillStyle = '#c82828'; ctx.fillRect(-8, -14, 20, 3);
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.beginPath(); ctx.ellipse(0, 1, 52, 3 + Math.sin(t * 0.2) * 1, 0, 0, 6.3); ctx.fill();
    if (!s.fired && s.subT < TUNE.SUB_UP && s.subT > TUNE.SUB_UP - 80) {   // red warning glow before the torpedo
      ctx.fillStyle = 'rgba(255,60,40,' + (0.4 + 0.5 * Math.sin(t * 0.7)) + ')'; ctx.beginPath(); ctx.arc(40, 0, 10, 0, 6.3); ctx.fill();
    }
    if (s.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(-50, -32, 100, 34); }
  }
  ctx.restore();
  if (!s.sinking && !s.under && s.hp < s.maxhp) pips(s.x, s.y - 40 * s.scale, s.hp, s.maxhp, '#ff5a4a');
}

function aimLocked(S) {             // would a missile fired now start inside a target's steering cone?
  const c = S.carrier, [mx, my] = muzzle(c), e = c.elev * DEG, ang = c.dir > 0 ? -e : Math.PI + e;
  return groundTargets(S).some(t => Math.abs(angDiff(Math.atan2(t.y - my, t.x - mx), ang)) < TUNE.CONE_DEG * DEG);
}
function drawCarrier(S, t) {
  const c = S.carrier;
  ctx.save(); ctx.translate(c.x, DECK_Y + c.dy);
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0, 50, 140, 8, 0, 0, 6.3); ctx.fill();   // shadow on the water
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(-c.dir * (118 + i * 18 + ((t * 0.8) % 18)), 44 + (i % 2) * 2, 22 - i * 2, 3, 0, 0, 6.3); ctx.fill(); }
  ctx.scale(c.dir, 1);
  if (S.rally > 0) ctx.rotate(0.05 * Math.sin(t * 0.3));
  let g = ctx.createLinearGradient(0, 0, 0, 52); g.addColorStop(0, '#7d8896'); g.addColorStop(1, '#3d4654');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-118, 0); ctx.lineTo(122, 0); ctx.lineTo(138, -8); ctx.lineTo(112, 38); ctx.lineTo(70, 50); ctx.lineTo(-92, 50); ctx.lineTo(-124, 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a82a2a'; ctx.beginPath(); ctx.moveTo(-96, 42); ctx.lineTo(72, 42); ctx.lineTo(70, 50); ctx.lineTo(-92, 50); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 9; i++) ctx.fillRect(-90 + i * 24, 18, 12, 5);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.fillText('77', 96, 28);
  ctx.fillStyle = '#58626f'; ctx.fillRect(-122, -4, 262, 10);
  ctx.fillStyle = '#9aa5b3'; ctx.fillRect(-122, -4, 262, 3);
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.moveTo(-100, 1); ctx.lineTo(120, 1); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffd23f'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(40 + i * 24, -2); ctx.lineTo(52 + i * 24, 1); ctx.lineTo(40 + i * 24, 4); ctx.fill(); }
  for (let i = 0; i < 8; i++) { ctx.fillStyle = (Math.floor(t / 10) + i) % 4 === 0 ? '#ffec6a' : '#6b5a1a'; ctx.fillRect(-114 + i * 34, 4, 4, 3); }
  ctx.fillStyle = '#6c7684'; ctx.fillRect(-58, -44, 40, 40); ctx.fillStyle = '#8793a2'; ctx.fillRect(-52, -62, 28, 20);
  ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(-58, -44, 6, 40);
  ctx.fillStyle = '#9fe3ff'; for (let i = 0; i < 4; i++) ctx.fillRect(-48 + i * 7, -56, 5, 6);
  ctx.fillStyle = '#ffe9a0'; for (let i = 0; i < 3; i++) ctx.fillRect(-52 + i * 12, -34, 7, 5);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-38, -62); ctx.lineTo(-38, -82); ctx.stroke();
  ctx.save(); ctx.translate(-38, -82); ctx.rotate(t * 0.08); ctx.fillStyle = '#e8edf2'; ctx.fillRect(-14, -2, 28, 4); ctx.restore();
  ctx.fillStyle = (Math.floor(t / 20) % 2) ? '#ff3b3b' : '#601818'; ctx.beginPath(); ctx.arc(-38, -84, 3, 0, 6.3); ctx.fill();
  // launcher turret at the bow end
  ctx.save(); ctx.translate(72 - c.recoil * 0.6, -6);
  ctx.fillStyle = '#4a5360'; ctx.beginPath(); ctx.arc(0, 0, 16, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#2c333d'; ctx.fillRect(-16, 0, 32, 5);
  ctx.rotate(-c.elev * DEG);
  const flak = c.elev >= TUNE.FLAK_ELEV;
  if (flak) {
    ctx.fillStyle = '#3a424d'; ctx.fillRect(2, -7, 40, 5); ctx.fillRect(2, 2, 40, 5);
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(38, -8, 6, 7); ctx.fillRect(38, 1, 6, 7);
  } else {
    ctx.fillStyle = '#3a424d'; ctx.fillRect(0, -6, 34, 12);
    ctx.fillStyle = '#e8edf2'; ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(40, -4); ctx.lineTo(50, 0); ctx.lineTo(40, 4); ctx.lineTo(4, 4); ctx.fill();
    ctx.fillStyle = '#e14a3a'; ctx.fillRect(10, -4, 6, 8);
  }
  if (c.flash > 0) { ctx.fillStyle = 'rgba(255,230,120,.9)'; ctx.beginPath(); ctx.arc(50, 0, 12, 0, 6.3); ctx.fill(); }
  const locked = !flak && aimLocked(S);
  ctx.strokeStyle = flak ? 'rgba(255,226,120,.6)' : locked ? 'rgba(120,255,150,.95)' : 'rgba(255,255,255,.6)';
  ctx.lineWidth = locked ? 3 : 2; ctx.setLineDash([3, 7]);
  ctx.beginPath(); ctx.moveTo(56, 0); ctx.lineTo(flak ? 120 : 260, 0); ctx.stroke(); ctx.setLineDash([]);   // aim guide: green = on target
  ctx.restore();
  if (c.hit > 0 && c.hit % 4 < 2) { ctx.fillStyle = 'rgba(255,80,60,.45)'; ctx.fillRect(-124, -8, 266, 62); }
  ctx.restore();
  if (S.phase !== 'play') return;
  // charge ring above the launcher
  const mx = c.x + c.dir * 72, my = DECK_Y + c.dy - 28;
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(mx, my - 46, 17, 0, 6.3); ctx.stroke();
  if (c.charge > 0) {
    ctx.strokeStyle = c.elev >= TUNE.FLAK_ELEV ? '#ffd23f' : '#ff6a3a'; ctx.beginPath(); ctx.arc(mx, my - 46, 17, -Math.PI / 2, -Math.PI / 2 + c.charge * 6.283); ctx.stroke();
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(c.elev >= TUNE.FLAK_ELEV ? 'FLAK' : (S.power.triple > 0 ? 'MISSILE x3' : 'MISSILE'), mx, my - 66);
}

function drawPlane(x, y, dir, rot, color, alpha, t, afterburn) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1); ctx.rotate(rot); ctx.globalAlpha = alpha;
  if (afterburn) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,170,40,.9)'; ctx.beginPath(); ctx.moveTo(-26, -3); ctx.lineTo(-40 - Math.random() * 8, 0); ctx.lineTo(-26, 3); ctx.fill();
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.moveTo(-26, -1.5); ctx.lineTo(-34, 0); ctx.lineTo(-26, 1.5); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-26, -2); ctx.lineTo(-34, -16); ctx.lineTo(-20, -2); ctx.fill();
  ctx.fillStyle = '#c9d2dc'; ctx.beginPath(); ctx.moveTo(-26, 2); ctx.lineTo(-38, 8); ctx.lineTo(-18, 3); ctx.fill();
  ctx.fillStyle = '#8f9bab'; ctx.beginPath(); ctx.moveTo(4, -2); ctx.lineTo(-14, -10); ctx.lineTo(-20, -8); ctx.lineTo(-4, 1); ctx.fill();
  let g = ctx.createLinearGradient(0, -8, 0, 8); g.addColorStop(0, '#f4f7fa'); g.addColorStop(1, '#aeb9c6');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-28, -4); ctx.quadraticCurveTo(0, -9, 24, -2); ctx.lineTo(38, 1); ctx.lineTo(24, 4); ctx.quadraticCurveTo(0, 8, -28, 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-26, -1); ctx.lineTo(22, -1); ctx.lineTo(24, 2); ctx.lineTo(-26, 2); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(26, -2); ctx.lineTo(38, 1); ctx.lineTo(26, 3); ctx.fill();
  g = ctx.createLinearGradient(0, -10, 0, -2); g.addColorStop(0, '#d6f4ff'); g.addColorStop(1, '#3a8fc0');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(8, -4.5, 9, 4, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(5, -7, 4, 1.5);
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(-16, 14); ctx.lineTo(-24, 14); ctx.lineTo(-8, 1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-18, 12, 6, 2);
  ctx.fillStyle = '#d9dde2'; ctx.fillRect(-6, 8, 14, 3); ctx.fillStyle = '#e14a3a'; ctx.fillRect(6, 8, 3, 3);
  if (Math.floor(t / 14) % 2) { ctx.fillStyle = '#7dff6a'; ctx.beginPath(); ctx.arc(-22, 14, 1.8, 0, 6.3); ctx.fill(); }   // wingtip light
  ctx.restore();
}

function drawBogie(b, t, night) {
  ctx.save(); ctx.translate(b.x, b.y);
  const dir = b.vx >= 0 ? 1 : -1;
  ctx.scale(dir, 1); if (b.dying) ctx.rotate(b.rot);
  const big = b.kind === 'bomber', k = big ? 1.5 : 1;
  ctx.scale(k, k);
  ctx.fillStyle = '#2e3440';
  ctx.beginPath(); ctx.moveTo(-26, -3); ctx.quadraticCurveTo(0, -8, 22, -1); ctx.lineTo(34, 1); ctx.lineTo(22, 4); ctx.quadraticCurveTo(0, 7, -26, 3); ctx.fill();
  ctx.fillStyle = '#22262f'; ctx.beginPath(); ctx.moveTo(-24, -2); ctx.lineTo(-32, -14); ctx.lineTo(-16, -2); ctx.fill();
  ctx.fillStyle = '#3b4252'; ctx.beginPath(); ctx.moveTo(6, 1); ctx.lineTo(-18, 13); ctx.lineTo(-26, 13); ctx.lineTo(-6, 1); ctx.fill();
  ctx.beginPath(); ctx.moveTo(6, -1); ctx.lineTo(-14, -9); ctx.lineTo(-20, -8); ctx.lineTo(-4, -1); ctx.fill();
  ctx.fillStyle = '#d83a3a'; ctx.beginPath(); ctx.moveTo(24, -1); ctx.lineTo(34, 1); ctx.lineTo(24, 3); ctx.fill();
  ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.ellipse(9, -4, 7, 3, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#d83a3a'; ctx.beginPath(); ctx.arc(-6, 6, 3, 0, 6.3); ctx.fill();   // enemy marking
  if (big) { ctx.fillStyle = '#4a5160'; ctx.fillRect(-4, 6, 10, 4); }
  if (!b.dying) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,150,40,.8)'; ctx.beginPath(); ctx.moveTo(-26, -2); ctx.lineTo(-36 - Math.sin(t * 0.8) * 3, 0); ctx.lineTo(-26, 2); ctx.fill();
    ctx.restore();
  }
  if (Math.floor(t / (night ? 8 : 16)) % 2) {             // blinking nav lights (big and bright at night)
    ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(-24, 13, night ? 3.5 : 2, 0, 6.3); ctx.fill();
    if (night) { ctx.fillStyle = 'rgba(255,60,60,.3)'; ctx.beginPath(); ctx.arc(-24, 13, 10, 0, 6.3); ctx.fill(); }
  }
  if (b.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(-30, -12, 66, 26); }
  ctx.restore();
  if (!b.dying && b.kind === 'bomber' && b.hp < 2) pips(b.x, b.y - 30, b.hp, 2, '#ff5a4a');
}

function drawCrate(cr, t) {
  ctx.save(); ctx.translate(cr.x, cr.y); ctx.rotate(Math.sin(cr.sway) * 0.15);
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;   // strings
  ctx.beginPath(); ctx.moveTo(-18, -30); ctx.lineTo(-8, -6); ctx.moveTo(18, -30); ctx.lineTo(8, -6); ctx.moveTo(0, -34); ctx.lineTo(0, -6); ctx.stroke();
  for (let i = 0; i < 4; i++) {                                   // striped parachute
    ctx.fillStyle = i % 2 ? '#ffffff' : '#ff5a3a';
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.arc(0, -30, 22, Math.PI + i * Math.PI / 4, Math.PI + (i + 1) * Math.PI / 4); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#9a6a3a'; ctx.fillRect(-10, -8, 20, 16); ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2; ctx.strokeRect(-10, -8, 20, 16);
  if (cr.kind === 'repair') { ctx.fillStyle = '#fff'; ctx.fillRect(-6, -2, 12, 4); ctx.fillRect(-2, -6, 4, 12); ctx.fillStyle = '#e83a3a'; ctx.fillRect(-5, -1, 10, 2); ctx.fillRect(-1, -5, 2, 10); }
  else if (cr.kind === 'rapid') { ctx.fillStyle = '#ffe23a'; ctx.beginPath(); ctx.moveTo(2, -7); ctx.lineTo(-5, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 7); ctx.lineTo(5, -1); ctx.lineTo(0, -1); ctx.closePath(); ctx.fill(); }
  else { ctx.fillStyle = '#fff'; for (let i = -1; i <= 1; i++) ctx.fillRect(-6, -1 + i * 4, 12, 2); }
  ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(160,255,190,' + (0.12 + 0.08 * Math.sin(t * 0.2)) + ')';
  ctx.beginPath(); ctx.arc(cr.x, cr.y - 12, 34, 0, 6.3); ctx.fill(); ctx.restore();
}

function drawParticles(S) {
  for (const q of S.parts) {                             // smoke and water first...
    if (q.kind === 'fire' || q.kind === 'spark') continue;
    const a = Math.max(0, q.life / q.max);
    ctx.globalAlpha = q.kind === 'smoke' ? a * 0.55 : a;
    ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.1, q.size), 0, 6.3); ctx.fill();
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';  // ...then fire and sparks glowing on top
  for (const q of S.parts) {
    if (q.kind !== 'fire' && q.kind !== 'spark') continue;
    const a = Math.max(0, q.life / q.max);
    ctx.globalAlpha = a; ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.1, q.size), 0, 6.3); ctx.fill();
    ctx.globalAlpha = a * 0.25; ctx.beginPath(); ctx.arc(q.x, q.y, q.size * 2.4, 0, 6.3); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  for (const sp of S.splashes) {
    const a = 1 - sp.t / 40;
    ctx.strokeStyle = 'rgba(230,248,255,' + a * 0.8 + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 6 + sp.t * 0.9, 2 + sp.t * 0.3, 0, 0, 6.3); ctx.stroke();
  }
  for (const r of S.rings) {                             // shockwave rings
    const k = r.t / 22;
    ctx.strokeStyle = 'rgba(255,240,200,' + (1 - k) * 0.7 + ')'; ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(r.x, r.y, 6 + k * r.max * 2, 0, 6.3); ctx.stroke();
  }
}

function drawProjectiles(S) {
  for (const b of S.bullets) {
    if (b.home) {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ang);
      ctx.fillStyle = 'rgba(255,170,40,.9)'; ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-13 - Math.random() * 4, 0); ctx.lineTo(-6, 2); ctx.fill();
      ctx.fillStyle = '#eef2f6'; ctx.fillRect(-6, -2, 13, 4); ctx.fillStyle = '#ff5a3a'; ctx.beginPath(); ctx.moveTo(7, -2); ctx.lineTo(12, 0); ctx.lineTo(7, 2); ctx.fill();
      ctx.restore(); continue;
    }
    ctx.fillStyle = '#fff6a8'; ctx.fillRect(b.x - 8, b.y - 1.5, 16, 3); ctx.fillStyle = '#ffb02e'; ctx.fillRect(b.x - 3, b.y - 1.5, 6, 3);
  }
  for (const f of S.flak) { ctx.fillStyle = '#ffe48a'; ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, 6.3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x, f.y, 2, 0, 6.3); ctx.fill(); }
  for (const m of S.missiles) {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,160,40,.9)'; ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-22 - Math.random() * 6, 0); ctx.lineTo(-10, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,80,.25)'; ctx.beginPath(); ctx.arc(-12, 0, 9, 0, 6.3); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#f2f4f7'; ctx.fillRect(-10, -3, 20, 6); ctx.fillStyle = m.owner === 'p' ? '#3a7bff' : '#e14a3a';
    ctx.beginPath(); ctx.moveTo(10, -3); ctx.lineTo(17, 0); ctx.lineTo(10, 3); ctx.fill();
    ctx.fillStyle = '#7b8696'; ctx.fillRect(-10, -6, 5, 12); ctx.restore();
  }
  for (const e of S.enemyShots) {
    if (e.kind === 'shell') { ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ff6a3a'; ctx.beginPath(); ctx.arc(e.x - 1, e.y - 1, 2, 0, 6.3); ctx.fill(); }
    else if (e.kind === 'torpedo') {
      const a = Math.atan2(e.vy, e.vx);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(e.x - Math.cos(a) * 60, e.y - Math.sin(a) * 60); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(a);
      ctx.fillStyle = '#1c2228'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 3.5, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = Math.floor(S.t / 6) % 2 ? '#ff3b3b' : '#7a1a1a'; ctx.beginPath(); ctx.arc(9, 0, 2.5, 0, 6.3); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,60,60,.35)'; ctx.beginPath(); ctx.arc(e.x, e.y, 11, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#ffd0c0'; ctx.beginPath(); ctx.arc(e.x, e.y, 2.5, 0, 6.3); ctx.fill();
    }
  }
  for (const b of S.bombs) { ctx.fillStyle = '#1c1f26'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 5, 8, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = '#d83a3a'; ctx.fillRect(b.x - 3, b.y - 11, 6, 4); }
}

function pipRow(x, y, n, max, col, align) {
  for (let i = 0; i < max; i++) {
    const px = align === 'right' ? x - i * 17 : x + i * 17;
    ctx.fillStyle = i < n ? col : 'rgba(255,255,255,.18)'; ctx.fillRect(px, y, 13, 10);
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.strokeRect(px, y, 13, 10);
  }
}
function goalBar(cx, y, label, n, max, col) {
  const w = 120, h = 13;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(cx - w / 2, y, w, h);
  ctx.fillStyle = col; ctx.fillRect(cx - w / 2, y, w * Math.min(1, n / max), h);
  if (n >= max) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(cx - w / 2, y, w, 4); }
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - w / 2, y, w, h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(label + '  ' + Math.min(n, max) + '/' + max + (n >= max ? ' ✓' : ''), cx, y - 3);
}
function names() { return roleNames(round, root.PLAYER_NAMES || null); }

function drawHUD(S) {
  const nm = names();
  ctx.fillStyle = 'rgba(8,14,34,.72)'; ctx.fillRect(0, 0, W, 60);
  ctx.fillStyle = 'rgba(120,160,255,.5)'; ctx.fillRect(0, 60, W, 2);
  ctx.textAlign = 'left'; ctx.font = 'bold 16px "Arial Rounded MT Bold",Arial';
  ctx.fillStyle = '#ffb36b'; ctx.fillText('⚓ ' + nm.c.toUpperCase() + '  ★ ' + S.stars.c, 12, 22);
  ctx.font = 'bold 10px Arial'; ctx.fillStyle = '#cfd8ee'; ctx.fillText('CARRIER  WASD • Q/E • mash SPACE', 12, 36);
  pipRow(12, 42, S.carrier.hull, TUNE.HULL, '#ffb36b', 'left');
  ctx.textAlign = 'right'; ctx.font = 'bold 16px "Arial Rounded MT Bold",Arial';
  const pc = PLANE_COLORS[S.plane.state === 'deck' ? (S.launches + 1 + S.round) % 2 : S.plane.colorIdx];
  ctx.fillStyle = pc; ctx.fillText(nm.p.toUpperCase() + '  ★ ' + S.stars.p + ' ✈', W - 12, 22);
  ctx.font = 'bold 10px Arial'; ctx.fillStyle = '#cfd8ee'; ctx.fillText('FIGHTER  ARROWS • ENTER • R-SHIFT', W - 12, 36);
  pipRow(W - 25, 42, S.plane.hp, TUNE.PLANE_HP, pc, 'right');
  for (let i = 0; i < TUNE.PLANE_MISSILES; i++) {   // air-to-ground ammo
    ctx.fillStyle = i < S.plane.ammo ? '#ffffff' : 'rgba(255,255,255,.2)'; ctx.fillRect(W - 25 - TUNE.PLANE_HP * 17 - 8 - i * 13, 42, 9, 10);
    ctx.fillStyle = i < S.plane.ammo ? '#3a7bff' : 'rgba(58,123,255,.2)'; ctx.fillRect(W - 25 - TUNE.PLANE_HP * 17 - 8 - i * 13, 42, 9, 3);
  }
  goalBar(W / 2 - 138, 20, '🚢 SHIPS', S.goals.ships, S.need.ships, '#4aa8ff');
  goalBar(W / 2, 20, '🎯 LAND', S.goals.land, S.need.land, '#ffb347');
  goalBar(W / 2 + 138, 20, '✈ BOGIES', S.goals.bogies, S.need.bogies, '#ff6a6a');
  ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
  if (S.phase === 'landing') { ctx.fillStyle = '#9dffbd'; ctx.fillText('ALL CLEAR — FIGHTER: LAND ON THE CARRIER!  (carrier: slide underneath to help)', W / 2, 52); }
  else { ctx.fillStyle = '#9fb0d8'; ctx.fillText('MISSION ' + (S.level + 1) + ' · ' + S.L.name, W / 2, 52); }
  // power-up chips and the boss bar under the HUD
  let cx = 12;
  const chip = (txt, col) => { ctx.font = 'bold 12px Arial'; const w = ctx.measureText(txt).width + 16; ctx.fillStyle = col; roundRect(cx, 68, w, 20, 8); ctx.fill(); ctx.fillStyle = '#0b1020'; ctx.textAlign = 'left'; ctx.fillText(txt, cx + 8, 82); cx += w + 6; };
  if (S.power.rapid > 0) chip('⚡ RAPID FIRE ' + Math.ceil(S.power.rapid / 60), '#ffe23a');
  if (S.power.triple > 0) chip('🚀 TRIPLE x' + S.power.triple, '#9dffbd');
  const boss = S.phase === 'play' && S.ships.find(s => s.kind === 'boss' && !s.sinking);
  if (boss) {
    const w = 300, x = W / 2 - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(x - 4, 66, w + 8, 22, 8); ctx.fill();
    ctx.fillStyle = '#c82828'; ctx.fillRect(x, 70, w * boss.hp / boss.maxhp, 14);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x, 70, w, 14);
    ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('BOSS BATTLESHIP', W / 2, 81);
  }
}

function drawBanner(S) {
  if (S.bannerT <= 0) return;
  const a = Math.min(1, S.bannerT / 20);
  const win = S.phase === 'win';
  ctx.save(); ctx.globalAlpha = win ? 1 : a; ctx.textAlign = 'center';
  const pop = win ? 1 : 1 + Math.max(0, (S.bannerT - 90) / 40) * 0.25;  // new banners pop in a bit bigger
  ctx.font = 'bold ' + Math.round((win ? 68 : 40) * pop) + 'px "Arial Rounded MT Bold",Arial';
  const y = win ? 225 : 150;
  outlined(S.banner, W / 2, y, win ? '#ffe45a' : '#fff', '#1a1030', 8);
  if (win) {
    const nm = names();
    ctx.font = 'bold 22px Arial';
    outlined((nm.c + ' + ' + nm.p + ' cleared ' + S.L.name + '!').toUpperCase(), W / 2, y + 42, '#fff', '#1a1030', 5);
    ctx.font = 'bold 18px Arial';
    outlined('★ ' + nm.c.toUpperCase() + ' ' + S.stars.c + '     ★ ' + nm.p.toUpperCase() + ' ' + S.stars.p + (S.combos ? '     TEAM COMBOS ' + S.combos : ''), W / 2, y + 72, '#ffd23f', '#1a1030', 5);
    if (S.phaseT > 150) {
      ctx.font = 'bold 22px Arial';
      outlined(S.level === LEVELS.length - 1 ? 'press R or the MAP button: you saved the world!' : 'press R or NEXT MISSION  (swap sides!)', W / 2, y + 108, '#9fe3ff', '#1a1030', 5);
    }
  }
  ctx.restore();
}

// Background skirmish: marines in landing boats and defenders on the beach shoot at each other. Pure decoration
// (nobody ever gets hurt: a "hit" soldier just ducks for a moment), so it uses its own timers, not the game state.
const SK = { men: [], shots: [], puffs: [], boats: [{ x: 590, y: 356 }, { x: 622, y: 361 }, { x: 654, y: 356 }] };
for (let i = 0; i < 6; i++) SK.men.push({ side: 0, x: SK.boats[i >> 1].x - 6 + (i % 2) * 12, y: SK.boats[i >> 1].y - 5, fire: 20 + Math.random() * 120, duck: 0, flash: 0 });
for (let i = 0; i < 7; i++) SK.men.push({ side: 1, x: 706 + i * 24 + (i % 2) * 4, y: 349 + (i % 3) * 1.5, fire: 20 + Math.random() * 120, duck: 0, flash: 0 });
function skirmishStep() {
  for (const m of SK.men) {
    if (m.duck > 0) m.duck--;
    if (m.flash > 0) m.flash--;
    if (--m.fire <= 0 && m.duck <= 0) {
      m.fire = 40 + Math.random() * 130; m.flash = 4;
      const foes = SK.men.filter(o => o.side !== m.side), tgt = foes[(Math.random() * foes.length) | 0];
      const a = Math.atan2(tgt.y - m.y, tgt.x - m.x);
      SK.shots.push({ x: m.x, y: m.y - 5, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7 - 0.3, tx: tgt.x, ty: tgt.y - 4, tgt, life: 60 });
    }
  }
  for (const b of SK.shots) {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (Math.abs(b.x - b.tx) < 8 || (b.vx > 0 ? b.x > b.tx : b.x < b.tx)) {
      b.life = 0;
      if (Math.random() < 0.3 && b.tgt.duck <= 0) b.tgt.duck = 70;               // ducks, then pops back up
      SK.puffs.push({ x: b.tx + (Math.random() - 0.5) * 8, y: b.ty + 4, life: 18, side: b.tgt.side });
    }
  }
  SK.shots = SK.shots.filter(b => b.life > 0);
  for (const p of SK.puffs) p.life--;
  SK.puffs = SK.puffs.filter(p => p.life > 0);
}
function drawSoldier(m) {
  const dir = m.side === 0 ? 1 : -1, y = m.y + (m.duck > 0 ? 4 : 0);
  ctx.save(); ctx.translate(m.x, y); ctx.scale(dir * 1.7, 1.7);
  ctx.fillStyle = m.side === 0 ? '#3d6b3a' : '#7a2e2a'; ctx.fillRect(-2, -6, 4, 6);
  ctx.fillStyle = '#e8c9a0'; ctx.beginPath(); ctx.arc(0, -8, 2.2, 0, 6.3); ctx.fill();
  ctx.fillStyle = m.side === 0 ? '#2a4d28' : '#4a1c1a'; ctx.fillRect(-2.5, -11, 5, 2);
  if (m.duck <= 0) { ctx.fillStyle = '#222'; ctx.fillRect(1, -6, 8, 1.6); }
  if (m.flash > 0 && m.duck <= 0) { ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(11, -5.2, 2.6, 0, 6.3); ctx.fill(); }
  ctx.restore();
}
function drawSkirmish(t) {
  for (const b of SK.boats) {
    const bob = Math.sin(t * 0.05 + b.x) * 1.2;
    ctx.fillStyle = '#5b6470'; ctx.beginPath(); ctx.moveTo(b.x - 16, b.y + bob - 3); ctx.lineTo(b.x + 16, b.y + bob - 3); ctx.lineTo(b.x + 12, b.y + bob + 3); ctx.lineTo(b.x - 13, b.y + bob + 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(b.x - 20, b.y + bob + 3, 40, 1.5);
  }
  ctx.fillStyle = '#b89968';
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(706 + i * 24 + 6, 352, 8, 3, 0, 0, 6.3); ctx.fill(); }
  for (const m of SK.men) drawSoldier(m);
  for (const b of SK.shots) { ctx.strokeStyle = 'rgba(255,240,150,.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(b.x - b.vx * 2, b.y - b.vy * 2); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  for (const p of SK.puffs) { ctx.fillStyle = (p.side ? 'rgba(210,180,120,' : 'rgba(220,240,255,') + p.life / 24 + ')'; ctx.beginPath(); ctx.arc(p.x, p.y - (18 - p.life) * 0.3, 2 + (18 - p.life) * 0.25, 0, 6.3); ctx.fill(); }
}

function drawLandingGuide(S) {
  const c = S.carrier, dk = DECK_Y + c.dy, t = S.t, pulse = 0.5 + 0.5 * Math.sin(t * 0.15);
  ctx.save();
  ctx.strokeStyle = 'rgba(120,255,170,' + (0.5 + 0.4 * pulse) + ')'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
  ctx.strokeRect(c.x - c.w / 2 + 10, dk - 56, c.w - 20, 56); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(120,255,170,' + (0.12 + 0.12 * pulse) + ')'; ctx.fillRect(c.x - c.w / 2 + 10, dk - 56, c.w - 20, 56);
  ctx.fillStyle = '#9dffbd'; ctx.beginPath(); const ay = dk - 84 - pulse * 8;
  ctx.moveTo(c.x - 16, ay); ctx.lineTo(c.x + 16, ay); ctx.lineTo(c.x, ay + 22); ctx.fill();
  ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
  outlined('LAND HERE!', c.x, ay - 8, '#9dffbd', '#0b2a1a', 5);
  ctx.restore();
}

function draw(S) {
  const t = S.t, g = grads(S.L.theme);
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  drawBackground(S);
  drawIsland(S);
  drawSkirmish(t);
  for (const s of S.ships.slice().sort((a, b) => a.y - b.y)) drawShip(s, t);
  drawCarrier(S, t);
  const p = S.plane;
  if (p.state === 'landed') drawPlane(p.x, p.y, p.dir, 0, PLANE_COLORS[p.colorIdx], 1, t, false);
  if (p.state === 'deck') drawPlane(p.x, p.y, p.dir, 0, PLANE_COLORS[(S.launches + 1 + S.round) % 2], 1, t, false);
  if (p.trail.length > 1 && p.state === 'fly') {
    ctx.lineCap = 'round';
    for (let i = 1; i < p.trail.length; i++) { ctx.strokeStyle = 'rgba(255,255,255,' + (i / p.trail.length * 0.5) + ')'; ctx.lineWidth = 1 + i * 0.18; ctx.beginPath(); ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y); ctx.lineTo(p.trail[i].x, p.trail[i].y); ctx.stroke(); }
  }
  const night = S.L.theme === 'night';
  for (const b of S.bogies) drawBogie(b, t, night);
  for (const cr of S.crates) drawCrate(cr, t);
  if (p.state === 'fly' || p.state === 'down') {
    const blink = p.hit > 0 && p.state === 'fly' && Math.floor(p.hit / 4) % 2 === 0;
    drawPlane(p.x, p.y, p.dir, p.rot, PLANE_COLORS[p.colorIdx], blink ? 0.35 : 1, t, p.state === 'fly');
    if (p.dockFlash > 0) { ctx.strokeStyle = 'rgba(130,255,170,' + p.dockFlash / 40 + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, 40 - p.dockFlash * 0.4, 0, 6.3); ctx.stroke(); }
  }
  drawProjectiles(S);
  drawParticles(S);
  drawWeather(S);
  for (const f of S.floaters) {
    ctx.globalAlpha = Math.min(1, (60 - f.t) / 20); ctx.font = 'bold 20px "Arial Rounded MT Bold",Arial'; ctx.textAlign = 'center';
    outlined(f.text, f.x, f.y - f.t * 0.8, f.seat === 'c' ? '#ffb36b' : PLANE_COLORS[S.plane.colorIdx], '#10101a', 4);
  }
  ctx.globalAlpha = 1;
  if (S.phase === 'landing') drawLandingGuide(S);
  ctx.restore();
  ctx.fillStyle = g.vig; ctx.fillRect(0, 0, W, H);
  if (S.flashT > 0) { ctx.fillStyle = 'rgba(255,240,210,' + S.flashT / 6 * 0.28 + ')'; ctx.fillRect(0, 0, W, H); }
  drawHUD(S);
  drawBanner(S);
  if (S.phase === 'play' && S.plane.state === 'deck') {
    ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
    outlined('FIGHTER: press an ARROW to take off (or wait a moment)!', W / 2, 108, '#fff', '#0b1020', 4);
  }
}

// ───────────────────────────── browser: world map ─────────────────────────────
function proj(lon, lat) { return [20 + (lon + 180) / 360 * 860, 84 + (80 - lat) / 140 * 430]; }
const LANDS = [
  [[-168, 66], [-162, 70], [-140, 70], [-120, 73], [-95, 72], [-82, 69], [-80, 63], [-64, 60], [-56, 52], [-66, 44], [-71, 41], [-76, 35], [-81, 31], [-80, 25], [-84, 30], [-90, 29], [-97, 26], [-97, 20], [-91, 18], [-87, 15], [-83, 10], [-79, 8], [-86, 13], [-92, 15], [-105, 20], [-110, 23], [-117, 32], [-124, 40], [-124, 48], [-133, 56], [-146, 60], [-155, 58], [-165, 60]],
  [[-79, 8], [-72, 12], [-62, 10], [-52, 4], [-50, 0], [-44, -2], [-35, -6], [-39, -14], [-41, -22], [-48, -26], [-53, -34], [-58, -38], [-62, -41], [-65, -47], [-69, -52], [-72, -54], [-74, -48], [-73, -38], [-71, -30], [-70, -18], [-76, -12], [-81, -5], [-80, 0], [-77, 4]],
  [[-9, 37], [-9, 43], [-2, 43.5], [-4, 48], [2, 50], [5, 53], [9, 54], [8, 57], [11, 59], [5, 61], [8, 63], [14, 67], [20, 70], [28, 71], [33, 69], [40, 66], [44, 68], [52, 68], [60, 68], [55, 60], [50, 50], [40, 46], [36, 47], [30, 45], [28, 41], [22, 40], [24, 38], [20, 39], [19, 42], [13, 46], [18, 40], [16, 38], [12, 44], [8, 44], [3, 43], [0, 40], [-2, 37]],
  [[-5, 50], [1, 51], [2, 53], [-1, 55], [-3, 58], [-6, 58], [-5, 55], [-3, 54], [-5, 52]],
  [[-17, 21], [-16, 27], [-10, 30], [-6, 36], [3, 37], [10, 37], [11, 33], [20, 31], [30, 31], [33, 31], [35, 28], [39, 20], [43, 12], [51, 12], [48, 6], [41, -2], [40, -11], [36, -20], [33, -26], [27, -34], [20, -35], [17, -29], [12, -17], [13, -8], [9, -1], [9, 4], [3, 6], [-5, 5], [-12, 8], [-16, 13]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -16]],
  [[60, 68], [70, 73], [80, 73], [100, 78], [113, 74], [130, 71], [150, 71], [170, 70], [180, 66], [175, 62], [163, 60], [160, 54], [155, 59], [142, 59], [136, 54], [141, 48], [133, 43], [129, 41], [126, 37], [121, 40], [122, 31], [120, 25], [110, 21], [108, 16], [106, 10], [100, 13], [100, 7], [103, 1], [98, 8], [94, 16], [91, 22], [87, 21], [80, 15], [78, 8], [73, 18], [72, 22], [67, 25], [57, 25], [56, 27], [50, 30], [48, 30], [51, 25], [56, 24], [59, 22], [55, 17], [44, 12], [43, 16], [39, 22], [34, 28], [35, 33], [36, 36], [30, 36], [27, 37], [28, 41], [36, 42], [42, 41], [50, 46], [55, 45], [50, 50], [55, 60]],
  [[130, 31], [132, 34], [136, 35], [140, 36], [141, 41], [140, 38], [139, 35], [135, 33]],
  [[114, -22], [122, -18], [129, -15], [132, -11], [137, -12], [136, -15], [140, -17], [142, -11], [146, -19], [150, -23], [153, -28], [151, -34], [147, -38], [141, -38], [138, -35], [131, -31], [124, -33], [115, -34], [113, -26]],
  [[95, 5], [98, 4], [104, -2], [106, -6], [102, -4], [98, 0]],
  [[106, -6], [110, -7], [114, -8], [110, -8.5], [106, -7]],
  [[109, 2], [113, 4], [117, 7], [119, 5], [117, 0], [116, -4], [111, -3], [109, 0]],
  [[131, -1], [138, -2], [147, -6], [150, -10], [143, -9], [138, -8], [133, -4]],
  [[172, -35], [175, -37], [178, -38], [176, -41], [174, -41], [172, -44], [167, -46], [170, -43], [173, -40]],
  [[-24, 65], [-18, 66], [-14, 65], [-17, 63.5], [-22, 64]],
];
const ICE = [[[-73, 78], [-60, 82], [-30, 83], [-20, 76], [-22, 70], [-42, 60], [-50, 62], [-56, 70], [-68, 76]]];
const OCEANS = [['PACIFIC OCEAN', -150, 8], ['ATLANTIC OCEAN', -38, 22], ['INDIAN OCEAN', 78, -22], ['ARCTIC OCEAN', -10, 79], ['PACIFIC', 168, -28]];
const SAVE_KEY = 'battle-fighter.progress';
let prog = loadProg(), mapSel = 0, mapT = 0, mapAnim = null, mapGrad = null;
mapSel = Math.min(prog.unlocked - 1, LEVELS.length - 1);
function loadProg() { try { return sanitizeProgress(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (e) { return sanitizeProgress(null); } }
function saveProg() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(prog)); } catch (e) { /* private mode: progress just isn't kept */ } }
function pin(i) { return proj(LEVELS[i].lon, LEVELS[i].lat); }
function legPoint(i, k) {                                // point k (0..1) along the curved route from pin i to pin i+1
  const [x0, y0] = pin(i), [x1, y1] = pin(i + 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - 70;
  const u = 1 - k;
  return [u * u * x0 + 2 * u * k * cx + k * k * x1, u * u * y0 + 2 * u * k * cy + k * k * y1];
}

function mapKey(code) {
  if (mapAnim) return;
  const n = prog.unlocked;
  if (code === 'ArrowLeft' || code === 'KeyA') { mapSel = (mapSel + n - 1) % n; SFX.pick(); }
  else if (code === 'ArrowRight' || code === 'KeyD') { mapSel = (mapSel + 1) % n; SFX.pick(); }
  else if (code === 'Space' || code === 'Enter') startLevel(mapSel);
}
function mapClick(e) {
  if (mapAnim) return;
  const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
  for (let i = 0; i < prog.unlocked; i++) { const [px, py] = pin(i); if (dist(x, y, px, py) < 26) { mapSel = i; startLevel(i); return; } }
  if (y > 524) startLevel(mapSel);                       // clicking the mission card launches too
}
function startLevel(i) {
  clearInput(); mode = 'game'; SFX.go();
  S = createState((Date.now() & 0xffff) + 1, round, i);
}
function toMap(won) {
  clearInput();
  if (won && S && S.phase === 'win') {
    const from = S.level;
    prog = nextProgress(prog, from); saveProg();
    round++;                                             // swap sides for the next mission
    mapSel = Math.min(from + 1, LEVELS.length - 1);
    if (mapSel !== from) mapAnim = { from, t: 0 };
  }
  mode = 'map';
}

function drawCarrierIcon(x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(2, 9, 22, 4, 0, 0, 6.3); ctx.fill();
  ctx.fillStyle = '#7d8896'; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(22, 0); ctx.lineTo(16, 8); ctx.lineTo(-16, 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a82a2a'; ctx.fillRect(-15, 6, 30, 2);
  ctx.fillStyle = '#5a6472'; ctx.fillRect(-8, -7, 7, 7);
  ctx.fillStyle = '#fff'; ctx.fillRect(-18, -1, 38, 1.5);
  ctx.restore();
}

function drawMap() {
  mapT++;
  if (mapAnim && ++mapAnim.t > 130) mapAnim = null;
  if (!mapGrad) mapGrad = lin(0, 0, 0, H, ['#0a2a50', '#11507e', '#0a2a50'], [0, 0.55, 1]);
  ctx.fillStyle = mapGrad; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1.5;   // little moving waves
  for (let i = 0; i < 40; i++) {
    const x = (i * 137 + mapT * 0.3) % (W + 40) - 20, y = 90 + (i * 89) % 420;
    ctx.beginPath(); ctx.arc(x, y, 8, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(160,200,255,.12)'; ctx.lineWidth = 1;     // latitude / longitude grid
  for (let lon = -150; lon <= 150; lon += 30) { const [x0, y0] = proj(lon, 80), [, y1] = proj(lon, -60); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke(); }
  for (let lat = 60; lat >= -60; lat -= 30) { const [x0, y0] = proj(-180, lat), [x1] = proj(180, lat); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); }
  { const [x0, y0] = proj(-180, 0), [x1] = proj(180, 0); ctx.strokeStyle = 'rgba(255,220,120,.3)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,220,120,.55)'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.fillText('EQUATOR', x0 + 4, y0 - 4); }
  const poly = (pts, fill, stroke, dx, dy) => {
    ctx.beginPath(); pts.forEach(([lo, la], i) => { const [x, y] = proj(lo, la); if (i) ctx.lineTo(x + dx, y + dy); else ctx.moveTo(x + dx, y + dy); }); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  };
  for (const pts of LANDS) poly(pts, 'rgba(0,0,0,.25)', null, 3, 4);
  for (const pts of ICE) poly(pts, 'rgba(0,0,0,.25)', null, 3, 4);
  for (const pts of LANDS) poly(pts, '#5c9c56', '#2e5a2b', 0, 0);
  for (const pts of ICE) poly(pts, '#e6f1f6', '#9bb3c2', 0, 0);
  ctx.font = 'italic bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(190,225,255,.55)';
  for (const [name, lo, la] of OCEANS) { const [x, y] = proj(lo, la); ctx.fillText(name, x, y); }
  // route between missions: gold once sailed, dotted while still ahead
  for (let i = 0; i < LEVELS.length - 1; i++) {
    const sailed = prog.done.indexOf(i) >= 0;
    ctx.strokeStyle = sailed ? '#ffd23f' : 'rgba(255,255,255,.55)'; ctx.lineWidth = sailed ? 3 : 2; ctx.setLineDash(sailed ? [] : [6, 8]);
    ctx.beginPath(); for (let k = 0; k <= 30; k++) { const [x, y] = legPoint(i, k / 30); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke();
  }
  ctx.setLineDash([]);
  for (let i = 0; i < LEVELS.length; i++) {
    const [x, y] = pin(i), open = i < prog.unlocked, done = prog.done.indexOf(i) >= 0, sel = i === mapSel;
    if (sel) { ctx.strokeStyle = 'rgba(157,255,189,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 22 + Math.sin(mapT * 0.12) * 4, 0, 6.3); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x + 2, y + 3, 15, 0, 6.3); ctx.fill();
    ctx.fillStyle = done ? '#ffd23f' : open ? '#ff5a4a' : '#5b6675'; ctx.beginPath(); ctx.arc(x, y, 15, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
    if (open) { ctx.fillStyle = done ? '#3a2a00' : '#fff'; ctx.fillText(done ? '★' : String(i + 1), x, y + 5); }
    else { ctx.fillStyle = '#d6dbe2'; ctx.fillRect(x - 5, y - 1, 10, 8); ctx.strokeStyle = '#d6dbe2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 2, 4, Math.PI, 0); ctx.stroke(); }
    ctx.font = 'bold 11px Arial';
    outlined(LEVELS[i].name, x, y + 31, open ? '#fff' : '#9aa6b5', '#0a2038', 4);
  }
  // the carrier sails to the next mission after a win
  let cx, cy;
  if (mapAnim) { const k = Math.min(1, mapAnim.t / 110), e = k * k * (3 - 2 * k); [cx, cy] = legPoint(mapAnim.from, e); }
  else { [cx, cy] = pin(mapSel); cy -= 30; }
  drawCarrierIcon(cx, cy + (mapAnim ? 0 : Math.sin(mapT * 0.08) * 2), 1.1);
  // title
  ctx.textAlign = 'center'; ctx.font = 'bold 34px "Arial Rounded MT Bold",Arial';
  outlined('BATTLE FIGHTER', W / 2, 42, '#ffe45a', '#1a1030', 7);
  ctx.font = 'bold 14px Arial';
  outlined(prog.done.length >= LEVELS.length ? '🏆 WORLD TOUR COMPLETE! PLAY ANY MISSION AGAIN 🏆' : 'WORLD TOUR  •  ' + prog.done.length + ' of ' + LEVELS.length + ' missions done', W / 2, 64, '#9fe3ff', '#1a1030', 4);
  // compass rose
  ctx.save(); ctx.translate(60, 470);
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(6, 0); ctx.lineTo(0, 26); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(0, 6); ctx.lineTo(26, 0); ctx.lineTo(0, -6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#fff'; ctx.fillText('N', 0, -30);
  ctx.restore();
  // mission card
  const L = LEVELS[mapSel], nm = names();
  ctx.fillStyle = 'rgba(8,14,34,.85)'; roundRect(30, 528, W - 60, 102, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(157,255,189,.6)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = 'left'; ctx.font = 'bold 22px "Arial Rounded MT Bold",Arial';
  outlined('MISSION ' + (mapSel + 1) + ': ' + L.name, 50, 556, '#ffe45a', '#1a1030', 4);
  ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#9fe3ff'; ctx.fillText('📍 ' + L.place + '   •   🚢 ' + L.need.ships + ' ships   🎯 ' + L.need.land + ' targets   ✈ ' + L.need.bogies + ' bogies', 50, 578);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.fillText(L.news, 50, 600);
  ctx.fillStyle = '#cfd8ee'; ctx.font = 'bold 12px Arial';
  ctx.fillText('⚓ ' + nm.c.toUpperCase() + ' drives the carrier   •   ✈ ' + nm.p.toUpperCase() + ' flies', 50, 620);
  ctx.textAlign = 'right'; ctx.font = 'bold 16px Arial';
  const pulse = 0.6 + 0.4 * Math.sin(mapT * 0.15);
  outlined(mapAnim ? 'SAILING...' : 'SPACE or ENTER: GO!', W - 50, 566, 'rgba(157,255,189,' + pulse + ')', '#0b2a1a', 4);
  ctx.font = 'bold 11px Arial'; ctx.fillStyle = '#9fb0d8'; ctx.fillText('← → pick a mission  •  or click a pin', W - 50, 586);
}

// ───────────────────────────── browser: loop ─────────────────────────────
function clearInput() { for (const k in keys) keys[k] = false; for (const k in tapped) delete tapped[k]; presses = 0; }
function playEvents() {
  const seen = {};
  for (const e of S.events) { if (!seen[e] && SFX[e]) { seen[e] = 1; SFX[e](); } }
  S.events.length = 0;
}
let armed = 0;
const rb = document.getElementById('brestart'), mb = document.getElementById('bmute'), mapb = document.getElementById('bmap');
function syncButtons() {
  if (!rb) return;
  const label = mode === 'map' ? 'START ▶' : (S.phase !== 'win' && performance.now() - armed < 2000) ? 'TAP AGAIN ↻' : S.phase === 'win' ? (S.level === LEVELS.length - 1 ? 'WORLD MAP 🌍' : 'NEXT MISSION 🌍') : 'RESTART ↻';
  if (rb.textContent !== label) rb.textContent = label;
}
let acc = 0, last = performance.now();
function frame(now) {
  acc += Math.min(100, now - last); last = now;
  if (mode === 'map') { acc = 0; drawMap(); }
  else {
    while (acc >= 1000 / 60) { step(S, readInput()); skirmishStep(); playEvents(); acc -= 1000 / 60; }
    draw(S);
  }
  syncButtons();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (rb) rb.onclick = () => {
  ensureAudio();
  if (mode === 'map') startLevel(mapSel);
  else if (S.phase === 'win') toMap(true);
  else if (performance.now() - armed < 2000) { armed = 0; startLevel(S.level); }
  else armed = performance.now();                    // first tap only arms it, so a bump doesn't wipe the mission
  rb.blur();
};
if (mapb) mapb.onclick = () => { if (mode === 'game') toMap(S.phase === 'win'); mapb.blur(); };
if (mb) mb.onclick = () => { muted = !muted; mb.textContent = muted ? '🔇 SOUND OFF' : '🔊 SOUND ON'; mb.blur(); };
root.__bf = { get S() { return S; }, get mode() { return mode; }, startLevel, toMap, get prog() { return prog; } };

})(typeof window !== 'undefined' ? window : globalThis);

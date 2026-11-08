'use strict';
// Battle Fighter -- 2-player co-op. One player runs the aircraft carrier (WASD, mash Space to charge a
// launch), the other flies the fighter (Left/Right to turn, Up/Down to climb/dive, hold Enter to shoot).
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
  GOALS: { ships: 5, land: 4, bogies: 8 },
  PRESSES_TO_FIRE: 3,         // mash this many times to launch
  CHARGE_HOLD: 45,            // frames before the charge starts to leak
  CHARGE_LEAK: 0.006,
  FLAK_ELEV: 60,              // launcher aimed at/above this = anti-aircraft, below = missile
  MISSILE_DMG: 2, SHIP_HP: 4, LAND_HP: 3,
  CARRIER_SPEED: 2.2, CARRIER_MIN: 130, CARRIER_MAX: 560,
  PLANE_CRUISE: 3.4, PLANE_BOOST: 5.4, PLANE_CLIMB: 3.6,
  GUN_COOLDOWN: 16, BULLET_SPEED: 8.5,            // Enter: heat-seeking air-to-air missile (unlimited)
  AAM_CONE_DEG: 55, AAM_TURN: 0.14,
  PLANE_INVULN: 70, DOCK_COOLDOWN: 90,
  RALLY_FRAMES: 150, DOWN_FRAMES: 150,
  MAX_BOGIES: 3, MAX_SHIPS: 3,
  PLANE_MISSILES: 4, PLANE_MISSILE_COOLDOWN: 40,   // air-to-surface missiles; refilled by a pass over the carrier
  CONE_DEG: 16, PLANE_CONE_DEG: 30,                // a missile only homes if it is already pointed within this cone of a target
  HOMING: 0.045,
  DEPTH_RANGE: 28, DEPTH_SPEED: 0.9,               // the carrier can slide up/down the screen a little
  LANDING_ASSIST: 900,                             // frames of 'land on the carrier' before the autopilot helps
};
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

// ───────────────────────────── state ─────────────────────────────
function createState(seed, round) {
  round = round || 0;
  const S = {
    rng: mulberry32((seed || 1) + round * 7919),
    t: 0, round, phase: 'play', phaseT: 0, rally: 0, launches: 0,
    carrier: { x: 300, dir: 1, elev: 24, charge: 0, idle: 0, hull: TUNE.HULL, hit: 0, w: 220, recoil: 0, flash: 0, dy: 0 },
    plane: { state: 'deck', stateT: 90, x: 300, y: DECK_Y - 14, vx: 0, vy: 0, dir: 1, hp: TUNE.PLANE_HP, hit: 0,
             colorIdx: (round + 1) % 2, rot: 0, cool: 0, dockCd: 0, trail: [], dockFlash: 0, anyPrev: true, bounce: 0, ammo: TUNE.PLANE_MISSILES, mcool: 0 },
    bogies: [], ships: [], land: [],
    missiles: [], flak: [], bullets: [], enemyShots: [], bombs: [],
    parts: [], splashes: [],
    goals: { ships: 0, land: 0, bogies: 0 },
    stars: { c: 0, p: 0 },
    spawnT: 120, banner: '', bannerT: 0, shake: 0, events: [], fwT: 0,
  };
  const lx = [655, 725, 795, 855], kinds = ['radar', 'bunker', 'fuel', 'sam'];
  for (let i = 0; i < 4; i++) {
    S.land.push({ kind: kinds[i], x: lx[i], y: HORIZON + 20 + (i % 2) * 8, hp: TUNE.LAND_HP, maxhp: TUNE.LAND_HP, dead: false, flash: 0, fireT: 200 + i * 40 });
  }
  for (let i = 0; i < 3; i++) spawnShip(S, 130 + i * 160);
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
function spawnShip(S, x) {
  const y = 330 + S.rng() * 70;
  const dir = S.rng() < 0.5 ? -1 : 1;
  S.ships.push({ x: x || 150 + S.rng() * 400, y, dir, speed: 0.35 + S.rng() * 0.3, hp: TUNE.SHIP_HP, maxhp: TUNE.SHIP_HP,
                 fireT: 200 + S.rng() * 200, warn: 0, flash: 0, sinking: 0, scale: 0.6 + (y - 330) / 70 * 0.3, hue: (S.rng() * 3) | 0 });
}
function spawnBogie(S) {
  const fromLeft = S.rng() < 0.5;
  const bomber = S.rng() < 0.3;
  S.bogies.push({
    kind: bomber ? 'bomber' : 'jet',
    x: fromLeft ? -40 : W + 40, y: 90 + S.rng() * (bomber ? 70 : 170),
    vx: (fromLeft ? 1 : -1) * (bomber ? 1.5 : 2.4 + S.rng() * 1.2),
    hp: bomber ? 2 : 1, bob: S.rng() * 6.28, base: 0, fireT: 80 + S.rng() * 120, bombT: 0,
    dying: null, rot: 0, vy: 0, flash: 0, dead: false,
  });
  S.bogies[S.bogies.length - 1].base = S.bogies[S.bogies.length - 1].y;
}

// ───────────────────────────── targets ─────────────────────────────
function groundTargets(S) {
  const out = [];
  for (const s of S.ships) if (!s.sinking) out.push(s);
  for (const l of S.land) if (!l.dead) out.push(l);
  return out;
}
function hitGround(S, t, dmg, seat) {
  seat = seat || 'c';
  t.hp -= dmg; t.flash = 10;
  if (t.hp > 0) { boom(S, t.x, t.y, 0.6); return; }
  if (t.sinking !== undefined) {           // a ship
    if (!t.sinking) { t.sinking = 1; S.goals.ships++; S.stars[seat]++; boom(S, t.x, t.y, 1.6); banner(S, 'SHIP SUNK!', 90); say(S, 'cheer'); }
  } else if (!t.dead) {                    // a land target
    t.dead = true; S.goals.land++; S.stars[seat]++; boom(S, t.x, t.y - 6, 1.8); banner(S, 'TARGET DESTROYED!', 90); say(S, 'cheer');
  }
}

function killBogie(S, b, seat) {
  if (b.dying || b.dead) return;
  S.goals.bogies++; S.stars[seat]++;
  banner(S, 'BOGEY DOWN!', 80); say(S, 'cheer');
  if (S.rng() < 0.5) {                      // some explode...
    b.dead = true; boom(S, b.x, b.y, 1.5);
  } else {                                  // ...and some spin into the sea
    b.dying = 'spin'; b.vy = 0.5; b.vx *= 0.6; b.splashY = 330 + S.rng() * 90; say(S, 'whistle');
  }
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

// ───────────────────────────── carrier weapons ─────────────────────────────
function fireCarrier(S) {
  const c = S.carrier, dir = c.dir, dk = DECK_Y + c.dy;
  const mx = c.x + dir * 72, my = dk - 22;
  c.recoil = 10; c.flash = 6;
  if (c.elev >= TUNE.FLAK_ELEV) {                       // anti-aircraft: a fan of three flak shells
    for (const off of [-10, 0, 10]) {
      const a = (c.elev + off) * DEG;
      S.flak.push({ x: mx, y: my, vx: dir * Math.cos(a) * 7.5, vy: -Math.sin(a) * 7.5, life: 62 });
    }
    say(S, 'flak');
  } else {                                              // surface-to-surface missile: it flies where the launcher points
    const rad = c.elev * DEG;                           // and only steers itself if it is already close to a target
    S.missiles.push({ x: mx, y: my, ang: dir > 0 ? -rad : Math.PI + rad, owner: 'c', cone: TUNE.CONE_DEG * DEG, life: 300 });
    say(S, 'missile');
  }
  for (let i = 0; i < 6; i++) puff(S, mx, my, { vx: dir * (1 + S.rng() * 2), vy: -S.rng() * 1.5, life: 26, max: 26, size: 5, grow: 0.25, color: '#cfd5e0', kind: 'smoke' });
}

function flakBurst(S, f) {
  puff(S, f.x, f.y, { life: 16, max: 16, size: 26, grow: 0.6, color: '#ffe48a', kind: 'fire' });
  for (let i = 0; i < 10; i++) {
    const a = S.rng() * 6.283;
    puff(S, f.x, f.y, { vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5, life: 20, max: 20, size: 2.5, color: '#fff2b0', kind: 'dot' });
  }
  for (const b of S.bogies) if (!b.dying && !b.dead && dist(b.x, b.y, f.x, f.y) < 58) hitBogie(S, b, 1, 'c');
  say(S, 'pop');
}

// ───────────────────────────── main step ─────────────────────────────
function step(S, inp) {
  S.t++;
  if (S.bannerT > 0) S.bannerT--;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - 0.6);
  updateParticles(S);
  for (const sp of S.splashes) sp.t++;
  S.splashes = S.splashes.filter(sp => sp.t < 40);

  if (S.phase === 'win') { winStep(S); return; }

  const c = S.carrier, p = S.plane;
  if (c.hit > 0) c.hit--;
  if (c.recoil > 0) c.recoil--;
  if (c.flash > 0) c.flash--;

  if (S.rally > 0) {                                    // hull gone: no-punishment reset
    S.rally--;
    if (S.t % 8 === 0) boom(S, c.x + (S.rng() - 0.5) * 160, DECK_Y + c.dy - 4, 0.6);
    if (S.rally === 0) rallyReset(S);
    return;
  }

  carrierStep(S, inp.c || {});
  planeStep(S, inp.p || {});
  shipsStep(S);
  landStep(S);
  bogiesStep(S);
  projectilesStep(S);
  spawnStep(S);

  const g = S.goals, G = TUNE.GOALS;
  if (S.phase === 'play' && g.ships >= G.ships && g.land >= G.land && g.bogies >= G.bogies) {
    S.phase = 'landing'; S.phaseT = 0; banner(S, 'ALL CLEAR!', 150); say(S, 'cheer');   // now the plane has to land on the carrier
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
  p.state = 'landed'; p.x = c.x - c.dir * 10; p.y = DECK_Y + c.dy - 14; p.dir = c.dir; p.vx = 0; p.vy = 0; p.rot = 0;
  S.phase = 'win'; S.phaseT = 0; S.fwT = 0; banner(S, 'YOU WIN!', 99999); say(S, 'dock'); say(S, 'win');
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
  const presses = k.presses | 0;
  if (presses > 0) {
    c.charge += presses / TUNE.PRESSES_TO_FIRE; c.idle = 0; say(S, 'tick');
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
    p.x = c.x - c.dir * 10; p.y = dk - 14; p.dir = c.dir; p.vx = 0; p.vy = 0; p.rot = 0;
    p.stateT--;
    if (rising || p.stateT <= 0) {            // takeoff needs a fresh key press, not a held key                       // take off; colour alternates every launch
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
  if (p.x < 40) { p.x = 40; p.dir = 1; p.bounce = 50; }
  if (p.x > W - 40) { p.x = W - 40; p.dir = -1; p.bounce = 50; }
  p.y = clamp(p.y, TOP_SAFE, dk - 30);
  p.rot = p.vy * 0.06 * p.dir;
  if (S.t % 2 === 0) { p.trail.push({ x: p.x - p.dir * 28, y: p.y }); if (p.trail.length > 26) p.trail.shift(); }

  if (k.fire && p.cool <= 0) {
    p.cool = TUNE.GUN_COOLDOWN;
    const a0 = p.dir > 0 ? 0 : Math.PI;
    S.bullets.push({ x: p.x + p.dir * 34, y: p.y, ang: a0, vx: Math.cos(a0) * TUNE.BULLET_SPEED, vy: 0, life: 100, home: true });
    say(S, 'gun');
  }
  if (k.missile && p.mcool <= 0 && p.ammo > 0) {      // air-to-surface missile: points down the way the plane faces
    p.mcool = TUNE.PLANE_MISSILE_COOLDOWN; p.ammo--;
    S.missiles.push({ x: p.x + p.dir * 22, y: p.y + 8, ang: p.dir > 0 ? 0.45 : Math.PI - 0.45, owner: 'p', cone: TUNE.PLANE_CONE_DEG * DEG, life: 260 });
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

function shipsStep(S) {
  const c = S.carrier;
  for (const s of S.ships) {
    if (s.flash > 0) s.flash--;
    if (s.sinking) { s.sinking++; if (s.sinking % 6 === 0) puff(S, s.x + (S.rng() - 0.5) * 30, s.y, { vy: -0.5, life: 40, max: 40, size: 6, grow: 0.2, color: '#444', kind: 'smoke' }); continue; }
    s.x += s.dir * s.speed;
    if (s.x < 90) s.dir = 1;
    if (s.x > 600) s.dir = -1;
    if (--s.fireT <= 0) { s.warn = 36; s.fireT = 260 + S.rng() * 200; }
    if (s.warn > 0 && --s.warn === 0) {
      const tx = c.x + (S.rng() - 0.5) * 60, ty = DECK_Y + c.dy - 8, T = 100, g = 0.06;
      S.enemyShots.push({ kind: 'shell', x: s.x, y: s.y - 14, vx: (tx - s.x) / T, vy: (ty - (s.y - 14)) / T - 0.5 * g * T, g, life: 140 });
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
    if ((b.vx > 0 && b.x > W + 60) || (b.vx < 0 && b.x < -60)) { b.dead = true; continue; }   // flew off: doesn't count
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
  const p = S.plane;
  // plane bullets: bogies only
  for (const b of S.bullets) {
    if (b.home) {                                       // heat-seeking: steers toward the best bogey inside its wide cone
      let best = null, bd = 99;
      for (const g of S.bogies) {
        if (g.dying || g.dead) continue;
        let d = Math.atan2(g.y - b.y, g.x - b.x) - b.ang;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
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
  S.bullets = S.bullets.filter(b => b.life > 0 && b.x > -20 && b.x < W + 20);

  // flak
  for (const f of S.flak) {
    f.x += f.vx; f.y += f.vy; f.life--;
    let burst = f.life <= 0;
    for (const g of S.bogies) if (!g.dying && !g.dead && dist(f.x, f.y, g.x, g.y) < 40) burst = true;
    if (burst) { flakBurst(S, f); f.life = -1; }
  }
  S.flak = S.flak.filter(f => f.life > 0);

  // missiles fly where they were pointed; they only steer if a target is already inside their cone
  for (const m of S.missiles) {
    m.life--;
    let best = null, bd = 99;
    for (const t of groundTargets(S)) {
      let d = Math.atan2(t.y - m.y, t.x - m.x) - m.ang;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < m.cone && Math.abs(d) < bd) { bd = Math.abs(d); best = d; }
    }
    if (best !== null) m.ang += clamp(best, -TUNE.HOMING, TUNE.HOMING);
    m.x += Math.cos(m.ang) * 5.4; m.y += Math.sin(m.ang) * 5.4;
    puff(S, m.x - Math.cos(m.ang) * 8, m.y - Math.sin(m.ang) * 8, { life: 24, max: 24, size: 4, grow: 0.15, color: '#d8dde8', kind: 'smoke' });
    for (const t of groundTargets(S)) {
      if (dist(m.x, m.y, t.x, t.y) < 26) { hitGround(S, t, TUNE.MISSILE_DMG, m.owner); m.life = 0; break; }
    }
  }
  S.missiles = S.missiles.filter(m => m.life > 0 && m.x > -40 && m.x < W + 40 && m.y > -40 && m.y < H);

  // enemy shots
  for (const e of S.enemyShots) {
    e.life--;
    if (e.g) e.vy += e.g;
    e.x += e.vx; e.y += e.vy;
    if (e.kind === 'shell') {
      if (e.vy > 0 && e.y >= DECK_Y + S.carrier.dy - 8 && Math.abs(e.x - S.carrier.x) < S.carrier.w / 2 + 6) { hurtCarrier(S, e.x, e.y); e.life = 0; }
      else if (e.y > WATER_Y + S.carrier.dy + 20) { splash(S, e.x, e.y); e.life = 0; }
    } else if (p.state === 'fly' && dist(e.x, e.y, p.x, p.y) < 20) { hurtPlane(S, e.x, e.y); e.life = 0; }
  }
  S.enemyShots = S.enemyShots.filter(e => e.life > 0 && e.x > -40 && e.x < W + 40 && e.y > -40 && e.y < H);

  // bombs
  for (const b of S.bombs) {
    b.vy += 0.07; b.y += b.vy;
    if (b.y >= DECK_Y + S.carrier.dy - 10 && Math.abs(b.x - S.carrier.x) < S.carrier.w / 2) { hurtCarrier(S, b.x, DECK_Y + S.carrier.dy - 6); b.y = 9999; }
    else if (b.y > WATER_Y + S.carrier.dy + 10) { splash(S, b.x, b.y); b.y = 9999; }
  }
  S.bombs = S.bombs.filter(b => b.y < 9000);
}

function spawnStep(S) {
  const G = TUNE.GOALS;
  const aliveShips = S.ships.filter(s => !s.sinking).length;
  if (aliveShips < TUNE.MAX_SHIPS && S.goals.ships + aliveShips < G.ships) spawnShip(S, S.rng() < 0.5 ? 100 : 560);
  const aliveB = S.bogies.filter(b => !b.dying).length;
  if (--S.spawnT <= 0) {
    S.spawnT = 150 + S.rng() * 120;
    if (aliveB < TUNE.MAX_BOGIES && S.goals.bogies + aliveB < G.bogies) spawnBogie(S);
  }
  // never get stuck: if nothing is left to hunt, send another bogie
  if (aliveB === 0 && S.goals.bogies < G.bogies && S.spawnT > 60) S.spawnT = 40;
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

const API = { W, H, HORIZON, DECK_Y, WATER_Y, TUNE, PLANE_COLORS, createState, step, roleNames, groundTargets };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.BattleFighter = API;

// ───────────────────────────── browser: input ─────────────────────────────
if (typeof document === 'undefined' || !document.getElementById('gc')) return;

const keys = {};
let presses = 0;
const P1_FIRE = new Set(['Space', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period']);
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'KeyQ', 'KeyE', 'ShiftRight', 'Slash']);
addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!e.repeat && P1_FIRE.has(e.code)) presses++;       // each fresh press counts toward the launch
  keys[e.code] = true; ensureAudio();
  if (!e.repeat && e.code === 'KeyR' && S.phase === 'win') restart();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousedown', e => { if (e.target.id === 'gc') presses++; });   // toddler-proof: clicking charges the launch too

function readInput() {
  const pr = presses; presses = 0;
  const pk = { left: keys.ArrowLeft, right: keys.ArrowRight, up: keys.ArrowUp, down: keys.ArrowDown, fire: keys.Enter, missile: keys.ShiftRight || keys.Slash };
  pk.any = !!(pk.left || pk.right || pk.up || pk.down || pk.fire);
  return { c: { left: keys.KeyA, right: keys.KeyD, up: keys.KeyW, down: keys.KeyS, depthUp: keys.KeyQ, depthDown: keys.KeyE, presses: pr }, p: pk };
}

// ───────────────────────────── browser: sound ─────────────────────────────
let AC = null, muted = false;
function ensureAudio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } } }
function tone(f, d, type, vol, slide) {
  if (!AC || muted) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(vol || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d);
}
function noise(d, vol) {
  if (!AC || muted) return;
  const n = Math.floor(AC.sampleRate * d), buf = AC.createBuffer(1, n, AC.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = buf; g.gain.value = vol || 0.12;
  s.connect(g); g.connect(AC.destination); s.start();
}
const SFX = {
  tick: () => tone(520, 0.05, 'square', 0.05), gun: () => tone(900, 0.04, 'square', 0.025, -500),
  missile: () => { tone(200, 0.35, 'sawtooth', 0.07, 500); noise(0.3, 0.08); }, flak: () => { tone(140, 0.2, 'square', 0.07, -60); noise(0.15, 0.1); },
  pop: () => noise(0.12, 0.08), boom: () => noise(0.35, 0.14), bigboom: () => { noise(0.6, 0.2); tone(80, 0.5, 'sawtooth', 0.1, -40); },
  splash: () => noise(0.25, 0.07), hurt: () => tone(160, 0.3, 'sawtooth', 0.09, -90), whistle: () => tone(1200, 0.7, 'sine', 0.05, -900),
  cheer: () => { tone(660, 0.09, 'square', 0.06); setTimeout(() => tone(880, 0.14, 'square', 0.06), 90); },
  launch: () => tone(150, 0.6, 'sawtooth', 0.07, 400), dock: () => { tone(700, 0.1, 'sine', 0.07); setTimeout(() => tone(1050, 0.16, 'sine', 0.07), 100); },
  shellfire: () => tone(110, 0.25, 'square', 0.05, -40), bolt: () => tone(500, 0.12, 'sawtooth', 0.03, -250),
  firework: () => { noise(0.25, 0.05); tone(1500, 0.3, 'sine', 0.03, -1200); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'square', 0.07), i * 140)),
};

// ───────────────────────────── browser: drawing ─────────────────────────────
const canvas = document.getElementById('gc'), ctx = canvas.getContext('2d');
let S, round = 0;

const CLOUDS = [];
{ const r = mulberry32(42); for (let i = 0; i < 9; i++) CLOUDS.push({ x: r() * W, y: 60 + r() * 170, s: 0.6 + r() * 0.9, v: 0.08 + r() * 0.18 }); }
const STARS_BG = [];

function blob(x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, 22 * s, 0, 6.3); ctx.arc(x + 24 * s, y - 8 * s, 28 * s, 0, 6.3); ctx.arc(x + 54 * s, y, 22 * s, 0, 6.3);
  ctx.arc(x + 26 * s, y + 8 * s, 24 * s, 0, 6.3); ctx.fill();
}

function drawBackground(t) {
  let g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, '#0f2a66'); g.addColorStop(0.55, '#3a7bc8'); g.addColorStop(1, '#ffc58a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, HORIZON);
  // sun with glow
  g = ctx.createRadialGradient(170, HORIZON - 30, 6, 170, HORIZON - 30, 150);
  g.addColorStop(0, 'rgba(255,250,210,1)'); g.addColorStop(0.15, 'rgba(255,225,150,.9)'); g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, HORIZON + 10);
  // clouds
  for (const c of CLOUDS) {
    const x = ((c.x + t * c.v) % (W + 200)) - 100;
    ctx.fillStyle = 'rgba(255,255,255,.28)'; blob(x, c.y + 6, c.s);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; blob(x, c.y, c.s);
  }
  // sea
  g = ctx.createLinearGradient(0, HORIZON, 0, H);
  g.addColorStop(0, '#3f8fcf'); g.addColorStop(0.25, '#1c5c9c'); g.addColorStop(1, '#082a52');
  ctx.fillStyle = g; ctx.fillRect(0, HORIZON, W, H - HORIZON);
  // sun glitter
  ctx.fillStyle = 'rgba(255,240,190,.5)';
  for (let i = 0; i < 26; i++) {
    const y = HORIZON + 3 + i * 5.5, w = 6 + i * 3.2 + Math.sin(t * 0.05 + i) * 5;
    ctx.fillRect(170 - w / 2 + Math.sin(t * 0.03 + i * 1.7) * 6, y, w, 1.6);
  }
  // waves
  ctx.lineWidth = 1.5;
  for (let r = 0; r < 14; r++) {
    const y = HORIZON + 14 + r * r * 1.9 + r * 6, amp = 1 + r * 0.35;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + r * 0.012) + ')';
    ctx.beginPath();
    for (let x = 0; x <= W; x += 14) {
      const yy = y + Math.sin(x * 0.02 + t * 0.03 * (1 + r * 0.05) + r) * amp;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // haze at horizon
  g = ctx.createLinearGradient(0, HORIZON - 8, 0, HORIZON + 26);
  g.addColorStop(0, 'rgba(255,215,170,0)'); g.addColorStop(0.3, 'rgba(255,215,170,.55)'); g.addColorStop(1, 'rgba(255,215,170,0)');
  ctx.fillStyle = g; ctx.fillRect(0, HORIZON - 8, W, 34);
}

function drawIsland(S) {
  // distant mountains and the enemy island
  ctx.fillStyle = '#5a6f8f';
  ctx.beginPath(); ctx.moveTo(560, HORIZON + 8); ctx.lineTo(640, HORIZON - 52); ctx.lineTo(690, HORIZON - 26); ctx.lineTo(760, HORIZON - 78);
  ctx.lineTo(830, HORIZON - 34); ctx.lineTo(900, HORIZON - 58); ctx.lineTo(900, HORIZON + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3d7a4a';
  ctx.beginPath(); ctx.moveTo(600, HORIZON + 40); ctx.quadraticCurveTo(650, HORIZON - 10, 740, HORIZON - 4); ctx.quadraticCurveTo(840, HORIZON - 14, 900, HORIZON - 4);
  ctx.lineTo(900, HORIZON + 44); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8d49a';
  ctx.beginPath(); ctx.moveTo(592, HORIZON + 44); ctx.quadraticCurveTo(640, HORIZON + 22, 740, HORIZON + 26); ctx.quadraticCurveTo(840, HORIZON + 20, 900, HORIZON + 24);
  ctx.lineTo(900, HORIZON + 46); ctx.closePath(); ctx.fill();
  // palms
  for (const px of [615, 690, 770, 880]) {
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, HORIZON + 28); ctx.quadraticCurveTo(px + 4, HORIZON + 8, px + 1, HORIZON - 4); ctx.stroke();
    ctx.fillStyle = '#2e8f3e';
    for (let i = 0; i < 5; i++) { const a = -2.6 + i * 0.55; ctx.beginPath(); ctx.moveTo(px + 1, HORIZON - 4); ctx.quadraticCurveTo(px + Math.cos(a) * 12, HORIZON - 4 + Math.sin(a) * 10 - 4, px + Math.cos(a) * 20, HORIZON - 4 + Math.sin(a) * 10 + 7); ctx.quadraticCurveTo(px + Math.cos(a) * 12, HORIZON - 2 + Math.sin(a) * 6, px + 1, HORIZON - 4); ctx.fill(); }
  }
  for (const l of S.land) drawLand(l, S.t);
}

function drawLand(l, t) {
  ctx.save(); ctx.translate(l.x, l.y);
  const dead = l.dead;
  if (l.flash > 0 && !dead) ctx.globalAlpha = 0.55 + (l.flash % 2) * 0.45;
  if (l.kind === 'radar') {
    ctx.fillStyle = dead ? '#2a2a2a' : '#7c8794'; ctx.fillRect(-14, -8, 28, 12);
    ctx.fillStyle = dead ? '#222' : '#aab4c0'; ctx.fillRect(-3, -30, 6, 24);
    ctx.save(); ctx.translate(0, -32); ctx.rotate(dead ? 0.8 : t * 0.06);
    ctx.fillStyle = dead ? '#333' : '#e8edf2'; ctx.beginPath(); ctx.ellipse(0, 0, 15, 4, 0, 0, 6.3); ctx.fill(); ctx.restore();
  } else if (l.kind === 'bunker') {
    ctx.fillStyle = dead ? '#2a2a2a' : '#6a7a5a'; ctx.beginPath(); ctx.moveTo(-22, 6); ctx.lineTo(-18, -14); ctx.lineTo(18, -14); ctx.lineTo(22, 6); ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-12, -9, 24, 4);
    ctx.fillStyle = dead ? '#222' : '#4a5a3e'; ctx.fillRect(-4, -22, 8, 10); ctx.fillRect(2, -20, 18, 3);
  } else if (l.kind === 'fuel') {
    for (const dx of [-14, 12]) {
      ctx.fillStyle = dead ? '#2a2a2a' : '#d9dde2'; ctx.beginPath(); ctx.ellipse(dx, -8, 12, 14, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = dead ? '#222' : '#e14a3a'; ctx.fillRect(dx - 12, -10, 24, 4);
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
  ctx.save(); ctx.translate(s.x, s.y + (s.sinking ? s.sinking * 0.35 : 0));
  ctx.scale(s.scale * s.dir, s.scale); if (s.sinking) ctx.rotate(Math.min(0.5, s.sinking * 0.01));
  ctx.globalAlpha = s.sinking ? Math.max(0, 1 - s.sinking / 100) : 1;
  const hull = ['#7b8696', '#8a7f74', '#6f8a7d'][s.hue];
  // wake
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  for (let i = 0; i < 3; i++) { const w = 26 - i * 6; ctx.fillRect(-64 - i * 14 - ((t * 0.6) % 14), 12 + i * 2, w, 2.5); }
  // hull
  ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(-62, -2); ctx.lineTo(62, -2); ctx.lineTo(78, -9); ctx.lineTo(60, 14); ctx.lineTo(-56, 14); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a82a2a'; ctx.fillRect(-58, 9, 118, 4);
  // superstructure
  ctx.fillStyle = '#9aa5b3'; ctx.fillRect(-18, -20, 36, 18); ctx.fillStyle = '#7b8696'; ctx.fillRect(-10, -32, 20, 12);
  ctx.fillStyle = '#ffe9a0'; for (let i = 0; i < 4; i++) ctx.fillRect(-14 + i * 9, -14, 5, 4);
  ctx.strokeStyle = '#444'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(0, -46); ctx.stroke();
  // guns
  ctx.fillStyle = '#5a6472'; ctx.fillRect(34, -10, 18, 8); ctx.fillRect(48, -9, 18, 3); ctx.fillRect(-52, -9, 14, 7);
  // flag
  ctx.fillStyle = '#c82828'; ctx.fillRect(0, -46, 10, 6);
  if (s.warn > 0 && !s.sinking) { ctx.fillStyle = 'rgba(255,60,40,' + (0.4 + 0.5 * Math.sin(t * 0.7)) + ')'; ctx.beginPath(); ctx.arc(52, -8, 12, 0, 6.3); ctx.fill(); }
  if (s.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-62, -20, 140, 36); }
  ctx.restore();
  if (!s.sinking && s.hp < s.maxhp) pips(s.x, s.y - 52 * s.scale, s.hp, s.maxhp, '#ff5a4a');
}

function drawCarrier(S, t) {
  const c = S.carrier, p = S.plane;
  ctx.save(); ctx.translate(c.x, DECK_Y + c.dy);
  // wake / foam
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(-c.dir * (118 + i * 18 + ((t * 0.8) % 18)), 44 + (i % 2) * 2, 22 - i * 2, 3, 0, 0, 6.3); ctx.fill(); }
  ctx.scale(c.dir, 1);
  if (S.rally > 0) ctx.rotate(0.05 * Math.sin(t * 0.3));
  // hull
  let g = ctx.createLinearGradient(0, 0, 0, 52); g.addColorStop(0, '#7d8896'); g.addColorStop(1, '#3d4654');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-118, 0); ctx.lineTo(122, 0); ctx.lineTo(138, -8); ctx.lineTo(112, 38); ctx.lineTo(70, 50); ctx.lineTo(-92, 50); ctx.lineTo(-124, 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a82a2a'; ctx.beginPath(); ctx.moveTo(-96, 42); ctx.lineTo(72, 42); ctx.lineTo(70, 50); ctx.lineTo(-92, 50); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 9; i++) ctx.fillRect(-90 + i * 24, 18, 12, 5);
  // flight deck
  ctx.fillStyle = '#58626f'; ctx.fillRect(-122, -4, 262, 10);
  ctx.fillStyle = '#9aa5b3'; ctx.fillRect(-122, -4, 262, 3);
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.moveTo(-100, 1); ctx.lineTo(120, 1); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffd23f'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(40 + i * 24, -2); ctx.lineTo(52 + i * 24, 1); ctx.lineTo(40 + i * 24, 4); ctx.fill(); }
  // blinking deck lights
  for (let i = 0; i < 8; i++) { ctx.fillStyle = (Math.floor(t / 10) + i) % 4 === 0 ? '#ffec6a' : '#6b5a1a'; ctx.fillRect(-114 + i * 34, 4, 4, 3); }
  // island tower
  ctx.fillStyle = '#6c7684'; ctx.fillRect(-58, -44, 40, 40); ctx.fillStyle = '#8793a2'; ctx.fillRect(-52, -62, 28, 20);
  ctx.fillStyle = '#9fe3ff'; for (let i = 0; i < 4; i++) ctx.fillRect(-48 + i * 7, -56, 5, 6);
  ctx.fillStyle = '#ffe9a0'; for (let i = 0; i < 3; i++) ctx.fillRect(-52 + i * 12, -34, 7, 5);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-38, -62); ctx.lineTo(-38, -82); ctx.stroke();
  ctx.save(); ctx.translate(-38, -82); ctx.rotate(t * 0.08); ctx.fillStyle = '#e8edf2'; ctx.fillRect(-14, -2, 28, 4); ctx.restore();
  ctx.fillStyle = (Math.floor(t / 20) % 2) ? '#ff3b3b' : '#601818'; ctx.beginPath(); ctx.arc(-38, -84, 3, 0, 6.3); ctx.fill();
  // parked plane
  if (p.state === 'deck') { ctx.save(); ctx.scale(c.dir, 1); ctx.translate(0, 0); ctx.restore(); }
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
  ctx.strokeStyle = flak ? 'rgba(255,226,120,.6)' : 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.setLineDash([3, 7]);
  ctx.beginPath(); ctx.moveTo(56, 0); ctx.lineTo(flak ? 120 : 150, 0); ctx.stroke(); ctx.setLineDash([]);   // short aim guide
  ctx.restore();
  if (c.hit > 0 && c.hit % 4 < 2) { ctx.fillStyle = 'rgba(255,80,60,.45)'; ctx.fillRect(-124, -8, 266, 62); }
  ctx.restore();
  // charge ring above the launcher
  const mx = c.x + c.dir * 72, my = DECK_Y + c.dy - 28;
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(mx, my - 46, 17, 0, 6.3); ctx.stroke();
  if (c.charge > 0) {
    ctx.strokeStyle = c.elev >= TUNE.FLAK_ELEV ? '#ffd23f' : '#ff6a3a'; ctx.beginPath(); ctx.arc(mx, my - 46, 17, -Math.PI / 2, -Math.PI / 2 + c.charge * 6.283); ctx.stroke();
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(c.elev >= TUNE.FLAK_ELEV ? 'FLAK' : 'MISSILE', mx, my - 66);
}

function drawPlane(x, y, dir, rot, color, alpha, t, afterburn) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1); ctx.rotate(rot); ctx.globalAlpha = alpha;
  if (afterburn) { ctx.fillStyle = 'rgba(255,170,40,.9)'; ctx.beginPath(); ctx.moveTo(-26, -3); ctx.lineTo(-40 - Math.random() * 8, 0); ctx.lineTo(-26, 3); ctx.fill(); ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.moveTo(-26, -1.5); ctx.lineTo(-34, 0); ctx.lineTo(-26, 1.5); ctx.fill(); }
  // tail fins
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-26, -2); ctx.lineTo(-34, -16); ctx.lineTo(-20, -2); ctx.fill();
  ctx.fillStyle = '#c9d2dc'; ctx.beginPath(); ctx.moveTo(-26, 2); ctx.lineTo(-38, 8); ctx.lineTo(-18, 3); ctx.fill();
  // far wing
  ctx.fillStyle = '#8f9bab'; ctx.beginPath(); ctx.moveTo(4, -2); ctx.lineTo(-14, -10); ctx.lineTo(-20, -8); ctx.lineTo(-4, 1); ctx.fill();
  // fuselage
  let g = ctx.createLinearGradient(0, -8, 0, 8); g.addColorStop(0, '#f4f7fa'); g.addColorStop(1, '#aeb9c6');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-28, -4); ctx.quadraticCurveTo(0, -9, 24, -2); ctx.lineTo(38, 1); ctx.lineTo(24, 4); ctx.quadraticCurveTo(0, 8, -28, 4); ctx.closePath(); ctx.fill();
  // colour stripe
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-26, -1); ctx.lineTo(22, -1); ctx.lineTo(24, 2); ctx.lineTo(-26, 2); ctx.fill();
  // nose cone
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(26, -2); ctx.lineTo(38, 1); ctx.lineTo(26, 3); ctx.fill();
  // canopy
  g = ctx.createLinearGradient(0, -10, 0, -2); g.addColorStop(0, '#d6f4ff'); g.addColorStop(1, '#3a8fc0');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(8, -4.5, 9, 4, 0, Math.PI, 0); ctx.fill();
  // near wing
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(-16, 14); ctx.lineTo(-24, 14); ctx.lineTo(-8, 1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-18, 12, 6, 2);
  // missile under wing
  ctx.fillStyle = '#d9dde2'; ctx.fillRect(-6, 8, 14, 3); ctx.fillStyle = '#e14a3a'; ctx.fillRect(6, 8, 3, 3);
  ctx.restore();
}

function drawBogie(b, t) {
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
  if (!b.dying) { ctx.fillStyle = 'rgba(255,150,40,.8)'; ctx.beginPath(); ctx.moveTo(-26, -2); ctx.lineTo(-36 - Math.sin(t * 0.8) * 3, 0); ctx.lineTo(-26, 2); ctx.fill(); }
  if (b.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(-30, -12, 66, 26); }
  ctx.restore();
  if (!b.dying && b.kind === 'bomber' && b.hp < 2) pips(b.x, b.y - 30, b.hp, 2, '#ff5a4a');
}

function drawParticles(S) {
  for (const q of S.parts) {
    const a = Math.max(0, q.life / q.max);
    ctx.globalAlpha = q.kind === 'smoke' ? a * 0.55 : a;
    ctx.fillStyle = q.color;
    ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.1, q.size), 0, 6.3); ctx.fill();
    if (q.kind === 'spark') { ctx.globalAlpha = a * 0.25; ctx.beginPath(); ctx.arc(q.x, q.y, q.size * 2.4, 0, 6.3); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  for (const sp of S.splashes) {   // splash rings
    const a = 1 - sp.t / 40;
    ctx.strokeStyle = 'rgba(230,248,255,' + a * 0.8 + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 6 + sp.t * 0.9, 2 + sp.t * 0.3, 0, 0, 6.3); ctx.stroke();
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
    ctx.fillStyle = '#fff6a8'; ctx.fillRect(b.x - 8, b.y - 1.5, 16, 3); ctx.fillStyle = '#ffb02e'; ctx.fillRect(b.x - 3, b.y - 1.5, 6, 3); }
  for (const f of S.flak) { ctx.fillStyle = '#ffe48a'; ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, 6.3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x, f.y, 2, 0, 6.3); ctx.fill(); }
  for (const m of S.missiles) {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang);
    ctx.fillStyle = 'rgba(255,160,40,.9)'; ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-20 - Math.random() * 6, 0); ctx.lineTo(-10, 3); ctx.fill();
    ctx.fillStyle = '#f2f4f7'; ctx.fillRect(-10, -3, 20, 6); ctx.fillStyle = '#e14a3a'; ctx.beginPath(); ctx.moveTo(10, -3); ctx.lineTo(17, 0); ctx.lineTo(10, 3); ctx.fill();
    ctx.fillStyle = '#7b8696'; ctx.fillRect(-10, -6, 5, 12); ctx.restore();
  }
  for (const e of S.enemyShots) {
    if (e.kind === 'shell') { ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ff6a3a'; ctx.beginPath(); ctx.arc(e.x - 1, e.y - 1, 2, 0, 6.3); ctx.fill(); }
    else { ctx.fillStyle = 'rgba(255,60,60,.35)'; ctx.beginPath(); ctx.arc(e.x, e.y, 11, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ffd0c0'; ctx.beginPath(); ctx.arc(e.x, e.y, 2.5, 0, 6.3); ctx.fill(); }
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
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - w / 2, y, w, h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(label + '  ' + Math.min(n, max) + '/' + max, cx, y - 3);
}

function drawHUD(S) {
  const names = roleNames(S.round, root.PLAYER_NAMES || (typeof PN !== 'undefined' ? PN : null));
  ctx.fillStyle = 'rgba(8,14,34,.72)'; ctx.fillRect(0, 0, W, 60);
  ctx.fillStyle = 'rgba(120,160,255,.5)'; ctx.fillRect(0, 60, W, 2);
  ctx.textAlign = 'left'; ctx.font = 'bold 16px "Arial Rounded MT Bold",Arial';
  ctx.fillStyle = '#ffb36b'; ctx.fillText('⚓ ' + names.c.toUpperCase() + '  ★ ' + S.stars.c, 12, 22);
  ctx.font = 'bold 10px Arial'; ctx.fillStyle = '#cfd8ee'; ctx.fillText('CARRIER  WASD • Q/E • mash SPACE', 12, 36);
  pipRow(12, 42, S.carrier.hull, TUNE.HULL, '#ffb36b', 'left');
  ctx.textAlign = 'right'; ctx.font = 'bold 16px "Arial Rounded MT Bold",Arial';
  const pc = PLANE_COLORS[S.plane.colorIdx];
  ctx.fillStyle = pc; ctx.fillText(names.p.toUpperCase() + '  ★ ' + S.stars.p + ' ✈', W - 12, 22);
  ctx.font = 'bold 10px Arial'; ctx.fillStyle = '#cfd8ee'; ctx.fillText('FIGHTER  ARROWS • ENTER • R-SHIFT', W - 12, 36);
  pipRow(W - 25, 42, S.plane.hp, TUNE.PLANE_HP, pc, 'right');
  for (let i = 0; i < TUNE.PLANE_MISSILES; i++) {   // missile ammo
    ctx.fillStyle = i < S.plane.ammo ? '#ffffff' : 'rgba(255,255,255,.2)'; ctx.fillRect(W - 25 - TUNE.PLANE_HP * 17 - 8 - i * 13, 42, 9, 10);
    ctx.fillStyle = i < S.plane.ammo ? '#e14a3a' : 'rgba(225,74,58,.2)'; ctx.fillRect(W - 25 - TUNE.PLANE_HP * 17 - 8 - i * 13, 42, 9, 3);
  }
  goalBar(W / 2 - 138, 20, '🚢 SHIPS', S.goals.ships, TUNE.GOALS.ships, '#4aa8ff');
  goalBar(W / 2, 20, '🎯 LAND', S.goals.land, TUNE.GOALS.land, '#ffb347');
  goalBar(W / 2 + 138, 20, '✈ BOGIES', S.goals.bogies, TUNE.GOALS.bogies, '#ff6a6a');
  ctx.fillStyle = '#9fb0d8'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
  ctx.fillText(S.phase === 'landing' ? 'ALL CLEAR — fighter: LAND ON THE CARRIER!  (carrier: slide underneath to help)' : 'carrier + fighter: ships & land   •   fighter: bogies', W / 2, 52);
}

function drawBanner(S, t) {
  if (S.bannerT <= 0) return;
  const a = Math.min(1, S.bannerT / 20);
  const win = S.phase === 'win';
  ctx.save(); ctx.globalAlpha = win ? 1 : a; ctx.textAlign = 'center';
  ctx.font = 'bold ' + (win ? 74 : 40) + 'px "Arial Rounded MT Bold",Arial';
  const y = win ? 230 : 150 + (1 - a) * -10;
  ctx.lineWidth = 8; ctx.strokeStyle = '#1a1030'; ctx.strokeText(S.banner, W / 2, y);
  ctx.fillStyle = win ? '#ffe45a' : '#fff'; ctx.fillText(S.banner, W / 2, y);
  if (win) {
    ctx.font = 'bold 22px Arial'; ctx.lineWidth = 5; ctx.fillStyle = '#fff';
    const names = roleNames(S.round, root.PLAYER_NAMES || (typeof PN !== 'undefined' ? PN : null));
    const msg = (names.c + ' + ' + names.p + ' saved the fleet!').toUpperCase();
    ctx.strokeText(msg, W / 2, y + 44); ctx.fillText(msg, W / 2, y + 44);
    if (S.phaseT > 150) { ctx.font = 'bold 24px Arial'; ctx.fillStyle = '#9fe3ff'; const m2 = 'press R  or  PLAY AGAIN   (swap sides!)'; ctx.strokeText(m2, W / 2, y + 84); ctx.fillText(m2, W / 2, y + 84); }
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
  ctx.fillStyle = m.side === 0 ? '#3d6b3a' : '#7a2e2a'; ctx.fillRect(-2, -6, 4, 6);          // body
  ctx.fillStyle = '#e8c9a0'; ctx.beginPath(); ctx.arc(0, -8, 2.2, 0, 6.3); ctx.fill();          // head
  ctx.fillStyle = m.side === 0 ? '#2a4d28' : '#4a1c1a'; ctx.fillRect(-2.5, -11, 5, 2);           // helmet
  if (m.duck <= 0) { ctx.fillStyle = '#222'; ctx.fillRect(1, -6, 8, 1.6); }                      // rifle
  if (m.flash > 0 && m.duck <= 0) { ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(11, -5.2, 2.6, 0, 6.3); ctx.fill(); }
  ctx.restore();
}
function drawSkirmish(t) {
  skirmishStep();
  for (const b of SK.boats) {                                    // little landing boats bobbing in the shallows
    const bob = Math.sin(t * 0.05 + b.x) * 1.2;
    ctx.fillStyle = '#5b6470'; ctx.beginPath(); ctx.moveTo(b.x - 16, b.y + bob - 3); ctx.lineTo(b.x + 16, b.y + bob - 3); ctx.lineTo(b.x + 12, b.y + bob + 3); ctx.lineTo(b.x - 13, b.y + bob + 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(b.x - 20, b.y + bob + 3, 40, 1.5);
  }
  ctx.fillStyle = '#b89968';                                       // sandbags the defenders hide behind
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
  ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = '#0b2a1a';
  ctx.strokeText('LAND HERE!', c.x, ay - 8); ctx.fillText('LAND HERE!', c.x, ay - 8);
  ctx.restore();
}

function draw(S) {
  const t = S.t;
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  drawBackground(t);
  drawIsland(S);
  drawSkirmish(t);
  for (const s of S.ships) drawShip(s, t);
  drawCarrier(S, t);
  const p = S.plane;
  if (p.state === 'landed') drawPlane(p.x, p.y, p.dir, 0, PLANE_COLORS[p.colorIdx], 1, t, false);
  if (p.state === 'deck') drawPlane(p.x, p.y, p.dir, 0, PLANE_COLORS[(S.launches + 1 + S.round) % 2], 1, t, false);
  if (p.trail.length > 1 && p.state === 'fly') {
    ctx.lineCap = 'round';
    for (let i = 1; i < p.trail.length; i++) { ctx.strokeStyle = 'rgba(255,255,255,' + (i / p.trail.length * 0.5) + ')'; ctx.lineWidth = 1 + i * 0.18; ctx.beginPath(); ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y); ctx.lineTo(p.trail[i].x, p.trail[i].y); ctx.stroke(); }
  }
  for (const b of S.bogies) drawBogie(b, t);
  if (p.state === 'fly' || p.state === 'down') {
    const blink = p.hit > 0 && p.state === 'fly' && Math.floor(p.hit / 4) % 2 === 0;
    drawPlane(p.x, p.y, p.dir, p.rot, PLANE_COLORS[p.colorIdx], blink ? 0.35 : 1, t, p.state === 'fly');
    if (p.dockFlash > 0) { ctx.strokeStyle = 'rgba(130,255,170,' + p.dockFlash / 40 + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, 40 - p.dockFlash * 0.4, 0, 6.3); ctx.stroke(); }
  }
  drawProjectiles(S);
  drawParticles(S);
  if (S.phase === 'landing') drawLandingGuide(S);
  ctx.restore();
  drawHUD(S);
  drawBanner(S, t);
  if (S.phase === 'play' && S.plane.state === 'deck') {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
    ctx.fillText('FIGHTER: press an ARROW to take off (or wait a moment)!', W / 2, 108);
  }
}

// ───────────────────────────── browser: loop ─────────────────────────────
function clearInput() { for (const k in keys) keys[k] = false; presses = 0; }
function newGame() { clearInput(); S = createState((Date.now() & 0xffff) + 1, round); }
function restart() { round++; newGame(); }
function playEvents() {
  const seen = {};
  for (const e of S.events) { if (!seen[e] && SFX[e]) { seen[e] = 1; SFX[e](); } }
  S.events.length = 0;
}
newGame();
let acc = 0, last = performance.now();
function frame(now) {
  acc += Math.min(100, now - last); last = now;
  while (acc >= 1000 / 60) { step(S, readInput()); playEvents(); acc -= 1000 / 60; }
  draw(S);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const rb = document.getElementById('brestart'), mb = document.getElementById('bmute');
if (rb) rb.onclick = () => { if (S.phase === 'win') restart(); else newGame(); rb.blur(); };
if (mb) mb.onclick = () => { muted = !muted; mb.textContent = muted ? '🔇 SOUND OFF' : '🔊 SOUND ON'; mb.blur(); };
root.__bf = { get S() { return S; }, restart, newGame };

})(typeof window !== 'undefined' ? window : globalThis);

'use strict';
// Headless smoke test for Battle Fighter (pure logic only, no DOM). Run: node smoke-test.js
const assert = require('assert');
const bf = require('./game.js');
const { createState, step, TUNE } = bf;

let failures = 0;
function check(label, fn) {
  try { fn(); console.log('✓ ' + label); } catch (e) { console.error('✗ ' + label + ': ' + e.message); failures++; }
}
const none = () => ({ c: {}, p: {} });
function run(S, n, inp) { for (let i = 0; i < n; i++) step(S, typeof inp === 'function' ? inp(i) : (inp || none())); }
function launch(S) { S.plane.anyPrev = false; step(S, { c: {}, p: { any: true } }); }

check('new state: full hull, full plane hp, 3 ships, 4 land targets, empty goals', () => {
  const S = createState(1, 0, 2);
  assert.strictEqual(S.carrier.hull, TUNE.HULL);
  assert.strictEqual(S.plane.hp, TUNE.PLANE_HP);
  assert.strictEqual(S.ships.length, 3);
  assert.strictEqual(S.land.length, 4);
  assert.deepStrictEqual(S.goals, { ships: 0, land: 0, bogies: 0 });
});

check('extra room: hull and plane take several hits', () => {
  assert.ok(TUNE.HULL >= 8 && TUNE.PLANE_HP >= 6);
});

check('plane takes off from the deck on any arrow, then flies', () => {
  const S = createState(1, 0, 2);
  assert.strictEqual(S.plane.state, 'deck');
  launch(S);
  assert.strictEqual(S.plane.state, 'fly');
});

check('plane colour alternates blue/red on each launch', () => {
  const S = createState(2, 0, 2);
  launch(S); const a = S.plane.colorIdx;
  S.plane.state = 'sunk'; S.plane.stateT = 1; run(S, 2); assert.strictEqual(S.plane.state, 'deck');
  launch(S); const b = S.plane.colorIdx;
  assert.notStrictEqual(a, b);
  S.plane.state = 'sunk'; S.plane.stateT = 1; run(S, 2); launch(S);
  assert.strictEqual(S.plane.colorIdx, a);
});

check('plane stays on screen and above the sea under rough input', () => {
  const S = createState(3, 0, 2); launch(S);
  run(S, 1500, i => ({ c: {}, p: { left: i % 90 < 45, right: i % 90 >= 45, up: i % 50 < 25, down: i % 50 >= 25, fire: true } }));
  assert.ok(S.plane.x >= 0 && S.plane.x <= bf.W);
  assert.ok(S.plane.y >= 0 && S.plane.y <= bf.DECK_Y);
});

check('three presses launch; low aim = homing missile, high aim = flak', () => {
  const S = createState(4, 0, 2);
  S.carrier.elev = 20;
  step(S, { c: { presses: 1 }, p: {} }); step(S, { c: { presses: 1 }, p: {} });
  assert.strictEqual(S.missiles.length + S.flak.length, 0);
  step(S, { c: { presses: 1 }, p: {} });
  assert.strictEqual(S.missiles.length, 1);
  S.carrier.elev = 70;
  step(S, { c: { presses: 3 }, p: {} });
  assert.strictEqual(S.flak.length, 3);
});

check('charge leaks away if the carrier player stops mashing', () => {
  const S = createState(5, 0, 2);
  step(S, { c: { presses: 1 }, p: {} });
  assert.ok(S.carrier.charge > 0);
  run(S, 400);
  assert.strictEqual(S.carrier.charge, 0);
});

function isolate(S) {   // one ship, nothing else to steer toward, nothing spawning
  S.ships.length = 1; S.land.forEach(l => { l.dead = true; }); S.goals.ships = S.need.ships - 1; S.goals.land = S.need.land;
}
function elevTo(S, tg) {   // launcher elevation that points at a target
  const c = S.carrier, mx = c.x + c.dir * 72, my = bf.DECK_Y + c.dy - 22;
  return Math.atan2(my - tg.y, Math.abs(tg.x - mx)) * 180 / Math.PI;
}
check('a well-aimed missile hits; an unaimed one flies past (aiming matters)', () => {
  const S = createState(6, 0, 2); isolate(S);
  const tg = S.ships[0]; tg.speed = 0; tg.x = 520; tg.y = 360;
  S.carrier.x = 300; S.carrier.dir = 1;
  S.carrier.elev = elevTo(S, tg);
  step(S, { c: { presses: 3 }, p: {} }); run(S, 120);
  assert.strictEqual(tg.hp, TUNE.SHIP_HP - TUNE.MISSILE_DMG, 'aimed shot hit');
  const T = createState(6, 0, 2); isolate(T); const t2 = T.ships[0]; t2.speed = 0; t2.x = 520; t2.y = 360;
  T.carrier.x = 300; T.carrier.dir = 1; T.carrier.elev = 70 - 0;   // far too steep for a missile: flak mode, not a ground shot
  T.carrier.elev = elevTo(T, t2) + 35;                              // 35 degrees too high
  if (T.carrier.elev >= TUNE.FLAK_ELEV) T.carrier.elev = TUNE.FLAK_ELEV - 1;
  step(T, { c: { presses: 3 }, p: {} }); run(T, 120);
  assert.strictEqual(t2.hp, TUNE.SHIP_HP, 'a badly aimed shot misses');
});

check('carrier missiles sink ships and destroy land targets (carrier goals count)', () => {
  const S = createState(6, 0, 2); S.carrier.dir = 1;
  for (let n = 0; n < 40 && S.goals.ships + S.goals.land < 3; n++) {
    const tg = S.land.find(l => !l.dead) || S.ships.find(s => !s.sinking);
    S.carrier.x = clampX(tg.x - 260); S.carrier.dir = 1; S.carrier.elev = Math.min(TUNE.FLAK_ELEV - 1, Math.max(8, elevTo(S, tg)));
    step(S, { c: { presses: 3 }, p: {} }); run(S, 80);
  }
  assert.ok(S.goals.ships + S.goals.land >= 3, 'got ' + JSON.stringify(S.goals));
  assert.ok(S.stars.c >= 3);
});
function clampX(x) { return Math.max(TUNE.CARRIER_MIN, Math.min(TUNE.CARRIER_MAX, x)); }

check('the plane has air-to-surface missiles: they hit ships/land, credit the plane, use ammo', () => {
  const S = createState(31, 0, 2); launch(S); isolate(S);
  const tg = S.ships[0]; tg.speed = 0; tg.x = 450; tg.y = 340; S.plane.x = 360; S.plane.y = 250; S.plane.dir = 1; S.plane.vy = 0;
  S.plane.hit = 0; S.bogies.length = 0; S.spawnT = 99999;
  const before = S.plane.ammo;
  step(S, { c: {}, p: { missile: true } });
  assert.strictEqual(S.plane.ammo, before - 1);
  run(S, 80);
  assert.ok(tg.hp < TUNE.SHIP_HP, 'ship hurt by the plane missile');
  assert.ok(S.missiles.length === 0);
  // ammo runs out, then a pass over the carrier reloads it
  S.plane.ammo = 0; S.plane.x = S.carrier.x; S.plane.y = bf.DECK_Y - 60; S.plane.dockCd = 0; S.plane.hp = TUNE.PLANE_HP;
  step(S, none());
  assert.strictEqual(S.plane.ammo, TUNE.PLANE_MISSILES);
});

check('plane missile credit: sinking a ship with a plane missile gives the plane the star', () => {
  const S = createState(32, 0, 2);
  const tg = S.ships[0]; tg.hp = 1; tg.speed = 0; tg.x = 400; tg.y = 340;
  S.missiles.push({ x: 380, y: 330, ang: 0.3, owner: 'p', cone: 0.5, life: 100 });
  run(S, 30);
  assert.strictEqual(S.goals.ships, 1); assert.strictEqual(S.stars.p, 1); assert.strictEqual(S.stars.c, 0);
});

check('the carrier can slide up and down a little, and stays inside its range', () => {
  const S = createState(33, 0, 2);
  run(S, 200, { c: { depthUp: true }, p: {} });
  assert.strictEqual(S.carrier.dy, -TUNE.DEPTH_RANGE);
  run(S, 400, { c: { depthDown: true }, p: {} });
  assert.strictEqual(S.carrier.dy, TUNE.DEPTH_RANGE);
});

check('plane guns shoot down bogies (credit to the plane); flak credit to the carrier', () => {
  const S = createState(7, 0, 2); launch(S);
  S.bogies.push({ kind: 'jet', x: 500, y: 200, vx: 0, hp: 1, bob: 0, base: 200, fireT: 9999, bombT: 0, dying: null, rot: 0, vy: 0, flash: 0, dead: false });
  S.plane.x = 400; S.plane.y = 200; S.plane.dir = 1; S.plane.vy = 0;
  run(S, 60, { c: {}, p: { fire: true } });
  assert.strictEqual(S.goals.bogies, 1); assert.strictEqual(S.stars.p, 1);
  const T = createState(8, 0, 2);
  T.bogies.push({ kind: 'jet', x: 440, y: 270, vx: 0, hp: 1, bob: 0, base: 270, fireT: 9999, bombT: 0, dying: null, rot: 0, vy: 0, flash: 0, dead: false });
  T.carrier.x = 300; T.carrier.dir = 1; T.carrier.elev = 70;
  for (let i = 0; i < 6 && T.goals.bogies === 0; i++) { step(T, { c: { presses: 3 }, p: {} }); run(T, 30); }
  assert.strictEqual(T.goals.bogies, 1); assert.strictEqual(T.stars.c, 1);
});

check('bogies die both ways: some explode, some spin into the sea', () => {
  let explode = 0, spin = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const S = createState(seed, 0, 2);
    const b = { kind: 'jet', x: 500, y: 200, vx: 1, hp: 1, bob: 0, base: 200, fireT: 9999, bombT: 0, dying: null, rot: 0, vy: 0, flash: 0, dead: false };
    S.bogies.push(b);
    require('./game.js'); // same module instance
    // hit it with a plane bullet
    S.bullets.push({ x: 500, y: 200, vx: 0, vy: 0, life: 5 });
    step(S, none());
    if (b.dead) explode++; else if (b.dying === 'spin') spin++;
  }
  assert.ok(explode > 5 && spin > 5, 'explode ' + explode + ' spin ' + spin);
});

check('a spinning bogie ends in the sea and is removed', () => {
  const S = createState(9, 0, 2);
  const b = { kind: 'jet', x: 500, y: 200, vx: 1, hp: 1, bob: 0, base: 200, fireT: 9999, bombT: 0, dying: 'spin', rot: 0, vy: 0.5, flash: 0, dead: false, splashY: 350 };
  S.bogies.push(b); run(S, 200);
  assert.ok(!S.bogies.includes(b));
});

check('the plane being hit gives a grace window, then it falls and respawns on the deck at full hp', () => {
  const S = createState(10, 0, 2); launch(S);
  S.plane.hit = 0; S.plane.hp = 1; S.plane.y = 300; S.plane.vy = 0;
  S.enemyShots.push({ kind: 'bolt', x: S.plane.x, y: S.plane.y, vx: 0, vy: 0, g: 0, life: 50 });
  step(S, none());
  assert.strictEqual(S.plane.state, 'down');
  let sawDeck = false;
  for (let i = 0; i < 600 && !sawDeck; i++) { step(S, none()); if (S.plane.state === 'deck') sawDeck = true; }
  assert.ok(sawDeck, 'plane returns to the deck');
  assert.strictEqual(S.plane.hp, TUNE.PLANE_HP);
});

check('flying over the carrier repairs one hit', () => {
  const S = createState(11, 0, 2); launch(S);
  S.plane.hp = 3; S.plane.x = S.carrier.x; S.plane.y = bf.DECK_Y - 60; S.plane.dockCd = 0;
  step(S, none());
  assert.strictEqual(S.plane.hp, 4);
});

check('hull gone = rally (no punishment): hull refills, goals kept', () => {
  const S = createState(12, 0, 2);
  S.goals.ships = 2; S.carrier.hull = 1;
  S.bombs.push({ x: S.carrier.x, y: bf.DECK_Y - 12, vy: 3 });
  step(S, none());
  assert.ok(S.rally > 0);
  run(S, TUNE.RALLY_FRAMES + 5);
  assert.strictEqual(S.carrier.hull, TUNE.HULL);
  assert.strictEqual(S.goals.ships, 2);
  assert.strictEqual(S.phase, 'play');
});

check('finishing every goal starts "land on the carrier"; touching down wins with fireworks; roles swap next round', () => {
  const S = createState(13, 0, 2); launch(S);
  S.goals = { ships: S.need.ships, land: S.need.land, bogies: S.need.bogies - 1 };
  S.bogies.push({ kind: 'jet', x: 500, y: 200, vx: 0, hp: 1, bob: 0, base: 200, fireT: 9999, bombT: 0, dying: null, rot: 0, vy: 0, flash: 0, dead: false });
  S.bullets.push({ x: 500, y: 200, vx: 0, vy: 0, life: 5 });
  S.plane.x = 100; S.plane.y = 200;
  step(S, none());
  assert.strictEqual(S.phase, 'landing', 'not won yet: the plane must land');
  S.plane.x = 100; S.plane.y = 200; S.plane.vx = 0; S.plane.vy = 0;
  run(S, 30);
  assert.strictEqual(S.phase, 'landing');
  S.plane.x = S.carrier.x; S.plane.y = bf.DECK_Y - 40;
  step(S, none());
  assert.strictEqual(S.phase, 'win'); assert.strictEqual(S.plane.state, 'landed');
  run(S, 120);
  assert.ok(S.parts.some(q => q.kind === 'spark'));
  const a = bf.roleNames(0, { P1: 'A', P2: 'B' }), b = bf.roleNames(1, { P1: 'A', P2: 'B' });
  assert.strictEqual(a.c, b.p); assert.strictEqual(a.p, b.c);
});

check('landing: the autopilot helps after a while, and a downed plane that respawns on the deck counts as landed', () => {
  const S = createState(34, 0, 2); launch(S);
  S.goals = { ships: S.need.ships, land: S.need.land, bogies: S.need.bogies };
  S.plane.x = 80; S.plane.y = 150;
  step(S, none()); assert.strictEqual(S.phase, 'landing');
  for (let i = 0; i < TUNE.LANDING_ASSIST + 1500 && S.phase === 'landing'; i++) step(S, none());
  assert.strictEqual(S.phase, 'win', 'autopilot got it home');
  const T = createState(35, 0, 2); launch(T);
  T.goals = { ships: T.need.ships, land: T.need.land, bogies: T.need.bogies };
  T.plane.x = 80; T.plane.y = 150;
  step(T, none()); assert.strictEqual(T.phase, 'landing');
  T.plane.state = 'sunk'; T.plane.stateT = 1;
  run(T, 5);
  assert.strictEqual(T.phase, 'win');
});

check('roles fall back to Player 1 / Player 2 when no names are set', () => {
  assert.deepStrictEqual(bf.roleNames(0, null), { c: 'Player 1', p: 'Player 2' });
});

check('same seed = same game (deterministic)', () => {
  const a = createState(99, 0, 2), b = createState(99, 0, 2);
  run(a, 800, { c: { presses: 0 }, p: {} }); run(b, 800, { c: { presses: 0 }, p: {} });
  assert.deepStrictEqual(a.goals, b.goals);
  assert.strictEqual(a.bogies.length, b.bogies.length);
});

check('a long messy random game never produces NaN, never stalls spawns, and stays bounded', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const S = createState(seed, 0, 2);
    let r = seed * 17;
    const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 6000 && S.phase === 'play'; i++) {
      step(S, { c: { left: rnd() < 0.3, right: rnd() < 0.3, up: rnd() < 0.3, down: rnd() < 0.3, presses: rnd() < 0.06 ? 1 : 0 },
                p: { left: rnd() < 0.2, right: rnd() < 0.2, up: rnd() < 0.3, down: rnd() < 0.3, fire: rnd() < 0.7, any: rnd() < 0.1 } });
      for (const v of [S.carrier.x, S.carrier.elev, S.plane.x, S.plane.y]) assert.ok(Number.isFinite(v), 'NaN at ' + i);
      assert.ok(S.parts.length <= 760 && S.bogies.length <= 8 && S.ships.length <= 6);
    }
    // at the cap there must still be the means to finish: enough ships/bogies/land exist or are done
    const need = S.need;
    const aliveShips = S.ships.filter(s => !s.sinking).length;
    assert.ok(S.goals.ships + aliveShips >= need.ships, 'ships can still be finished');
  }
});

check('a bogie escaping off-screen never softlocks the bogie goal (a replacement arrives)', () => {
  const S = createState(21, 0, 2);
  S.goals.bogies = S.need.bogies - 1;
  S.bogies.push({ kind: 'jet', x: bf.W + 30, y: 200, vx: 3, hp: 1, bob: 0, base: 200, fireT: 9999, bombT: 0, dying: null, rot: 0, vy: 0, flash: 0, dead: false });
  let sawNew = false;
  for (let i = 0; i < 900 && !sawNew; i++) { step(S, none()); if (S.bogies.some(b => b.x > -60 && b.x < bf.W + 60)) sawNew = true; }
  assert.ok(sawNew, 'a new bogie shows up');
});

check('mouse/Enter-free: the plane only launches from plane input, not carrier presses', () => {
  const S = createState(22, 0, 2);
  step(S, { c: { presses: 3, left: true }, p: {} });
  assert.strictEqual(S.plane.state, 'deck');
});

check('holding a direction at the wall does not pin the plane there', () => {
  const S = createState(23, 0, 2); launch(S); S.plane.state = 'fly';
  run(S, 400, { c: {}, p: { left: true, any: true } });
  let moved = 0; const x0 = S.plane.x; for (let i = 0; i < 120; i++) { step(S, { c: {}, p: { left: true, any: true } }); moved = Math.max(moved, Math.abs(S.plane.x - x0)); }
  assert.ok(moved > 60, 'plane keeps moving, moved ' + moved);
});

check('a key already held does not auto-launch the plane (needs a fresh press)', () => {
  const S = createState(24, 0, 2);
  run(S, 30, { c: {}, p: { right: true, any: true } });
  assert.strictEqual(S.plane.state, 'deck');
  run(S, 3, { c: {}, p: {} });
  launch(S);
  assert.strictEqual(S.plane.state, 'fly');
});

check('Enter fires a heat-seeking air-to-air missile that steers onto an off-axis bogey', () => {
  const S = createState(41, 0, 2); launch(S); S.bogies.length = 0; S.spawnT = 99999;
  S.plane.x = 300; S.plane.y = 200; S.plane.dir = 1; S.plane.vy = 0; S.plane.hit = 0;
  S.bogies.push({ kind: 'jet', x: 520, y: 290, vx: 0, hp: 1, bob: 0, base: 290, fireT: 9999, bombT: 0, dying: null, rot: 0, vy: 0, flash: 0, dead: false });
  step(S, { c: {}, p: { fire: true } });
  S.plane.vx = 0; run(S, 80);
  assert.strictEqual(S.goals.bogies, 1, 'missile found it');
});


// ───────────── world tour (5 levels) ─────────────
check('five missions, each with matching land targets and goals', () => {
  assert.strictEqual(bf.LEVELS.length, 5);
  bf.LEVELS.forEach((L, i) => {
    const S = createState(1, 0, i);
    assert.strictEqual(S.level, i);
    assert.strictEqual(S.land.length, L.need.land);
    assert.deepStrictEqual(S.need, L.need);
    for (const l of S.land) assert.ok(l.x >= 660 && l.x <= 860, 'land target on the island');
  });
  assert.ok(bf.LEVELS[4].boss && !bf.LEVELS[0].subs && bf.LEVELS[1].subs);
});

function canHit(level, place) {   // is there any carrier aim that lands a missile on this target?
  for (const dir of [1, -1]) for (let x = TUNE.CARRIER_MIN; x <= TUNE.CARRIER_MAX; x += 30) for (let e = 8; e < TUNE.FLAK_ELEV; e += 2) {
    const S = createState(5, 0, level);
    S.ships.length = 0; S.land.forEach(l => { l.dead = true; }); S.goals.ships = S.need.ships; S.goals.land = S.need.land - 1;
    S.bogies.length = 0; S.spawnT = 1e9; S.crateT = 1e9;
    const tg = place(S);
    S.carrier.x = x; S.carrier.dir = dir; S.carrier.elev = e;
    step(S, { c: { presses: 3 }, p: {} });
    for (let i = 0; i < 160 && S.missiles.length; i++) step(S, none());
    if (tg.hp < tg.maxhp) return true;
  }
  return false;
}
check('every land target in every mission can be hit by an aimed carrier missile', () => {
  bf.LEVELS.forEach((L, li) => {
    for (let k = 0; k < L.land.length; k++) {
      assert.ok(canHit(li, S => { const l = S.land[k]; l.dead = false; l.hp = l.maxhp; return l; }), 'mission ' + (li + 1) + ' target ' + k);
    }
  });
});
check('ships anywhere in the sea lane (and surfaced subs, and the boss) can be hit', () => {
  const spots = [[100, 330], [100, 400], [350, 330], [350, 400], [600, 330], [600, 400], [140, 420], [590, 420], [340, 372]];
  for (const [x, y] of spots) {
    assert.ok(canHit(4, S => { S.ships.push({ kind: 'ship', x, y, dir: 1, speed: 0, hp: 4, maxhp: 4, fireT: 1e9, warn: 0, flash: 0, sinking: 0, scale: 1, under: false, subT: 0 }); S.goals.ships = S.need.ships - 1; S.goals.land = S.need.land; return S.ships[0]; }),
      'ship at ' + x + ',' + y);
  }
});

check('submarines: hidden subs cannot be hit; they surface, warn, and fire a torpedo', () => {
  const S = createState(51, 0, 1); S.ships.length = 0; S.spawnT = 1e9; S.crateT = 1e9; S.goals.ships = S.need.ships - 1;
  S.ships.push({ kind: 'sub', x: 300, y: 415, dir: 1, speed: 0, hp: 2, maxhp: 2, fireT: 0, warn: 0, flash: 0, sinking: 0, scale: 1, under: true, subT: 50, fired: false });
  const sub = S.ships[0];
  assert.ok(!bf.groundTargets(S).includes(sub), 'diving sub is not a target');
  S.missiles.push({ x: 290, y: 415, ang: 0, owner: 'c', cone: 0.3, life: 10 });
  run(S, 5); assert.strictEqual(sub.hp, 2, 'missile passes over a hidden sub');
  run(S, 50); assert.strictEqual(sub.under, false, 'it surfaced');
  assert.ok(bf.groundTargets(S).includes(sub));
  run(S, 90);
  assert.ok(S.enemyShots.some(e => e.kind === 'torpedo'), 'torpedo fired');
});
check('a torpedo hurts a carrier that stays put, and misses one that steers away', () => {
  const mk = () => { const S = createState(52, 0, 1); S.ships.length = 0; S.spawnT = 1e9; S.crateT = 1e9; S.carrier.x = 300; S.goals.ships = S.need.ships;
    S.enemyShots.push({ kind: 'torpedo', x: 520, y: 415, vx: -1.5, vy: 0.9, g: 0, life: 420 }); return S; };
  const A = mk(); run(A, 300); assert.ok(A.carrier.hull < TUNE.HULL, 'sitting duck gets hit');
  const B = mk(); for (let i = 0; i < 300; i++) step(B, { c: { right: i < 200 }, p: {} });
  assert.strictEqual(B.carrier.hull, TUNE.HULL, 'dodged');
});

check('mission 5: the last ship is a boss battleship that takes many hits and gives bonus stars', () => {
  const S = createState(53, 0, 4); S.bogies.length = 0; S.spawnT = 1e9; S.crateT = 1e9;
  S.goals.ships = S.need.ships - 1; S.ships.length = 0;
  step(S, none());
  const boss = S.ships.find(s => s.kind === 'boss');
  assert.ok(boss, 'boss spawned as the final ship'); assert.strictEqual(boss.hp, TUNE.BOSS_HP);
  boss.speed = 0;
  let shots = 0;
  while (!boss.sinking && shots < 20) { S.missiles.push({ x: boss.x - 30, y: boss.y, ang: 0, owner: 'p', cone: 0.3, life: 30 }); run(S, 10); shots++; }
  assert.strictEqual(shots, TUNE.BOSS_HP / TUNE.MISSILE_DMG);
  assert.strictEqual(S.goals.ships, S.need.ships); assert.strictEqual(S.stars.p, 3);
  run(S, 5); assert.ok(!S.ships.some(s => s.kind === 'boss' && !s.sinking));
});

check('crates: the plane grabs one in the air, the carrier catches one on the deck', () => {
  const S = createState(54, 0, 0); launch(S); S.bogies.length = 0; S.spawnT = 1e9; S.crateT = 1e9;
  S.crates.push({ x: 300, y: 200, kind: 'triple', sway: 0, gone: false });
  S.plane.x = 300; S.plane.y = 200; S.plane.vy = 0;
  step(S, none());
  assert.strictEqual(S.crates.length, 0); assert.strictEqual(S.power.triple, TUNE.TRIPLE_SHOTS); assert.strictEqual(S.stars.p, 1);
  S.carrier.elev = 20; step(S, { c: { presses: 3 }, p: {} });
  assert.strictEqual(S.missiles.length, 3, 'triple missiles'); assert.strictEqual(S.power.triple, TUNE.TRIPLE_SHOTS - 1);
  S.plane.x = 50; S.plane.y = 100;
  S.carrier.hull = 3;
  S.crates.push({ x: S.carrier.x, y: bf.DECK_Y - 30, kind: 'repair', sway: 0, gone: false });
  run(S, 30);
  assert.strictEqual(S.carrier.hull, 5, 'repair kit adds 2 hull'); assert.strictEqual(S.stars.c, 1);
});
check('rapid fire: 2 presses launch instead of 3, and it wears off', () => {
  const S = createState(55, 0, 0); S.crateT = 1e9;
  S.power.rapid = 30; S.carrier.elev = 20;
  step(S, { c: { presses: 2 }, p: {} });
  assert.strictEqual(S.missiles.length, 1);
  run(S, 40); assert.strictEqual(S.power.rapid, 0);
  const before = S.missiles.length;
  step(S, { c: { presses: 2 }, p: {} }); assert.strictEqual(S.missiles.length, before, 'needs 3 again');
  step(S, { c: { presses: 1 }, p: {} }); assert.strictEqual(S.missiles.length, before + 1);
});
check('crates that miss both land in the sea; crates stop once the sky is clear', () => {
  const S = createState(56, 0, 0); S.crateT = 1e9;
  S.crates.push({ x: 820, y: 400, kind: 'rapid', sway: 0, gone: false });
  run(S, 400); assert.strictEqual(S.crates.length, 0); assert.strictEqual(S.power.rapid, 0);
});

check('TEAM COMBO: both players scoring close together gives each a bonus star', () => {
  const S = createState(57, 0, 2); launch(S); S.bogies.length = 0; S.spawnT = 1e9; S.crateT = 1e9;
  S.ships[0].hp = 1; S.ships[0].speed = 0;
  S.missiles.push({ x: S.ships[0].x - 20, y: S.ships[0].y, ang: 0, owner: 'c', cone: 0.3, life: 20 });
  run(S, 5); assert.strictEqual(S.stars.c, 1);
  S.bogies.push({ kind: 'jet', x: 500, y: 200, vx: 0, hp: 1, bob: 0, base: 200, fireT: 9999, bombT: 0, dying: null, rot: 0, vy: 0, flash: 0, dead: false });
  S.bullets.push({ x: 500, y: 200, vx: 0, vy: 0, life: 5 });
  step(S, none());
  assert.strictEqual(S.combos, 1); assert.strictEqual(S.stars.c, 2); assert.strictEqual(S.stars.p, 2);
  const T = createState(58, 0, 2); T.ships[0].hp = 1; T.ships[1].hp = 1;   // the same player twice is not a combo
  T.missiles.push({ x: T.ships[0].x - 20, y: T.ships[0].y, ang: 0, owner: 'c', cone: 0.3, life: 20 }, { x: T.ships[1].x - 20, y: T.ships[1].y, ang: 0, owner: 'c', cone: 0.3, life: 20 });
  T.ships.forEach(s => { s.speed = 0; }); run(T, 5); assert.strictEqual(T.combos, 0);
});

check('progress: winning opens the next mission; bad saved data is cleaned up', () => {
  let p = bf.sanitizeProgress(null); assert.deepStrictEqual(p, { unlocked: 1, done: [] });
  p = bf.nextProgress(p, 0); assert.deepStrictEqual(p, { unlocked: 2, done: [0] });
  p = bf.nextProgress(p, 0); assert.deepStrictEqual(p, { unlocked: 2, done: [0] });
  p = bf.nextProgress({ unlocked: 5, done: [0, 1, 2, 3] }, 4); assert.deepStrictEqual(p, { unlocked: 5, done: [0, 1, 2, 3, 4] });
  assert.deepStrictEqual(bf.sanitizeProgress({ unlocked: 99, done: [1, 1, 'x', 7, -1] }), { unlocked: 5, done: [1] });
  assert.deepStrictEqual(bf.sanitizeProgress({ unlocked: 'lots' }), { unlocked: 1, done: [] });
});

check('god-mode playthrough: every mission can be finished (spawns, subs, boss, landing, win)', () => {
  bf.LEVELS.forEach((L, li) => {
    const S = createState(60 + li, 0, li); launch(S);
    let i = 0;
    for (; i < 60000 && S.phase !== 'win'; i++) {
      if (S.phase === 'play') {
        for (const t of bf.groundTargets(S)) S.missiles.push({ x: t.x, y: t.y, ang: 0, owner: i % 2 ? 'c' : 'p', cone: 0.1, life: 2 });
        for (const b of S.bogies) if (!b.dying) S.bullets.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 2 });
      }
      step(S, none());
    }
    assert.strictEqual(S.phase, 'win', 'mission ' + (li + 1) + ' finished (frames ' + i + ', goals ' + JSON.stringify(S.goals) + ')');
    assert.deepStrictEqual(S.goals, S.need);
    if (L.boss) assert.ok(S.bossSpawned);
  });
});

check('ships never leave the sailing lane and carrier stays in range', () => {
  const S = createState(14, 0, 2); run(S, 3000);
  for (const s of S.ships) assert.ok(s.x > 60 && s.x < 640);
  assert.ok(S.carrier.x >= TUNE.CARRIER_MIN && S.carrier.x <= TUNE.CARRIER_MAX);
});

if (failures) { console.error('\n' + failures + ' failed'); process.exit(1); }
console.log('\nall passed');

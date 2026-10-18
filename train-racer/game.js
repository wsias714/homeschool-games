'use strict';

const W = 900, H = 520;
const SPEEDS = [0, 0.0014, 0.0032, 0.006, 0.010];
const CLRS  = {red:'#e74c3c',blue:'#3498db',green:'#2ecc71',orange:'#e67e22',purple:'#9b59b6'};
const DARK  = {red:'#7b241c',blue:'#1a5276',green:'#196030',orange:'#784212',purple:'#512e8c'};
const ALL_COLORS = ['red','blue','green','orange','purple'];
const RY = 308;            // horizontal road y-coordinate (center of road)
const ROAD_HALF_H = 25;    // road extends ±25px from RY (50px tall total)
const LANE_R = RY + 11;    // rightbound lane y (lower)
const LANE_L = RY - 11;    // leftbound lane y (upper)
const MAX_TRAINS = 4;
const MAX_CARS  = 14;      // max road vehicles at once
const CAR_LEN   = 24;      // standard car length
const TRUCK_LEN = 48;      // truck length (2x car)
const CARGO_GOAL = 5;        // deliveries needed to win
const STATION_MAX = 3;       // max pickups per station (forces using both stations)
const CAR_IMPATIENT_MS = 11000; // car ignores gate after this long stalled
// Drawbridge (over river crossing the spL↔jBL track)
const DBRIDGE_X = 160;       // x position on the spL↔jBL bezier
const DBRIDGE_Y = 420;       // y position (river centerline)
const DBRIDGE_T_FROM_JBL = 0.333;  // bezier param along jBL→spL where x≈160
const RIVER_Y      = 420;    // river centerline
const RIVER_HALF_H = 14;     // river extends ±14 from centerline

const canvas = document.getElementById('gc');
const ctx = canvas.getContext('2d');

// ── Track Data ──────────────────────────────────────────────────────────────
// Double-oval figure-8: outer oval + two inner crossing diagonals + depot spurs
// [id, x, y, type, branchA, branchB, sw]
const ND = [
  // Left/right side junctions — outer oval OR inner mid-bypass
  ['spL',  80, 260, 'junction', 'jTL', 'jML',  0],
  ['spR', 820, 260, 'junction', 'jBR', 'jMR',  0],
  // Corner junctions (outer oval ↔ inner diagonals)
  ['jTL', 260,  80, 'junction', 'jDT', 'jCT',  0],
  ['jTR', 640,  80, 'junction', 'jCS', 'jPS',  0],
  ['jBL', 260, 440, 'junction', 'spL', 'jTR',  0],
  ['jBR', 640, 440, 'junction', 'jDB', 'jTL',  0],
  // Depot-gateway junctions (top/bottom of outer arc)
  ['jDT', 450,  68, 'junction', 'jTR', 'dTop', 0],
  ['jDB', 450, 452, 'junction', 'jCC', 'dBot', 0],
  ['jCC', 380, 455, 'junction', 'jBL', 'jDT',  0],   // center bridge gateway
  ['jCS', 780, 130, 'junction', 'spR', 'cStn', 0],   // cargo station switch (on top-right arc)
  ['cStn',832,  60, 'cargo',    null, null,    0],   // cargo station (top-right corner)
  ['jCT', 450, 260, 'junction', 'jBR', 'jPS',  0],   // center crossover — left diagonal, branches to passenger station
  ['jPS', 520, 200, 'junction', 'jBL', 'pStn', 0],   // passenger switch — on right diagonal above road, right of center
  ['pStn',700, 148, 'cargo',    null, null,    0],   // passenger station: north of road, right side, opposite right city
  // Inner mid-bypass waypoints (create extra crossings with diagonals)
  ['jML', 252, 192, 'waypoint', null,  null,   0],
  ['jMR', 648, 192, 'waypoint', null,  null,   0],
  // Depot nodes (train sleeps here)
  ['dTop', 450,  18, 'depot', null, null, 0],
  ['dBot', 450, 502, 'depot', null, null, 0],
];

// [fromId, toId, cpx, cpy]  — null = straight
const ED = [
  // Outer oval (clockwise direction)
  ['spL', 'jTL',   80,  80],    // left side up to top-left corner
  ['jTL', 'jDT',  350,  20],    // top arc — left half
  ['jDT', 'jTR',  550,  20],    // top arc — right half
  ['jTR', 'jCS',  770,  80],    // top arc to cargo switch
  ['jCS', 'spR',  820, 180],    // cargo switch down to right side
  ['jCS', 'cStn', 820,  60],    // cargo spur into station
  ['spR', 'jBR',  820, 440],    // right side down to bottom-right corner
  ['jBR', 'jDB',  550, 500],    // bottom arc — right half
  ['jDB', 'jCC',  415, 480],    // bottom arc — right half to center junction
  ['jCC', 'jBL',  310, 480],    // bottom arc — center junction to jBL
  // Center spur: direct jCC→jDT with bridge at x≈310
  ['jCC', 'jDT',  200, 200],    // center spur arcs left-up, bridge over road at x≈310
  ['jBL', 'spL',   80, 440],    // bottom-left corner up to left side
  // Inner crossing diagonals (create figure-8 center X at ≈450,260)
  ['jTL', 'jCT', null, null],   // left diagonal first half: jTL → center crossover
  ['jCT', 'jBR', null, null],   // left diagonal second half: center crossover → bottom-right
  ['jCT', 'jPS', null, null],   // crossover branch: center → passenger junction (above road)
  ['jTR', 'jPS', null, null],   // right diagonal first segment: jTR → jPS (junction above road)
  ['jPS', 'jBL', null, null],   // right diagonal second segment: jPS → jBL
  ['jPS', 'pStn', 620, 148],    // passenger station spur: goes right, stays above road
  // Depot spur tracks
  ['jDT', 'dTop', null, null],
  ['jDB', 'dBot', null, null],
  // Inner mid-bypass (arcs through upper middle, crossing both diagonals)
  ['spL', 'jML',  155, 225],   // left side → bypass entry
  ['jML', 'jMR',  450, 148],   // bypass: upper arc crossing both diagonals
  ['spR', 'jMR',  745, 225],   // right side → bypass entry
];

// Visual crossing zones — where train paths physically intersect
// Both diagonals cross each other at (450,260)
// Left diag (260,80)→(640,440) crosses road (y=308) at x≈500
// Right diag (640,80)→(260,440) crosses road (y=308) at x≈400
const CX = [
  {x:450, y:260},   // figure-8 center X (diagonals cross each other)
  {x:500, y:308},   // left diagonal × road
  {x:400, y:308},   // right diagonal × road
  {x:388, y:188},   // inner bypass × left diagonal  (jML→jMR arc ≈ y=192)
  {x:512, y:188},   // inner bypass × right diagonal
];
const GATE_XA = 400;        // level-crossing gate A
const GATE_XB = 500;        // level-crossing gate B (restored — was wrongly made a bridge)
const ROAD_SPEED = 2.4;     // base road car speed
// Outer-oval right segment spR(820,260)→jBR(640,440) [cp:820,440] crosses road (y=308) at t≈0.144
// Py(t)=260+360t-180t² → t=1-√(11/15)≈0.144 → Px=820-180t²≈816
// Tangent dx/dt=-360t≈-52, dy/dt=360(1-t)≈308
const BRIDGE_CX  = 816;
const BRIDGE_CY  = RY;
const BRIDGE_ANG = Math.atan2(308, -52); // ≈1.74 rad — nearly straight down, slight left lean
// Center spur jCC(380,455)→CP(200,200)→jDT(450,68) crosses road at ≈(310,308), tangent ≈atan2(-433,-92)
const BRIDGE_CX2  = 310;
const BRIDGE_CY2  = RY;
const BRIDGE_ANG2 = Math.atan2(-433, -92);
// jBL(260,440)→spL(80,260) [cp:80,440] crosses road at x≈84, tangent≈atan2(-308,-52)
const BRIDGE_CX3  = 84;
const BRIDGE_CY3  = RY;
const BRIDGE_ANG3 = Math.atan2(-308, -52);

// Road vehicles (cars + trucks) — continuously spawned, drive off-screen and despawn
const CAR_COLORS   = ['#e8c040','#d04028','#90c878','#4090d8','#c060c0','#60b860','#d08030','#a0a0e8'];
const TRUCK_COLORS = ['#b06030','#406688','#705840','#306060','#884028','#508050'];
function makeVehicle(opts) {
  const isTruck = opts.type === 'truck';
  const palette = isTruck ? TRUCK_COLORS : CAR_COLORS;
  return {
    x: opts.x,
    vx: opts.vx,
    y: opts.vx > 0 ? LANE_R : LANE_L,
    col: opts.col || palette[(Math.random()*palette.length)|0],
    type: isTruck ? 'truck' : 'car',
    len: isTruck ? TRUCK_LEN : CAR_LEN,
  };
}
let roadCars = [];
let carSpawnTimer = 0;
let gateOn = false;

// Plane state (decorative flyover)
let plane = null;
let planeTimer = 0;

// Ships on the river + drawbridge state
let ships = [];
let shipSpawnTimer = 0;
let bridgeOpen = false;   // drawbridge: false=trains pass, true=ships pass
// Per-station pickup counters (forces using both stations)
let stationsUsed = { cStn: 0, pStn: 0 };

// Cargo loading queue (timers handled via setTimeout on per-train state)

// ── Game State ──────────────────────────────────────────────────────────────
let nodes, edges, nodeById, edgeById, adj;
let trains, selId, phase, fc;
let score, particles, trainIdCounter, spawnQueue;
let junctionNodes, selJctIdx, gateOnFrames, sleepCount, cargoCount;

function init() {
  nodes         = ND.map(d => ({id:d[0],x:d[1],y:d[2],type:d[3],branchA:d[4],branchB:d[5],sw:d[6],pt:0}));
  junctionNodes = [];
  edges    = ED.map(([f,t,cx,cy],i) => ({id:i,fromId:f,toId:t,cpx:cx??null,cpy:cy??null}));
  nodeById      = new Map(nodes.map(n => [n.id, n]));
  junctionNodes = nodes.filter(n => n.type === 'junction');
  edgeById = new Map(edges.map(e => [e.id, e]));
  adj      = new Map(nodes.map(n => [n.id, []]));
  edges.forEach(e => {
    adj.get(e.fromId).push({nid:e.toId,   eid:e.id});
    adj.get(e.toId  ).push({nid:e.fromId, eid:e.id});
  });

  trains         = [];
  trainIdCounter = 0;
  selId          = null;
  phase          = 'playing';
  fc             = 0;
  score          = 0;
  particles      = [];
  spawnQueue     = ['dTop','dBot','dTop','dBot','dTop','dBot'];
  gateOnFrames   = 0;
  selJctIdx      = -1;
  sleepCount     = 0;
  cargoCount     = 0;
  carSpawnTimer  = 0;
  plane          = null;
  planeTimer     = 0;
  ships          = [];
  shipSpawnTimer = 0;
  bridgeOpen     = false;
  stationsUsed   = { cStn: 0, pStn: 0 };
  spawnInitialCars();

  gateOn = false;
  const bg = document.getElementById('bg');
  bg.textContent = '🚧 GATE'; bg.style.background = '#d4860a';

  doSpawn('dTop');
  doSpawn('dBot');
  upPanel();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const lerp = (a,b,t) => a + (b-a)*t;
const dst  = (x1,y1,x2,y2) => Math.sqrt((x2-x1)**2+(y2-y1)**2);

function bpt(t,x0,y0,cx,cy,x1,y1) {
  const m = 1-t;
  return {x:m*m*x0+2*m*t*cx+t*t*x1, y:m*m*y0+2*m*t*cy+t*t*y1};
}
function bang(t,x0,y0,cx,cy,x1,y1) {
  return Math.atan2(2*(1-t)*(cy-y0)+2*t*(y1-cy), 2*(1-t)*(cx-x0)+2*t*(x1-cx));
}
function eb(a,b) {
  const r = (adj.get(a)||[]).find(n => n.nid===b);
  return r ? edgeById.get(r.eid) : null;
}
function rr(x,y,w,h,r) {
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function rotOff(ox,oy,a) {
  return {x:ox*Math.cos(a)-oy*Math.sin(a), y:ox*Math.sin(a)+oy*Math.cos(a)};
}
// Sample history at a given pixel distance behind the front of the train.
// Returns {x, y, ang} or null if not enough history yet.
function histAt(h, dist) {
  if (h.length < 2) return null;
  let traveled = 0;
  for (let i = h.length-1; i > 0; i--) {
    const dx = h[i].x - h[i-1].x, dy = h[i].y - h[i-1].y;
    const d  = Math.sqrt(dx*dx + dy*dy);
    if (traveled + d >= dist) {
      const frac = (dist - traveled) / d;
      return {
        x:   h[i].x - dx*frac,
        y:   h[i].y - dy*frac,
        ang: Math.atan2(dy, dx),
      };
    }
    traveled += d;
  }
  return null;
}

// ── Routing ─────────────────────────────────────────────────────────────────
function nextNode(t, atId, prevId) {
  const n = nodeById.get(atId);
  if (n.type === 'junction') {
    const prev = nodeById.get(prevId);
    // Exiting a depot spur or cargo station → always take main track (branchA)
    if (prev && (prev.type === 'depot' || prev.type === 'cargo')) return n.branchA;
    // Exiting the mid-bypass back onto the oval → always continue on oval (branchA)
    if ((atId === 'spR' && prevId === 'jMR') ||
        (atId === 'spL' && prevId === 'jML')) return n.branchA;
    return n.sw === 0 ? n.branchA : n.branchB;
  }
  const f = (adj.get(atId)||[]).find(e => e.nid !== prevId);
  return f ? f.nid : prevId;
}

function arrive(t, nid) {
  const prev = t.cur;
  const n    = nodeById.get(nid);
  t.cur = nid; t.nxt = null; t.eid = null; t.ep = 0;

  if (n.type === 'depot') {
    // If the train is carrying cargo/passengers → DELIVERY (count + continue)
    if (t.cargo) {
      const kind = t.cargo.from === 'cStn' ? '📦 cargo' : '👥 passengers';
      t.state = 'unloading';
      t.vx = n.x; t.vy = n.y;
      t.unloadStart = fc;
      cargoCount++;
      playA();
      flash(`✅ Delivered ${kind}! (${cargoCount}/${CARGO_GOAL})`);
      upPanel();
      if (cargoCount >= CARGO_GOAL) {
        phase = 'won';
        setTimeout(() => init(), 5500);
        return;
      }
      // Continue out of the depot (no sleep on delivery)
      setTimeout(() => {
        if (phase !== 'playing' || t.state !== 'unloading') return;
        const exitId = nid === 'dTop' ? 'jDT' : 'jDB';
        const ex = eb(nid, exitId);
        if (!ex) { t.state = 'stopped'; return; }
        t.cur = nid; t.nxt = exitId; t.eid = ex.id; t.ep = 0; t.state = 'looping';
        t.cargo = null;
      }, 1600);
      return;
    }
    // Empty train: original sleep behavior
    t.state = 'sleeping';
    t.vx = n.x; t.vy = n.y;
    playA();
    sleepCount++;
    flash(`${t.cn.toUpperCase()} train resting 😴`);
    setTimeout(() => triggerSpawn(), 3000);
    return;
  }

  if (n.type === 'cargo') {
    const stationLabel = nid === 'cStn' ? '📦 cargo' : '👥 passengers';
    const exitId = nid === 'cStn' ? 'jCS' : 'jPS';

    // Already loaded — pass through briefly, no re-pickup
    if (t.cargo) {
      t.state = 'loading';
      t.loadStart = fc;
      t.vx = n.x; t.vy = n.y;
      flash(`${t.cn.toUpperCase()} already loaded — passing through`);
      setTimeout(() => {
        if (phase !== 'playing' || t.state !== 'loading') return;
        const ex = eb(nid, exitId);
        if (!ex) { t.state = 'stopped'; return; }
        t.cur = nid; t.nxt = exitId; t.eid = ex.id; t.ep = 0; t.state = 'looping';
      }, 700);
      return;
    }

    // Station depleted — train stops briefly then continues empty
    if ((stationsUsed[nid] || 0) >= STATION_MAX) {
      t.state = 'loading';
      t.loadStart = fc;
      t.vx = n.x; t.vy = n.y;
      flash(`${stationLabel} station empty!`);
      setTimeout(() => {
        if (phase !== 'playing' || t.state !== 'loading') return;
        const ex = eb(nid, exitId);
        if (!ex) { t.state = 'stopped'; return; }
        t.cur = nid; t.nxt = exitId; t.eid = ex.id; t.ep = 0; t.state = 'looping';
      }, 900);
      return;
    }

    // Normal pickup
    stationsUsed[nid] = (stationsUsed[nid] || 0) + 1;
    t.state = 'loading';
    t.loadStart = fc;
    t.vx = n.x; t.vy = n.y;
    playA();
    flash(`${stationLabel} loaded on ${t.cn.toUpperCase()} — deliver to a depot!`);
    upPanel();
    setTimeout(() => {
      if (phase !== 'playing' || t.state !== 'loading') return;
      const ex = eb(nid, exitId);
      if (!ex) { t.state = 'stopped'; return; }
      t.cur = nid; t.nxt = exitId; t.eid = ex.id; t.ep = 0; t.state = 'looping';
      t.cargo = { from: nid };
    }, 2200);
    return;
  }

  const nxtId = nextNode(t, nid, prev);
  if (!nxtId) { t.state = 'stopped'; return; }
  const e = eb(nid, nxtId);
  if (!e)  { t.state = 'stopped'; return; }
  t.nxt = nxtId; t.eid = e.id; t.ep = 0;
}

function triggerSpawn() {
  if (phase !== 'playing') return;
  const entry = spawnQueue.shift() || 'spL';
  spawnQueue.push(entry);
  doSpawn(entry);
}

function doSpawn(depotId) {
  const active = trains.filter(t => t.state !== 'sleeping' && t.state !== 'crashed');
  if (active.length >= MAX_TRAINS) return;
  const usedColors = active.map(t => t.cn);
  const cn = ALL_COLORS.find(c => !usedColors.includes(c));
  if (!cn) return;

  // Trains spawn AT the depot and drive out through the gateway junction
  const en    = nodeById.get(depotId);
  const nxtId = depotId === 'dTop' ? 'jDT' : 'jDB';
  const e     = eb(depotId, nxtId);
  if (!e) return;

  trains.push({
    id:    trainIdCounter++,
    cn,    color: CLRS[cn],
    cur:   depotId, nxt: nxtId, eid: e.id, ep: 0,
    si:    2, state: 'looping',
    vx:    en.x, vy: en.y,
    ang:   depotId === 'dTop' ? Math.PI/2 : -Math.PI/2, // point toward main track
    sel: false, wt: 0, hist: [],
  });
  upPanel();
}

// ── Visual Sync ──────────────────────────────────────────────────────────────
function syncVis(t) {
  if (t.nxt === null) return;
  const e  = edgeById.get(t.eid);
  const fn = nodeById.get(t.cur);
  const tn = nodeById.get(t.nxt);
  if (!fn || !tn) return;
  if (e && e.cpx !== null) {
    const p = bpt(t.ep, fn.x,fn.y,e.cpx,e.cpy,tn.x,tn.y);
    t.vx = p.x; t.vy = p.y;
    t.ang = bang(t.ep, fn.x,fn.y,e.cpx,e.cpy,tn.x,tn.y);
  } else {
    t.vx = lerp(fn.x,tn.x,t.ep); t.vy = lerp(fn.y,tn.y,t.ep);
    t.ang = Math.atan2(tn.y-fn.y, tn.x-fn.x);
  }
  t.hist.push({x:t.vx, y:t.vy});
  if (t.hist.length > 200) t.hist.shift();
}

// ── Collision ────────────────────────────────────────────────────────────────
function tpos(t) {
  const p = [{x:t.vx, y:t.vy}];
  if (t.hist.length >= 14) p.push(t.hist[t.hist.length-14]);
  if (t.hist.length >= 28) p.push(t.hist[t.hist.length-28]);
  return p;
}

function chkCollisions() {
  for (let i = 0; i < trains.length; i++)
  for (let j = i+1; j < trains.length; j++) {
    const a = trains[i], b = trains[j];
    if (['sleeping','crashed','loading','unloading'].includes(a.state)) continue;
    if (['sleeping','crashed','loading','unloading'].includes(b.state)) continue;
    const pa = tpos(a), pb = tpos(b);
    let hit = false;
    pa.forEach(p => pb.forEach(q => { if (dst(p.x,p.y,q.x,q.y) < 14) hit = true; }));
    if (hit) { crashTT(a,b); return; }
    pa.forEach(p => pb.forEach(q => { if (dst(p.x,p.y,q.x,q.y) < 55) { a.wt=10; b.wt=10; } }));
  }
  if (!gateOn) trains.forEach(t => {
    if (['sleeping','crashed','stopped','loading','unloading'].includes(t.state)) return;
    // Jam radius: more cars near the crossing = larger danger zone
    const jammed = roadCars.filter(c => Math.abs(c.x - GATE_XA) < 130 ||
                                        Math.abs(c.x - GATE_XB) < 130).length;
    const hitR = jammed >= 4 ? 24 : 16;
    tpos(t).forEach(p => roadCars.forEach(c => {
      if (dst(p.x, p.y, BRIDGE_CX,  BRIDGE_CY)  < 34) return; // outer oval right bridge
      if (dst(p.x, p.y, BRIDGE_CX2, BRIDGE_CY2) < 34) return; // center spur bridge
      if (dst(p.x, p.y, BRIDGE_CX3, BRIDGE_CY3) < 34) return; // outer oval left bridge
      // Trucks have larger hit footprint along x-axis
      const dx = Math.abs(p.x - c.x), dy = Math.abs(p.y - c.y);
      if (dx < c.len/2 + hitR/2 && dy < hitR) crashTC(t);
    }));
  });
}

function boom(cx,cy) {
  for (let i = 0; i < 28; i++) {
    const a = Math.random()*Math.PI*2, s = 2+Math.random()*6;
    particles.push({
      x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
      r:4+Math.random()*7, life:1, type:'boom',
      col:['#e74c3c','#f39c12','#f1c40f','#fff','#ff6b35'][0|Math.random()*5],
    });
  }
}

function removeCrashed(arr) {
  arr.forEach(t => { t.state = 'crashed'; });
  setTimeout(() => {
    if (phase !== 'playing') return;
    trains = trains.filter(t => !arr.includes(t));
    upPanel();
    setTimeout(() => triggerSpawn(), 400);
    if (arr.length >= 2) setTimeout(() => triggerSpawn(), 1200);
  }, 1600);
}

function crashTT(a,b) {
  if (a.state==='crashed'||b.state==='crashed') return;
  boom((a.vx+b.vx)/2, (a.vy+b.vy)/2);
  score = Math.max(0, score-200);
  a.state='crashed'; b.state='crashed';
  playB(); flash('CRASH! -200pts 💥'); upPanel();
  removeCrashed([a,b]);
}

function crashTC(t) {
  if (t.state==='crashed') return;
  boom(t.vx, t.vy);
  score = Math.max(0, score-100);
  t.state='crashed';
  playB(); flash('Road collision! -100pts 🚗💥'); upPanel();
  removeCrashed([t]);
}

// ── Update ───────────────────────────────────────────────────────────────────
function updateTrain(t, dt) {
  if (['sleeping','crashed','loading','unloading'].includes(t.state)) return;
  if (t.state === 'stopped') { syncVis(t); return; }
  if (t.wt > 0) t.wt--;
  // Drawbridge: if open and the train is on the spL↔jBL edge approaching the bridge, hold.
  if (bridgeOpen) {
    const onBridgeEdge = (t.cur === 'spL' && t.nxt === 'jBL') || (t.cur === 'jBL' && t.nxt === 'spL');
    if (onBridgeEdge) {
      const dbT = (t.cur === 'jBL') ? DBRIDGE_T_FROM_JBL : (1 - DBRIDGE_T_FROM_JBL);
      const step = SPEEDS[t.si]*(dt/16.67);
      const holdAt = dbT - 0.025;
      if (t.ep < dbT && t.ep + step >= holdAt) {
        if (t.ep < holdAt) t.ep = holdAt;
        syncVis(t); return;
      }
    }
  }
  t.ep = Math.min(1.001, t.ep + SPEEDS[t.si]*(dt/16.67));
  syncVis(t);
  // Emit steam puff from chimney
  if (t.si >= 2 && fc % 5 === t.id % 5) {
    const off = rotOff(-13, -14, t.ang);
    particles.push({
      x: t.vx+off.x, y: t.vy+off.y,
      vx:(Math.random()-.5)*0.4, vy:-0.55-Math.random()*0.5,
      r:2+Math.random()*2.5, life:0.75+Math.random()*0.35,
      type:'smoke', col:null,
    });
  }
  if (t.ep >= 1) arrive(t, t.nxt);
}

function spawnInitialCars() {
  roadCars = [
    makeVehicle({x:  60, vx: 2.4}),
    makeVehicle({x: 270, vx: 2.4}),
    makeVehicle({x: 500, vx: 2.4, type:'truck'}),
    makeVehicle({x: 880, vx:-2.4}),
    makeVehicle({x: 660, vx:-2.4}),
    makeVehicle({x: 430, vx:-2.4, type:'truck'}),
    makeVehicle({x: 150, vx:-2.4}),
  ];
}

function trySpawnCar() {
  if (roadCars.length >= MAX_CARS) return;
  const rb = roadCars.filter(c=>c.vx>0).length;
  const lb = roadCars.filter(c=>c.vx<0).length;
  const dir = rb < lb ? 1 : (lb < rb ? -1 : (Math.random() < 0.5 ? 1 : -1));
  const spawnX = dir > 0 ? -60 : W + 60;
  // Make sure no vehicle too close to the spawn point in the same lane
  const sameLane = roadCars.filter(c => Math.sign(c.vx) === dir);
  const tooClose = sameLane.some(c => Math.abs(c.x - spawnX) < 70);
  if (tooClose) return;
  const isTruck = Math.random() < 0.22;
  roadCars.push(makeVehicle({
    x: spawnX,
    vx: dir * (2.0 + Math.random() * 0.7),
    type: isTruck ? 'truck' : 'car',
  }));
}

function spawnPlane() {
  if (plane) return;
  const goingRight = Math.random() < 0.5;
  plane = {
    x: goingRight ? -120 : W + 120,
    y: 35 + Math.random() * 30,
    vx: (goingRight ? 1 : -1) * (1.1 + Math.random() * 0.6),
    col: ['#f0f0f0','#e6ecf2','#fff3d0'][(Math.random()*3)|0],
  };
}

function updatePlane(dt) {
  if (!plane) return;
  plane.x += plane.vx * (dt/16);
  if (plane.x < -200 || plane.x > W + 200) plane = null;
}

// ── Ships on the river ──────────────────────────────────────────────────────
function spawnShip() {
  if (ships.length >= 4) return;
  // Spawn just off-screen at the right of the river so they sail LEFT into the lake.
  const colors = ['#b04848','#4078b0','#b08840','#80808a','#508050'];
  ships.push({
    x: W + 50,
    y: RIVER_Y + (Math.random()-0.5)*4,
    vx: -(0.45 + Math.random()*0.3),   // slower — leisurely sail
    vy: 0,                              // will increase as ship nears the lake
    col: colors[(Math.random()*colors.length)|0],
    flagCol: ['#e74c3c','#f1c40f','#3498db'][(Math.random()*3)|0],
  });
}

function updateShips(dt) {
  // Sort front-to-back along travel direction (leftbound: front = lowest x)
  const sorted = [...ships].sort((a,b) => a.x - b.x);
  sorted.forEach((s, i) => {
    let spd = -s.vx; // positive magnitude
    // Stop at drawbridge if it's DOWN (closed for ships)
    if (!bridgeOpen && s.x > DBRIDGE_X + 14 && s.x < DBRIDGE_X + 90) spd = 0;
    // Ship-following (avoid collisions)
    if (i > 0) {
      const ahead = sorted[i-1];
      const gap = s.x - ahead.x - 40; // edge-to-edge
      if (gap < 6) spd = 0;
      else if (gap < 28) spd *= (gap - 6) / 22;
    }
    s.x -= spd * (dt/16);
    // Curve down toward lake only after passing the drawbridge — keeps ships on the river
    if (s.x < DBRIDGE_X) {
      if (s.y < 460) {
        s.vy = Math.min(s.vy + 0.07 * (dt/16), 1.5);
      } else {
        // In lake / exit channel — straighten out and sail left off-screen
        s.vy = Math.max(s.vy - 0.06 * (dt/16), 0);
      }
    }
    s.y += s.vy * (dt/16);
  });
  // Despawn when fully off left edge via exit channel
  ships = ships.filter(s => s.x > -70);
  // Periodic spawn
  shipSpawnTimer += dt;
  if (shipSpawnTimer > 5500 + Math.random()*4500) {
    spawnShip();
    shipSpawnTimer = 0;
  }
}

function drawRiver() {
  // River path: horizontal strip from right edge to the lake on the left
  ctx.fillStyle = '#3a7ec0';
  ctx.beginPath();
  ctx.moveTo(W, RIVER_Y - RIVER_HALF_H);
  ctx.lineTo(220, RIVER_Y - RIVER_HALF_H);
  ctx.quadraticCurveTo(180, RIVER_Y - 4, 150, RIVER_Y + 8);
  ctx.quadraticCurveTo(120, RIVER_Y + 18, 90, RIVER_Y + 24);  // dive toward lake
  ctx.lineTo(90, RIVER_Y + RIVER_HALF_H + 8);
  ctx.lineTo(220, RIVER_Y + RIVER_HALF_H);
  ctx.lineTo(W, RIVER_Y + RIVER_HALF_H);
  ctx.closePath();
  ctx.fill();
  // Bank lines
  ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(W, RIVER_Y - RIVER_HALF_H);
  ctx.lineTo(220, RIVER_Y - RIVER_HALF_H);
  ctx.quadraticCurveTo(180, RIVER_Y - 4, 150, RIVER_Y + 8);
  ctx.quadraticCurveTo(120, RIVER_Y + 18, 90, RIVER_Y + 24);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W, RIVER_Y + RIVER_HALF_H);
  ctx.lineTo(220, RIVER_Y + RIVER_HALF_H);
  ctx.stroke();
  // Water shimmer
  ctx.fillStyle = 'rgba(200,230,255,0.22)';
  for (let i = 0; i < 14; i++) {
    const wx = 230 + i*40 + Math.sin(fc*0.04+i)*3;
    if (wx > W - 5) continue;
    ctx.beginPath();
    ctx.ellipse(wx, RIVER_Y + Math.sin(i*1.7)*4, 5, 1.4, 0, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawShips() {
  ships.forEach(s => {
    // Hull (long boat shape, pointy front to the left)
    ctx.fillStyle = s.col;
    ctx.beginPath();
    ctx.moveTo(s.x - 22, s.y);                 // bow
    ctx.lineTo(s.x - 14, s.y - 6);
    ctx.lineTo(s.x + 18, s.y - 6);
    ctx.lineTo(s.x + 18, s.y + 6);
    ctx.lineTo(s.x - 14, s.y + 6);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.9; ctx.stroke();
    // Cabin
    ctx.fillStyle = '#f5f5f5';
    rr(s.x - 4, s.y - 11, 14, 6, 1); ctx.fill();
    ctx.strokeStyle = '#444'; ctx.lineWidth = 0.6;
    rr(s.x - 4, s.y - 11, 14, 6, 1); ctx.stroke();
    // Cabin windows
    ctx.fillStyle = '#88c8ff';
    ctx.fillRect(s.x - 2, s.y - 10, 3, 3);
    ctx.fillRect(s.x + 3, s.y - 10, 3, 3);
    // Mast + flag
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s.x + 3, s.y - 11); ctx.lineTo(s.x + 3, s.y - 19); ctx.stroke();
    ctx.fillStyle = s.flagCol;
    ctx.beginPath();
    ctx.moveTo(s.x + 3, s.y - 19); ctx.lineTo(s.x + 9, s.y - 17); ctx.lineTo(s.x + 3, s.y - 15);
    ctx.closePath(); ctx.fill();
    // Wake behind (to the right since moving left)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(s.x + 20 + i*5, s.y, 6 + i*2, Math.PI*5/6, Math.PI*7/6);
      ctx.stroke();
    }
  });
}

function drawDrawbridge() {
  const dx = DBRIDGE_X, dy = DBRIDGE_Y;
  // Stone abutments on each bank of the river
  ctx.fillStyle = '#7a5630';
  ctx.fillRect(dx - 22, dy - RIVER_HALF_H - 2, 8, RIVER_HALF_H*2 + 4);
  ctx.fillRect(dx + 14, dy - RIVER_HALF_H - 2, 8, RIVER_HALF_H*2 + 4);
  // Pillar caps
  ctx.fillStyle = '#9a7448';
  ctx.fillRect(dx - 23, dy - RIVER_HALF_H - 3, 10, 3);
  ctx.fillRect(dx - 23, dy + RIVER_HALF_H, 10, 3);
  ctx.fillRect(dx + 13, dy - RIVER_HALF_H - 3, 10, 3);
  ctx.fillRect(dx + 13, dy + RIVER_HALF_H, 10, 3);

  if (bridgeOpen) {
    // Two leaves angled UP — ships can pass underneath
    const angle = Math.PI/2.6;
    [['L', -14, -1], ['R', 14, 1]].forEach(([side, anchorX, dir]) => {
      ctx.save();
      ctx.translate(dx + anchorX, dy);
      ctx.rotate(-dir * angle);
      const len = 14;
      ctx.fillStyle = '#5a3e1a';
      ctx.fillRect(0, -3, dir * len, 6);
      ctx.strokeStyle = '#7a5a28'; ctx.lineWidth = 0.8;
      ctx.strokeRect(Math.min(0, dir*len), -3, len, 6);
      // Gold rails
      ctx.strokeStyle = '#e8c050'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(dir*len, -1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,  1); ctx.lineTo(dir*len,  1); ctx.stroke();
      ctx.restore();
    });
    // Red lights flashing on each abutment
    const p = 0.5 + 0.5*Math.sin(fc*0.3);
    ctx.shadowColor = 'red'; ctx.shadowBlur = 10;
    ctx.fillStyle = `rgba(255,30,30,${p})`;
    ctx.beginPath(); ctx.arc(dx - 18, dy - RIVER_HALF_H - 8, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(dx + 18, dy - RIVER_HALF_H - 8, 3, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    // Deck DOWN — flat bridge across the river (trains pass)
    ctx.fillStyle = '#5a3e1a';
    ctx.fillRect(dx - 14, dy - 4, 28, 8);
    ctx.strokeStyle = '#7a5a28'; ctx.lineWidth = 1;
    ctx.strokeRect(dx - 14, dy - 4, 28, 8);
    // Deck planking
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6;
    for (let i = -10; i < 14; i += 4) {
      ctx.beginPath(); ctx.moveTo(dx + i, dy - 4); ctx.lineTo(dx + i, dy + 4); ctx.stroke();
    }
    // Gold rails
    ctx.strokeStyle = '#e8c050'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(dx - 14, dy - 2); ctx.lineTo(dx + 14, dy - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dx - 14, dy + 2); ctx.lineTo(dx + 14, dy + 2); ctx.stroke();
    // Green lights (bridge ready for trains)
    ctx.fillStyle = 'rgba(60,220,80,0.85)';
    ctx.beginPath(); ctx.arc(dx - 18, dy - RIVER_HALF_H - 8, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(dx + 18, dy - RIVER_HALF_H - 8, 3, 0, Math.PI*2); ctx.fill();
  }
  // [D] hotkey hint
  ctx.fillStyle = bridgeOpen ? 'rgba(255,180,80,0.95)' : 'rgba(160,255,160,0.75)';
  ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
  ctx.fillText('[D]', dx, dy - RIVER_HALF_H - 16);
  ctx.textAlign = 'left';
}

function updateCars(dt) {
  // Sort each lane front-to-back for following logic
  const rb = roadCars.filter(c=>c.vx>0).sort((a,b)=>b.x-a.x); // rightbound: front=highest x
  const lb = roadCars.filter(c=>c.vx<0).sort((a,b)=>a.x-b.x); // leftbound: front=lowest x

  [rb, lb].forEach(lane => {
    lane.forEach((c, i) => {
      let spd = ROAD_SPEED;

      // Impatience: if this car has been stuck too long, it ignores gate AND car-following
      const impatient = (c._stallMs || 0) > CAR_IMPATIENT_MS;

      // Car-following: only queue near the crossing zone so distant cars keep moving freely
      if (i > 0 && !impatient) {
        const ahead = lane[i-1];
        const centerGap = c.vx > 0 ? ahead.x - c.x : c.x - ahead.x;
        const gap = centerGap - c.len/2 - ahead.len/2; // edge-to-edge gap
        const nearGate = c.vx > 0 ? c.x > GATE_XA - 280 : c.x < GATE_XB + 280;
        if (nearGate) {
          if (gap < 12) spd = 0;
          else if (gap < 48) spd = ROAD_SPEED * (gap - 12) / 36;
        }
      }

      // Gate: stop only in the approach zone BEFORE each crossing the car would hit next
      if (gateOn && !impatient) {
        if (c.vx > 0) {
          if (c.x >= GATE_XA - 90 && c.x < GATE_XA) spd = 0;
          if (c.x >= GATE_XB - 90 && c.x < GATE_XB) spd = 0;
        }
        if (c.vx < 0) {
          if (c.x <= GATE_XB + 90 && c.x > GATE_XB) spd = 0;
          if (c.x <= GATE_XA + 90 && c.x > GATE_XA) spd = 0;
        }
      }

      const wasStalled = c._stalled;
      c._stalled = !impatient && spd < 0.5;
      // Track stall time — don't reset while impatient so the flag stays latched until car clears
      if (c._stalled)   c._stallMs = (c._stallMs || 0) + dt;
      else if (!impatient) c._stallMs = 0;
      if (c._stalled && !wasStalled && gateOnFrames > 90) playHonk();
      if (c._stalled && gateOnFrames > 280 && fc % 200 === (Math.abs(Math.round(c.x)) % 200)) playHonk();
      // Impatient: car-following and gate already skipped above — drives at full ROAD_SPEED
      c.x += Math.sign(c.vx) * spd * (dt/16);
    });
  });

  // Warning flash when cars are about to lose patience
  if (gateOn) {
    const longest = roadCars.reduce((m,c) => Math.max(m, c._stallMs || 0), 0);
    if (longest > CAR_IMPATIENT_MS - 3000 && longest <= CAR_IMPATIENT_MS - 3000 + dt) {
      flash('🚗💨 Drivers running out of patience — they\'ll cross anyway soon!');
    }
  }

  // Despawn vehicles that have left the screen
  roadCars = roadCars.filter(c => c.x > -120 && c.x < W + 120);

  // Continuous spawning so traffic keeps flowing in
  carSpawnTimer += dt;
  if (carSpawnTimer > 1100 + Math.random()*900) {
    trySpawnCar();
    carSpawnTimer = 0;
  }

  // Gate congestion penalty: deduct score if gate held too long
  if (gateOn) {
    gateOnFrames++;
    if (gateOnFrames === 310) flash('Traffic jam building! Open the gate 🚦');
    if (gateOnFrames > 310 && gateOnFrames % 180 === 0) {
      score = Math.max(0, score - 60);
      flash('Traffic congestion! -60pts 🚗🚗');
      upPanel();
    }
  } else {
    gateOnFrames = 0;
  }
}

function updatePfx() {
  for (let i = particles.length-1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    if (p.type==='smoke') { p.vy -= 0.04; p.life -= 0.028; }
    else                  { p.vy += 0.20; p.life -= 0.035; }
    p.r *= 0.97;
    if (p.life <= 0) particles.splice(i,1);
  }
}

// ── Game Loop ────────────────────────────────────────────────────────────────
let lastTs = null;
function loop(ts) {
  const dt = lastTs ? Math.min(ts-lastTs, 50) : 16;
  lastTs = ts; fc++;
  if (phase === 'playing') {
    trains.forEach(t => updateTrain(t,dt));
    updateCars(dt); updateShips(dt); updatePfx(); chkCollisions();
    score += trains.filter(t => t.state==='looping').length;
    if (fc % 60 === 0) upPanel();
  } else updatePfx();
  // Plane: periodic decorative flyover (no gameplay impact)
  planeTimer += dt;
  if (!plane && planeTimer > 12000 + Math.random()*16000) {
    spawnPlane();
    planeTimer = 0;
  }
  updatePlane(dt);
  render();
  requestAnimationFrame(loop);
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0,0,W,H);
  drawBg();           // grass, trees, lake, towns
  drawRiver();        // river under the bottom-left train track
  drawShips();        // ships sailing on river BEFORE drawbridge so bridge covers them
  drawRoad();
  drawRoadCars();     // cars BEFORE road bridges so bridges render on top
  drawTracks();       // tracks + road bridge overpasses drawn last in drawTracks
  drawDrawbridge();   // drawbridge over river (after tracks so the deck reads as the rail bed)
  drawTrafficLights();
  drawCrossWarn();
  drawGate();
  drawNodes();
  drawPfx();
  drawTrains();
  drawPlane();    // decorative — drawn on top of everything except the win overlay
  if (phase === 'won') drawWinOverlay();
}

function drawBg() {
  // Grass base
  ctx.fillStyle = '#3d7028'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x=0;x<W;x+=28) for (let y=0;y<H;y+=28) {
    if (((x/28)+(y/28))%2===0) ctx.fillRect(x,y,28,28);
  }

  // Lake (bottom-left quadrant)
  ctx.fillStyle = 'rgba(40,130,200,0.55)';
  ctx.beginPath(); ctx.ellipse(108, 460, 72, 38, -0.2, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(80,170,240,0.6)'; ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(180,230,255,0.18)';
  ctx.beginPath(); ctx.ellipse(98, 452, 38, 18, -0.3, 0, Math.PI*2); ctx.fill();
  // Exit channel: lake → left screen edge (ships sail out this way)
  ctx.fillStyle = 'rgba(40,130,200,0.55)';
  ctx.beginPath();
  ctx.moveTo(0, 449); ctx.lineTo(42, 449);
  ctx.quadraticCurveTo(50, 454, 48, 460);
  ctx.quadraticCurveTo(50, 466, 42, 471);
  ctx.lineTo(0, 471); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(80,170,240,0.5)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0,449); ctx.lineTo(42,449); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,471); ctx.lineTo(42,471); ctx.stroke();

  // Trees — scattered in clear areas
  const trees = [
    [38,38],[130,32],[38,140],[32,360],[38,468],   // left edge
    [870,200],[858,380],[862,468],                 // right edge (cleared top for cargo station)
    [200,470],[320,480],[560,480],[680,475],          // bottom strip
    [180,32],[350,28],[560,28],[720,32],              // top strip
  ];
  trees.forEach(([tx,ty]) => drawTree(tx,ty));

  // Two cities — positioned inside the ovals, clear of all track segments.
  drawTown(155, 185, 'left');    // left city: upper-left interior of left oval (above bypass, below left arc)
  drawTown(748, 372, 'right');   // right city: lower-right interior of right oval (below bypass, above bottom arc)

  // Wooden table border
  ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = 12;
  ctx.strokeRect(6,6,W-12,H-12);
  ctx.strokeStyle = '#8a6030'; ctx.lineWidth = 3;
  ctx.strokeRect(12,12,W-24,H-24);
}

function drawTree(tx,ty) {
  // Trunk
  ctx.fillStyle = '#6b4020';
  ctx.fillRect(tx-3, ty+4, 6, 10);
  // Canopy
  ctx.fillStyle = '#2a6618';
  ctx.beginPath(); ctx.arc(tx, ty, 13, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#3a8822';
  ctx.beginPath(); ctx.arc(tx-4, ty-3, 8, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(tx+4, ty-2, 7, 0, Math.PI*2); ctx.fill();
}

function drawTown(cx, cy, side) {
  // Wide ground patch
  ctx.fillStyle = 'rgba(120,150,70,0.35)';
  ctx.beginPath(); ctx.ellipse(cx, cy+18, 78, 22, 0, 0, Math.PI*2); ctx.fill();

  // Sidewalk strip at the front
  ctx.fillStyle = 'rgba(180,180,180,0.4)';
  ctx.fillRect(cx - 70, cy + 16, 140, 4);

  // Buildings: mix of skyscrapers, midrise, and houses
  const layouts = {
    left: [
      {ox:-58, oy: -2, w:14, h:18, kind:'house',      col:'#f0dcb0', roof:'#a02828'},
      {ox:-40, oy:-26, w:16, h:42, kind:'midrise',    col:'#d8a878', roof:'#5a3018'},
      {ox:-20, oy:-50, w:14, h:66, kind:'skyscraper', col:'#7090b0', roof:'#3050a0'},
      {ox:  0, oy:-38, w:14, h:54, kind:'skyscraper', col:'#a8b0c0', roof:'#406088'},
      {ox: 20, oy:-58, w:14, h:74, kind:'skyscraper', col:'#5070a0', roof:'#284070'},
      {ox: 40, oy:-22, w:16, h:38, kind:'midrise',    col:'#d8b860', roof:'#604020'},
      {ox: 58, oy: -4, w:16, h:20, kind:'house',      col:'#e8d0a0', roof:'#385f8a'},
    ],
    right: [
      {ox:-58, oy: -4, w:16, h:20, kind:'house',      col:'#f0dcb0', roof:'#3a6d28'},
      {ox:-38, oy:-30, w:16, h:46, kind:'midrise',    col:'#cab088', roof:'#502810'},
      {ox:-18, oy:-56, w:14, h:72, kind:'skyscraper', col:'#88a0b8', roof:'#284870'},
      {ox:  2, oy:-44, w:14, h:60, kind:'skyscraper', col:'#c0c8d0', roof:'#506080'},
      {ox: 22, oy:-32, w:14, h:48, kind:'midrise',    col:'#b89070', roof:'#604020'},
      {ox: 40, oy:-50, w:14, h:66, kind:'skyscraper', col:'#6080a8', roof:'#304060'},
      {ox: 58, oy: -2, w:14, h:18, kind:'house',      col:'#e0c498', roof:'#a02828'},
    ],
  };
  const buildings = layouts[side] || layouts.left;
  buildings.forEach(b => drawBuilding(cx + b.ox, cy + b.oy, b));

  // A handful of townspeople strolling
  const people = [
    {ox:-50, oy:14, col:'#e84040'},
    {ox:-28, oy:13, col:'#3070d0'},
    {ox:-10, oy:14, col:'#d0a020'},
    {ox:  8, oy:13, col:'#7a4ac8'},
    {ox: 28, oy:14, col:'#40a070'},
    {ox: 50, oy:13, col:'#e8408a'},
  ];
  people.forEach(p => {
    const px = cx + p.ox, py = cy + p.oy;
    const sway = Math.sin(fc * 0.07 + p.ox) * 0.5;
    ctx.fillStyle = p.col;
    ctx.fillRect(px - 1.5 + sway, py, 3, 4);
    ctx.fillStyle = '#f0c898';
    ctx.beginPath(); ctx.arc(px + sway, py - 1.2, 1.6, 0, Math.PI*2); ctx.fill();
  });
}

function drawBuilding(x, y, b) {
  // Subtle shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x - b.w/2 + 1, y + 2, b.w, b.h);

  // Wall + outline
  ctx.fillStyle = b.col;
  ctx.fillRect(x - b.w/2, y, b.w, b.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.7;
  ctx.strokeRect(x - b.w/2, y, b.w, b.h);

  if (b.kind === 'skyscraper') {
    // Grid of lit/dark windows
    const rows = Math.max(4, Math.floor(b.h / 5));
    const cols = Math.max(2, Math.floor(b.w / 4));
    const colSp = (b.w - 2) / cols;
    const rowSp = (b.h - 4) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x - b.w/2 + 1 + c * colSp;
        const wy = y + 2 + r * rowSp;
        const lit = ((r * 7 + c * 3 + (x|0)) % 4) !== 0;
        ctx.fillStyle = lit ? '#ffe070' : '#2a3040';
        ctx.fillRect(wx, wy, Math.max(1.5, colSp - 1.5), Math.max(1.5, rowSp - 1.5));
      }
    }
    // Flat roof ledge
    ctx.fillStyle = b.roof; ctx.fillRect(x - b.w/2 - 1, y - 2, b.w + 2, 3);
    // Antenna with red blinker
    ctx.fillStyle = '#222';
    ctx.fillRect(x - 0.5, y - 9, 1, 7);
    const blink = (Math.sin(fc * 0.1 + x) + 1) / 2;
    ctx.fillStyle = `rgba(255,80,80,${0.5 + blink*0.5})`;
    ctx.beginPath(); ctx.arc(x, y - 10, 1.4, 0, Math.PI*2); ctx.fill();
  } else if (b.kind === 'midrise') {
    // Vertical column stripe + horizontal floor lines
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x - 0.5, y + 1, 1, b.h - 2);
    ctx.fillStyle = '#ffeb70';
    const floors = Math.floor(b.h / 6);
    for (let r = 0; r < floors; r++) {
      const wy = y + 3 + r * 6;
      ctx.fillRect(x - b.w/2 + 2, wy, b.w/2 - 3, 3);
      ctx.fillRect(x + 1,         wy, b.w/2 - 3, 3);
    }
    // Pitched roof (slight)
    ctx.fillStyle = b.roof;
    ctx.beginPath();
    ctx.moveTo(x - b.w/2 - 1, y);
    ctx.lineTo(x,             y - 5);
    ctx.lineTo(x + b.w/2 + 1, y);
    ctx.closePath(); ctx.fill();
  } else {
    // House
    ctx.fillStyle = '#ffeb70';
    ctx.fillRect(x - b.w/2 + 2, y + 3, 3, 3);
    ctx.fillRect(x + b.w/2 - 5, y + 3, 3, 3);
    // Door
    ctx.fillStyle = '#5a3010';
    ctx.fillRect(x - 2, y + b.h - 7, 4, 7);
    // Pitched roof
    ctx.fillStyle = b.roof;
    ctx.beginPath();
    ctx.moveTo(x - b.w/2 - 2, y);
    ctx.lineTo(x,             y - 9);
    ctx.lineTo(x + b.w/2 + 2, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.6; ctx.stroke();
    // Chimney
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(x + b.w/2 - 6, y - 5, 3, 4);
  }
}

function drawPlane() {
  if (!plane) return;
  const x = plane.x, y = plane.y, dir = Math.sign(plane.vx);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  // Shadow on ground (below, faded)
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath(); ctx.ellipse(0, 220, 22, 4, 0, 0, Math.PI*2); ctx.fill();
  // Wings (back)
  ctx.fillStyle = '#dadfe5';
  ctx.beginPath();
  ctx.moveTo(-4, 0); ctx.lineTo(6, -14); ctx.lineTo(10, -14); ctx.lineTo(2, 0); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-4, 0); ctx.lineTo(6,  14); ctx.lineTo(10,  14); ctx.lineTo(2, 0); ctx.closePath(); ctx.fill();
  // Fuselage
  ctx.fillStyle = plane.col;
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-22, -4);
  ctx.lineTo(20, -4);
  ctx.lineTo(26, 0);
  ctx.lineTo(20,  4);
  ctx.lineTo(-22, 4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.7; ctx.stroke();
  // Tail fin
  ctx.fillStyle = '#c8d0d8';
  ctx.beginPath();
  ctx.moveTo(-22, -1); ctx.lineTo(-26, -9); ctx.lineTo(-19, -1); ctx.closePath(); ctx.fill();
  // Windows
  ctx.fillStyle = 'rgba(80,160,220,0.85)';
  for (let i = -10; i <= 14; i += 4) ctx.fillRect(i, -2, 2, 2);
  // Cockpit
  ctx.fillStyle = 'rgba(40,120,180,0.95)';
  ctx.fillRect(17, -3, 4, 3);
  // Nose
  ctx.fillStyle = '#444';
  ctx.beginPath(); ctx.arc(25, 0, 1.4, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawTrafficLights() {
  drawTrafficLight(GATE_XA - 22, RY);
  drawTrafficLight(GATE_XB + 22, RY);
}

function drawTrafficLight(gx, gy) {
  const baseY = gy - ROAD_HALF_H - 4;  // sit just above the road edge
  // Post
  ctx.fillStyle = '#444';
  ctx.fillRect(gx-2, baseY-32, 4, 32);
  // Housing box
  ctx.fillStyle = '#1a1a1a';
  rr(gx-8, baseY-34, 16, 30, 3); ctx.fill();
  ctx.strokeStyle = '#555'; ctx.lineWidth=1;
  rr(gx-8, baseY-34, 16, 30, 3); ctx.stroke();
  // Red light
  const redOn = gateOn;
  ctx.fillStyle = redOn ? '#ff2020' : '#3a0000';
  if (redOn) { ctx.shadowColor='red'; ctx.shadowBlur=10; }
  ctx.beginPath(); ctx.arc(gx, baseY-27, 5, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  // Green light
  ctx.fillStyle = redOn ? '#003000' : '#20dd20';
  if (!redOn) { ctx.shadowColor='lime'; ctx.shadowBlur=8; }
  ctx.beginPath(); ctx.arc(gx, baseY-13, 5, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
}

function drawRoad() {
  // Wider asphalt road with two visible lanes
  ctx.fillStyle = '#3a424a'; ctx.fillRect(0, RY-ROAD_HALF_H, W, ROAD_HALF_H*2);
  // Subtle shoulder shading
  const grd = ctx.createLinearGradient(0, RY-ROAD_HALF_H, 0, RY+ROAD_HALF_H);
  grd.addColorStop(0,   'rgba(0,0,0,0.18)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0)');
  grd.addColorStop(1,   'rgba(0,0,0,0.18)');
  ctx.fillStyle = grd; ctx.fillRect(0, RY-ROAD_HALF_H, W, ROAD_HALF_H*2);
  // Solid yellow edge lines
  ctx.strokeStyle = 'rgba(255,210,40,0.55)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,RY-ROAD_HALF_H); ctx.lineTo(W,RY-ROAD_HALF_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,RY+ROAD_HALF_H); ctx.lineTo(W,RY+ROAD_HALF_H); ctx.stroke();
  // Center dashed lane divider (yellow)
  ctx.strokeStyle='rgba(255,210,40,0.7)'; ctx.lineWidth=2; ctx.setLineDash([22,16]);
  ctx.beginPath(); ctx.moveTo(0,RY); ctx.lineTo(W,RY); ctx.stroke();
  ctx.setLineDash([]);
}

function drawRoadCars() {
  roadCars.forEach(c => {
    if (c.type === 'truck') drawTruck(c); else drawCarVehicle(c);
    // Honk indicator
    if (c._stalled && gateOnFrames > 200) {
      const p = 0.5+0.5*Math.sin(fc*0.35+c.x*0.05);
      ctx.fillStyle=`rgba(255,210,0,${p*0.95})`;
      ctx.font='bold 11px Arial'; ctx.textAlign='center';
      ctx.fillText('📯', c.x, c.y - 11);
      ctx.textAlign='left';
    }
  });
}

function drawCarVehicle(c) {
  const x=c.x, y=c.y, w=c.len, h=12;
  // Shadow
  ctx.fillStyle='rgba(0,0,0,0.28)';
  rr(x-w/2+1, y-h/2+3, w, h, 3); ctx.fill();
  // Body
  ctx.fillStyle=c.col; rr(x-w/2,y-h/2,w,h,3); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.lineWidth=0.8;
  rr(x-w/2,y-h/2,w,h,3); ctx.stroke();
  // Windshield
  ctx.fillStyle='rgba(180,225,255,0.78)';
  if (c.vx>0) ctx.fillRect(x-w/2+3,y-h/2+2,7,h-4);
  else        ctx.fillRect(x+w/2-10,y-h/2+2,7,h-4);
  // Headlights / taillights
  if (c.vx>0) {
    ctx.fillStyle='rgba(255,240,180,0.95)';
    ctx.fillRect(x+w/2-2, y-3, 2, 2); ctx.fillRect(x+w/2-2, y+1, 2, 2);
    ctx.fillStyle='rgba(255,40,40,0.85)';
    ctx.fillRect(x-w/2, y-3, 2, 2); ctx.fillRect(x-w/2, y+1, 2, 2);
  } else {
    ctx.fillStyle='rgba(255,240,180,0.95)';
    ctx.fillRect(x-w/2, y-3, 2, 2); ctx.fillRect(x-w/2, y+1, 2, 2);
    ctx.fillStyle='rgba(255,40,40,0.85)';
    ctx.fillRect(x+w/2-2, y-3, 2, 2); ctx.fillRect(x+w/2-2, y+1, 2, 2);
  }
}

function drawTruck(c) {
  const x=c.x, y=c.y, w=c.len, h=14;
  const cabW=14, trailerW=w-cabW-2;
  // Shadow
  ctx.fillStyle='rgba(0,0,0,0.32)';
  rr(x-w/2+1, y-h/2+3, w, h, 2); ctx.fill();
  if (c.vx > 0) {
    // Trailer (back of truck, on the left)
    ctx.fillStyle = '#d8d8d8';
    rr(x-w/2, y-h/2+1, trailerW, h-2, 1); ctx.fill();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 0.8; rr(x-w/2, y-h/2+1, trailerW, h-2, 1); ctx.stroke();
    // Trailer corrugation
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.6;
    for (let lx = x-w/2+4; lx < x-w/2+trailerW-1; lx += 4) {
      ctx.beginPath(); ctx.moveTo(lx, y-h/2+2); ctx.lineTo(lx, y+h/2-2); ctx.stroke();
    }
    // Cab (front, on the right)
    ctx.fillStyle = c.col; rr(x+w/2-cabW, y-h/2, cabW, h, 2); ctx.fill();
    // Windshield
    ctx.fillStyle = 'rgba(180,225,255,0.8)';
    ctx.fillRect(x+w/2-cabW+2, y-h/2+2, 5, h-4);
    // Headlights
    ctx.fillStyle = 'rgba(255,240,180,0.95)';
    ctx.fillRect(x+w/2-2, y-4, 2, 2); ctx.fillRect(x+w/2-2, y+2, 2, 2);
  } else {
    // Cab (front, on the left)
    ctx.fillStyle = c.col; rr(x-w/2, y-h/2, cabW, h, 2); ctx.fill();
    // Windshield
    ctx.fillStyle = 'rgba(180,225,255,0.8)';
    ctx.fillRect(x-w/2+cabW-7, y-h/2+2, 5, h-4);
    // Headlights
    ctx.fillStyle = 'rgba(255,240,180,0.95)';
    ctx.fillRect(x-w/2, y-4, 2, 2); ctx.fillRect(x-w/2, y+2, 2, 2);
    // Trailer (back, on the right)
    ctx.fillStyle = '#d8d8d8';
    rr(x-w/2+cabW+2, y-h/2+1, trailerW, h-2, 1); ctx.fill();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 0.8; rr(x-w/2+cabW+2, y-h/2+1, trailerW, h-2, 1); ctx.stroke();
    // Corrugation
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.6;
    for (let lx = x-w/2+cabW+5; lx < x+w/2-1; lx += 4) {
      ctx.beginPath(); ctx.moveTo(lx, y-h/2+2); ctx.lineTo(lx, y+h/2-2); ctx.stroke();
    }
  }
  // Wheels
  ctx.fillStyle = '#1a1a1a';
  const wy = y + h/2 - 1;
  const wheelXs = [-w/2+5, -w/2+cabW-2, w/2-cabW+2, w/2-5];
  wheelXs.forEach(wx => { ctx.beginPath(); ctx.arc(x+wx, wy, 2.4, 0, Math.PI*2); ctx.fill(); });
}

function drawTracks() {
  // Inner diagonals (dimmer, drawn first)
  drawTrk('jTL','jCT','#c09840',true);
  drawTrk('jCT','jBR','#c09840',true);
  drawTrk('jTR','jPS','#c09840',true);
  drawTrk('jPS','jBL','#c09840',true);
  // Crossover branch + passenger station spur (blue — passenger line)
  drawTrk('jCT','jPS','#5a8cc8',true);
  drawTrk('jPS','pStn','#5a8cc8',true);
  // Mid-bypass (arcs through upper middle, crosses both diagonals — slightly dim)
  drawTrk('spL','jML','#a0b870',true);
  drawTrk('jML','jMR','#a0b870',true);
  drawTrk('spR','jMR','#a0b870',true);
  // Center spur — curls left-up, bridge over road at x≈310
  drawTrk('jCC','jDT','#a0b870',true);
  // Depot spurs
  drawTrk('jDT','dTop','#90c060');
  drawTrk('jDB','dBot','#90c060');
  // Cargo station spur (vibrant orange so it stands out as the objective)
  drawTrk('jCS','cStn','#ffb050');
  // Outer oval (main track, on top — full brightness); bottom arc routes via jCC, top-right via jCS
  const oc = '#e8c050';
  drawTrk('spL','jTL',oc); drawTrk('jTL','jDT',oc); drawTrk('jDT','jTR',oc);
  drawTrk('jTR','jCS',oc); drawTrk('jCS','spR',oc);
  drawTrk('spR','jBR',oc); drawTrk('jBR','jDB',oc); drawTrk('jDB','jCC',oc); drawTrk('jCC','jBL',oc); drawTrk('jBL','spL',oc);
  // Road overpass bridges (outer oval right side + outer oval left side)
  drawRoadBridge(BRIDGE_CX,  BRIDGE_CY,  BRIDGE_ANG);   // right bridge (x≈816)
  drawRoadBridge(BRIDGE_CX2, BRIDGE_CY2, BRIDGE_ANG2);  // center spur bridge (x≈310)
  drawRoadBridge(BRIDGE_CX3, BRIDGE_CY3, BRIDGE_ANG3);  // left bridge (x≈84)
}

function drawBridge(bx,by) {
  ctx.fillStyle='rgba(55,38,18,0.92)'; ctx.fillRect(bx-12,by-9,24,18);
  ctx.strokeStyle='rgba(180,150,100,0.7)'; ctx.lineWidth=1.5;
  ctx.strokeRect(bx-12,by-9,24,18);
  ctx.strokeStyle='#c09840'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(bx-12,by-4.5); ctx.lineTo(bx+12,by-4.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx-12,by+4.5); ctx.lineTo(bx+12,by+4.5); ctx.stroke();
}

// Overpass bridge — rotated to follow the track angle.
// In local space: X-axis = track direction, Y-axis = perpendicular (deck width).
// Includes tall trestle abutments + cross-bracing to give a visible "elevated above road" feel.
function drawRoadBridge(bx, by, ang) {
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(ang);

  const span = 36;       // half-length along track (covers wider 50px road + overhang)
  const wid  = 15;       // half-width perpendicular to track
  const pillarW = 14;
  const pillarExt = 5;   // pillars extend past deck on both sides (trestle look)

  // Deep cast shadow under bridge on the road
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(-span+4, -wid+5, span*2, wid*2);

  // Tall stone abutment pillars at each end (extend beyond deck on both sides)
  ctx.fillStyle = '#7a5630';
  ctx.fillRect(-span,            -wid-pillarExt, pillarW, wid*2+pillarExt*2);
  ctx.fillRect( span-pillarW,    -wid-pillarExt, pillarW, wid*2+pillarExt*2);
  // Inside shadow edge on each pillar (depth cue)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-span+pillarW,     -wid-pillarExt, 3, wid*2+pillarExt*2);
  ctx.fillRect( span-pillarW-3,   -wid-pillarExt, 3, wid*2+pillarExt*2);
  // Pillar cap (lighter band at top/bottom = base & cap of column)
  ctx.fillStyle = '#9a7448';
  ctx.fillRect(-span-1,         -wid-pillarExt-1, pillarW+2, 4);
  ctx.fillRect(-span-1,          wid+pillarExt-3, pillarW+2, 4);
  ctx.fillRect( span-pillarW-1, -wid-pillarExt-1, pillarW+2, 4);
  ctx.fillRect( span-pillarW-1,  wid+pillarExt-3, pillarW+2, 4);

  // Mortar stone-block pattern on pillars
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.7;
  for (let ry = -wid+3; ry < wid; ry += 5) {
    ctx.beginPath(); ctx.moveTo(-span+1,         ry); ctx.lineTo(-span+pillarW-1, ry); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(span-pillarW+1,  ry); ctx.lineTo(span-1,           ry); ctx.stroke();
  }

  // Diagonal cross-bracing between the pillars (visible truss work beneath the deck)
  ctx.strokeStyle = 'rgba(60,40,18,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-span+pillarW, -wid+2); ctx.lineTo(span-pillarW, wid-2);
  ctx.moveTo(-span+pillarW,  wid-2); ctx.lineTo(span-pillarW,-wid+2);
  ctx.stroke();

  // Bridge deck (between pillars)
  ctx.fillStyle = '#5a3e1a';
  ctx.fillRect(-span+pillarW, -wid, span*2-pillarW*2, wid*2);
  ctx.strokeStyle = '#7a5a28'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-span+pillarW, -wid, span*2-pillarW*2, wid*2);

  // Deck planking (transverse lines)
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6;
  for (let lx = -span+pillarW+3; lx < span-pillarW; lx += 5) {
    ctx.beginPath(); ctx.moveTo(lx, -wid+1); ctx.lineTo(lx, wid-1); ctx.stroke();
  }

  // Guardrail beams along both edges
  ctx.strokeStyle = '#b09040'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-span+1, -wid+2); ctx.lineTo(span-1, -wid+2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-span+1,  wid-2); ctx.lineTo(span-1,  wid-2); ctx.stroke();

  // Vertical balusters
  ctx.strokeStyle = '#d0b055'; ctx.lineWidth = 1.4;
  for (let lx = -span+pillarW+3; lx <= span-pillarW-3; lx += 8) {
    ctx.beginPath(); ctx.moveTo(lx, -wid+3); ctx.lineTo(lx, wid-3); ctx.stroke();
  }

  // Gold track rails along the bridge deck
  ctx.strokeStyle = '#e8c050'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-span+1, -5); ctx.lineTo(span-1, -5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-span+1,  5); ctx.lineTo(span-1,  5); ctx.stroke();

  ctx.restore();
}

function drawTrk(fid, tid, railCol, dim=false) {
  const fn = nodeById.get(fid), tn = nodeById.get(tid); if (!fn||!tn) return;
  const e  = edges.find(e=>(e.fromId===fid&&e.toId===tid)||(e.fromId===tid&&e.toId===fid));
  const hc = e && e.cpx !== null;
  ctx.globalAlpha = dim ? 0.55 : 1; ctx.lineCap='round';

  if (hc) {
    const S = [];
    for (let t=0; t<=1; t+=0.05) S.push(bpt(t,fn.x,fn.y,e.cpx,e.cpy,tn.x,tn.y));
    // Sleeper bed
    ctx.strokeStyle='#5a3a18'; ctx.lineWidth=15;
    ctx.beginPath(); ctx.moveTo(fn.x,fn.y); ctx.quadraticCurveTo(e.cpx,e.cpy,tn.x,tn.y); ctx.stroke();
    // Sleepers
    ctx.strokeStyle='#3e2810'; ctx.lineWidth=3.5;
    for (let i=1; i<S.length-1; i+=2) {
      const p=S[i], px=S[Math.max(0,i-1)], nx=S[Math.min(S.length-1,i+1)];
      const dx=nx.x-px.x, dy=nx.y-px.y, l=Math.sqrt(dx*dx+dy*dy)||1;
      ctx.beginPath();
      ctx.moveTo(p.x-dy/l*8.5,p.y+dx/l*8.5);
      ctx.lineTo(p.x+dy/l*8.5,p.y-dx/l*8.5);
      ctx.stroke();
    }
    // Rails
    ctx.strokeStyle=railCol; ctx.lineWidth=3.5;
    const OFF=5;
    ['left','right'].forEach(side=>{
      ctx.beginPath();
      S.forEach((p,i)=>{
        const px=S[Math.max(0,i-1)], nx=S[Math.min(S.length-1,i+1)];
        const dx=nx.x-px.x, dy=nx.y-px.y, l=Math.sqrt(dx*dx+dy*dy)||1;
        const ox=side==='left'?-dy/l*OFF:dy/l*OFF;
        const oy=side==='left'?dx/l*OFF:-dx/l*OFF;
        i===0?ctx.moveTo(p.x+ox,p.y+oy):ctx.lineTo(p.x+ox,p.y+oy);
      }); ctx.stroke();
    });
  } else {
    const dx=tn.x-fn.x, dy=tn.y-fn.y, l=Math.sqrt(dx*dx+dy*dy)||1;
    const nx=-dy/l, ny=dx/l;
    ctx.strokeStyle='#5a3a18'; ctx.lineWidth=15;
    ctx.beginPath(); ctx.moveTo(fn.x,fn.y); ctx.lineTo(tn.x,tn.y); ctx.stroke();
    ctx.strokeStyle='#3e2810'; ctx.lineWidth=3.5;
    const steps = Math.floor(l/20);
    for (let i=1; i<steps; i++) {
      const t=i/steps, mx=lerp(fn.x,tn.x,t), my=lerp(fn.y,tn.y,t);
      ctx.beginPath(); ctx.moveTo(mx+nx*8.5,my+ny*8.5); ctx.lineTo(mx-nx*8.5,my-ny*8.5); ctx.stroke();
    }
    ctx.strokeStyle=railCol; ctx.lineWidth=3.5;
    ctx.beginPath(); ctx.moveTo(fn.x+nx*5,fn.y+ny*5); ctx.lineTo(tn.x+nx*5,tn.y+ny*5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fn.x-nx*5,fn.y-ny*5); ctx.lineTo(tn.x-nx*5,tn.y-ny*5); ctx.stroke();
  }
  ctx.globalAlpha=1;
}

// Tunnel portal — rendered on top of the track so the road appears to pass OVER the train.
// The center spur crosses the road nearly vertically; we paint a road-colored patch over the
// track segment under the road, then draw stone arch portals at each road edge.
function drawTunnelPortal(bx, by) {
  const tw = 11;              // half-width of the track slot in the tunnel
  const ph = 16;              // portal arch stone height above/below road edge
  const roadT = by - ROAD_HALF_H;  // top edge of road
  const roadB = by + ROAD_HALF_H;  // bottom edge of road

  // Road-colored overlay covering the track where it runs under the road
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(bx - tw - 4, roadT, (tw + 4) * 2, ROAD_HALF_H * 2);
  // Restore road edge lines
  ctx.strokeStyle = '#e8c050'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx - tw - 4, roadT); ctx.lineTo(bx + tw + 4, roadT); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx - tw - 4, roadB); ctx.lineTo(bx + tw + 4, roadB); ctx.stroke();
  // Restore center dash
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx - tw - 4, by); ctx.lineTo(bx + tw + 4, by); ctx.stroke();
  ctx.setLineDash([]);

  // Stone portal blocks on each road edge (north + south)
  [roadT, roadB].forEach((ey, side) => {
    const dir = side === 0 ? -1 : 1;  // -1 = above road, +1 = below road
    // Stone surround
    ctx.fillStyle = '#6a4820';
    ctx.fillRect(bx - tw - 5, ey, (tw + 5) * 2, dir * ph);
    // Lighter cap
    ctx.fillStyle = '#9a7448';
    ctx.fillRect(bx - tw - 6, ey, (tw + 6) * 2, dir * 3);
    // Mortar lines
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.7;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(bx - tw - 5, ey + dir * i * 4);
      ctx.lineTo(bx + tw + 5, ey + dir * i * 4);
      ctx.stroke();
    }
    // Dark tunnel opening (arch) in the center
    ctx.fillStyle = '#0c0c14';
    const archW = tw - 1;
    const archH = Math.abs(dir * ph) - 4;
    ctx.beginPath();
    ctx.ellipse(bx, ey + dir * (archH * 0.5 + 3), archW, archH * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // Gold rail stubs entering the tunnel
    ctx.strokeStyle = '#e8c050'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(bx - 5, ey); ctx.lineTo(bx - 5, ey + dir * (ph - 3)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + 5, ey); ctx.lineTo(bx + 5, ey + dir * (ph - 3)); ctx.stroke();
  });
}

function drawCrossWarn() {
  CX.forEach(c=>{
    const near = trains.filter(t=>t.state==='looping'&&dst(t.vx,t.vy,c.x,c.y)<85).length;
    ctx.strokeStyle='rgba(255,200,50,0.18)'; ctx.lineWidth=1.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(c.x-7,c.y-7); ctx.lineTo(c.x+7,c.y+7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.x+7,c.y-7); ctx.lineTo(c.x-7,c.y+7); ctx.stroke();
    if (near>=2){
      const p=0.5+0.5*Math.sin(fc*0.2);
      ctx.strokeStyle=`rgba(255,50,30,${0.5+p*0.5})`; ctx.lineWidth=3; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.arc(c.x,c.y,24+p*5,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle=`rgba(255,200,0,${0.8+p*0.2})`; ctx.font='bold 13px Arial'; ctx.textAlign='center';
      ctx.fillText('⚠',c.x,c.y-30); ctx.textAlign='left';
    }
  });
  // Road danger warning — near either level crossing (skip bridge zones)
  if (!gateOn) {
    [GATE_XA, GATE_XB].forEach(gx => {
      const nearCrossing = trains.filter(t =>
        t.state==='looping' &&
        Math.abs(t.vy-RY) < 70 &&
        Math.abs(t.vx-gx) < 110
      ).length;
      if (nearCrossing > 0) {
        const p = 0.5+0.5*Math.sin(fc*0.28);
        ctx.fillStyle=`rgba(255,150,0,${p*0.22})`;
        ctx.fillRect(gx-95, RY-ROAD_HALF_H-4, 190, ROAD_HALF_H*2+8);
      }
    });
  }
}

function drawGate() {
  drawLevelCrossing(GATE_XA, RY);
  drawLevelCrossing(GATE_XB, RY);
}

function drawLevelCrossing(gx, gy) {
  // Signal posts (extend past the wider road)
  const postH = ROAD_HALF_H + 18;
  ctx.fillStyle = '#555';
  ctx.fillRect(gx-3, gy-postH, 5, postH);  // top post
  ctx.fillRect(gx-3, gy,       5, postH);  // bottom post

  if (gateOn) {
    const p = 0.55 + 0.45*Math.sin(fc*0.28);
    // Flashing red signal lights on top of posts
    ctx.shadowColor = 'red'; ctx.shadowBlur = 14;
    ctx.fillStyle = `rgba(255,20,20,${p})`;
    ctx.beginPath(); ctx.arc(gx, gy-postH-2, 6, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx, gy+postH+2, 6, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    // Arms drop across the road — top arm at upper edge, bottom at lower edge
    const armLen = 84;
    const topArmY = gy - ROAD_HALF_H - 8;
    const botArmY = gy + ROAD_HALF_H;
    ctx.fillStyle = `rgba(225,35,35,${0.85 + p*0.15})`;
    ctx.fillRect(gx - armLen, topArmY, armLen, 8);  // top-left arm
    ctx.fillRect(gx + 2,      botArmY, armLen, 8);  // bottom-right arm

    // Diagonal white/red stripes on arms
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(gx - armLen + i*14, topArmY, 6, 8);
      ctx.fillRect(gx + 2 + i*14,      botArmY, 6, 8);
    }
    // Arm tips
    ctx.fillStyle = `rgba(225,35,35,${0.85+p*0.15})`;
    ctx.beginPath(); ctx.arc(gx - armLen, topArmY+4, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx + armLen + 2, botArmY+4, 4, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(50,220,70,0.85)';
    ctx.beginPath(); ctx.arc(gx, gy-postH-2, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx, gy+postH+2, 5, 0, Math.PI*2); ctx.fill();
  }
}

// ── Node Rendering ───────────────────────────────────────────────────────────
function drawNodes() {
  nodes.forEach(n => {
    if (n.type==='depot')    drawDepot(n);
    else if (n.type==='cargo')    drawCargoStn(n);
    else if (n.type==='junction') drawJct(n);
    // waypoints not drawn (invisible track points)
  });
}

function drawCargoStn(n) {
  const isPassenger = n.id === 'pStn';
  const used = stationsUsed[n.id] || 0;
  const remaining = Math.max(0, STATION_MAX - used);
  const loading = trains.find(t => t.state==='loading' && dst(t.vx,t.vy,n.x,n.y)<30);
  const themeCol  = isPassenger ? '#5078b8' : '#c08040';
  const accentCol = isPassenger ? '#3050a0' : '#5a3010';
  const roofCol   = isPassenger ? '#3a5a90' : '#8c5828';
  const label     = isPassenger ? 'PASSENGER' : 'CARGO';
  const icon      = isPassenger ? '👥' : '📦';

  // Loading platform
  ctx.fillStyle = '#1c1c1c';
  rr(n.x-38, n.y-4, 76, 22, 4); ctx.fill();
  ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 1.2;
  rr(n.x-38, n.y-4, 76, 22, 4); ctx.stroke();
  // Building body
  ctx.fillStyle = themeCol;
  rr(n.x-34, n.y-26, 68, 28, 3); ctx.fill();
  ctx.strokeStyle = loading ? '#FFD700' : accentCol; ctx.lineWidth = 2.5;
  rr(n.x-34, n.y-26, 68, 28, 3); ctx.stroke();
  // Roof
  ctx.fillStyle = roofCol;
  ctx.beginPath();
  ctx.moveTo(n.x-38, n.y-26);
  ctx.lineTo(n.x-32, n.y-36);
  ctx.lineTo(n.x+32, n.y-36);
  ctx.lineTo(n.x+38, n.y-26);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=0.8; ctx.stroke();
  // Center "door" (bay door for cargo, glass entrance for passenger)
  if (isPassenger) {
    ctx.fillStyle = '#bee0ff';
    ctx.fillRect(n.x-12, n.y-22, 24, 22);
    ctx.strokeStyle = '#1a1a1a'; ctx.strokeRect(n.x-12, n.y-22, 24, 22);
    // Glass divisions
    ctx.strokeStyle = '#5078b8'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(n.x, n.y-22); ctx.lineTo(n.x, n.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(n.x-12, n.y-11); ctx.lineTo(n.x+12, n.y-11); ctx.stroke();
    // A waiting passenger silhouette
    ctx.fillStyle = '#222';
    ctx.fillRect(n.x-2, n.y-9, 4, 8);
    ctx.beginPath(); ctx.arc(n.x, n.y-11, 2, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = '#3a2a18';
    ctx.fillRect(n.x-12, n.y-22, 24, 22);
    ctx.strokeStyle = '#1a1a1a'; ctx.strokeRect(n.x-12, n.y-22, 24, 22);
    ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=0.7;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(n.x-12, n.y-22+i*5.5); ctx.lineTo(n.x+12, n.y-22+i*5.5); ctx.stroke();
    }
  }
  // Side windows
  ctx.fillStyle = '#ffeb8a';
  ctx.fillRect(n.x-28, n.y-20, 6, 6);
  ctx.fillRect(n.x+22, n.y-20, 6, 6);
  // Label
  ctx.fillStyle = isPassenger ? '#88ccff' : '#FFD700';
  ctx.font='bold 9px Arial'; ctx.textAlign='center';
  ctx.fillText(label, n.x, n.y-30);
  // Capacity badge (remaining pickups)
  const empty = remaining === 0;
  ctx.fillStyle = empty ? '#5a1010' : '#1a1a1a';
  rr(n.x+14, n.y-44, 28, 14, 3); ctx.fill();
  ctx.strokeStyle = empty ? '#ff5050' : (isPassenger ? '#88ccff' : '#FFD700');
  ctx.lineWidth = 1.2;
  rr(n.x+14, n.y-44, 28, 14, 3); ctx.stroke();
  ctx.fillStyle = empty ? '#ff8080' : '#FFD700';
  ctx.font='bold 9px Arial';
  ctx.fillText(empty ? 'EMPTY' : `${icon} ${remaining}`, n.x+28, n.y-34);
  ctx.textAlign='left';
  // Loading animation
  if (loading) {
    const p = (fc - loading.loadStart) / 132; // ~2.2s @60fps
    const frac = Math.min(1, p);
    ctx.fillStyle='#2a2a2a';
    ctx.fillRect(n.x-26, n.y+22, 52, 6);
    ctx.fillStyle = loading.color;
    ctx.fillRect(n.x-26, n.y+22, 52*frac, 6);
    ctx.strokeStyle = isPassenger ? '#88ccff' : '#FFD700'; ctx.lineWidth=1;
    ctx.strokeRect(n.x-26, n.y+22, 52, 6);
    // Icon hopping
    const hop = Math.abs(Math.sin(fc*0.25))*3;
    ctx.font='14px Arial'; ctx.textAlign='center';
    ctx.fillStyle='#fff';
    ctx.fillText(icon, n.x, n.y-46-hop);
    ctx.textAlign='left';
  }
}

function drawDepot(n) {
  const occ = trains.some(t=>t.state==='sleeping'&&dst(t.vx,t.vy,n.x,n.y)<30);
  const fc2 = occ ? trains.find(t=>t.state==='sleeping'&&dst(t.vx,t.vy,n.x,n.y)<30) : null;
  const accentCol = fc2 ? fc2.color : '#aaa';
  if (occ){ ctx.shadowColor=accentCol; ctx.shadowBlur=20; }
  // Station building
  ctx.fillStyle='#2c1a08'; ctx.strokeStyle=occ?accentCol:'#7a6a50'; ctx.lineWidth=3;
  rr(n.x-32,n.y-20,64,40,8); ctx.fill(); ctx.stroke();
  // Roof
  ctx.fillStyle=(occ?accentCol:'#888')+'88';
  ctx.beginPath(); ctx.moveTo(n.x-36,n.y-20); ctx.lineTo(n.x,n.y-42); ctx.lineTo(n.x+36,n.y-20); ctx.closePath(); ctx.fill();
  ctx.shadowBlur=0;
  // Label
  ctx.fillStyle='white'; ctx.font='bold 9px Arial'; ctx.textAlign='center';
  ctx.fillText('DEPOT',n.x,n.y+4);
  if (occ){ ctx.font='16px Arial'; ctx.fillText('😴',n.x,n.y-44); }
  ctx.textAlign='left';
}

function drawJct(n) {
  const kbSelected = junctionNodes.indexOf(n) === selJctIdx && selJctIdx >= 0;
  if (kbSelected) {
    const p = 0.5+0.5*Math.sin(fc*0.3);
    ctx.strokeStyle=`rgba(80,200,255,${0.6+p*0.4})`; ctx.lineWidth=4;
    ctx.setLineDash([5,3]);
    ctx.beginPath(); ctx.arc(n.x,n.y,26,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (n.pt>0){
    const a=n.pt/22;
    ctx.strokeStyle=`rgba(255,215,0,${a*0.85})`; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(n.x,n.y,22+(1-a)*12,0,Math.PI*2); ctx.stroke(); n.pt--;
  }
  ctx.fillStyle='#1e2e10'; ctx.strokeStyle='#e8c050'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.arc(n.x,n.y,15,0,Math.PI*2); ctx.fill(); ctx.stroke();
  [{id:n.branchA,active:n.sw===0},{id:n.branchB,active:n.sw===1}].forEach(b=>{
    if(!b.id) return;
    const bn=nodeById.get(b.id); if(!bn) return;
    const dx=bn.x-n.x, dy=bn.y-n.y, l=Math.sqrt(dx*dx+dy*dy)||1;
    ctx.strokeStyle=b.active?'#FFD700':'rgba(255,255,255,0.2)';
    ctx.lineWidth=b.active?4:1.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(n.x,n.y); ctx.lineTo(n.x+dx/l*14,n.y+dy/l*14); ctx.stroke();
    if(b.active){
      const ax=n.x+dx/l*14, ay=n.y+dy/l*14, px=-dy/l, py=dx/l;
      ctx.fillStyle='#FFD700';
      ctx.beginPath(); ctx.moveTo(ax+dx/l*5,ay+dy/l*5);
      ctx.lineTo(ax+px*4-dx/l*2,ay+py*4-dy/l*2);
      ctx.lineTo(ax-px*4-dx/l*2,ay-py*4-dy/l*2); ctx.closePath(); ctx.fill();
    }
  });
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='bold 8px Arial'; ctx.textAlign='center';
  ctx.fillText('S',n.x,n.y+3); ctx.textAlign='left';
}

// ── Particle Rendering ───────────────────────────────────────────────────────
function drawPfx() {
  particles.forEach(p=>{
    ctx.globalAlpha=Math.max(0,p.life);
    if(p.type==='smoke'){
      const g=Math.floor(150+80*p.life);
      ctx.fillStyle=`rgb(${g},${g},${g})`;
    } else {
      ctx.fillStyle=p.col;
    }
    ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.1,p.r),0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;
}

// ── Train Rendering ──────────────────────────────────────────────────────────
function drawTrains() {
  trains.forEach(t=>{
    if(t.state==='sleeping'){
      drawLoco(t,t.vx,t.vy,0,0.45); return;
    }
    if(t.state==='loading' || t.state==='unloading'){
      drawLoco(t,t.vx,t.vy,t.ang||0,1);
      return;
    }
    if(t.state==='crashed') return;
    const al=t.state==='stopped'?0.6:1;
    const h=t.hist;
    const GAP = 48; // px between loco centre and each car centre
    const p1 = histAt(h, GAP);
    const p2 = histAt(h, GAP*2);
    if (p2) drawCar(t, p2.x, p2.y, p2.ang, al);
    if (p1) drawCar(t, p1.x, p1.y, p1.ang, al);
    drawLoco(t,t.vx,t.vy,t.ang,al);
    if(t.wt>0){
      const pw=t.wt/10;
      ctx.strokeStyle=`rgba(255,120,0,${pw})`; ctx.lineWidth=2.5; ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.arc(t.vx,t.vy,23,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
    }
    if(t.sel){
      const ps=0.5+0.5*Math.sin(fc*0.2);
      ctx.strokeStyle=`rgba(255,255,255,${0.45+ps*0.55})`; ctx.lineWidth=2.5; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.arc(t.vx,t.vy,24,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
    }
  });
}

function drawLoco(t,x,y,ang,al){
  ctx.save(); ctx.translate(x,y); ctx.rotate(ang); ctx.globalAlpha=al;
  // Shadow
  ctx.fillStyle='rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(2,8,18,5,0,0,Math.PI*2); ctx.fill();
  // Body
  ctx.fillStyle=t.color; rr(-19,-10,38,20,6); ctx.fill();
  // Cab
  ctx.fillStyle=DARK[t.cn]; rr(10,-12,12,20,3); ctx.fill();
  // Window
  ctx.fillStyle='#cceeff'; ctx.fillRect(12,-10,8,8);
  // Chimney
  ctx.fillStyle='#333'; ctx.fillRect(-12,-17,9,8); ctx.fillRect(-14,-19,13,4);
  // Wheels
  ctx.fillStyle='#111';
  [[-12,11],[6,11],[-12,-11],[6,-11]].forEach(([wx,wy])=>{
    ctx.beginPath(); ctx.arc(wx,wy,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#555'; ctx.beginPath(); ctx.arc(wx,wy,2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#111';
  });
  // Headlight arrow
  ctx.fillStyle='rgba(255,255,200,0.95)';
  ctx.beginPath(); ctx.moveTo(23,0); ctx.lineTo(16,-6); ctx.lineTo(16,6); ctx.closePath(); ctx.fill();
  // Label
  ctx.fillStyle='rgba(255,255,255,0.92)'; ctx.font='bold 8px Arial'; ctx.textAlign='center';
  ctx.fillText(t.cn.slice(0,3).toUpperCase(),0,1);
  // Cargo / passenger indicator on top of the loco when loaded
  if (t.cargo) {
    if (t.cargo.from === 'cStn') {
      // Wooden cargo crate
      ctx.fillStyle = '#8a5a30';
      ctx.fillRect(-6, -18, 12, 6);
      ctx.strokeStyle = '#4a2810'; ctx.lineWidth = 0.8;
      ctx.strokeRect(-6, -18, 12, 6);
      ctx.beginPath(); ctx.moveTo(-6, -15); ctx.lineTo(6, -15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, -12); ctx.stroke();
    } else {
      // Passenger box (white with windows)
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(-6, -18, 12, 6);
      ctx.strokeStyle = '#3070d0'; ctx.lineWidth = 0.8;
      ctx.strokeRect(-6, -18, 12, 6);
      ctx.fillStyle = '#88c8ff';
      ctx.fillRect(-5, -17, 3, 2); ctx.fillRect(-1, -17, 3, 2); ctx.fillRect(3, -17, 2, 2);
    }
  }
  ctx.globalAlpha=1; ctx.restore();
}

function drawCar(t,x,y,ang,al){
  ctx.save(); ctx.translate(x,y); ctx.rotate(ang); ctx.globalAlpha=al*0.85;
  ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(1,7,15,4,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=DARK[t.cn]; rr(-16,-8,32,16,5); ctx.fill();
  ctx.strokeStyle=t.color; ctx.lineWidth=1.5; rr(-16,-8,32,16,5); ctx.stroke();
  ctx.fillStyle='rgba(180,220,255,0.55)'; ctx.fillRect(-12,-6,9,6); ctx.fillRect(3,-6,9,6);
  ctx.fillStyle='#111';
  [[-10,9],[6,9],[-10,-9],[6,-9]].forEach(([wx,wy])=>{
    ctx.beginPath(); ctx.arc(wx,wy,3.5,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1; ctx.restore();
}

// ── Input ─────────────────────────────────────────────────────────────────────
function cxy(e){
  const r=canvas.getBoundingClientRect(), sx=W/r.width, sy=H/r.height;
  const s=e.touches?e.touches[0]:e;
  return [(s.clientX-r.left)*sx,(s.clientY-r.top)*sy];
}

function onClick(e){
  e.preventDefault();
  const [cx,cy]=cxy(e);
  let hit=null;
  trains.forEach(t=>{if(dst(cx,cy,t.vx,t.vy)<26)hit=t;});
  if(hit){selTrain(hit.id);return;}
  nodes.forEach(n=>{
    if(n.type==='junction'&&dst(cx,cy,n.x,n.y)<22){n.sw=1-n.sw;n.pt=22;playC();}
  });
}

canvas.addEventListener('click',onClick);
canvas.addEventListener('touchend',onClick,{passive:false});
document.addEventListener('keydown',e=>{
  if(e.code==='ArrowUp'  ||e.code==='KeyF'){e.preventDefault();doF();}
  if(e.code==='ArrowDown'||e.code==='KeyS'){e.preventDefault();doS();}
  if(e.code==='KeyX'){e.preventDefault();doX();}
  if(e.code==='KeyG'||e.code==='KeyP'){e.preventDefault();toggleGate();}  // P or G
  if(e.code==='Space'){e.preventDefault();cycleTrains();}                  // Space cycles trains
  if(e.code==='ArrowLeft'){e.preventDefault();cycleJunction(-1);}   // ← select prev junction
  if(e.code==='ArrowRight'){e.preventDefault();cycleJunction(1);}   // → select next junction
  if(e.code==='KeyC'){e.preventDefault();toggleSelJct();}           // C toggles selected junction
  if(e.code==='KeyD'){e.preventDefault();toggleDrawbridge();}       // D toggles drawbridge
  const idx=['1','2','3','4'].indexOf(e.key);
  if(idx>=0&&trains[idx])selTrain(trains[idx].id);
});

document.getElementById('bf').addEventListener('click',doF);
document.getElementById('bs').addEventListener('click',doS);
document.getElementById('bx').addEventListener('click',doX);
document.getElementById('bg').addEventListener('click',toggleGate);

function cycleTrains() {
  const active = trains.filter(t => !['sleeping','crashed'].includes(t.state));
  if (active.length === 0) return;
  const cur = active.findIndex(t => t.id === selId);
  selTrain(active[(cur+1) % active.length].id);
}

function cycleJunction(dir) {
  if (junctionNodes.length === 0) return;
  selJctIdx = ((selJctIdx < 0 ? 0 : selJctIdx) + dir + junctionNodes.length) % junctionNodes.length;
  playP(); // soft click to confirm selection, no toggle
}

function toggleSelJct() {
  if (selJctIdx < 0 || selJctIdx >= junctionNodes.length) return;
  const n = junctionNodes[selJctIdx];
  n.sw = 1 - n.sw; n.pt = 22; playC();
}

function selTrain(id){
  selId=id; trains.forEach(t=>t.sel=t.id===id); upPanel(); playP();
}
const selT=()=>trains.find(t=>t.id===selId)||null;

function doF(){
  const t=selT(); if(!t||['sleeping','crashed'].includes(t.state))return;
  t.si=Math.min(4,t.si+1);
  if(t.state==='stopped'&&t.si>0)t.state='looping';
}
function doS(){
  const t=selT(); if(!t||['sleeping','crashed'].includes(t.state))return;
  t.si=Math.max(1,t.si-1);
}
function doX(){
  trains.forEach(t=>{if(t.state==='looping'){t.si=0;t.state='stopped';}});
  flash('All trains stopped'); playC();
}
function toggleGate(){
  gateOn=!gateOn;
  const b=document.getElementById('bg');
  b.textContent=gateOn?'🔴 GATE ON':'🚧 GATE';
  b.style.background=gateOn?'#c0392b':'#d4860a';
  playC();
}
function toggleDrawbridge(){
  bridgeOpen=!bridgeOpen;
  flash(bridgeOpen ? '⛵ Drawbridge UP — ships pass, trains stop!' : '🚂 Drawbridge DOWN — trains pass!');
  playC();
}

// ── Panel ──────────────────────────────────────────────────────────────────
function upPanel(){
  const t=selT(), lbl=document.getElementById('tlabel');
  if(t&&t.state!=='crashed'){
    lbl.textContent=t.cn.toUpperCase()+' train';
    lbl.style.color=t.color;
  } else {
    lbl.textContent='Tap a train!';
    lbl.style.color='#a0c848';
  }
  document.getElementById('bf').disabled=!t||['sleeping','crashed'].includes(t?.state);
  document.getElementById('bs').disabled=!t||['sleeping','crashed'].includes(t?.state);

  // Speed indicator (■ per speed level)
  const spi=document.getElementById('spi');
  if(t&&!['sleeping','crashed'].includes(t.state)){
    spi.innerHTML=Array.from({length:4},(_,i)=>
      `<span style="color:${i<t.si?t.color:'#3a5030'}">■</span>`).join('');
  } else spi.innerHTML='';

  // Train status dots
  document.getElementById('sd').innerHTML=trains.map(tr=>{
    let ic;
    if (tr.state==='sleeping')        ic='😴';
    else if (tr.state==='stopped')    ic='⏸';
    else if (tr.state==='crashed')    ic='💥';
    else if (tr.state==='loading')    ic='📥';
    else if (tr.state==='unloading')  ic='📤';
    else if (tr.cargo)                ic = tr.cargo.from==='cStn' ? '📦' : '👥';
    else                              ic='▶';
    return`<div class="dot" style="background:${tr.color};border-color:${tr.sel?'white':'rgba(255,255,255,0.2)'}">${ic}</div>`;
  }).join('');

  // Score + cargo progress
  const sc=document.getElementById('sc');
  if(sc) sc.textContent=`★ ${Math.floor(score/60)}  📦 ${cargoCount}/${CARGO_GOAL}`;
}

function drawWinOverlay() {
  ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0,0,W,H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFD700'; ctx.font = 'bold 48px Arial';
  ctx.fillText('CONGRATULATIONS!', W/2, H/2 - 56);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px Arial';
  ctx.fillText(`📦 ${CARGO_GOAL} cargo deliveries complete!`, W/2, H/2 - 12);
  ctx.fillStyle = '#a0c848'; ctx.font = 'bold 20px Arial';
  ctx.fillText(`Final Score: ★ ${Math.floor(score/60)}`, W/2, H/2 + 24);
  ctx.fillStyle = '#ddd'; ctx.font = '15px Arial';
  ctx.fillText(`Trains rested: ${sleepCount}`, W/2, H/2 + 50);
  ctx.fillStyle = '#88ccff'; ctx.font = '16px Arial';
  ctx.fillText('Starting new game...', W/2, H/2 + 82);
  ctx.textAlign = 'left';
}

// ── Flash ──────────────────────────────────────────────────────────────────
let _ft=null;
function flash(txt){
  const l=document.getElementById('tlabel'),pv=l.textContent,pc=l.style.color;
  l.textContent=txt; l.style.color='#f39c12';
  clearTimeout(_ft); _ft=setTimeout(()=>{l.textContent=pv;l.style.color=pc;},2800);
}

// ── Sound ──────────────────────────────────────────────────────────────────
let _ac=null;
const ac=()=>{if(!_ac)_ac=new(window.AudioContext||window.webkitAudioContext)();return _ac;};
function beep(f,d,tp='square',v=0.12,dl=0){
  try{
    const a=ac(),o=a.createOscillator(),g=a.createGain();
    o.connect(g);g.connect(a.destination);o.type=tp;o.frequency.value=f;
    const t=a.currentTime+dl;
    g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.001,t+d);
    o.start(t);o.stop(t+d+.01);
  }catch(_){}
}
function playC(){beep(440,.08);}
function playP(){beep(523,.07,'sine',.1);}
function playA(){beep(880,.12,'sine',.18);beep(1047,.3,'sine',.18,.14);}
function playB(){beep(80,.4,'sawtooth',.28);beep(55,.55,'sawtooth',.22,.1);}
// Realistic car horn — two simultaneous tones (classic major-third "honk")
// with sawtooth + square layering, slight detune, attack/sustain/release envelope.
function playHonk() {
  try {
    const a = ac();
    const t = a.currentTime;
    const dur = 0.35;
    const master = a.createGain();
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(0.18, t + 0.02);
    master.gain.setValueAtTime(0.18, t + dur - 0.07);
    master.gain.exponentialRampToValueAtTime(0.001, t + dur);
    master.connect(a.destination);
    // Slight low-pass for warmth
    const lpf = a.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 2400; lpf.Q.value = 0.7;
    lpf.connect(master);
    // Two-tone horn: A4 (440) + C#5 (554) major third — classic horn voicing
    [[440, 0.55, 'sawtooth'],
     [554, 0.45, 'sawtooth'],
     [442, 0.30, 'square'],
     [556, 0.25, 'square']].forEach(([freq, vol, type]) => {
      const osc = a.createOscillator();
      osc.type = type; osc.frequency.value = freq;
      const g = a.createGain(); g.gain.value = vol;
      osc.connect(g); g.connect(lpf);
      osc.start(t); osc.stop(t + dur + 0.02);
    });
  } catch(_) {}
}

// ── Start ──────────────────────────────────────────────────────────────────
init();
requestAnimationFrame(loop);

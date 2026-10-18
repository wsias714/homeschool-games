'use strict';
// Headless smoke test for Dino Roar.
// Stubs the browser APIs, loads game.js, turns on AUTOPLAY, and drives the loop
// until the WIN state is reached — asserting no exceptions and that all 5
// sectors get cleared through DRIVE + DEFEND.  Run:  node smoke-test.js

// ── Stub a no-op 2D canvas context ──────────────────────────────────────────
const noop = () => {};
const ctxStub = new Proxy({}, {
  get(_, prop){
    if (prop === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (prop === 'measureText') return () => ({ width: 0 });
    return noop;
  },
  set(){ return true; },
});
const fakeEl = {
  getContext: () => ctxStub,
  addEventListener: noop,
  style: {},
  textContent: '', innerHTML: '',
  blur: noop,
};

// ── Stub globals before requiring the game ──────────────────────────────────
global.document = { getElementById: () => fakeEl };
global.window = {};                 // AudioContext stays undefined → beep()s no-op
global.addEventListener = noop;
// deliberately leave requestAnimationFrame undefined so game.js exports instead of looping

const game = require('./game.js');

// ── Drive ───────────────────────────────────────────────────────────────────
game.setAutoplay(true);

const MAX_FRAMES = 80000;     // generous ceiling (~22 min of game time)
const DT = 16.67;
let reachedWin = false;
let sectorsSeenInDefend = new Set();
let flightSectorsSeen = new Set();
let lastMode = '';

try {
  for (let f = 1; f <= MAX_FRAMES; f++){
    game.loop(f * DT);
    const s = game.state();
    if (s.mode === 'defend') sectorsSeenInDefend.add(s.curSector);
    if (s.mode === 'flight') flightSectorsSeen.add(s.curSector);
    if (s.mode !== lastMode){ lastMode = s.mode; }
    if (s.mode === 'win'){ reachedWin = true;
      console.log(`✓ WIN reached at frame ${f} (~${Math.round(f*DT/1000)}s game time)`);
      console.log(`  scores: P1 ${s.score[0]}  P2 ${s.score[1]}  lab left: ${s.labHP.toFixed(1)}`);
      break;
    }
  }
} catch (e){
  console.error('✗ EXCEPTION during play:', e && e.stack || e);
  process.exit(1);
}

// ── Assert ──────────────────────────────────────────────────────────────────
let ok = true;
if (!reachedWin){ console.error(`✗ never reached WIN within ${MAX_FRAMES} frames (stuck in "${lastMode}")`); ok = false; }
const expectedSectors = [0,1,2,3,4];
for (const i of expectedSectors){ if (!sectorsSeenInDefend.has(i)){ console.error(`✗ sector ${i+1} defend never ran`); ok = false; } }
for (const i of [2,3]){ if (!flightSectorsSeen.has(i)){ console.error(`✗ sector ${i+1} flight transit never ran`); ok = false; } }
if (ok){
  console.log(`✓ all ${expectedSectors.length} sectors ran DRIVE + DEFEND, no exceptions`);
  console.log('SMOKE TEST PASSED');
  process.exit(0);
} else {
  console.log('SMOKE TEST FAILED');
  process.exit(1);
}

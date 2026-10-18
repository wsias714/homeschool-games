// Player names come from the local server's /names.js (private). Public default is Player 1/2/3.
var PN = Object.assign({ P1: 'Player 1', P2: 'Player 2', P3: 'Player 3' }, (typeof window !== 'undefined' && window.PLAYER_NAMES) || {});
/* ============================================================
   CANNON BATTLE
   A harbour battle map: a numbered grid of columns and rows laid
   over the water, tall ships anchored (or, from level 3 on,
   slowly drifting) across three consecutive cells -- Battleship
   style, horizontal or vertical. Dial in POWDER SCOOPS (the
   column) and ELEVATION NOTCHES (the row) to name the exact cell
   a ship sits on, and fire.

   Five levels, five real Caribbean ports, each a bigger grid with
   more ships and (from level 3) a slow drift the boys have to
   lead with a FUSE dial -- "the ship will be two squares over by
   the time this lands."

   Pure grid/fleet logic (no DOM) lives above the DOM-wiring block
   below so smoke-test.js can require() this file headlessly in
   Node -- same split used in times-tables/game.js and
   sound-it-out/game.js.
   ============================================================ */

// ---------- TUNABLES (safe to fiddle with mid-session) ----------
var TUNE = {
  PLAYERS:         ['P1', 'P2'],
  PLAYER_COLORS:   { P1: '#7cc9ff', P2: '#ff9f7c' },

  MAX_POWDER:      9,   // physical cap on powder scoops -- the grid is never wider than this
  MAX_FUSE:        3,   // most move-ticks a shot can be delayed
  FORT_WALLS:      5,
  BROADSIDE_MS:    18000,
  SHIP_CELLS:      3,   // every ship is 3 cells, Battleship-style

  // The powder cap is what makes cannon choice matter: it limits which
  // COLUMNS a cannon can reach (a 6-pounder can't hit the far side of a
  // wide map), not an abstract "range" -- a real spatial trade-off.
  //
  // Invariant: every reloadMs here must stay >= the longest possible
  // impactFlightDurationMs() for that cannon's level (worst case: fuse
  // MAX_FUSE, fired right at a step boundary, on the slowest-moving level
  // that unlocks the cannon). The trigger is locked for the full reload,
  // not just until the ball lands -- if reload ever finished before an
  // earlier shot's ball had landed, two of that ship's segments could be
  // in flight at once and both apply a hit to the same still-unhit
  // segment. Not reachable today (max flight is ~4-12s at fuse 3, well
  // under any reloadMs below), but worth checking again before shortening
  // a reload time or lengthening MAX_FUSE / a level's moveEverySec.
  CANNONS: [
    { id: 'six',        label: '6-POUNDER',  maxPowder: 4, reloadMs: 3000 },
    { id: 'twelve',     label: '12-POUNDER', maxPowder: 6, reloadMs: 5000 },
    { id: 'twentyfour', label: '24-POUNDER', maxPowder: 9, reloadMs: 8000 }
  ],

  // Five real Caribbean ports, each a bigger board than the last. `cols`
  // never exceeds the best unlocked cannon's maxPowder for that level, so
  // every column is always reachable by something -- see the solvability
  // smoke tests. Movement (`moving`) only turns on from level 3.
  LEVELS: [
    {
      id: 1, name: 'Nassau, Bahamas', city: 'Nassau', country: 'The Bahamas',
      fact: 'Nassau is the capital of the Bahamas, on an island called New Providence.',
      cols: 6, rows: 2, shipsPerFleet: 1,
      cannons: ['twelve'], moving: false, moveEverySec: 0
    },
    {
      id: 2, name: 'Havana, Cuba', city: 'Havana', country: 'Cuba',
      fact: 'Havana is the capital of Cuba and one of the oldest cities in the Americas, founded in 1519.',
      cols: 6, rows: 4, shipsPerFleet: 2,
      cannons: ['twelve', 'six'], moving: false, moveEverySec: 0
    },
    {
      id: 3, name: 'San Juan, Puerto Rico', city: 'San Juan', country: 'Puerto Rico',
      fact: "San Juan's fort El Morro is one of the oldest built anywhere in the Americas.",
      cols: 8, rows: 5, shipsPerFleet: 3,
      cannons: ['twelve', 'six', 'twentyfour'], moving: true, moveEverySec: 4
    },
    {
      id: 4, name: 'Port Royal, Jamaica', city: 'Port Royal', country: 'Jamaica',
      fact: 'Port Royal was once one of the most famous pirate havens in the whole Caribbean.',
      cols: 8, rows: 6, shipsPerFleet: 4,
      cannons: ['twelve', 'six', 'twentyfour'], moving: true, moveEverySec: 3
    },
    {
      id: 5, name: 'Bridgetown, Barbados', city: 'Bridgetown', country: 'Barbados',
      fact: 'Barbados is the easternmost major island in the whole Caribbean Sea.',
      cols: 9, rows: 7, shipsPerFleet: 5,
      cannons: ['twelve', 'six', 'twentyfour'], moving: true, moveEverySec: 2
    }
  ]
};

// Every ship in a fleet flies its own sail colour, so a boy who can't read
// the name can still be told "aim for the purple one". Each colour has its
// own pool of names that match it, and a fleet's Nth ship always gets the
// Nth colour -- the red ship is always the first one, on every board.
var SHIP_COLORS = [
  { key: 'red',    sail: '#d8412f', names: ['Red Dragon', 'Crimson Wake', 'Ruby Crab', 'Scarlet Shark'] },
  { key: 'green',  sail: '#2f9e5b', names: ['Green Turtle', 'Jade Serpent', 'Emerald Eel', 'Sea Rover'] },
  { key: 'purple', sail: '#7b4fd0', names: ['Purple Parrot', 'Violet Storm', 'Plum Kraken', 'Lilac Lobster'] },
  { key: 'orange', sail: '#f08a24', names: ['Orange Octopus', 'Amber Galleon', 'Sunset Sloop', 'Tangerine Tern'] },
  { key: 'black',  sail: '#2b2b35', names: ['Black Gull', 'Night Heron', 'Iron Whale', 'Midnight Sparrow'] }
];

// ---------- PURE GRID / FLEET LOGIC ----------
function levelFor(id) {
  var i = Math.max(1, Math.min(id, TUNE.LEVELS.length));
  return TUNE.LEVELS[i - 1];
}

function cannonFor(id) {
  for (var i = 0; i < TUNE.CANNONS.length; i++) {
    if (TUNE.CANNONS[i].id === id) return TUNE.CANNONS[i];
  }
  return null;
}

function maxPowderFor(id) {
  var c = cannonFor(id);
  return c ? c.maxPowder : 0;
}

// A deterministic triangle-wave bounce in [0, range] -- used to drift a
// ship back and forth within the room it has to move, without ever
// leaving the grid. range <= 0 means "no room to move" -> stays put.
function bounceOffset(steps, range) {
  if (range <= 0) return 0;
  var period = range * 2;
  var m = ((steps % period) + period) % period;
  return m <= range ? m : period - m;
}

// The ship's 3 cells at a given number of whole move-ticks since its
// fleet spawned. Static ships (moving:false) ignore `steps` entirely --
// this is also what makes a FUSE-delayed shot's future impact point
// computable in advance, not just observable after the fact.
function shipCellsAtSteps(ship, steps) {
  if (!ship.moving) return ship.cells.map(function (c) { return c.slice(); });
  // The anchor bounces within [1, 1+slack] -- NOT [baseCol, baseCol+slack] --
  // otherwise a ship already placed near the far edge (baseCol itself up to
  // 1+slack) could add another full slack's worth of offset on top and
  // drift past the grid edge. `phase` is chosen at generation time so this
  // still reproduces the ship's original placement at steps=0.
  var off = bounceOffset(steps + ship.phase, ship.slack);
  var cells = [];
  for (var i = 0; i < TUNE.SHIP_CELLS; i++) {
    cells.push(ship.orientation === 'h'
      ? [1 + off + i, ship.baseRow]
      : [ship.baseCol, 1 + off + i]);
  }
  return cells;
}

// Whole move-ticks elapsed since a ship's fleet spawned, given real
// elapsed milliseconds -- the DOM layer's clock feeds this.
function stepsAtElapsed(ship, elapsedMs) {
  if (!ship.moving || !ship.moveEverySec) return 0;
  return Math.floor(elapsedMs / 1000 / ship.moveEverySec);
}

// How long a fired ball should take to visually land, so it can never
// arrive before the ship it was scored against (evaluateShot judges the
// shot against `impactSteps` steps in) actually reaches that future cell.
// A fixed short flight regardless of fuse would let the ball splash on
// empty water while the feedback still says HIT, once the ship needed
// more real time to get there than the ball took to fly. Floored at
// MIN_FLIGHT_MS so a fuse=0 shot (impactSteps === the current step)
// still feels like an immediate cannon blast rather than waiting for a
// step boundary.
var MIN_FLIGHT_MS = 650;
function impactFlightDurationMs(impactSteps, moveEverySec, elapsedAtFireMs) {
  var impactElapsedMs = impactSteps * moveEverySec * 1000;
  return Math.max(MIN_FLIGHT_MS, impactElapsedMs - elapsedAtFireMs);
}

function cellsOverlap(a, b) {
  for (var i = 0; i < a.length; i++) {
    for (var j = 0; j < b.length; j++) {
      if (a[i][0] === b[j][0] && a[i][1] === b[j][1]) return true;
    }
  }
  return false;
}

// One ship's starting placement -- horizontal (3 consecutive columns in
// one row) or vertical (3 consecutive rows in one column). Vertical is
// only offered when the board is tall enough to hold it.
function placeShip(cols, rows, rand) {
  var canVertical = rows >= TUNE.SHIP_CELLS;
  var horizontal = !canVertical || rand() < 0.5;
  var baseCol, baseRow;
  if (horizontal) {
    baseRow = 1 + Math.floor(rand() * rows);
    baseCol = 1 + Math.floor(rand() * (cols - TUNE.SHIP_CELLS + 1));
  } else {
    baseCol = 1 + Math.floor(rand() * cols);
    baseRow = 1 + Math.floor(rand() * (rows - TUNE.SHIP_CELLS + 1));
  }
  var cells = [];
  for (var i = 0; i < TUNE.SHIP_CELLS; i++) {
    cells.push(horizontal ? [baseCol + i, baseRow] : [baseCol, baseRow + i]);
  }
  return { orientation: horizontal ? 'h' : 'v', baseCol: baseCol, baseRow: baseRow, cells: cells };
}

// How many move-ticks of a ship's path to check for overlap: a bounce's
// full back-and-forth period is 2*slack, and slack can't exceed
// MAX_POWDER - SHIP_CELLS. Two ships' combined positions repeat every
// LCM of their periods, so check the LCM of *every* possible period --
// that covers any pair on any board this game can define.
var OVERLAP_CHECK_STEPS = (function () {
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  var l = 1;
  for (var k = 1; k <= TUNE.MAX_POWDER - TUNE.SHIP_CELLS; k++) l = l * (2 * k) / gcd(l, 2 * k);
  return l;
})();

// Places every ship in the level's fleet with no overlaps -- not just at
// spawn, but at every step of their drift, since two independently
// bouncing ships (different phase, possibly different orientation/slack)
// can start clear and still cross paths later. Checking cells at a single
// step (spawn only) misses that; a shot landing on a cell two drifting
// ships both pass through would otherwise get silently credited to
// whichever ship happens to be first in the fleet array.
// `cols` is always <= the level's best unlocked cannon's maxPowder (see
// the LEVELS table), so every cell any ship can occupy is reachable by
// something -- no ship is ever placed where it cannot possibly be hit.
// Placement is greedy, so early ships can box later ones in (every drifting
// ship sweeps its whole row or column). When that happens, throw the fleet
// away and start over rather than sailing in short-handed.
function generateFleet(levelId, rand) {
  rand = rand || Math.random;
  var best = [];
  for (var tries = 0; tries < 60; tries++) {
    var fleet = tryGenerateFleet(levelId, rand);
    if (fleet.length === levelFor(levelId).shipsPerFleet) return fleet;
    if (fleet.length > best.length) best = fleet;
  }
  return best;
}

function tryGenerateFleet(levelId, rand) {
  var lvl = levelFor(levelId);
  var fleet = [];
  var attempts = 0;

  while (fleet.length < lvl.shipsPerFleet && attempts < 200) {
    attempts++;
    var p = placeShip(lvl.cols, lvl.rows, rand);
    var slack = p.orientation === 'h' ? (lvl.cols - TUNE.SHIP_CELLS) : (lvl.rows - TUNE.SHIP_CELLS);
    var color = SHIP_COLORS[fleet.length % SHIP_COLORS.length];
    var candidate = {
      id: 'ship' + fleet.length,
      color: color.key,
      sail: color.sail,
      name: color.names[attempts % color.names.length],
      orientation: p.orientation,
      baseCol: p.baseCol,
      baseRow: p.baseRow,
      cells: p.cells,
      hits: [false, false, false],
      moving: lvl.moving,
      moveEverySec: lvl.moveEverySec,
      slack: slack,
      // bounceOffset(phase, slack) === phase for phase <= slack (the
      // ascending branch of the triangle wave), so this exactly
      // reproduces the ship's placed position at steps=0.
      phase: (p.orientation === 'h' ? p.baseCol : p.baseRow) - 1
    };

    var collides = fleet.some(function (existing) {
      for (var s = 0; s <= OVERLAP_CHECK_STEPS; s++) {
        if (cellsOverlap(shipCellsAtSteps(candidate, s), shipCellsAtSteps(existing, s))) return true;
      }
      return false;
    });
    if (collides) continue;

    fleet.push(candidate);
  }
  return fleet;
}

function liveShips(fleet) {
  return (fleet || []).filter(function (s) { return s.hits.indexOf(false) !== -1; });
}

function isFleetSunk(fleet) {
  return !!fleet && fleet.length > 0 && fleet.every(function (s) { return s.hits.every(function (h) { return h; }); });
}

// Negative colError = short of the true column (aimed LEFT of it),
// positive = aimed RIGHT of it. Negative rowError = SHORT, positive =
// OVER -- column is corrected before row, same "fix aim, then distance"
// order as the original bearing/range design.
function shotResult(shot, targetCell) {
  var colError = shot.col - targetCell[0];
  var rowError = shot.row - targetCell[1];
  var hit = colError === 0 && rowError === 0;
  var verdict;
  if (hit) {
    verdict = 'HIT';
  } else if (colError !== 0) {
    verdict = (colError < 0 ? 'LEFT BY ' : 'RIGHT BY ') + Math.abs(colError);
  } else {
    verdict = (rowError < 0 ? 'SHORT BY ' : 'OVER BY ') + Math.abs(rowError);
  }
  return { hit: hit, colError: colError, rowError: rowError, verdict: verdict };
}

// Checks the shot against every live ship's cells AT THE GIVEN move-tick
// (so a fuse-delayed shot is judged against where the ship will really
// be, not where it was when fired). An exact cell match on an unhit
// segment is a hit; otherwise the verdict is reported against whichever
// live cell the shot landed closest to.
function evaluateShot(shot, fleet, steps) {
  var live = liveShips(fleet);
  if (!live.length) return null;

  for (var s = 0; s < live.length; s++) {
    var ship = live[s];
    var cells = shipCellsAtSteps(ship, steps);
    for (var i = 0; i < cells.length; i++) {
      if (ship.hits[i]) continue;
      if (cells[i][0] === shot.col && cells[i][1] === shot.row) {
        var res = shotResult(shot, cells[i]);
        res.ship = ship;
        res.segmentIndex = i;
        res.cells = cells;
        return res;
      }
    }
  }

  // Only unhit cells are eligible as the "nearest" reference -- otherwise
  // a shot that exactly matches an already-destroyed segment could pick
  // that segment as its reference and spuriously come out HIT via
  // shotResult's exact-match check below, even though the loop above
  // correctly skipped it as a real hit.
  var bestCell = null, bestShip = null, bestD = Infinity;
  live.forEach(function (ship) {
    var cells = shipCellsAtSteps(ship, steps);
    cells.forEach(function (c, i) {
      if (ship.hits[i]) return;
      var d = Math.abs(shot.col - c[0]) + Math.abs(shot.row - c[1]);
      if (d < bestD) { bestD = d; bestCell = c; bestShip = ship; }
    });
  });
  var missRes = shotResult(shot, bestCell);
  missRes.ship = bestShip;
  missRes.cells = shipCellsAtSteps(bestShip, steps);
  return missRes;
}

// Returns whether this hit sank the ship (every segment now hit).
function applyHit(ship, segmentIndex) {
  ship.hits[segmentIndex] = true;
  return ship.hits.every(function (h) { return h; });
}

// Which way a ship is sailing at this step: +1 toward higher columns
// (horizontal) / rows (vertical), -1 the other way, 0 if it has no room
// to move. The board draws the bow pointing this way, so "which way is
// it going?" can be answered by looking. Anchored ships face +1.
function shipHeadingAtSteps(ship, steps) {
  if (!ship.moving || ship.slack <= 0) return 1;
  var now = bounceOffset(steps + ship.phase, ship.slack);
  var next = bounceOffset(steps + ship.phase + 1, ship.slack);
  return next > now ? 1 : -1;
}

// A miss turned into a single instruction a five-year-old can follow on
// the dials: which dial to turn (column first, same order as the
// verdict), which way (+1 = turn it up), and how many clicks. Null on a
// hit. The board draws this as an arrow with a number next to the splash.
function aimHint(res) {
  if (!res || res.hit) return null;
  if (res.colError !== 0) {
    return { axis: 'col', dir: res.colError < 0 ? 1 : -1, amount: Math.abs(res.colError) };
  }
  return { axis: 'row', dir: res.rowError < 0 ? 1 : -1, amount: Math.abs(res.rowError) };
}

// Treasure for the shared chest: a coin per hit, two more for sinking
// the ship. Small whole numbers on purpose -- the boys count them.
var COINS_PER_HIT = 1, COINS_PER_SINK = 2;
function coinsForShot(hit, sunk) {
  if (!hit) return 0;
  return COINS_PER_HIT + (sunk ? COINS_PER_SINK : 0);
}

// ---------- LOG REPLAY ----------
function ownRecords(records) {
  return (records || []).filter(function (r) {
    return r && (!r.game || r.game === 'cannon-battle');
  });
}

// Level is never stored -- it's recomputed from the log, one level per
// fleet cleared. Backward-compatible with the pre-grid log schema: those
// older records still carry `fleetCleared`, which is all this counts, so
// progress already made (e.g. Wade's own play) carries forward cleanly.
function computeLevel(records) {
  var cleared = 0;
  ownRecords(records).forEach(function (r) { if (r.fleetCleared) cleared++; });
  return Math.min(cleared + 1, TUNE.LEVELS.length);
}

function playerStats(records) {
  var stats = {};
  TUNE.PLAYERS.forEach(function (p) { stats[p] = { shots: 0, hits: 0, sunk: 0 }; });
  ownRecords(records).forEach(function (r) {
    var s = stats[r.player];
    if (!s) return;
    s.shots++;
    if (r.hit) s.hits++;
    if (r.sunk) s.sunk++;
  });
  return stats;
}


// ---------- DOM WIRING ----------
if (typeof document !== 'undefined' && document.getElementById && document.getElementById('harbor')) {
  (function () {

    var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var FONT = "'Fredoka', 'Trebuchet MS', sans-serif";
    var SVGNS = 'http://www.w3.org/2000/svg';

    // Canvas palette -- the same tokens style.css uses for the panels.
    var C = {
      seaTop: '#16679a', seaMid: '#2291b8', seaLow: '#3db6c3',
      sand: '#f3d9a3', sandWet: '#dcb677',
      ink: '#0e2a3f', paper: '#f6ead0', brass: '#f0b441', signal: '#e0442f',
      hull: '#70421f', hullEdge: '#3b2311', deck: '#bd8a55', deckLine: '#9a6a3a', spar: '#4a2e16',
      stone: '#e2cfab', stoneShade: '#c3aa81', stoneLine: '#9c8563', gate: '#4b3a28',
      leaf: '#3f9a4b', leafDark: '#2a6e34', trunk: '#8a6039', trunkDark: '#6a4527',
      rock: '#6f7f89', rockLight: '#9aa8b0',
      bronze: '#b27a3a', bronzeDark: '#6e4a1e', bronzeLight: '#e6b983', wood: '#5b3a1e'
    };

    var BARREL_SMOOTH = 0.2;
    var CANNON_SHAPE = {
      six: { len: 0.25, thick: 0.05 },
      twelve: { len: 0.3, thick: 0.064 },
      twentyfour: { len: 0.35, thick: 0.08 }
    };

    var state = {
      screen: 'map',              // 'map' | 'playing'
      overlay: null,              // null | 'win' | 'lose'
      turn: 0,
      level: 1,
      unlockedLevel: 1,
      selectedPort: 1,
      userPicked: false,
      voyaging: false,
      cannonId: 'twelve',
      col: 1, row: 1, fuse: 0,
      fleet: [],
      fleetStartTime: 0,
      fortWalls: TUNE.FORT_WALLS,
      locked: false,
      inFlight: false,
      roundOver: false,
      reloadStart: 0, reloadDur: 0, reloadTimeoutId: null,
      shake: 0, barrelAngle: -Math.PI / 2, recoil: 0,
      coins: 0, coinsShown: 0,
      shots: [], parts: [], flashes: [], pegs: [], stamps: [], hints: [], warn: null,
      gull: null, nextGullAt: 0,
      broadsideTimer: null, lastFleetRender: 0, lastBeat: '',
      W: 0, H: 0, dpr: 1,
      cellPx: 60, gridOriginX: 0, gridOriginY: 0, gridW: 0, gridH: 0,
      beachTop: 0, fortX: 0, fortBaseY: 0, fortW: 200, tokenR: 18,
      glints: [],
      sessionId: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    };

    for (var gi = 0; gi < 46; gi++) {
      state.glints.push({
        x: Math.random(), y: Math.random(), len: 8 + Math.random() * 12,
        speed: 3 + Math.random() * 7, phase: Math.random() * Math.PI * 2
      });
    }

    var els = {
      mapScreen: document.getElementById('map-screen'),
      chart: document.getElementById('chart'),
      piNum: document.getElementById('pi-num'),
      piCity: document.getElementById('pi-city'),
      piCountry: document.getElementById('pi-country'),
      piFact: document.getElementById('pi-fact'),
      piFleet: document.getElementById('pi-fleet'),
      piLock: document.getElementById('pi-lock'),
      setSailBtn: document.getElementById('set-sail-btn'),
      voyage: document.getElementById('voyage'),
      gameScreen: document.getElementById('game-screen'),
      harbor: document.getElementById('harbor'),
      harborWrap: document.getElementById('harbor-wrap'),
      levelCity: document.getElementById('level-city'),
      levelCountry: document.getElementById('level-country'),
      wallSegments: document.getElementById('wall-segments'),
      chest: document.getElementById('chest'),
      coinCount: document.getElementById('coin-count'),
      soundBtn: document.getElementById('sound-btn'),
      changePortBtn: document.getElementById('change-port-btn'),
      overlay: document.getElementById('board-overlay'),
      overlayTitle: document.getElementById('overlay-title'),
      overlayText: document.getElementById('overlay-text'),
      overlayCoins: document.getElementById('overlay-coins'),
      overlayButtons: document.getElementById('overlay-buttons'),
      turnBanner: document.getElementById('turn-banner'),
      turnBadge: document.getElementById('turn-badge'),
      turnName: document.getElementById('turn-name'),
      cannonSelect: document.getElementById('cannon-select'),
      colValue: document.getElementById('col-value'),
      rowValue: document.getElementById('row-value'),
      fuseDial: document.getElementById('fuse-dial'),
      fuseValue: document.getElementById('fuse-value'),
      beat: document.getElementById('beat'),
      beatLabel: document.getElementById('beat-label'),
      rangeEquation: document.getElementById('range-equation'),
      comboGrid: document.getElementById('combo-grid'),
      fireBtn: document.getElementById('fire-btn'),
      fireFill: document.querySelector('#fire-btn .fire-fill'),
      fireLabel: document.querySelector('#fire-btn .fire-label'),
      feedback: document.getElementById('feedback'),
      fleetStatus: document.getElementById('fleet-status'),
      confetti: document.getElementById('confetti'),
      coinLayer: document.getElementById('coin-layer')
    };

    var ctx = els.harbor.getContext('2d');

    function currentPlayer() { return TUNE.PLAYERS[state.turn % TUNE.PLAYERS.length]; }
    function currentLevel() { return levelFor(state.level); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function easeOutBack(t) { var c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
    function titleCase(name) { return name.charAt(0) + name.slice(1).toLowerCase(); }
    function isSunk(ship) { return ship.hits.every(function (h) { return h; }); }
    function maxReachableCol() { return Math.min(maxPowderFor(state.cannonId), currentLevel().cols); }

    // =====================================================
    // SOUND -- everything is synthesized, no audio files
    // =====================================================
    var sfx = (function () {
      var ac = null, master = null, noiseBuf = null, muted = false;
      try { muted = window.localStorage.getItem('cannon-battle-muted') === '1'; } catch (e) { /* storage blocked */ }

      function ready() {
        if (muted) return null;
        try {
          if (!ac) {
            ac = new (window.AudioContext || window.webkitAudioContext)();
            master = ac.createGain();
            master.gain.value = 0.55;
            master.connect(ac.destination);
            noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
            var d = noiseBuf.getChannelData(0);
            for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          }
          if (ac.state === 'suspended') ac.resume();
          return ac;
        } catch (e) { return null; }
      }

      function tone(freq, dur, type, vol, delay, slideTo) {
        var a = ready(); if (!a) return;
        var t = a.currentTime + (delay || 0);
        var o = a.createOscillator(), g = a.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + dur + 0.02);
      }

      function noise(dur, filter, f0, f1, vol, delay) {
        var a = ready(); if (!a) return;
        var t = a.currentTime + (delay || 0);
        var src = a.createBufferSource(), flt = a.createBiquadFilter(), g = a.createGain();
        src.buffer = noiseBuf;
        flt.type = filter;
        flt.frequency.setValueAtTime(f0, t);
        flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(flt); flt.connect(g); g.connect(master);
        src.start(t); src.stop(t + dur + 0.02);
      }

      return {
        fire: function () { noise(0.55, 'lowpass', 1800, 120, 0.9); tone(70, 0.4, 'sine', 0.7, 0, 32); },
        enemy: function () { noise(0.5, 'lowpass', 900, 90, 0.45); tone(55, 0.3, 'sine', 0.35, 0, 30); },
        splash: function () {
          noise(0.7, 'bandpass', 1400, 350, 0.55);
          for (var i = 0; i < 4; i++) tone(500 + Math.random() * 500, 0.07, 'sine', 0.06, 0.12 + i * 0.06, 250);
        },
        hit: function () {
          noise(0.45, 'lowpass', 3000, 250, 0.85);
          tone(523, 0.12, 'triangle', 0.16, 0.08);
          tone(784, 0.2, 'triangle', 0.16, 0.18);
        },
        sink: function () {
          tone(330, 1.1, 'sawtooth', 0.06, 0, 60);
          for (var i = 0; i < 8; i++) tone(350 + Math.random() * 700, 0.06, 'sine', 0.07, 0.25 + i * 0.09, 900);
        },
        crumble: function () { noise(0.7, 'lowpass', 700, 60, 0.8); tone(48, 0.4, 'sine', 0.5, 0, 30); },
        coin: function () { tone(1318, 0.08, 'triangle', 0.12); tone(1760, 0.14, 'triangle', 0.12, 0.06); },
        click: function () { tone(880, 0.035, 'square', 0.035); },
        warn: function () { tone(600, 0.12, 'square', 0.05); tone(600, 0.12, 'square', 0.05, 0.18); },
        fanfare: function () {
          [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i === 3 ? 0.6 : 0.2, 'triangle', 0.2, i * 0.14); });
        },
        sad: function () { [392, 330, 262].forEach(function (f, i) { tone(f, 0.35, 'triangle', 0.14, i * 0.22); }); },
        isMuted: function () { return muted; },
        setMuted: function (m) {
          muted = m;
          try { window.localStorage.setItem('cannon-battle-muted', m ? '1' : '0'); } catch (e) { /* storage blocked */ }
          if (ac) { if (m) ac.suspend(); else ac.resume(); }
        }
      };
    })();

    // =====================================================
    // LAYOUT
    // =====================================================
    // The numbered grid fills the sea; a sandy beach strip along the
    // bottom holds the fort. Everything is in CSS pixels (the canvas
    // backing store is scaled by devicePixelRatio so numbers stay crisp).
    function computeLayout() {
      var lvl = currentLevel();
      var w = state.W, h = state.H;
      var beachH = clamp(h * 0.21, 104, 170);
      state.beachTop = h - beachH;
      var padTop = 60, padLeft = 60, padRight = 26, padBottom = 34;
      var availW = w - padLeft - padRight;
      var availH = state.beachTop - padTop - padBottom;
      var cell = Math.max(26, Math.min(86, 0.86 * Math.min(availW / lvl.cols, availH / lvl.rows)));
      state.cellPx = cell;
      state.gridW = cell * lvl.cols;
      state.gridH = cell * lvl.rows;
      state.gridOriginX = padLeft + (availW - state.gridW) / 2;
      state.gridOriginY = padTop + (availH - state.gridH) / 2;
      state.tokenR = clamp(cell * 0.24, 13, 21);
      state.fortW = clamp(w * 0.25, 150, 250);
      state.fortX = clamp(state.gridOriginX + state.gridW / 2, state.fortW * 0.6, w - state.fortW * 0.6);
      state.fortBaseY = h - beachH * 0.2;
    }

    function cellCenter(col, row) {
      return {
        x: state.gridOriginX + (col - 0.5) * state.cellPx,
        y: state.gridOriginY + state.gridH - (row - 0.5) * state.cellPx
      };
    }

    function resizeCanvas() {
      var cw = els.harborWrap.clientWidth, ch = els.harborWrap.clientHeight;
      if (!cw || !ch) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.W = cw; state.H = ch; state.dpr = dpr;
      els.harbor.width = Math.round(cw * dpr);
      els.harbor.height = Math.round(ch * dpr);
      computeLayout();
    }

    // ---------- the gun ----------
    function fortTopY() { return state.fortBaseY - state.fortW * 0.3; }
    function gunPivot() { return { x: state.fortX, y: fortTopY() - state.fortW * 0.035 }; }
    function barrelLen() { return state.fortW * (CANNON_SHAPE[state.cannonId] || CANNON_SHAPE.twelve).len; }

    function targetBarrelAngle() {
      var p = gunPivot(), t = cellCenter(state.col, state.row);
      return Math.atan2(t.y - p.y, t.x - p.x);
    }

    function muzzlePoint() {
      var p = gunPivot(), len = barrelLen() * (1 - state.recoil * 0.25);
      return { x: p.x + Math.cos(state.barrelAngle) * len, y: p.y + Math.sin(state.barrelAngle) * len };
    }

    function arcHeightFor(x0, y0, x1, y1) {
      return clamp(Math.hypot(x1 - x0, y1 - y0) * 0.32, 40, 170);
    }

    function currentSteps() {
      var lvl = currentLevel();
      if (!lvl.moving) return 0;
      return Math.floor((performance.now() - state.fleetStartTime) / 1000 / lvl.moveEverySec);
    }

    // =====================================================
    // DRAWING: sea, beach, grid
    // =====================================================
    function roundRectPath(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

    function drawSea(now) {
      var w = state.W, h = state.H;
      var g = ctx.createLinearGradient(0, 0, 0, state.beachTop);
      g.addColorStop(0, C.seaTop);
      g.addColorStop(0.62, C.seaMid);
      g.addColorStop(1, C.seaLow);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      var drift = REDUCED ? 0 : now / 1000;
      state.glints.forEach(function (gl) {
        var a = 0.1 + 0.1 * Math.sin(now / 900 + gl.phase);
        if (a < 0.03) return;
        var x = ((gl.x * (w + 40) + drift * gl.speed) % (w + 40)) - 20;
        var y = 8 + gl.y * (state.beachTop - 30);
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(x - gl.len / 2, y);
        ctx.quadraticCurveTo(x, y - 3, x + gl.len / 2, y);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    function shoreY(x, now) {
      var t = REDUCED ? 0 : now / 1400;
      return state.beachTop + Math.sin(x / 38 + t) * 4 + Math.sin(x / 17) * 2;
    }

    function drawPalm(x, y, s, now, flip) {
      var sway = REDUCED ? 0 : Math.sin(now / 1500 + x) * 0.05;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(flip ? -s : s, s);
      ctx.strokeStyle = C.trunk;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(10, -34, 4, -70);
      ctx.stroke();
      ctx.strokeStyle = C.trunkDark;
      ctx.lineWidth = 2;
      for (var k = 1; k < 7; k++) {
        var ty = -k * 10;
        ctx.beginPath();
        ctx.moveTo(4 + k * 0.6, ty);
        ctx.lineTo(10 - k * 0.3, ty - 3);
        ctx.stroke();
      }
      ctx.translate(4, -70);
      ctx.rotate(sway);
      [[-2.7, 1.0], [-2.1, 1.1], [-1.2, 0.95], [-0.55, 1.05], [0.25, 0.95], [0.7, 0.8]].forEach(function (f, i) {
        ctx.save();
        ctx.rotate(f[0] + 1.2);
        var L = 42 * f[1];
        ctx.fillStyle = i % 2 ? C.leafDark : C.leaf;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(L * 0.5, -12, L, 10);
        ctx.quadraticCurveTo(L * 0.5, 2, 0, 0);
        ctx.fill();
        ctx.restore();
      });
      ctx.fillStyle = '#6b4a22';
      circle(-3, 4, 4.5); ctx.fill();
      circle(4, 5, 4.5); ctx.fill();
      ctx.restore();
    }

    function drawRock(x, y, r) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.35, r * 1.25, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.rock;
      ctx.beginPath();
      ctx.moveTo(x - r, y + r * 0.3);
      ctx.quadraticCurveTo(x - r * 0.9, y - r * 0.6, x - r * 0.1, y - r * 0.7);
      ctx.quadraticCurveTo(x + r * 0.9, y - r * 0.5, x + r, y + r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = C.rockLight;
      ctx.beginPath();
      ctx.ellipse(x - r * 0.25, y - r * 0.3, r * 0.35, r * 0.18, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawBeach(now) {
      var w = state.W, h = state.H, top = state.beachTop;

      var sh = ctx.createLinearGradient(0, top - 46, 0, top + 4);
      sh.addColorStop(0, 'rgba(120,220,210,0)');
      sh.addColorStop(1, 'rgba(120,220,210,0.85)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, top - 46, w, 50);

      ctx.beginPath();
      ctx.moveTo(0, h);
      for (var x = 0; x <= w + 12; x += 12) ctx.lineTo(x, shoreY(x, now));
      ctx.lineTo(w, h);
      ctx.closePath();
      var sand = ctx.createLinearGradient(0, top, 0, h);
      sand.addColorStop(0, C.sandWet);
      sand.addColorStop(0.16, C.sand);
      sand.addColorStop(1, '#ebc98b');
      ctx.fillStyle = sand;
      ctx.fill();

      var swash = REDUCED ? 0.5 : (Math.sin(now / 1100) + 1) / 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (x = 0; x <= w + 12; x += 12) {
        var y = shoreY(x, now);
        if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.2 + 0.35 * (1 - swash)).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (x = 0; x <= w + 12; x += 12) {
        var y2 = shoreY(x, now) - 7 - swash * 10 + Math.sin(x / 9) * 1.5;
        if (!x) ctx.moveTo(x, y2); else ctx.lineTo(x, y2);
      }
      ctx.stroke();

      var fx = state.fortX, fw = state.fortW;
      drawRock(fx - fw * 0.5 - 86, top - 10, 18);
      drawRock(fx + fw * 0.5 + 96, top - 6, 22);
      drawRock(fx + fw * 0.5 + 126, top + 2, 12);
      if (fx - fw * 0.5 - 200 > 20) drawRock(fx - fw * 0.5 - 200, top - 4, 14);

      var s = clamp(h / 720, 0.75, 1.15);
      drawPalm(fx - fw * 0.5 - 42, h - 16, s, now, false);
      drawPalm(fx + fw * 0.5 + 48, h - 12, s * 0.9, now, true);
      if (fx - fw * 0.5 - 150 > 30) drawPalm(fx - fw * 0.5 - 140, h - 8, s * 0.8, now, true);
      if (fx + fw * 0.5 + 160 < w - 30) drawPalm(fx + fw * 0.5 + 170, h - 10, s * 0.85, now, false);
    }

    function drawToken(x, y, n, active, dim) {
      var r = state.tokenR * (active ? 1.22 : 1);
      ctx.save();
      ctx.globalAlpha = dim ? 0.4 : 1;
      if (active) {
        ctx.fillStyle = 'rgba(240,180,65,0.35)';
        circle(x, y, r + 7); ctx.fill();
      }
      ctx.fillStyle = active ? C.brass : C.paper;
      circle(x, y, r); ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.font = '700 ' + Math.round(r * 1.18) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n, x, y + r * 0.06);
      ctx.restore();
    }

    function drawGrid() {
      var lvl = currentLevel();
      var cell = state.cellPx, ox = state.gridOriginX, oy = state.gridOriginY;
      var gw = state.gridW, gh = state.gridH;
      var maxCol = maxReachableCol();

      ctx.fillStyle = 'rgba(8,50,80,0.18)';
      roundRectPath(ox - 7, oy - 7, gw + 14, gh + 14, 10);
      ctx.fill();

      // Columns this cannon can't reach are shaded and hatched, so it's
      // visible *why* the column dial stops where it does.
      if (maxCol < lvl.cols) {
        var x0 = ox + maxCol * cell, ww = (lvl.cols - maxCol) * cell;
        ctx.save();
        ctx.fillStyle = 'rgba(6,28,46,0.45)';
        ctx.fillRect(x0, oy, ww, gh);
        ctx.beginPath();
        ctx.rect(x0, oy, ww, gh);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.lineWidth = 6;
        for (var hx = x0 - gh; hx < x0 + ww; hx += 22) {
          ctx.beginPath();
          ctx.moveTo(hx, oy + gh);
          ctx.lineTo(hx + gh, oy);
          ctx.stroke();
        }
        ctx.restore();
      }

      // The aim: the dialed column and the dialed row light up as lanes,
      // and the square where they cross is the target.
      var laneA = state.inFlight ? 0.08 : 0.17;
      ctx.fillStyle = 'rgba(255,255,255,' + laneA + ')';
      ctx.fillRect(ox + (state.col - 1) * cell, oy, cell, gh);
      ctx.fillRect(ox, oy + gh - state.row * cell, gw, cell);
      ctx.fillStyle = 'rgba(240,180,65,0.32)';
      ctx.fillRect(ox + (state.col - 1) * cell, oy + gh - state.row * cell, cell, cell);

      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var c = 1; c < lvl.cols; c++) { ctx.moveTo(ox + c * cell, oy); ctx.lineTo(ox + c * cell, oy + gh); }
      for (var r = 1; r < lvl.rows; r++) { ctx.moveTo(ox, oy + r * cell); ctx.lineTo(ox + gw, oy + r * cell); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(ox, oy, gw, gh);

      // The "grid of numbers": each square quietly carries column x row.
      ctx.font = '600 ' + Math.round(cell * 0.24) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      for (c = 1; c <= lvl.cols; c++) {
        for (r = 1; r <= lvl.rows; r++) {
          if (c === state.col && r === state.row) continue;
          var p = cellCenter(c, r);
          ctx.fillText(c * r, p.x, p.y);
        }
      }

      var tr = state.tokenR;
      for (c = 1; c <= lvl.cols; c++) {
        drawToken(ox + (c - 0.5) * cell, oy - tr - 11, c, c === state.col, c > maxCol);
      }
      for (r = 1; r <= lvl.rows; r++) {
        drawToken(ox - tr - 11, cellCenter(1, r).y, r, r === state.row, false);
      }
    }

    // =====================================================
    // DRAWING: ships (top-down, each sail sits on one square)
    // =====================================================
    function shipPose(ship, now, steps) {
      var cells = shipCellsAtSteps(ship, steps);
      var pts = cells.map(function (c) { return cellCenter(c[0], c[1]); });
      var heading = shipHeadingAtSteps(ship, steps);
      if (ship.moving && steps > 0 && !REDUCED) {
        var into = now - state.fleetStartTime - steps * ship.moveEverySec * 1000;
        var t = Math.min(1, into / 420);
        if (t < 1) {
          var prev = shipCellsAtSteps(ship, steps - 1).map(function (c) { return cellCenter(c[0], c[1]); });
          var e = easeInOut(Math.max(0, t));
          pts = pts.map(function (p, i) { return { x: lerp(prev[i].x, p.x, e), y: lerp(prev[i].y, p.y, e) }; });
          heading = shipHeadingAtSteps(ship, steps - 1);
        }
      }
      var angle = ship.orientation === 'h'
        ? (heading > 0 ? 0 : Math.PI)
        : (heading > 0 ? -Math.PI / 2 : Math.PI / 2);
      return { pts: pts, cx: (pts[0].x + pts[2].x) / 2, cy: (pts[0].y + pts[2].y) / 2, angle: angle };
    }

    function hullPath(L, W, dx, dy) {
      ctx.beginPath();
      ctx.moveTo(-L / 2 + dx, -W * 0.42 + dy);
      ctx.lineTo(L * 0.2 + dx, -W / 2 + dy);
      ctx.quadraticCurveTo(L * 0.44 + dx, -W * 0.45 + dy, L / 2 + dx, dy);
      ctx.quadraticCurveTo(L * 0.44 + dx, W * 0.45 + dy, L * 0.2 + dx, W / 2 + dy);
      ctx.lineTo(-L / 2 + dx, W * 0.42 + dy);
      ctx.quadraticCurveTo(-L / 2 - W * 0.18 + dx, dy, -L / 2 + dx, -W * 0.42 + dy);
      ctx.closePath();
    }

    function drawSail(lx, W, cell, color) {
      var S = W * 0.98, th = Math.max(5, cell * 0.12);
      ctx.save();
      ctx.translate(lx, 0);
      ctx.strokeStyle = C.spar;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, cell * 0.04);
      ctx.beginPath();
      ctx.moveTo(-th * 0.35, -S * 1.1);
      ctx.lineTo(-th * 0.35, S * 1.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-th * 0.3, -S);
      ctx.quadraticCurveTo(th * 1.9, 0, -th * 0.3, S);
      ctx.quadraticCurveTo(th * 0.55, 0, -th * 0.3, -S);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(-th * 0.05, -S * 0.7);
      ctx.quadraticCurveTo(th * 1.1, 0, -th * 0.05, S * 0.7);
      ctx.stroke();
      ctx.fillStyle = C.spar;
      circle(-th * 0.3, 0, Math.max(2.5, cell * 0.05));
      ctx.fill();
      ctx.restore();
    }

    function drawBurntMast(lx, W, cell) {
      ctx.save();
      ctx.translate(lx, 0);
      ctx.fillStyle = 'rgba(25,14,8,0.6)';
      ctx.beginPath();
      ctx.ellipse(0, 0, cell * 0.2, W * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#231710';
      ctx.lineWidth = Math.max(2, cell * 0.035);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-cell * 0.03, -W * 0.7);
      ctx.lineTo(cell * 0.05, -W * 0.15);
      ctx.moveTo(-cell * 0.05, W * 0.2);
      ctx.lineTo(cell * 0.04, W * 0.75);
      ctx.stroke();
      ctx.fillStyle = '#231710';
      circle(0, 0, Math.max(2.5, cell * 0.05));
      ctx.fill();
      ctx.restore();
    }

    function drawWake(L, W, now) {
      var t = REDUCED ? 0 : (now / 600) % 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (var k = 0; k < 2; k++) {
        var o = (k + t) / 2;
        ctx.globalAlpha = 0.6 * (1 - o);
        ctx.beginPath();
        ctx.moveTo(-L / 2 - 2 - o * L * 0.35, -W * (0.35 + o * 0.5));
        ctx.lineTo(-L / 2 + 4 - o * L * 0.35, 0);
        ctx.lineTo(-L / 2 - 2 - o * L * 0.35, W * (0.35 + o * 0.5));
        ctx.stroke();
      }
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(L / 2 - 2, -W * 0.35);
      ctx.quadraticCurveTo(L / 2 + 6, 0, L / 2 - 2, W * 0.35);
      ctx.stroke();
      ctx.restore();
    }

    function drawShipBody(ship, pose, now, o) {
      o = o || {};
      var cell = state.cellPx;
      var L = cell * 2.8, W = Math.min(cell * 0.5, 50);
      var dirx = Math.cos(pose.angle), diry = Math.sin(pose.angle);
      var bob = REDUCED ? 0 : Math.sin(now / 950 + ship.seed) * 0.016;

      ctx.save();
      ctx.globalAlpha = o.alpha == null ? 1 : Math.max(0, o.alpha);
      ctx.translate(pose.cx, pose.cy);
      ctx.rotate(pose.angle + bob + (o.tilt || 0));
      if (o.scale) ctx.scale(o.scale, o.scale);

      ctx.fillStyle = 'rgba(4,30,50,0.28)';
      hullPath(L, W, 4, 6);
      ctx.fill();

      if (ship.moving && !o.sinking && !isSunk(ship)) drawWake(L, W, now);

      hullPath(L, W, 0, 0);
      ctx.fillStyle = C.hull;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = C.hullEdge;
      ctx.stroke();

      ctx.save();
      ctx.scale(0.86, 0.7);
      hullPath(L, W, 0, 0);
      ctx.fillStyle = C.deck;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = C.deckLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var k = -1; k <= 1; k++) {
        ctx.moveTo(-L * 0.38, k * W * 0.17);
        ctx.lineTo(L * 0.3, k * W * 0.17);
      }
      ctx.stroke();

      ctx.strokeStyle = C.spar;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(L / 2 - 3, 0);
      ctx.lineTo(L / 2 + cell * 0.2, 0);
      ctx.stroke();

      // stern pennant in the ship's colour -- still visible after its sails burn
      ctx.fillStyle = ship.sail;
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 4, -2);
      ctx.lineTo(-L / 2 - cell * 0.22, -W * 0.18 + (REDUCED ? 0 : Math.sin(now / 160 + ship.seed) * 2));
      ctx.lineTo(-L / 2 + 4, W * 0.14);
      ctx.closePath();
      ctx.fill();

      for (var i = 0; i < 3; i++) {
        var lx = (pose.pts[i].x - pose.cx) * dirx + (pose.pts[i].y - pose.cy) * diry;
        if (ship.hits[i]) drawBurntMast(lx, W, cell);
        else drawSail(lx, W, cell, ship.sail);
      }
      ctx.restore();
    }

    function drawFire(x, y, now, seed) {
      var s = state.cellPx * 0.3;
      for (var k = 0; k < 4; k++) {
        var ph = ((now / 1500 + k / 4 + seed * 0.13) % 1);
        ctx.globalAlpha = 0.32 * (1 - ph);
        ctx.fillStyle = '#5b5560';
        circle(x + ph * s * 0.9 + Math.sin(now / 500 + k) * 3, y - s * 0.4 - ph * s * 2.4, s * (0.25 + ph * 0.55));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (k = 0; k < 3; k++) {
        var flick = REDUCED ? 1 : 0.75 + 0.25 * Math.sin(now / 85 + seed + k * 2.1);
        var fx = x + (k - 1) * s * 0.42;
        var fh = s * (k === 1 ? 1.3 : 0.9) * flick;
        ctx.fillStyle = '#ff7a1f';
        ctx.beginPath();
        ctx.moveTo(fx - s * 0.26, y + s * 0.1);
        ctx.quadraticCurveTo(fx - s * 0.3, y - fh * 0.55, fx, y - fh);
        ctx.quadraticCurveTo(fx + s * 0.3, y - fh * 0.55, fx + s * 0.26, y + s * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath();
        ctx.moveTo(fx - s * 0.12, y + s * 0.1);
        ctx.quadraticCurveTo(fx - s * 0.14, y - fh * 0.35, fx, y - fh * 0.6);
        ctx.quadraticCurveTo(fx + s * 0.14, y - fh * 0.35, fx + s * 0.12, y + s * 0.1);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawWreck(ship, now) {
      var pose = ship.sinkPose, cell = state.cellPx;
      var dirx = Math.cos(pose.angle), diry = Math.sin(pose.angle);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(pose.cx, pose.cy, cell * 1.3, cell * 0.45, pose.angle, 0, Math.PI * 2);
      ctx.stroke();
      for (var k = 0; k < 5; k++) {
        var along = (k - 2) * cell * 0.55 + Math.sin(ship.seed + k) * cell * 0.15;
        var across = Math.cos(ship.seed * 3 + k * 1.7) * cell * 0.25;
        var bob = REDUCED ? 0 : Math.sin(now / 800 + k + ship.seed) * 1.5;
        var px = pose.cx + dirx * along - diry * across;
        var py = pose.cy + diry * along + dirx * across + bob;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ship.seed + k * 1.3);
        ctx.fillStyle = k === 2 ? ship.sail : C.hull;
        if (k === 2) {
          ctx.beginPath();
          ctx.moveTo(-cell * 0.14, -cell * 0.08);
          ctx.lineTo(cell * 0.16, 0);
          ctx.lineTo(-cell * 0.14, cell * 0.08);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-cell * 0.16, -cell * 0.035, cell * 0.32, cell * 0.07);
        }
        ctx.restore();
      }
      ctx.restore();
    }

    function drawFleet(now) {
      var steps = currentSteps();
      var cell = state.cellPx;
      state.fleet.forEach(function (ship) {
        if (ship.sinkT0) {
          var age = now - ship.sinkT0;
          if (age < 0) {
            drawShipBody(ship, ship.sinkPose, now);
            ship.sinkPose.pts.forEach(function (p, i) { if (ship.hits[i]) drawFire(p.x, p.y, now, ship.seed + i); });
          } else if (age < 1600) {
            var p = age / 1600;
            drawShipBody(ship, ship.sinkPose, now, { alpha: 1 - p * p, scale: 1 - 0.3 * p, tilt: 0.4 * p, sinking: true });
            if (!REDUCED && Math.random() < 0.5) {
              var bp = ship.sinkPose.pts[Math.floor(Math.random() * 3)];
              state.parts.push({
                kind: 'bubble', x0: bp.x + (Math.random() - 0.5) * cell * 0.6, y0: bp.y + (Math.random() - 0.5) * cell * 0.3,
                vx: (Math.random() - 0.5) * 10, vy: -20 - Math.random() * 30, g: 0,
                r: 2 + Math.random() * 4, t0: now, dur: 700 + Math.random() * 500
              });
            }
          } else {
            drawWreck(ship, now);
          }
          return;
        }
        var pose = shipPose(ship, now, steps);
        drawShipBody(ship, pose, now);
        pose.pts.forEach(function (pt, i) { if (ship.hits[i]) drawFire(pt.x, pt.y, now, ship.seed + i); });

        if (state.warn && state.warn.ship === ship) {
          var wa = (now - state.warn.t0) / 900;
          ctx.save();
          ctx.strokeStyle = C.signal;
          ctx.globalAlpha = 0.9 * (0.5 + 0.5 * Math.sin(now / 70));
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.ellipse(pose.cx, pose.cy, cell * (1.55 + wa * 0.1), cell * 0.62, pose.angle, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    function drawPegs(now) {
      var cell = state.cellPx;
      state.pegs = state.pegs.filter(function (p) { return !p.fadeAt || now < p.fadeAt + 800; });
      state.pegs.forEach(function (p) {
        var c = cellCenter(p.col, p.row);
        var a = p.fadeAt && now > p.fadeAt ? 1 - (now - p.fadeAt) / 800 : 1;
        ctx.globalAlpha = 0.85 * a;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        circle(c.x, c.y, cell * 0.2); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        circle(c.x, c.y, cell * 0.075); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    // =====================================================
    // DRAWING: the fort (front view, El Morro style)
    // =====================================================
    var DAMAGE_ORDER = (function () {
      var order = [], l = 0, r = TUNE.FORT_WALLS - 1;
      while (l <= r) { order.push(r--); if (l <= r) order.push(l++); }
      return order;               // outer merlons fall first, the one under the gun last
    })();
    function merlonBroken(i) { return DAMAGE_ORDER.indexOf(i) < TUNE.FORT_WALLS - state.fortWalls; }
    function merlonCenterX(i) {
      var fw = state.fortW, n = TUNE.FORT_WALLS;
      return state.fortX - fw * 0.33 + (n > 1 ? i * (fw * 0.66 / (n - 1)) : fw * 0.33);
    }

    function drawGarita(x, y, fw) {
      var w = fw * 0.085, h = fw * 0.1;
      ctx.fillStyle = C.stone;
      ctx.fillRect(x - w / 2, y - h, w, h);
      ctx.strokeStyle = C.stoneLine;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - w / 2, y - h, w, h);
      ctx.beginPath();
      ctx.arc(x, y - h, w / 2, Math.PI, 0);
      ctx.fillStyle = C.stoneShade;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.gate;
      ctx.fillRect(x - w * 0.12, y - h * 0.7, w * 0.24, h * 0.42);
      ctx.fillStyle = C.stoneShade;
      circle(x, y - h - w / 2 - 2, 2.5); ctx.fill();
    }

    function drawFort(now) {
      var fw = state.fortW, fh = fw * 0.3, bx = state.fortX, by = state.fortBaseY;
      var top = by - fh;

      ctx.fillStyle = 'rgba(90,60,20,0.22)';
      ctx.beginPath();
      ctx.ellipse(bx, by + 3, fw * 0.6, fh * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx - fw / 2, by);
      ctx.lineTo(bx - fw * 0.45, top);
      ctx.lineTo(bx + fw * 0.45, top);
      ctx.lineTo(bx + fw / 2, by);
      ctx.closePath();
      var sg = ctx.createLinearGradient(0, top, 0, by);
      sg.addColorStop(0, C.stone);
      sg.addColorStop(1, C.stoneShade);
      ctx.fillStyle = sg;
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(120,95,60,0.45)';
      ctx.lineWidth = 1;
      var rows = 4, rh = fh / rows;
      for (var r = 1; r < rows; r++) {
        ctx.beginPath(); ctx.moveTo(bx - fw, top + r * rh); ctx.lineTo(bx + fw, top + r * rh); ctx.stroke();
      }
      for (r = 0; r < rows; r++) {
        for (var jx = bx - fw / 2 + (r % 2) * fw * 0.06; jx < bx + fw / 2; jx += fw * 0.12) {
          ctx.beginPath(); ctx.moveTo(jx, top + r * rh); ctx.lineTo(jx, top + (r + 1) * rh); ctx.stroke();
        }
      }
      var damage = TUNE.FORT_WALLS - state.fortWalls;
      ctx.fillStyle = 'rgba(30,20,12,0.3)';
      for (var d = 0; d < damage; d++) {
        ctx.beginPath();
        ctx.ellipse(merlonCenterX(DAMAGE_ORDER[d]), top + fh * 0.12, fw * 0.045, fh * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(120,95,60,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - fw / 2, by);
      ctx.lineTo(bx - fw * 0.45, top);
      ctx.lineTo(bx + fw * 0.45, top);
      ctx.lineTo(bx + fw / 2, by);
      ctx.stroke();

      var gw = fw * 0.12, gh = fh * 0.58;
      ctx.fillStyle = C.gate;
      ctx.beginPath();
      ctx.moveTo(bx - gw / 2, by);
      ctx.lineTo(bx - gw / 2, by - gh + gw / 2);
      ctx.arc(bx, by - gh + gw / 2, gw / 2, Math.PI, 0);
      ctx.lineTo(bx + gw / 2, by);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2d2116';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx, by - gh + gw * 0.3);
      ctx.stroke();

      drawGarita(bx - fw * 0.43, top, fw);
      drawGarita(bx + fw * 0.43, top, fw);

      // flag on the left sentry box flies the current gunner's colour
      var poleX = bx - fw * 0.43, poleTop = top - fw * 0.1 - fw * 0.2;
      ctx.strokeStyle = '#3a2c1c';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(poleX, top - fw * 0.1 - fw * 0.04); ctx.lineTo(poleX, poleTop); ctx.stroke();
      var wave = REDUCED ? 0 : Math.sin(now / 200) * 4;
      ctx.fillStyle = TUNE.PLAYER_COLORS[currentPlayer()];
      ctx.beginPath();
      ctx.moveTo(poleX, poleTop);
      ctx.quadraticCurveTo(poleX + 16, poleTop - 4 + wave, poleX + 32, poleTop + 6 + wave * 0.5);
      ctx.quadraticCurveTo(poleX + 16, poleTop + 14 - wave * 0.5, poleX, poleTop + 18);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      var mw = fw * 0.075, mh = fw * 0.06;
      for (var i = 0; i < TUNE.FORT_WALLS; i++) {
        var mx = merlonCenterX(i);
        if (!merlonBroken(i)) {
          ctx.fillStyle = C.stone;
          ctx.fillRect(mx - mw / 2, top - mh, mw, mh);
          ctx.strokeStyle = C.stoneLine;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(mx - mw / 2, top - mh, mw, mh);
        } else {
          ctx.fillStyle = '#8a7556';
          ctx.beginPath();
          ctx.moveTo(mx - mw / 2, top);
          ctx.lineTo(mx - mw / 4, top - mh * 0.45);
          ctx.lineTo(mx, top - mh * 0.2);
          ctx.lineTo(mx + mw / 4, top - mh * 0.55);
          ctx.lineTo(mx + mw / 2, top);
          ctx.closePath();
          ctx.fill();
          for (var sp = 0; sp < 3; sp++) {
            var ph = ((now / 1000 + sp / 3 + i * 0.37) % 1);
            ctx.globalAlpha = 0.35 * (1 - ph);
            ctx.fillStyle = '#8f8a95';
            circle(mx + Math.sin(now / 420 + i) * 4 + ph * 8, top - mh - ph * 36, 4 + ph * 7);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }

      // the gun: carriage, then the bronze barrel turned toward the aim
      var pv = gunPivot();
      ctx.fillStyle = C.wood;
      ctx.beginPath();
      ctx.moveTo(pv.x - fw * 0.07, top + 1);
      ctx.lineTo(pv.x - fw * 0.05, pv.y - fw * 0.005);
      ctx.lineTo(pv.x + fw * 0.05, pv.y - fw * 0.005);
      ctx.lineTo(pv.x + fw * 0.07, top + 1);
      ctx.closePath();
      ctx.fill();
      [-1, 1].forEach(function (sgn) {
        var wx = pv.x + sgn * fw * 0.055, wy = top - fw * 0.005, wr = fw * 0.03;
        ctx.fillStyle = '#3d2814';
        circle(wx, wy, wr); ctx.fill();
        ctx.strokeStyle = '#8a6039';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wx - wr * 0.7, wy); ctx.lineTo(wx + wr * 0.7, wy);
        ctx.moveTo(wx, wy - wr * 0.7); ctx.lineTo(wx, wy + wr * 0.7);
        ctx.stroke();
      });

      var target = targetBarrelAngle();
      var diff = Math.atan2(Math.sin(target - state.barrelAngle), Math.cos(target - state.barrelAngle));
      state.barrelAngle += diff * BARREL_SMOOTH;

      var shape = CANNON_SHAPE[state.cannonId] || CANNON_SHAPE.twelve;
      var len = barrelLen() * (1 - state.recoil * 0.25);
      var th = fw * shape.thick;
      ctx.save();
      ctx.translate(pv.x, pv.y);
      ctx.rotate(state.barrelAngle);
      var bg = ctx.createLinearGradient(0, -th, 0, th);
      bg.addColorStop(0, C.bronzeDark);
      bg.addColorStop(0.4, C.bronzeLight);
      bg.addColorStop(1, C.bronzeDark);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(-th * 0.6, -th * 0.62);
      ctx.lineTo(len, -th * 0.42);
      ctx.lineTo(len, th * 0.42);
      ctx.lineTo(-th * 0.6, th * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(len - th * 0.35, -th * 0.56, th * 0.45, th * 1.12);
      ctx.strokeStyle = C.bronzeDark;
      ctx.lineWidth = 2;
      [0.25, 0.55].forEach(function (f) {
        ctx.beginPath(); ctx.moveTo(len * f, -th * 0.56); ctx.lineTo(len * f, th * 0.56); ctx.stroke();
      });
      ctx.fillStyle = '#1b1208';
      ctx.beginPath(); ctx.ellipse(len + th * 0.1, 0, th * 0.12, th * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.bronze;
      circle(-th * 0.75, 0, th * 0.3); ctx.fill();
      ctx.restore();

      drawRammer(now, pv, len, th);
      if (state.recoil > 0.02) state.recoil *= 0.85; else state.recoil = 0;
    }

    // While reloading, a ramrod slides into the muzzle and back out.
    function drawRammer(now, pv, len, th) {
      if (!state.locked || !state.reloadStart) return;
      var t = (now - state.reloadStart - 350) / 700;
      if (t < 0 || t > 1) return;
      var push = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
      ctx.save();
      ctx.translate(pv.x, pv.y);
      ctx.rotate(state.barrelAngle);
      ctx.strokeStyle = '#8a6039';
      ctx.lineWidth = Math.max(3, th * 0.25);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(len + th * 3.4 - push * th * 2.6, 0);
      ctx.lineTo(len + th * 7 - push * th * 2.6, 0);
      ctx.stroke();
      ctx.fillStyle = '#5b3a1e';
      circle(len + th * 3.4 - push * th * 2.6, 0, th * 0.3); ctx.fill();
      ctx.restore();
    }

    // =====================================================
    // DRAWING: aim, shots, effects, words on the board
    // =====================================================
    function drawAim(now) {
      var cell = state.cellPx;
      var land = cellCenter(state.col, state.row);
      var tip = muzzlePoint();
      var arcH = arcHeightFor(tip.x, tip.y, land.x, land.y);
      ctx.save();
      ctx.globalAlpha = state.inFlight ? 0.3 : 0.8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.setLineDash([0.5, 10]);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.quadraticCurveTo((tip.x + land.x) / 2, (tip.y + land.y) / 2 - arcH * 2, land.x, land.y);
      ctx.stroke();
      ctx.setLineDash([]);

      var r = cell * 0.36 + (REDUCED ? 0 : Math.sin(now / 220) * 2);
      ctx.globalAlpha = state.inFlight ? 0.45 : 1;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 7;
      circle(land.x, land.y, r); ctx.stroke();
      ctx.strokeStyle = C.brass;
      ctx.lineWidth = 4;
      circle(land.x, land.y, r); ctx.stroke();
      var spin = REDUCED ? 0 : now / 1600;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (var k = 0; k < 4; k++) {
        var a = spin + k * Math.PI / 2;
        ctx.moveTo(land.x + Math.cos(a) * r * 0.55, land.y + Math.sin(a) * r * 0.55);
        ctx.lineTo(land.x + Math.cos(a) * r * 1.22, land.y + Math.sin(a) * r * 1.22);
      }
      ctx.stroke();

      // product tag pinned to the target square's corner
      var label = String(state.col * state.row);
      var fs = Math.round(clamp(cell * 0.24, 13, 22));
      ctx.font = '700 ' + fs + 'px ' + FONT;
      var tw = ctx.measureText(label).width + fs * 0.7;
      var tx = land.x + cell / 2 - tw - 3, ty = land.y - cell / 2 + 3;
      ctx.fillStyle = C.brass;
      roundRectPath(tx, ty, tw, fs * 1.3, fs * 0.35);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tx + tw / 2, ty + fs * 0.68);
      ctx.restore();
    }

    function ballPos(s, t) {
      return {
        x: lerp(s.x0, s.x1, t),
        y: lerp(s.y0, s.y1, t) - 4 * s.arcH * t * (1 - t)
      };
    }

    function drawBall(s, now) {
      var t = clamp((now - s.t0) / s.dur, 0, 1);
      var pos = ballPos(s, t);
      var ground = { x: lerp(s.x0, s.x1, t), y: lerp(s.y0, s.y1, t) };
      var lift = Math.sin(Math.PI * t);
      ctx.fillStyle = 'rgba(0,20,40,' + (0.28 - lift * 0.12).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y + 4, 7 - lift * 2, 3 - lift, 0, 0, Math.PI * 2);
      ctx.fill();
      for (var i = 4; i >= 1; i--) {
        var tp = ballPos(s, Math.max(0, t - i * 0.035));
        ctx.globalAlpha = 0.18 * (1 - i / 5);
        ctx.fillStyle = s.kind === 'enemy' ? '#ffd0b8' : '#ffffff';
        circle(tp.x, tp.y, 4 + i * 1.2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      var br = (s.kind === 'enemy' ? 5 : 6) * (1 + lift * 0.4);
      ctx.fillStyle = '#1d1a1a';
      circle(pos.x, pos.y, br); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      circle(pos.x - br * 0.35, pos.y - br * 0.35, br * 0.3); ctx.fill();
      return t;
    }

    function spawnParts(kind, x, y, n, opts) {
      opts = opts || {};
      var now = performance.now();
      for (var i = 0; i < n; i++) {
        var a = opts.angle != null ? opts.angle + (Math.random() - 0.5) * (opts.spread || 1) : Math.random() * Math.PI * 2;
        var sp = (opts.speed || 80) * (0.5 + Math.random());
        state.parts.push({
          kind: kind, x0: x, y0: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + (opts.lift || 0),
          g: opts.g == null ? 300 : opts.g,
          r: (opts.r || 4) * (0.6 + Math.random() * 0.8),
          color: opts.color, t0: now, dur: (opts.dur || 700) * (0.7 + Math.random() * 0.6),
          rot: Math.random() * 6
        });
      }
    }

    function drawParts(now) {
      state.parts = state.parts.filter(function (p) { return now - p.t0 < p.dur; });
      state.parts.forEach(function (p) {
        var t = (now - p.t0) / 1000, f = (now - p.t0) / p.dur;
        var x = p.x0 + p.vx * t, y = p.y0 + p.vy * t + 0.5 * p.g * t * t;
        if (p.kind === 'drop') {
          ctx.globalAlpha = 0.9 * (1 - f);
          ctx.fillStyle = p.color || '#e9fbff';
          circle(x, y, p.r); ctx.fill();
        } else if (p.kind === 'spark') {
          ctx.globalAlpha = 1 - f;
          ctx.fillStyle = p.color || '#ffd84a';
          circle(x, y, p.r * (1 - f * 0.6)); ctx.fill();
        } else if (p.kind === 'smoke') {
          ctx.globalAlpha = 0.45 * (1 - f);
          ctx.fillStyle = p.color || '#d8d4dd';
          circle(x, y, p.r * (1 + f * 2.2)); ctx.fill();
        } else if (p.kind === 'bubble') {
          ctx.globalAlpha = 0.8 * (1 - f);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          circle(x, y, p.r); ctx.stroke();
        } else if (p.kind === 'rubble') {
          ctx.globalAlpha = 1 - f * f;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot + t * 5);
          ctx.fillStyle = p.color || C.stoneShade;
          ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
          ctx.restore();
        }
      });
      ctx.globalAlpha = 1;
    }

    function drawFlashes(now) {
      state.flashes = state.flashes.filter(function (f) { return now - f.t0 < f.dur; });
      state.flashes.forEach(function (f) {
        var p = (now - f.t0) / f.dur;
        var r = f.r * (0.4 + p * 0.9);
        var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, 'rgba(255,248,210,' + (1 - p) + ')');
        g.addColorStop(0.35, 'rgba(255,190,60,' + (0.9 * (1 - p)) + ')');
        g.addColorStop(0.7, 'rgba(230,80,30,' + (0.6 * (1 - p)) + ')');
        g.addColorStop(1, 'rgba(230,80,30,0)');
        ctx.fillStyle = g;
        circle(f.x, f.y, r); ctx.fill();
        if (f.ring) {
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - p)) + ')';
          ctx.lineWidth = 3;
          circle(f.x, f.y, f.r * 0.5 + p * f.r * 1.4); ctx.stroke();
        }
      });
    }

    function addStamp(text, x, y, color, size, delay) {
      state.stamps.push({ text: text, x: x, y: y, color: color, size: size, t0: performance.now() + (delay || 0) });
    }

    function drawStamps(now) {
      state.stamps = state.stamps.filter(function (s) { return now - s.t0 < 1300; });
      state.stamps.forEach(function (s) {
        var age = now - s.t0;
        if (age < 0) return;
        var sc = age < 220 ? easeOutBack(age / 220) : 1;
        var a = age > 950 ? 1 - (age - 950) / 350 : 1;
        var y = s.y - state.cellPx * 0.6 - (REDUCED ? 0 : age * 0.025);
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.translate(s.x, y);
        ctx.scale(sc, sc);
        ctx.rotate(-0.06);
        ctx.font = '700 ' + s.size + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = s.size * 0.2;
        ctx.strokeStyle = C.ink;
        ctx.strokeText(s.text, 0, 0);
        ctx.fillStyle = s.color;
        ctx.fillText(s.text, 0, 0);
        ctx.restore();
      });
    }

    // After a miss: an arrow from the splash, pointing the way to turn
    // the dial, with the number of clicks in a brass disc.
    function drawHints(now) {
      state.hints = state.hints.filter(function (h) { return now - h.t0 < 3800; });
      state.hints.forEach(function (h) {
        var age = now - h.t0;
        var a = age > 3200 ? 1 - (age - 3200) / 600 : 1;
        var cell = state.cellPx;
        var dx = h.axis === 'col' ? h.dir : 0, dy = h.axis === 'row' ? -h.dir : 0;
        var nudge = REDUCED ? 0 : Math.sin(age / 180) * 4;
        var sx = h.x + dx * cell * 0.3, sy = h.y + dy * cell * 0.3;
        var ex = h.x + dx * (cell * 0.95 + nudge), ey = h.y + dy * (cell * 0.95 + nudge);
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        [[C.ink, 11], [C.brass, 6]].forEach(function (st) {
          ctx.strokeStyle = st[0];
          ctx.lineWidth = st[1];
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          var hx = -dx * 12, hy = -dy * 12;
          ctx.moveTo(ex + hx - dy * 10, ey + hy - dx * 10);
          ctx.lineTo(ex, ey);
          ctx.lineTo(ex + hx + dy * 10, ey + hy + dx * 10);
          ctx.stroke();
        });
        var bx = ex + dx * 20, by = ey + dy * 20;
        var br = clamp(cell * 0.2, 13, 19);
        ctx.fillStyle = C.brass;
        circle(bx, by, br); ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = C.ink;
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.font = '700 ' + Math.round(br * 1.25) + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(h.amount, bx, by + 1);
        ctx.restore();
      });
    }

    function drawGull(now) {
      if (REDUCED) return;
      if (!state.gull) {
        if (now > state.nextGullAt) {
          var dir = Math.random() < 0.5 ? 1 : -1;
          state.gull = {
            dir: dir, x: dir > 0 ? -40 : state.W + 40,
            y: 20 + Math.random() * Math.max(40, state.gridOriginY + state.gridH * 0.4),
            speed: 55 + Math.random() * 35, last: now
          };
        }
        return;
      }
      var gl = state.gull;
      gl.x += gl.dir * gl.speed * (now - gl.last) / 1000;
      gl.last = now;
      gl.y += Math.sin(now / 700) * 0.2;
      if (gl.x < -60 || gl.x > state.W + 60) {
        state.gull = null;
        state.nextGullAt = now + 14000 + Math.random() * 14000;
        return;
      }
      var flap = Math.sin(now / 110) * 7;
      ctx.save();
      ctx.fillStyle = 'rgba(0,20,40,0.18)';
      ctx.beginPath();
      ctx.ellipse(gl.x + 16, gl.y + 40, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(gl.x - 14, gl.y - flap * 0.4);
      ctx.quadraticCurveTo(gl.x - 7, gl.y - 8 - flap, gl.x, gl.y);
      ctx.quadraticCurveTo(gl.x + 7, gl.y - 8 - flap, gl.x + 14, gl.y - flap * 0.4);
      ctx.stroke();
      ctx.strokeStyle = '#2b3a44';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // =====================================================
    // MAIN DRAW LOOP
    // =====================================================
    function drawScene() {
      if (state.screen !== 'playing' || !state.W || !state.H) return;
      var now = performance.now();

      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.clearRect(0, 0, state.W, state.H);
      if (state.shake > 0.3 && !REDUCED) {
        ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
      }

      drawSea(now);
      drawBeach(now);
      drawGrid();
      drawPegs(now);
      drawFleet(now);
      drawFort(now);
      drawAim(now);

      var landed = [];
      state.shots.forEach(function (s) {
        if (drawBall(s, now) >= 1) landed.push(s);
      });
      drawFlashes(now);
      drawParts(now);
      drawStamps(now);
      drawHints(now);
      drawGull(now);

      if (landed.length) {
        state.shots = state.shots.filter(function (s) { return landed.indexOf(s) === -1; });
        landed.forEach(function (s) { s.onLand(); });
      }
      state.shake = state.shake > 0.3 ? state.shake * 0.86 : 0;
    }

    function loop() {
      drawScene();
      if (state.screen === 'playing' && currentLevel().moving) {
        var now = performance.now();
        if (now - state.lastFleetRender > 300) {
          renderFleet();
          state.lastFleetRender = now;
        }
        renderBeat(now);
      }
      requestAnimationFrame(loop);
    }

    // =====================================================
    // SIDEBAR + HEADER
    // =====================================================
    function renderTurn(animate) {
      var p = currentPlayer();
      var color = TUNE.PLAYER_COLORS[p];
      els.turnName.textContent = PN[p];
      els.turnBadge.textContent = p.charAt(0);
      els.turnBanner.style.setProperty('--player', color);
      if (animate && !REDUCED) {
        els.turnBanner.classList.remove('swap');
        void els.turnBanner.offsetWidth;
        els.turnBanner.classList.add('swap');
      }
    }

    function renderLevelBanner() {
      var lvl = currentLevel();
      els.levelCity.textContent = lvl.city;
      els.levelCountry.textContent = lvl.country;
    }

    function cannonIcon(id) {
      var s = CANNON_SHAPE[id] || CANNON_SHAPE.twelve;
      var len = Math.round(s.len * 120), th = Math.round(s.thick * 120);
      return '<svg viewBox="0 0 52 26" aria-hidden="true">' +
        '<rect x="' + (8) + '" y="' + (12 - th / 2) + '" width="' + len + '" height="' + th + '" rx="2" fill="currentColor"/>' +
        '<circle cx="9" cy="19" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
        '</svg>';
    }

    function renderCannonSelect() {
      var ids = currentLevel().cannons;
      if (ids.indexOf(state.cannonId) === -1) state.cannonId = ids[0];
      var lvl = currentLevel();
      els.cannonSelect.innerHTML = '';
      ids.slice().sort(function (a, b) { return maxPowderFor(a) - maxPowderFor(b); }).forEach(function (id) {
        var c = cannonFor(id);
        var reach = Math.min(c.maxPowder, lvl.cols);
        var btn = document.createElement('button');
        btn.className = 'cannon-btn' + (id === state.cannonId ? ' selected' : '');
        btn.setAttribute('aria-pressed', id === state.cannonId ? 'true' : 'false');
        btn.title = c.label + ': reaches column ' + reach + ', reloads in ' + (c.reloadMs / 1000) + ' seconds';
        btn.innerHTML = cannonIcon(id) +
          '<span class="cb-name">' + c.label.replace('-POUNDER', '-pounder') + '</span>' +
          '<span class="cb-reach">' + (reach >= lvl.cols ? 'reaches all' : 'reaches ' + reach) + '</span>';
        btn.addEventListener('click', function () {
          if (state.inFlight || state.cannonId === id) return;
          state.cannonId = id;
          sfx.click();
          clampDials();
          renderCannonSelect();
          renderDials();
        });
        els.cannonSelect.appendChild(btn);
      });
    }

    function clampDials() {
      var lvl = currentLevel();
      state.col = clamp(state.col, 1, maxReachableCol());
      state.row = clamp(state.row, 1, lvl.rows);
      state.fuse = lvl.moving ? clamp(state.fuse, 0, TUNE.MAX_FUSE) : 0;
      els.fuseDial.classList.toggle('hidden', !lvl.moving);
    }

    function renderDials() {
      var lvl = currentLevel();
      els.colValue.textContent = state.col;
      els.rowValue.textContent = state.row;
      els.fuseValue.textContent = state.fuse;
      var limits = {
        col: [1, maxReachableCol()], row: [1, lvl.rows], fuse: [0, lvl.moving ? TUNE.MAX_FUSE : 0]
      };
      document.querySelectorAll('[data-dial]').forEach(function (b) {
        var d = b.getAttribute('data-dial'), dir = parseInt(b.getAttribute('data-dir'), 10);
        var v = state[d];
        b.disabled = state.inFlight || (dir < 0 ? v <= limits[d][0] : v >= limits[d][1]);
      });
      els.rangeEquation.innerHTML = state.col + ' × ' + state.row + ' = <span class="eq-product">' + (state.col * state.row) + '</span>';
      els.comboGrid.style.gridTemplateColumns = 'repeat(' + state.col + ', 11px)';
      var total = state.col * state.row, html = '';
      for (var i = 0; i < total; i++) html += '<span class="combo-dot"></span>';
      els.comboGrid.innerHTML = html;
      var left = liveShips(state.fleet).length;
      els.harbor.setAttribute('aria-label', lvl.city + ' harbour. Aiming at column ' + state.col + ', row ' + state.row +
        '. ' + left + (left === 1 ? ' ship' : ' ships') + ' left.');
    }

    function bumpValue(el) {
      if (REDUCED) return;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }

    function changeDial(dial, dir) {
      if (state.screen !== 'playing' || state.overlay || state.inFlight) return;
      var lvl = currentLevel();
      var before = state[dial];
      if (dial === 'col') state.col = clamp(state.col + dir, 1, maxReachableCol());
      else if (dial === 'row') state.row = clamp(state.row + dir, 1, lvl.rows);
      else if (dial === 'fuse' && lvl.moving) state.fuse = clamp(state.fuse + dir, 0, TUNE.MAX_FUSE);
      if (state[dial] === before) return;
      sfx.click();
      renderDials();
      bumpValue(dial === 'col' ? els.colValue : dial === 'row' ? els.rowValue : els.fuseValue);
    }

    function renderWalls() {
      els.wallSegments.innerHTML = '';
      for (var i = 0; i < TUNE.FORT_WALLS; i++) {
        var seg = document.createElement('div');
        seg.className = 'wall-seg' + (i < state.fortWalls ? '' : ' broken');
        els.wallSegments.appendChild(seg);
      }
      els.wallSegments.parentNode.setAttribute('aria-label', 'Fort walls: ' + state.fortWalls + ' of ' + TUNE.FORT_WALLS + ' standing');
    }

    function renderCoins() {
      els.coinCount.textContent = state.coinsShown;
    }

    function arrowFor(ship, steps) {
      if (!ship.moving || ship.slack <= 0) return '';
      var h = shipHeadingAtSteps(ship, steps);
      if (ship.orientation === 'h') return h > 0 ? ' →' : ' ←';
      return h > 0 ? ' ↑' : ' ↓';
    }

    function renderFleet() {
      var steps = currentSteps();
      els.fleetStatus.innerHTML = '';
      state.fleet.forEach(function (ship) {
        var sunk = isSunk(ship);
        var cells = shipCellsAtSteps(ship, steps);
        var li = document.createElement('li');
        li.className = 'ship-row' + (sunk ? ' sunk' : '');
        var sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = ship.sail;
        var name = document.createElement('span');
        name.className = 'ship-name';
        name.textContent = ship.name;
        var where = document.createElement('span');
        where.className = 'ship-where';
        if (sunk) {
          where.textContent = 'Sunk';
        } else {
          var cs = cells.map(function (c) { return c[0]; }), rs = cells.map(function (c) { return c[1]; });
          where.textContent = ship.orientation === 'h'
            ? 'row ' + rs[0] + ', columns ' + cs[0] + ' to ' + cs[2] + arrowFor(ship, steps)
            : 'column ' + cs[0] + ', rows ' + rs[0] + ' to ' + rs[2] + arrowFor(ship, steps);
        }
        var segs = document.createElement('span');
        segs.className = 'ship-segs';
        ship.hits.forEach(function (h) {
          var pip = document.createElement('span');
          pip.className = 'seg-pip' + (h ? ' hit' : '');
          segs.appendChild(pip);
        });
        li.appendChild(sw); li.appendChild(name); li.appendChild(segs); li.appendChild(where);
        els.fleetStatus.appendChild(li);
      });
    }

    // The beat: one dot per second between moves, turning red on the
    // move itself -- so "every 4 seconds" is something you can count.
    function renderBeat(now) {
      var lvl = currentLevel();
      if (!lvl.moving) return;
      var stepMs = lvl.moveEverySec * 1000;
      var into = (now - state.fleetStartTime) % stepMs;
      var lit = Math.floor(into / 1000) + 1;
      var justMoved = into < 350;
      var key = lit + (justMoved ? 'm' : '');
      if (key === state.lastBeat) return;
      state.lastBeat = key;
      var html = '';
      for (var i = 1; i <= lvl.moveEverySec; i++) {
        html += '<span class="' + (justMoved ? 'move' : (i <= lit ? 'on' : '')) + '"></span>';
      }
      els.beat.innerHTML = html;
    }

    function flashFeedback(msg, ok) {
      els.feedback.textContent = msg;
      els.feedback.className = ok ? 'ok' : 'bad';
    }

    // ---------- coins flying into the chest ----------
    function flyCoins(x, y, n) {
      if (!n) return;
      state.coins += n;
      var rect = els.harbor.getBoundingClientRect();
      var icon = els.chest.querySelector('svg').getBoundingClientRect();
      var sx = rect.left + x - 11, sy = rect.top + y - 11;
      var tx = icon.left + icon.width / 2 - 11, ty = icon.top + icon.height / 2 - 11;
      for (var i = 0; i < n; i++) {
        (function (i) {
          setTimeout(function () {
            if (REDUCED || !Element.prototype.animate) { arriveCoin(); return; }
            var c = document.createElement('div');
            c.className = 'coin';
            c.style.left = sx + 'px';
            c.style.top = sy + 'px';
            els.coinLayer.appendChild(c);
            var dx = tx - sx, dy = ty - sy;
            var anim = c.animate([
              { transform: 'translate(0,0) scale(.5)' },
              { transform: 'translate(' + (dx * 0.3 + (i % 2 ? 30 : -30)) + 'px,' + (dy * 0.3 - 110) + 'px) scale(1.25)', offset: 0.4 },
              { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.8)' }
            ], { duration: 820, easing: 'cubic-bezier(.45,0,.55,1)' });
            anim.onfinish = function () { c.remove(); arriveCoin(); };
          }, 260 + i * 150);
        })(i);
      }
    }

    function arriveCoin() {
      state.coinsShown = Math.min(state.coins, state.coinsShown + 1);
      renderCoins();
      sfx.coin();
      if (REDUCED) return;
      els.chest.classList.remove('bump');
      void els.chest.offsetWidth;
      els.chest.classList.add('bump');
      setTimeout(function () { els.chest.classList.remove('bump'); }, 180);
    }

    function celebrate(count) {
      if (REDUCED) return;
      var colors = ['#f0b441', '#7cc9ff', '#ff9f7c', '#8be39a', '#e0442f', '#f6ead0'];
      for (var i = 0; i < count; i++) {
        var piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = (Math.random() * 0.5) + 's';
        piece.style.animationDuration = (1.4 + Math.random() * 1) + 's';
        els.confetti.appendChild(piece);
        (function (p) { setTimeout(function () { p.remove(); }, 3200); })(piece);
      }
    }

    // =====================================================
    // RELOAD / TRACKING / ENEMY FIRE
    // =====================================================
    function startReload() {
      var c = cannonFor(state.cannonId);
      state.locked = true;
      state.reloadStart = performance.now();
      state.reloadDur = c.reloadMs;
      els.fireBtn.disabled = true;
      els.fireLabel.textContent = 'Loading…';
      els.fireFill.style.transition = 'none';
      els.fireFill.style.width = '0%';
      requestAnimationFrame(function () {
        els.fireFill.style.transition = 'width ' + c.reloadMs + 'ms linear';
        els.fireFill.style.width = '100%';
      });
      if (state.reloadTimeoutId) clearTimeout(state.reloadTimeoutId);
      state.reloadTimeoutId = setTimeout(function () {
        state.reloadTimeoutId = null;
        state.locked = false;
        els.fireBtn.disabled = false;
        els.fireLabel.textContent = 'Fire!';
        els.fireFill.style.transition = 'none';
        els.fireFill.style.width = '0%';
      }, c.reloadMs);
    }

    // Cancels any in-progress reload and unlocks the trigger -- called
    // whenever a level starts/restarts, so a reload begun on a port you
    // left early can't leave FIRE stuck disabled on the next one.
    function cancelReload() {
      if (state.reloadTimeoutId) { clearTimeout(state.reloadTimeoutId); state.reloadTimeoutId = null; }
      state.locked = false;
      state.inFlight = false;
      els.fireBtn.disabled = false;
      els.fireLabel.textContent = 'Fire!';
      els.fireFill.style.transition = 'none';
      els.fireFill.style.width = '0%';
    }

    function track(record) {
      record.game = 'cannon-battle';
      record.session_id = state.sessionId;
      record.player = currentPlayer();
      return fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).catch(function () { /* tracking is best-effort, never blocks the game */ });
    }

    function stopBroadside() {
      if (state.broadsideTimer) { clearInterval(state.broadsideTimer); state.broadsideTimer = null; }
      state.warn = null;
    }

    // Every so often a ship glows red for a moment, then fires at the fort.
    function startBroadside() {
      stopBroadside();
      state.broadsideTimer = setInterval(function () {
        var live = liveShips(state.fleet).filter(function (s) { return !s.sinkT0; });
        if (!live.length || state.roundOver) return;
        var shooter = live[Math.floor(Math.random() * live.length)];
        state.warn = { ship: shooter, t0: performance.now() };
        sfx.warn();
        setTimeout(function () {
          if (!state.warn || state.warn.ship !== shooter) return;
          state.warn = null;
          if (state.roundOver || state.screen !== 'playing' || isSunk(shooter)) return;
          enemyFire(shooter);
        }, 900);
      }, TUNE.BROADSIDE_MS);
    }

    function enemyFire(shooter) {
      var now = performance.now();
      var pose = shipPose(shooter, now, currentSteps());
      var fw = state.fortW;
      var to = { x: state.fortX + (Math.random() - 0.5) * fw * 0.6, y: fortTopY() + Math.random() * fw * 0.08 };
      state.flashes.push({ x: pose.cx, y: pose.cy, r: state.cellPx * 0.7, t0: now, dur: 260 });
      spawnParts('smoke', pose.cx, pose.cy, 6, { speed: 30, g: -20, r: 7, dur: 900 });
      sfx.enemy();

      state.shots.push({
        kind: 'enemy',
        x0: pose.cx, y0: pose.cy, x1: to.x, y1: to.y,
        t0: now, dur: 1100, arcH: arcHeightFor(pose.cx, pose.cy, to.x, to.y) * 0.8,
        onLand: function () {
          // The round already ended this frame (see fire()'s onLand) --
          // don't keep damaging a fort whose fleet was just cleared.
          if (state.roundOver) return;
          var brokenMerlon = DAMAGE_ORDER[TUNE.FORT_WALLS - state.fortWalls];
          state.fortWalls = Math.max(0, state.fortWalls - 1);
          state.shake = 14;
          var t = performance.now();
          state.flashes.push({ x: to.x, y: to.y, r: 34, t0: t, dur: 380 });
          if (brokenMerlon != null) {
            spawnParts('rubble', merlonCenterX(brokenMerlon), fortTopY() - 8, 10,
              { angle: -Math.PI / 2, spread: 2.2, speed: 140, g: 520, r: 4, dur: 900 });
          }
          spawnParts('smoke', to.x, to.y, 8, { speed: 35, g: -25, r: 8, dur: 1100 });
          sfx.crumble();
          renderWalls();
          if (state.fortWalls === 0) {
            state.roundOver = true;
            stopBroadside();
            setTimeout(showLose, 600);
          }
        }
      });
    }

    // =====================================================
    // FIRING
    // =====================================================
    function hintSentence(h) {
      var n = h.amount;
      if (h.axis === 'col') return 'Splash! ' + n + (n === 1 ? ' column' : ' columns') + ' to the ' + (h.dir > 0 ? 'right.' : 'left.');
      return 'Splash! ' + n + (n === 1 ? ' row ' : ' rows ') + (h.dir > 0 ? 'up.' : 'down.');
    }

    function fire() {
      if (state.locked || state.inFlight || state.overlay || state.screen !== 'playing') return;
      var live = liveShips(state.fleet);
      if (!live.length) return;

      var shot = { col: state.col, row: state.row };
      var fireSteps = currentSteps();
      var impactSteps = fireSteps + state.fuse;
      var res = evaluateShot(shot, state.fleet, impactSteps);
      if (!res) return;

      var now = performance.now();
      startReload();
      state.inFlight = true;
      renderDials();
      state.recoil = 1;
      var tip = muzzlePoint();
      state.flashes.push({ x: tip.x, y: tip.y, r: 30, t0: now, dur: 220, ring: true });
      spawnParts('smoke', tip.x, tip.y, 9, { angle: state.barrelAngle, spread: 1.2, speed: 60, g: -30, r: 7, dur: 900 });
      spawnParts('spark', tip.x, tip.y, 8, { angle: state.barrelAngle, spread: 0.7, speed: 160, g: 200, r: 2.5, dur: 350 });
      state.shake = 6;
      sfx.fire();

      var landing = cellCenter(state.col, state.row);
      var lvl = currentLevel();
      var flightDur = impactFlightDurationMs(impactSteps, lvl.moveEverySec, now - state.fleetStartTime);
      var firedFuse = state.fuse;

      state.shots.push({
        kind: 'player',
        x0: tip.x, y0: tip.y, x1: landing.x, y1: landing.y,
        t0: now, dur: flightDur, arcH: arcHeightFor(tip.x, tip.y, landing.x, landing.y),
        onLand: function () {
          var t = performance.now();
          var sunk = false;
          state.inFlight = false;
          if (res.hit) {
            sunk = applyHit(res.ship, res.segmentIndex);
            sfx.hit();
            state.shake = 9;
            state.flashes.push({ x: landing.x, y: landing.y, r: state.cellPx * 0.75, t0: t, dur: 480, ring: true });
            spawnParts('spark', landing.x, landing.y, 16, { speed: 170, g: 260, r: 3, dur: 600 });
            spawnParts('smoke', landing.x, landing.y, 7, { speed: 30, g: -30, r: 8, dur: 1100 });
            if (!sunk) addStamp('Hit!', landing.x, landing.y, C.signal, Math.round(clamp(state.cellPx * 0.5, 26, 50)));
            if (sunk) {
              res.ship.sinkPose = shipPose(res.ship, t, currentSteps());
              res.ship.sinkT0 = t + 300;
              setTimeout(sfx.sink, 300);
              addStamp('Sunk!', landing.x, landing.y, C.brass, Math.round(clamp(state.cellPx * 0.62, 32, 62)), 200);
              flashFeedback('You sank the ' + res.ship.name + '!', true);
            } else {
              flashFeedback('Hit! The ' + res.ship.name + ' is on fire.', true);
            }
            flyCoins(landing.x, landing.y, coinsForShot(true, sunk));
          } else {
            sfx.splash();
            state.flashes.push({ x: landing.x, y: landing.y, r: state.cellPx * 0.4, t0: t, dur: 160 });
            spawnParts('drop', landing.x, landing.y, 18, { angle: -Math.PI / 2, spread: 1.3, speed: 190, g: 520, r: 3.2, dur: 700 });
            addStamp('Splash!', landing.x, landing.y, '#ffffff', Math.round(clamp(state.cellPx * 0.36, 20, 36)));
            var peg = { col: shot.col, row: shot.row, fadeAt: lvl.moving ? t + 6000 : 0 };
            state.pegs = state.pegs.filter(function (p) { return p.col !== peg.col || p.row !== peg.row; });
            state.pegs.push(peg);
            var hint = aimHint(res);
            if (hint) {
              state.hints = [{ axis: hint.axis, dir: hint.dir, amount: hint.amount, x: landing.x, y: landing.y, t0: t }];
              flashFeedback(hintSentence(hint), false);
            }
          }

          var fleetSunk = isFleetSunk(state.fleet);
          track({
            hit: res.hit, sunk: sunk, fleetCleared: fleetSunk,
            col: shot.col, row: shot.row, fuse: firedFuse,
            cannon: state.cannonId, level: state.level
          });

          renderFleet();

          if (fleetSunk) {
            // Guarded so a broadside that dropped the fort to 0 walls in
            // this same frame (see enemyFire's onLand) can't also pop the
            // win card on top of the lose card -- whichever terminal shot
            // resolves first in this batch wins the round. The hit itself
            // is still credited/tracked above either way.
            if (!state.roundOver) {
              state.roundOver = true;
              stopBroadside();
              // Replaying an earlier port doesn't unlock anything new.
              state.unlockedLevel = Math.max(state.unlockedLevel, Math.min(TUNE.LEVELS.length, state.level + 1));
              // Only if still on the board -- a shot flushed on leaving
              // for the map (see showMap) already counted, but shouldn't
              // pop a win card over a different screen.
              if (state.screen === 'playing') setTimeout(showWin, 1500);
            }
          } else {
            state.turn++;
            renderTurn(true);
          }
          renderDials();
        }
      });
    }

    function newFleet() {
      cancelReload();
      state.roundOver = false;
      state.fleet = generateFleet(state.level, Math.random);
      state.fleet.forEach(function (s, i) { s.seed = i * 1.7 + Math.random() * 3; });
      state.fortWalls = TUNE.FORT_WALLS;
      state.fleetStartTime = performance.now();
      state.shots = [];
      state.parts = [];
      state.flashes = [];
      state.pegs = [];
      state.stamps = [];
      state.hints = [];
      state.coins = 0;
      state.coinsShown = 0;
      state.lastBeat = '';
      renderCoins();
      renderWalls();
      renderFleet();
      startBroadside();
    }

    // =====================================================
    // WIN / LOSE CARDS
    // =====================================================
    function openOverlay(kind, title, text, coins, buttons) {
      state.overlay = kind;
      els.overlayTitle.textContent = title;
      els.overlayText.textContent = text;
      els.overlayCoins.innerHTML = '';
      for (var i = 0; i < Math.min(coins, 30); i++) {
        var c = document.createElement('span');
        c.className = 'coin';
        c.style.animationDelay = (i * 60) + 'ms';
        els.overlayCoins.appendChild(c);
      }
      els.overlayButtons.innerHTML = '';
      buttons.forEach(function (b, i) {
        var btn = document.createElement('button');
        btn.className = 'btn ' + b.cls;
        btn.textContent = b.label;
        btn.addEventListener('click', b.onClick);
        els.overlayButtons.appendChild(btn);
        if (i === 0) setTimeout(function () { btn.focus(); }, 50);
      });
      els.overlay.classList.remove('hidden');
    }

    function closeOverlay() {
      state.overlay = null;
      els.overlay.classList.add('hidden');
    }

    function showWin() {
      if (state.screen !== 'playing') return;
      sfx.fanfare();
      celebrate(80);
      var lvl = currentLevel();
      var next = state.level < TUNE.LEVELS.length ? levelFor(state.level + 1) : null;
      var coinText = ' You found ' + state.coins + ' gold coins.';
      if (next) {
        openOverlay('win', 'Fleet sunk!',
          'You chased every ship out of ' + lvl.city + '.' + coinText + ' ' + next.city + ' needs you next.',
          state.coins, [
            { label: 'Sail to ' + next.city, cls: 'btn-fire', onClick: function () { showMap({ voyageFrom: state.level }); } },
            { label: 'Back to the map', cls: 'btn-quiet', onClick: function () { showMap(); } }
          ]);
      } else {
        openOverlay('win', 'The Caribbean is safe!',
          'All five ports are defended.' + coinText + ' What a crew!',
          state.coins, [
            { label: 'Back to the map', cls: 'btn-brass', onClick: function () { showMap(); } }
          ]);
      }
    }

    function showLose() {
      if (state.screen !== 'playing') return;
      sfx.sad();
      openOverlay('lose', 'The fort needs mending',
        'The ships knocked down every wall. Mend them and keep firing. Every ship you already hit stays hit.',
        0, [{ label: 'Mend the walls', cls: 'btn-brass', onClick: rally }]);
    }

    function rally() {
      closeOverlay();
      state.roundOver = false;
      state.fortWalls = TUNE.FORT_WALLS;
      renderWalls();
      startBroadside();
    }

    // =====================================================
    // THE VOYAGE MAP
    // =====================================================
    var chartEls = { ports: [], legs: [], voyager: null };

    function svg(tag, attrs, parent) {
      var el = document.createElementNS(SVGNS, tag);
      Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      if (parent) parent.appendChild(el);
      return el;
    }

    function shipGlyph(parent, color) {
      var g = svg('g', {}, parent);
      svg('path', { d: 'M-15 2 L15 2 L10 10 L-11 10 Z', fill: '#70421f', stroke: '#2c2415', 'stroke-width': 1.5 }, g);
      svg('path', { d: 'M-2 1 V-20', stroke: '#2c2415', 'stroke-width': 1.6 }, g);
      svg('path', { d: 'M-1 -19 Q9 -12 -1 -3 Z', fill: color || '#f6ead0', stroke: '#2c2415', 'stroke-width': 1.2 }, g);
      svg('path', { d: 'M-3 -17 Q-13 -10 -3 -2 Z', fill: color || '#f6ead0', stroke: '#2c2415', 'stroke-width': 1.2 }, g);
      svg('path', { d: 'M-2 -20 L5 -23 L-2 -25', fill: '#e0442f' }, g);
      return g;
    }

    function buildChart() {
      var s = els.chart;
      s.setAttribute('viewBox', '0 0 ' + CHART.WIDTH + ' ' + CHART.HEIGHT);
      s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      var defs = svg('defs', {}, s);
      var pat = svg('pattern', { id: 'waves', width: 52, height: 30, patternUnits: 'userSpaceOnUse' }, defs);
      svg('path', { d: 'M4 10 q5 -5 10 0 t10 0 M30 25 q5 -5 10 0 t10 0', fill: 'none', stroke: '#1f6f86', 'stroke-opacity': 0.2, 'stroke-width': 1.4 }, pat);

      svg('rect', { width: CHART.WIDTH, height: CHART.HEIGHT, fill: '#a3d9dc' }, s);
      svg('rect', { width: CHART.WIDTH, height: CHART.HEIGHT, fill: 'url(#waves)' }, s);

      var rose = CHART.project(CHART.ROSE[0], CHART.ROSE[1]);
      var rh = svg('g', {}, s);
      for (var k = 0; k < 16; k++) {
        var a = k * Math.PI / 8;
        svg('line', { class: 'rhumb', x1: rose[0], y1: rose[1], x2: rose[0] + Math.cos(a) * 2000, y2: rose[1] + Math.sin(a) * 2000 }, rh);
      }

      var landG = svg('g', {}, s);
      var shapes = Object.keys(CHART.LAND).map(function (key) { return { d: CHART.polygonPath(CHART.LAND[key]) }; });
      CHART.ISLETS.forEach(function (e) {
        var p = CHART.project(e[0], e[1]);
        shapes.push({ ellipse: [p[0], p[1], e[2] * CHART.COSLAT * CHART.K, e[3] * CHART.K, e[4]] });
      });
      ['shallows', 'beach', 'land'].forEach(function (cls) {
        shapes.forEach(function (sh) {
          if (sh.d) svg('path', { d: sh.d, class: cls }, landG);
          else svg('ellipse', {
            cx: sh.ellipse[0], cy: sh.ellipse[1], rx: sh.ellipse[2], ry: sh.ellipse[3],
            transform: 'rotate(' + sh.ellipse[4] + ' ' + sh.ellipse[0] + ' ' + sh.ellipse[1] + ')', class: cls
          }, landG);
        });
      });

      CHART.LABELS.forEach(function (l) {
        var p = CHART.project(l[1], l[2]);
        var t = svg('text', { x: p[0], y: p[1], 'text-anchor': 'middle', class: l[3] === 'sea' ? 'sea-label' : 'land-label' }, s);
        t.textContent = l[0];
      });

      var rg = svg('g', { transform: 'translate(' + rose[0] + ' ' + rose[1] + ')' }, s);
      svg('circle', { r: 62, fill: '#f6ead0', 'fill-opacity': 0.6, stroke: '#4d3d24', 'stroke-width': 1.2 }, rg);
      svg('circle', { r: 52, fill: 'none', stroke: '#4d3d24', 'stroke-width': 0.8 }, rg);
      for (k = 0; k < 8; k++) {
        var R = k % 2 ? 36 : 58, w = R * 0.2;
        var pt = svg('g', { transform: 'rotate(' + (k * 45) + ')' }, rg);
        svg('path', { d: 'M0 ' + (-R) + ' L' + (-w) + ' ' + (-w) + ' L0 0 Z', fill: '#f6ead0', stroke: '#4d3d24', 'stroke-width': 1 }, pt);
        svg('path', { d: 'M0 ' + (-R) + ' L' + w + ' ' + (-w) + ' L0 0 Z', fill: k === 0 ? '#e0442f' : '#4d3d24', stroke: '#4d3d24', 'stroke-width': 1 }, pt);
      }
      var nt = svg('text', { y: -70, 'text-anchor': 'middle', class: 'land-label', style: 'font-size:22px;font-style:normal' }, rg);
      nt.textContent = 'N';

      var legsG = svg('g', {}, s);
      chartEls.legs = CHART.LEGS.map(function (leg) {
        return svg('path', { d: CHART.smoothPath(leg), class: 'leg ahead' }, legsG);
      });

      var portsG = svg('g', {}, s);
      chartEls.ports = CHART.PORTS.map(function (p) {
        var lvl = levelFor(p.id);
        var xy = CHART.project(p.lon, p.lat);
        var g = svg('g', {
          class: 'port', transform: 'translate(' + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1) + ')',
          tabindex: 0, role: 'button'
        }, portsG);
        svg('circle', { r: 17, class: 'pulse' }, g);
        svg('circle', { r: 27, class: 'port-ring' }, g);
        svg('circle', { r: 17, class: 'port-dot' }, g);
        var num = svg('text', { class: 'port-num', y: 1 }, g);
        num.textContent = p.id;
        var city = svg('text', { class: 'port-city', x: p.tag[0], y: p.tag[1], 'text-anchor': p.tag[2] }, g);
        city.textContent = lvl.city;
        svg('circle', { r: 30, fill: 'transparent' }, g);
        g.addEventListener('click', function () { selectPort(p.id, true); });
        g.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPort(p.id, true); }
        });
        return g;
      });

      chartEls.voyager = svg('g', { class: 'voyager' }, s);
      chartEls.voyagerFlip = svg('g', {}, chartEls.voyager);
      shipGlyph(chartEls.voyagerFlip);
    }

    function portXY(id) {
      var p = CHART.PORTS[id - 1];
      return CHART.project(p.lon, p.lat);
    }

    function placeVoyager(x, y, facingLeft) {
      chartEls.voyager.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
      chartEls.voyagerFlip.setAttribute('transform', facingLeft ? 'scale(-1 1)' : '');
    }

    // Moored beside the port rather than on it, on the side away from
    // the city name so the label stays readable.
    function mooring(id) {
      var xy = portXY(id), tag = CHART.PORTS[id - 1].tag;
      return [xy[0] + 30, xy[1] + (tag[1] > 0 ? -20 : 30)];
    }
    function parkVoyager(id) {
      var m = mooring(id);
      placeVoyager(m[0], m[1], false);
    }

    function portStatus(id) {
      if (id < state.unlockedLevel) return 'cleared';
      if (id === state.unlockedLevel) return 'current';
      return 'locked';
    }

    function updateChart() {
      chartEls.ports.forEach(function (g, i) {
        var id = i + 1, st = portStatus(id);
        var lvl = levelFor(id);
        g.setAttribute('class', 'port ' + st + (id === state.selectedPort ? ' selected' : ''));
        g.querySelector('.pulse').style.display = st === 'current' ? '' : 'none';
        g.setAttribute('aria-label', 'Port ' + id + ', ' + lvl.city + ', ' + lvl.country +
          (st === 'locked' ? ', locked' : st === 'cleared' ? ', defended' : ', next battle'));
        g.setAttribute('aria-pressed', id === state.selectedPort ? 'true' : 'false');
      });
      chartEls.legs.forEach(function (leg, i) {
        leg.setAttribute('class', 'leg ' + (i + 2 <= state.unlockedLevel ? 'sailed' : 'ahead'));
      });
      if (!state.voyaging) parkVoyager(state.unlockedLevel);
      els.voyage.innerHTML = '';
      TUNE.LEVELS.forEach(function (lvl) {
        var li = document.createElement('li');
        li.className = portStatus(lvl.id);
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = lvl.id;
        var name = document.createElement('span');
        name.textContent = lvl.city;
        li.appendChild(dot); li.appendChild(name);
        els.voyage.appendChild(li);
      });
    }

    function fleetPreview(lvl) {
      var wrap = document.createElement('div');
      wrap.className = 'fleet-icons';
      for (var i = 0; i < lvl.shipsPerFleet; i++) {
        var sv = document.createElementNS(SVGNS, 'svg');
        sv.setAttribute('viewBox', '-17 -27 34 40');
        sv.setAttribute('aria-hidden', 'true');
        shipGlyph(sv, SHIP_COLORS[i].sail);
        wrap.appendChild(sv);
      }
      return wrap;
    }

    function selectPort(id, byUser) {
      if (state.voyaging) return;
      if (byUser) { state.userPicked = true; sfx.click(); }
      state.selectedPort = id;
      var lvl = levelFor(id), st = portStatus(id);
      els.piNum.textContent = id;
      els.piNum.className = 'port-num ' + st;
      els.piCity.textContent = lvl.city;
      els.piCountry.textContent = lvl.country;
      els.piFact.textContent = lvl.fact;
      els.piFleet.innerHTML = '';
      els.piFleet.appendChild(fleetPreview(lvl));
      var note = document.createElement('span');
      note.textContent = lvl.shipsPerFleet + (lvl.shipsPerFleet === 1 ? ' ship, ' : ' ships, ') +
        (lvl.moving ? 'moving every ' + lvl.moveEverySec + ' seconds' : 'at anchor') +
        '. Board ' + lvl.cols + ' by ' + lvl.rows + '.';
      els.piFleet.appendChild(note);
      var locked = st === 'locked';
      els.setSailBtn.disabled = locked;
      els.setSailBtn.textContent = locked ? 'Locked' : 'Set sail for ' + lvl.city;
      var more = id - state.unlockedLevel;
      els.piLock.textContent = 'Win ' + (more === 1 ? 'one more battle' : more + ' more battles') + ' to sail here.';
      els.piLock.classList.toggle('hidden', !locked);
      updateChart();
    }

    // After a win: the little ship sails the dotted route to the next port.
    function animateVoyage(fromLevel) {
      var leg = chartEls.legs[fromLevel - 1];
      if (!leg || REDUCED || !leg.getTotalLength || fromLevel + 1 !== state.unlockedLevel) {
        selectPort(fromLevel + 1);
        return;
      }
      state.voyaging = true;
      var total = leg.getTotalLength(), t0 = performance.now(), dur = 2600;
      var from = mooring(fromLevel), to = mooring(fromLevel + 1);
      var p0 = leg.getPointAtLength(0), p1 = leg.getPointAtLength(total);
      var last = { x: from[0], y: from[1] };
      function step() {
        var t = Math.min(1, (performance.now() - t0) / dur);
        var e = easeInOut(t);
        var pt = leg.getPointAtLength(total * e);
        // slide off the mooring onto the route, and back off it at the end
        var off = e < 0.5 ? Math.max(0, 1 - e * 8) : 0, on = e > 0.5 ? Math.max(0, 1 - (1 - e) * 8) : 0;
        var x = pt.x + (from[0] - p0.x) * off + (to[0] - p1.x) * on;
        var y = pt.y + (from[1] - p0.y) * off + (to[1] - p1.y) * on;
        placeVoyager(x, y, x < last.x - 0.01);
        last = { x: x, y: y };
        if (t < 1) { requestAnimationFrame(step); return; }
        state.voyaging = false;
        selectPort(fromLevel + 1);
        els.setSailBtn.focus();
      }
      leg.setAttribute('class', 'leg sailed');
      requestAnimationFrame(step);
    }

    // Leaving the board for the map. A shot already fired (its outcome was
    // decided back in fire()) but still mid-flight would otherwise never
    // resolve -- drawScene() stops running off the board, so its onLand
    // (the hit + /api/track post + fleet-cleared check) would be silently
    // dropped when newFleet() next clears state.shots. Resolve it now.
    // An in-flight ENEMY shot is dropped without effect -- you're leaving
    // before it lands, so it shouldn't retroactively cost a wall. The
    // screen flips first: fire()'s onLand checks it before queuing the
    // win card, which must not pop over the map.
    function showMap(opts) {
      opts = opts || {};
      state.screen = 'map';
      state.shots.filter(function (s) { return s.kind === 'player'; }).forEach(function (s) { s.onLand(); });
      state.shots = [];
      stopBroadside();
      closeOverlay();
      els.gameScreen.classList.add('hidden');
      els.mapScreen.classList.remove('hidden');
      if (opts.voyageFrom) state.userPicked = true;
      selectPort(opts.voyageFrom ? opts.voyageFrom : (state.userPicked ? state.selectedPort : state.unlockedLevel));
      if (opts.voyageFrom) {
        if (opts.voyageFrom + 1 === state.unlockedLevel) parkVoyager(opts.voyageFrom);
        setTimeout(function () { animateVoyage(opts.voyageFrom); }, 350);
      }
      fetch('/api/sessions?game=cannon-battle')
        .then(function (r) { return r.json(); })
        .then(function (records) {
          state.unlockedLevel = Math.max(state.unlockedLevel, computeLevel(records));
          if (!state.voyaging) selectPort(state.userPicked ? state.selectedPort : state.unlockedLevel);
        })
        .catch(function () { /* offline: keep whatever this session knows */ });
    }

    function startLevel(levelId) {
      sfx.click();
      state.level = levelId;
      state.screen = 'playing';
      state.col = 1; state.row = 1; state.fuse = 0;
      els.mapScreen.classList.add('hidden');
      els.gameScreen.classList.remove('hidden');
      closeOverlay();
      renderLevelBanner();
      renderTurn(false);
      renderCannonSelect();
      clampDials();
      resizeCanvas();
      newFleet();
      renderDials();
      state.barrelAngle = targetBarrelAngle();
      var lvl = currentLevel();
      flashFeedback(levelId === 1
        ? 'Turn the column and row dials until the gold circle sits on a sail, then fire!'
        : lvl.moving
          ? 'These ships move! The pointy front shows which way they sail.'
          : 'Find a ship, dial its column and row, and fire!', true);
    }

    // =====================================================
    // INPUT
    // =====================================================
    function bindControls() {
      document.querySelectorAll('[data-dial]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          changeDial(btn.getAttribute('data-dial'), parseInt(btn.getAttribute('data-dir'), 10));
        });
      });
      els.fireBtn.addEventListener('click', fire);
      els.changePortBtn.addEventListener('click', function () { showMap(); });
      els.setSailBtn.addEventListener('click', function () {
        if (portStatus(state.selectedPort) !== 'locked') startLevel(state.selectedPort);
      });

      function syncSound() {
        var on = !sfx.isMuted();
        els.soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        els.soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
      }
      els.soundBtn.addEventListener('click', function () {
        sfx.setMuted(!sfx.isMuted());
        syncSound();
        sfx.click();
      });
      syncSound();

      document.addEventListener('keydown', function (e) {
        if (state.screen !== 'playing' || state.overlay) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        var onButton = e.target && e.target.tagName === 'BUTTON';
        var k = e.key;
        if (k === 'ArrowLeft') changeDial('col', -1);
        else if (k === 'ArrowRight') changeDial('col', 1);
        else if (k === 'ArrowUp') changeDial('row', 1);
        else if (k === 'ArrowDown') changeDial('row', -1);
        else if (k === '+' || k === '=') changeDial('fuse', 1);
        else if (k === '-' || k === '_') changeDial('fuse', -1);
        else if ((k === ' ' || k === 'Enter') && !onButton) fire();
        else return;
        e.preventDefault();
      });

      if (window.ResizeObserver) {
        new ResizeObserver(function () { if (state.screen === 'playing') resizeCanvas(); }).observe(els.harborWrap);
      } else {
        window.addEventListener('resize', function () { if (state.screen === 'playing') resizeCanvas(); });
      }
    }

    function init() {
      buildChart();
      bindControls();
      state.nextGullAt = performance.now() + 5000;
      loop();
      showMap();
    }

    init();
  })();
}

// ---------- exports for the headless smoke test ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TUNE: TUNE,
    levelFor: levelFor,
    cannonFor: cannonFor,
    maxPowderFor: maxPowderFor,
    bounceOffset: bounceOffset,
    shipCellsAtSteps: shipCellsAtSteps,
    stepsAtElapsed: stepsAtElapsed,
    impactFlightDurationMs: impactFlightDurationMs,
    cellsOverlap: cellsOverlap,
    placeShip: placeShip,
    generateFleet: generateFleet,
    liveShips: liveShips,
    isFleetSunk: isFleetSunk,
    shotResult: shotResult,
    evaluateShot: evaluateShot,
    applyHit: applyHit,
    shipHeadingAtSteps: shipHeadingAtSteps,
    aimHint: aimHint,
    coinsForShot: coinsForShot,
    SHIP_COLORS: SHIP_COLORS,
    computeLevel: computeLevel,
    playerStats: playerStats
  };
}

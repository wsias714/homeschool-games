'use strict';
// Headless smoke test for Cannon Battle.
// No DOM needed -- game.js only wires up the browser UI when a real
// `document` with a #harbor element exists, so requiring it here in plain
// Node exercises just the pure grid/fleet logic. Run: node smoke-test.js

var assert = require('assert');
var game = require('./game.js');

var failures = [];
function check(label, fn) {
  try {
    fn();
    console.log('✓ ' + label);
  } catch (e) {
    console.error('✗ ' + label + ': ' + e.message);
    failures.push(label);
  }
}

function seeded(seed) {
  // small deterministic PRNG so fleet-generation tests are reproducible
  var s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 100000) / 100000;
  };
}

// ---------- levels / cannons ----------
check('levelFor clamps to the 5-level range', function () {
  assert.strictEqual(game.levelFor(0).id, 1);
  assert.strictEqual(game.levelFor(1).id, 1);
  assert.strictEqual(game.levelFor(5).id, 5);
  assert.strictEqual(game.levelFor(99).id, 5);
});

check('every level\'s grid width is reachable by its best unlocked cannon', function () {
  game.TUNE.LEVELS.forEach(function (lvl) {
    var bestReach = Math.max.apply(null, lvl.cannons.map(game.maxPowderFor));
    assert.ok(bestReach >= lvl.cols, lvl.name + ': cols=' + lvl.cols + ' exceeds best cannon reach ' + bestReach);
  });
});

check('movement is off for levels 1-2 and on for levels 3-5 ("after level 2")', function () {
  [1, 2].forEach(function (id) { assert.strictEqual(game.levelFor(id).moving, false); });
  [3, 4, 5].forEach(function (id) { assert.strictEqual(game.levelFor(id).moving, true); });
});

check('ship count grows with level ("more ships as it gets harder")', function () {
  var counts = game.TUNE.LEVELS.map(function (l) { return l.shipsPerFleet; });
  for (var i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1], 'level ' + (i + 1) + ' should have more ships than level ' + i);
});

check('cannonFor / maxPowderFor read the cannon table', function () {
  assert.strictEqual(game.maxPowderFor('six'), 4);
  assert.strictEqual(game.maxPowderFor('twelve'), 6);
  assert.strictEqual(game.maxPowderFor('twentyfour'), 9);
  assert.strictEqual(game.maxPowderFor('nonexistent'), 0);
});

// ---------- bounce / movement ----------
check('bounceOffset zigzags between 0 and range', function () {
  var seen = [];
  for (var s = 0; s < 12; s++) seen.push(game.bounceOffset(s, 3));
  assert.deepStrictEqual(seen, [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1]);
});

check('bounceOffset never leaves [0, range] for any step, positive or negative', function () {
  for (var r = 0; r <= 5; r++) {
    for (var s = -20; s <= 20; s++) {
      var v = game.bounceOffset(s, r);
      assert.ok(v >= 0 && v <= Math.max(r, 0), 'range ' + r + ' step ' + s + ' -> ' + v);
    }
  }
});

check('bounceOffset with range 0 always returns 0 (no divide-by-zero)', function () {
  for (var s = -5; s <= 5; s++) assert.strictEqual(game.bounceOffset(s, 0), 0);
});

check('shipCellsAtSteps returns the fixed cells for a static ship regardless of steps', function () {
  var ship = { moving: false, cells: [[2, 3], [3, 3], [4, 3]] };
  assert.deepStrictEqual(game.shipCellsAtSteps(ship, 0), ship.cells);
  assert.deepStrictEqual(game.shipCellsAtSteps(ship, 50), ship.cells);
});

check('shipCellsAtSteps slides a horizontal moving ship along columns, row fixed', function () {
  var ship = { moving: true, orientation: 'h', baseCol: 1, baseRow: 2, slack: 3, phase: 0 };
  assert.deepStrictEqual(game.shipCellsAtSteps(ship, 0), [[1, 2], [2, 2], [3, 2]]);
  assert.deepStrictEqual(game.shipCellsAtSteps(ship, 2), [[3, 2], [4, 2], [5, 2]]);
});

check('shipCellsAtSteps slides a vertical moving ship along rows, column fixed', function () {
  var ship = { moving: true, orientation: 'v', baseCol: 4, baseRow: 1, slack: 2, phase: 0 };
  assert.deepStrictEqual(game.shipCellsAtSteps(ship, 0), [[4, 1], [4, 2], [4, 3]]);
  assert.deepStrictEqual(game.shipCellsAtSteps(ship, 1), [[4, 2], [4, 3], [4, 4]]);
});

check('a moving ship never drifts out of [1, cols]/[1, rows] bounds at any step', function () {
  var lvl = game.levelFor(5); // biggest board
  for (var trial = 0; trial < 20; trial++) {
    var fleet = game.generateFleet(5, seeded(900 + trial));
    fleet.forEach(function (ship) {
      for (var st = 0; st < 40; st++) {
        var cells = game.shipCellsAtSteps(ship, st);
        cells.forEach(function (c) {
          assert.ok(c[0] >= 1 && c[0] <= lvl.cols, 'col out of bounds: ' + c);
          assert.ok(c[1] >= 1 && c[1] <= lvl.rows, 'row out of bounds: ' + c);
        });
      }
    });
  }
});

check('stepsAtElapsed converts elapsed ms to whole move-ticks, 0 for static ships', function () {
  var moving = { moving: true, moveEverySec: 4 };
  assert.strictEqual(game.stepsAtElapsed(moving, 0), 0);
  assert.strictEqual(game.stepsAtElapsed(moving, 3999), 0);
  assert.strictEqual(game.stepsAtElapsed(moving, 4000), 1);
  assert.strictEqual(game.stepsAtElapsed(moving, 9000), 2);
  var still = { moving: false, moveEverySec: 0 };
  assert.strictEqual(game.stepsAtElapsed(still, 99999), 0);
});

check('impactFlightDurationMs never lets the ball land before the ship reaches the scored cell', function () {
  // fuse 0, fired right at a step boundary (0ms into it): impact step ===
  // fire step, so the ball should fly at the normal fast/minimum speed --
  // there's nothing to wait for.
  assert.strictEqual(game.impactFlightDurationMs(0, 4, 0), 650);
  // fuse 1 on a 4s-per-step level, fired right at a step boundary: must
  // wait the full 4s for the ship to reach the next step, not the old
  // fixed 650+400=1050ms (which was the bug -- landing ~3s before the
  // ship actually got there).
  assert.strictEqual(game.impactFlightDurationMs(1, 4, 0), 4000);
  // fuse 1, fired 3500ms into the current step: only 500ms left until the
  // next step -- but never below the minimum flight time.
  assert.strictEqual(game.impactFlightDurationMs(1, 4, 3500), 650);
  // fuse 2 on a 2s-per-step level (level 5), fired at a step boundary:
  // wait a full 2 steps.
  assert.strictEqual(game.impactFlightDurationMs(2, 2, 0), 4000);
  // Non-moving levels pass moveEverySec 0 -- must never divide by it or
  // return something below the floor.
  assert.strictEqual(game.impactFlightDurationMs(0, 0, 1234), 650);
});

// ---------- placement / fleet generation ----------
check('placeShip only offers vertical when the board is tall enough', function () {
  var rand = function () { return 0.99; }; // always pick vertical branch if offered
  var flat = game.placeShip(5, 1, rand);
  assert.strictEqual(flat.orientation, 'h', 'a 1-row board cannot hold a vertical ship');
  var tall = game.placeShip(5, 3, rand);
  assert.strictEqual(tall.orientation, 'v');
});

check('placeShip always produces exactly 3 in-bounds cells in a straight line', function () {
  for (var trial = 0; trial < 50; trial++) {
    var rand = seeded(trial);
    var p = game.placeShip(6, 6, rand);
    assert.strictEqual(p.cells.length, 3);
    p.cells.forEach(function (c) {
      assert.ok(c[0] >= 1 && c[0] <= 6 && c[1] >= 1 && c[1] <= 6, 'out of bounds: ' + c);
    });
    if (p.orientation === 'h') {
      assert.strictEqual(p.cells[0][1], p.cells[1][1]);
      assert.strictEqual(p.cells[1][1], p.cells[2][1]);
      assert.strictEqual(p.cells[1][0], p.cells[0][0] + 1);
      assert.strictEqual(p.cells[2][0], p.cells[0][0] + 2);
    } else {
      assert.strictEqual(p.cells[0][0], p.cells[1][0]);
      assert.strictEqual(p.cells[1][0], p.cells[2][0]);
      assert.strictEqual(p.cells[1][1], p.cells[0][1] + 1);
      assert.strictEqual(p.cells[2][1], p.cells[0][1] + 2);
    }
  }
});

check('cellsOverlap detects any shared cell between two ships', function () {
  assert.strictEqual(game.cellsOverlap([[1, 1], [2, 1]], [[2, 1], [3, 1]]), true);
  assert.strictEqual(game.cellsOverlap([[1, 1], [2, 1]], [[3, 1], [4, 1]]), false);
});

check('generateFleet produces the right ship count with no overlaps, for every level', function () {
  game.TUNE.LEVELS.forEach(function (lvl) {
    for (var trial = 0; trial < 15; trial++) {
      var fleet = game.generateFleet(lvl.id, seeded(lvl.id * 1000 + trial));
      assert.strictEqual(fleet.length, lvl.shipsPerFleet, lvl.name + ' trial ' + trial + ' got ' + fleet.length + ' ships');
      var allCells = [];
      fleet.forEach(function (s) { allCells = allCells.concat(s.cells); });
      var keys = allCells.map(function (c) { return c[0] + ',' + c[1]; });
      assert.strictEqual(new Set(keys).size, keys.length, lvl.name + ': overlapping ships in fleet');
    }
  });
});

check('generateFleet has no overlap at ANY step of drift, not just spawn (moving levels)', function () {
  // Two independently-bouncing ships (different phase/orientation/slack)
  // can start clear and still cross paths later -- a check that only
  // looks at spawn cells (t=0) misses this entirely, which is exactly
  // what let this regress silently before.
  game.TUNE.LEVELS.filter(function (lvl) { return lvl.moving; }).forEach(function (lvl) {
    for (var trial = 0; trial < 40; trial++) {
      var fleet = game.generateFleet(lvl.id, seeded(lvl.id * 5000 + trial));
      for (var step = 0; step <= 24; step++) {
        for (var i = 0; i < fleet.length; i++) {
          for (var j = i + 1; j < fleet.length; j++) {
            var ci = game.shipCellsAtSteps(fleet[i], step);
            var cj = game.shipCellsAtSteps(fleet[j], step);
            assert.strictEqual(game.cellsOverlap(ci, cj), false,
              lvl.name + ' trial ' + trial + ' step ' + step + ': ' + fleet[i].name + ' overlaps ' + fleet[j].name);
          }
        }
      }
    }
  });
});

check('generateFleet only places ships within the level\'s reachable columns/rows', function () {
  game.TUNE.LEVELS.forEach(function (lvl) {
    var fleet = game.generateFleet(lvl.id, seeded(42));
    fleet.forEach(function (ship) {
      ship.cells.forEach(function (c) {
        assert.ok(c[0] >= 1 && c[0] <= lvl.cols, lvl.name + ' col out of range: ' + c);
        assert.ok(c[1] >= 1 && c[1] <= lvl.rows, lvl.name + ' row out of range: ' + c);
      });
    });
  });
});

check('every generated ship starts with 3 unhit segments', function () {
  var fleet = game.generateFleet(3, seeded(7));
  fleet.forEach(function (s) { assert.deepStrictEqual(s.hits, [false, false, false]); });
});

// ---------- shot scoring ----------
check('shotResult reports HIT only on an exact cell match', function () {
  assert.strictEqual(game.shotResult({ col: 3, row: 2 }, [3, 2]).hit, true);
  assert.strictEqual(game.shotResult({ col: 3, row: 2 }, [3, 3]).hit, false);
});

check('shotResult reports column error before row error (fix aim first)', function () {
  var res = game.shotResult({ col: 2, row: 5 }, [4, 1]);
  assert.strictEqual(res.verdict, 'LEFT BY 2');
});

check('shotResult reports RIGHT when the column overshoots', function () {
  var res = game.shotResult({ col: 6, row: 1 }, [3, 1]);
  assert.strictEqual(res.verdict, 'RIGHT BY 3');
});

check('shotResult reports SHORT and OVER for row error once column matches', function () {
  assert.strictEqual(game.shotResult({ col: 3, row: 1 }, [3, 4]).verdict, 'SHORT BY 3');
  assert.strictEqual(game.shotResult({ col: 3, row: 5 }, [3, 2]).verdict, 'OVER BY 3');
});

check('evaluateShot hits the exact live segment at a matching cell', function () {
  var fleet = [{ id: 'a', hits: [false, false, false], moving: false, cells: [[2, 2], [3, 2], [4, 2]] }];
  var res = game.evaluateShot({ col: 3, row: 2 }, fleet, 0);
  assert.strictEqual(res.hit, true);
  assert.strictEqual(res.segmentIndex, 1);
});

check('evaluateShot never re-hits an already-hit segment -- reports a miss verdict instead', function () {
  var fleet = [{ id: 'a', hits: [false, true, false], moving: false, cells: [[2, 2], [3, 2], [4, 2]] }];
  var res = game.evaluateShot({ col: 3, row: 2 }, fleet, 0);
  assert.strictEqual(res.hit, false, 'segment 1 is already hit, this must not count as a fresh hit');
});

check('evaluateShot skips fully-sunk ships when picking a target', function () {
  var fleet = [
    { id: 'a', hits: [true, true, true], moving: false, cells: [[1, 1], [2, 1], [3, 1]] },
    { id: 'b', hits: [false, false, false], moving: false, cells: [[5, 5], [5, 6], [5, 7]] }
  ];
  var res = game.evaluateShot({ col: 5, row: 5 }, fleet, 0);
  assert.strictEqual(res.ship.id, 'b');
});

check('evaluateShot returns null once the whole fleet is sunk', function () {
  var fleet = [{ id: 'a', hits: [true, true, true], moving: false, cells: [[1, 1], [2, 1], [3, 1]] }];
  assert.strictEqual(game.evaluateShot({ col: 1, row: 1 }, fleet, 0), null);
});

check('evaluateShot judges a moving ship at its position AT THE GIVEN step, not step 0', function () {
  // ship starts at cols 1-3 row 1, drifts right; by step 2 it occupies cols 3-5
  var ship = { id: 'a', hits: [false, false, false], moving: true, orientation: 'h', baseCol: 1, baseRow: 1, slack: 3, phase: 0 };
  var missAtStart = game.evaluateShot({ col: 5, row: 1 }, [ship], 0);
  assert.strictEqual(missAtStart.hit, false, 'col 5 is not occupied at step 0');
  var hitLater = game.evaluateShot({ col: 5, row: 1 }, [ship], 2);
  assert.strictEqual(hitLater.hit, true, 'col 5 IS occupied at step 2 -- this is the whole point of the fuse mechanic');
});

// ---------- damage ----------
check('applyHit marks the segment and reports sunk only once all 3 are hit', function () {
  var ship = { hits: [false, false, false] };
  assert.strictEqual(game.applyHit(ship, 0), false);
  assert.strictEqual(game.applyHit(ship, 1), false);
  assert.strictEqual(game.applyHit(ship, 2), true);
  assert.deepStrictEqual(ship.hits, [true, true, true]);
});

check('isFleetSunk is true only once every ship\'s every segment is hit', function () {
  var fleet = [{ hits: [true, true, true] }, { hits: [true, true, false] }];
  assert.strictEqual(game.isFleetSunk(fleet), false);
  fleet[1].hits[2] = true;
  assert.strictEqual(game.isFleetSunk(fleet), true);
});

// ---------- level progression from the log ----------
check('computeLevel starts at 1 with no records', function () {
  assert.strictEqual(game.computeLevel([]), 1);
});

check('computeLevel advances one level per fleetCleared record', function () {
  var records = [{ game: 'cannon-battle', fleetCleared: true }, { game: 'cannon-battle', hit: false }];
  assert.strictEqual(game.computeLevel(records), 2);
});

check('computeLevel caps at the top level', function () {
  var records = [];
  for (var i = 0; i < 10; i++) records.push({ game: 'cannon-battle', fleetCleared: true });
  assert.strictEqual(game.computeLevel(records), game.TUNE.LEVELS.length);
});

check('computeLevel stays backward-compatible with the pre-grid log schema (only fleetCleared matters)', function () {
  var oldSchemaRecord = { game: 'cannon-battle', fleetCleared: true, bearing: 4, powder: 5, elevation: 1, mark: 5, tier: 1 };
  assert.strictEqual(game.computeLevel([oldSchemaRecord]), 2, 'old records without col/row must still count toward level progress');
});

check('computeLevel ignores records from other games', function () {
  var records = [{ game: 'times-tables', fleetCleared: true }, { game: 'times-tables', fleetCleared: true }];
  assert.strictEqual(game.computeLevel(records), 1);
});

// ---------- per-player stats ----------
check('playerStats tallies shots, hits, and sinks per boy', function () {
  var records = [
    { game: 'cannon-battle', player: 'P1', hit: true, sunk: false },
    { game: 'cannon-battle', player: 'P1', hit: false, sunk: false },
    { game: 'cannon-battle', player: 'P2', hit: true, sunk: true },
    { game: 'sound-it-out', player: 'P1', hit: true, sunk: true } // must be ignored
  ];
  var stats = game.playerStats(records);
  assert.deepStrictEqual(stats.P1, { shots: 2, hits: 1, sunk: 0 });
  assert.deepStrictEqual(stats.P2, { shots: 1, hits: 1, sunk: 1 });
});

// ---------- ship identity / heading ----------
check('every ship in a fleet has a distinct sail colour and a name from that colour\'s pool', function () {
  game.TUNE.LEVELS.forEach(function (lvl) {
    var fleet = game.generateFleet(lvl.id, seeded(lvl.id * 77));
    var colours = fleet.map(function (s) { return s.color; });
    assert.strictEqual(new Set(colours).size, colours.length, lvl.name + ': repeated sail colour');
    fleet.forEach(function (s, i) {
      var def = game.SHIP_COLORS[i];
      assert.strictEqual(s.color, def.key);
      assert.ok(def.names.indexOf(s.name) !== -1, s.name + ' is not a ' + def.key + ' name');
    });
  });
  assert.ok(game.SHIP_COLORS.length >= game.TUNE.LEVELS[game.TUNE.LEVELS.length - 1].shipsPerFleet,
    'fewer sail colours than the biggest fleet');
});

check('shipHeadingAtSteps points the way the ship actually moves next step', function () {
  var ship = { moving: true, slack: 3, phase: 0, orientation: 'h', baseRow: 1 };
  for (var s = 0; s < 12; s++) {
    var here = game.shipCellsAtSteps(ship, s)[0][0];
    var next = game.shipCellsAtSteps(ship, s + 1)[0][0];
    assert.strictEqual(game.shipHeadingAtSteps(ship, s), next > here ? 1 : -1, 'step ' + s);
  }
  assert.strictEqual(game.shipHeadingAtSteps({ moving: false, slack: 2, phase: 0 }, 5), 1);
  assert.strictEqual(game.shipHeadingAtSteps({ moving: true, slack: 0, phase: 0 }, 5), 1);
});

// ---------- miss hints / treasure ----------
check('aimHint turns a miss into "turn this dial, this way, this many clicks"', function () {
  var ship = [[4, 2]];
  var left = game.shotResult({ col: 2, row: 2 }, ship[0]);   // aimed 2 short of column 4
  assert.deepStrictEqual(game.aimHint(left), { axis: 'col', dir: 1, amount: 2 });
  var right = game.shotResult({ col: 6, row: 5 }, ship[0]);  // column is wrong first -> fix column
  assert.deepStrictEqual(game.aimHint(right), { axis: 'col', dir: -1, amount: 2 });
  var low = game.shotResult({ col: 4, row: 1 }, ship[0]);
  assert.deepStrictEqual(game.aimHint(low), { axis: 'row', dir: 1, amount: 1 });
  var high = game.shotResult({ col: 4, row: 5 }, ship[0]);
  assert.deepStrictEqual(game.aimHint(high), { axis: 'row', dir: -1, amount: 3 });
  assert.strictEqual(game.aimHint(game.shotResult({ col: 4, row: 2 }, ship[0])), null);
});

check('aimHint applied to the dials always lands on the target (column, then row)', function () {
  var target = [3, 4];
  for (var c = 1; c <= 6; c++) {
    for (var r = 1; r <= 6; r++) {
      var shot = { col: c, row: r };
      for (var guard = 0; guard < 3; guard++) {
        var h = game.aimHint(game.shotResult(shot, target));
        if (!h) break;
        shot[h.axis] += h.dir * h.amount;
      }
      assert.deepStrictEqual([shot.col, shot.row], target, 'from ' + c + ',' + r);
    }
  }
});

check('coinsForShot: 1 per hit, 2 more for a sink, none for a miss; a whole ship pays 5', function () {
  assert.strictEqual(game.coinsForShot(false, false), 0);
  assert.strictEqual(game.coinsForShot(true, false), 1);
  assert.strictEqual(game.coinsForShot(true, true), 3);
  assert.strictEqual(game.coinsForShot(true, false) * 2 + game.coinsForShot(true, true), 5);
});

// ---------- the Caribbean chart ----------
var chart = require('./chart.js');
check('every level has a port on the chart, in voyage order, inside the chart bounds', function () {
  assert.strictEqual(chart.PORTS.length, game.TUNE.LEVELS.length);
  chart.PORTS.forEach(function (p, i) {
    assert.strictEqual(p.id, game.TUNE.LEVELS[i].id);
    assert.ok(chart.inBounds(p.lon, p.lat), 'port ' + p.id + ' off the chart');
    var xy = chart.project(p.lon, p.lat);
    assert.ok(xy[0] > 0 && xy[0] < chart.WIDTH && xy[1] > 0 && xy[1] < chart.HEIGHT, 'port ' + p.id + ' projects off the SVG');
  });
});

check('each voyage leg starts at port N and ends at port N+1', function () {
  assert.strictEqual(chart.LEGS.length, chart.PORTS.length - 1);
  chart.LEGS.forEach(function (leg, i) {
    var a = chart.PORTS[i], b = chart.PORTS[i + 1];
    assert.deepStrictEqual(leg[0], [a.lon, a.lat], 'leg ' + (i + 1) + ' start');
    assert.deepStrictEqual(leg[leg.length - 1], [b.lon, b.lat], 'leg ' + (i + 1) + ' end');
  });
});

check('chart paths are well-formed SVG path data', function () {
  Object.keys(chart.LAND).forEach(function (k) {
    assert.ok(/^M[\d.\- ]+( L[\d.\- ]+)+ Z$/.test(chart.polygonPath(chart.LAND[k])), k);
  });
  chart.LEGS.forEach(function (leg, i) {
    var d = chart.smoothPath(leg);
    assert.ok(/^M[\d.\- ]+( C[\d.\- ]+)+$/.test(d), 'leg ' + (i + 1));
    assert.ok(d.indexOf('NaN') === -1);
  });
});

// ---------- report ----------
if (failures.length) {
  console.log('SMOKE TEST FAILED (' + failures.length + ' failure(s))');
  process.exit(1);
} else {
  console.log('SMOKE TEST PASSED');
  process.exit(0);
}

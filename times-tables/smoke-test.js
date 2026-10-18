'use strict';
// Headless smoke test for Times Table Trail.
// No DOM needed -- game.js only wires up the browser UI when a real
// `document` with a #grid element exists, so requiring it here in plain
// Node exercises just the pure grid logic. Run: node smoke-test.js

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

// ---------- mastery ----------
check('a cell masters after MASTERY_TARGET correct answers', function () {
  var g = {};
  for (var i = 0; i < game.TUNE.MASTERY_TARGET - 1; i++) game.applyAnswer(g, 2, 3, true);
  assert.strictEqual(game.isMastered(g[game.cellKey(2, 3)]), false);
  game.applyAnswer(g, 2, 3, true);
  assert.strictEqual(game.isMastered(g[game.cellKey(2, 3)]), true);
});

check('wrong answers never master a cell on their own', function () {
  var g = {};
  for (var i = 0; i < 10; i++) game.applyAnswer(g, 4, 5, false);
  assert.strictEqual(game.isMastered(g[game.cellKey(4, 5)]), false);
});

// ---------- no mirror shortcut ----------
check('(a,b) and (b,a) are independent facts', function () {
  var g = {};
  for (var i = 0; i < game.TUNE.MASTERY_TARGET; i++) game.applyAnswer(g, 2, 7, true);
  assert.strictEqual(game.isMastered(g[game.cellKey(2, 7)]), true);
  assert.strictEqual(game.isMastered(g[game.cellKey(7, 2)]), false);
});

// ---------- tier growth ----------
check('tier does not expand until every unlocked cell (both orientations) is mastered', function () {
  var g = {};
  var start = game.TUNE.START_MAX_FACTOR; // 2 -> unlocks (1,1) (1,2) (2,1) (2,2)
  var cells = game.unlockedCells(start);
  cells.forEach(function (p) {
    for (var i = 0; i < game.TUNE.MASTERY_TARGET; i++) game.applyAnswer(g, p[0], p[1], true);
  });
  // Un-master one cell by resetting it below target.
  g[game.cellKey(start, start)].correct = game.TUNE.MASTERY_TARGET - 1;
  assert.strictEqual(game.computeMaxFactor(g), start, 'should stay on the starting tier');

  game.applyAnswer(g, start, start, true);
  assert.strictEqual(game.computeMaxFactor(g), start + 1, 'should grow exactly one factor');
});

check('isGameComplete only true once the full 10x10 grid is mastered', function () {
  var g = {};
  game.unlockedCells(game.TUNE.FULL_MAX_FACTOR).forEach(function (p) {
    for (var i = 0; i < game.TUNE.MASTERY_TARGET; i++) game.applyAnswer(g, p[0], p[1], true);
  });
  assert.strictEqual(game.isGameComplete(g), true);

  delete g[game.cellKey(10, 10)];
  assert.strictEqual(game.isGameComplete(g), false);
});

// ---------- target selection favors least-practiced cells ----------
check('selectTarget weights toward the least-practiced unlocked cell', function () {
  var g = {};
  var maxFactor = 2;
  game.unlockedCells(maxFactor).forEach(function (p) {
    game.applyAnswer(g, p[0], p[1], true); // everyone gets 1 correct
  });
  // Make every cell except (1,1) more practiced.
  game.unlockedCells(maxFactor).forEach(function (p) {
    if (p[0] === 1 && p[1] === 1) return;
    game.applyAnswer(g, p[0], p[1], true);
  });

  var rand = function () { return 0.99; }; // never trigger review mode
  for (var i = 0; i < 20; i++) {
    var pick = game.selectTarget(g, maxFactor, rand);
    assert.deepStrictEqual(pick, [1, 1], 'least-practiced cell should always be picked when it is uniquely behind');
  }
});

check('selectTarget can surface a mastered cell for review when review-chance triggers', function () {
  var g = {};
  var maxFactor = 2;
  game.unlockedCells(maxFactor).forEach(function (p) {
    for (var i = 0; i < game.TUNE.MASTERY_TARGET; i++) game.applyAnswer(g, p[0], p[1], true);
  });
  var rand = function () { return 0; }; // always trigger review mode
  var pick = game.selectTarget(g, maxFactor, rand);
  assert.strictEqual(game.isMastered(g[game.cellKey(pick[0], pick[1])]), true);
});

// ---------- log replay ----------
check('replayLog reconstructs grid state and tier from a synthetic event log', function () {
  var records = [];
  game.unlockedCells(2).forEach(function (p) {
    for (var i = 0; i < game.TUNE.MASTERY_TARGET; i++) {
      records.push({ game: 'times-tables', a: p[0], b: p[1], correct: true });
    }
  });
  records.push({ game: 'times-tables', a: 3, b: 3, correct: true });
  records.push({ game: 'sound-it-out', a: 9, b: 9, correct: true }); // must be ignored

  var g = game.replayLog(records);
  assert.strictEqual(game.computeMaxFactor(g), 3, 'the 1-2 block is fully mastered, so tier grows to 3');
  assert.strictEqual(g[game.cellKey(9, 9)], undefined, 'records from other games must not leak in');
});

// ---------- footprint trail ordering ----------
check('masteryOrder returns cells in the chronological order they first hit MASTERY_TARGET', function () {
  var records = [
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:01Z' },
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:02Z' },
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:03Z' },
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:04Z' },
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:05Z' }, // 2,2 mastered here (3rd correct)
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:06Z' }  // 1,1 mastered here (3rd correct)
  ];
  assert.deepStrictEqual(game.masteryOrder(records), [[2, 2], [1, 1]]);
});

check('masteryOrder ignores out-of-order log entries by sorting on server_timestamp', function () {
  var records = [
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:04Z' },
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:01Z' },
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:05Z' },
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:02Z' },
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:06Z' },
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:03Z' }
  ];
  assert.deepStrictEqual(game.masteryOrder(records), [[2, 2], [1, 1]], 'should reorder by timestamp, not log order');
});

check('masteryOrder breaks equal-timestamp ties by original log order', function () {
  var records = [
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:00Z' },
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:00Z' },
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:00Z' },
    { game: 'times-tables', a: 2, b: 2, correct: true, server_timestamp: '2026-01-01T00:00:00Z' }, // 2,2 mastered here
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:00Z' },
    { game: 'times-tables', a: 1, b: 1, correct: true, server_timestamp: '2026-01-01T00:00:00Z' }  // 1,1 mastered here
  ];
  assert.deepStrictEqual(game.masteryOrder(records), [[2, 2], [1, 1]], 'identical timestamps should preserve original log order');
});

check('masteryOrder ignores records from other games', function () {
  var records = [];
  for (var i = 0; i < game.TUNE.MASTERY_TARGET; i++) {
    records.push({ game: 'sound-it-out', a: 5, b: 5, correct: true, server_timestamp: '2026-01-01T00:00:0' + i + 'Z' });
  }
  assert.deepStrictEqual(game.masteryOrder(records), []);
});

// ---------- per-cell icon variety ----------
check('every cell gets a unique icon at the "1 correct" stage, no two squares collide', function () {
  var seen = new Set();
  for (var a = 1; a <= game.TUNE.FULL_MAX_FACTOR; a++) {
    for (var b = 1; b <= game.TUNE.FULL_MAX_FACTOR; b++) {
      seen.add(game.glyphForCell(a, b, 1));
    }
  }
  assert.strictEqual(seen.size, game.TUNE.FULL_MAX_FACTOR * game.TUNE.FULL_MAX_FACTOR, 'all 100 cells should have distinct icons at stage 1');
});

check('every cell gets a unique icon at the "2 correct" stage, no two squares collide', function () {
  var seen = new Set();
  for (var a = 1; a <= game.TUNE.FULL_MAX_FACTOR; a++) {
    for (var b = 1; b <= game.TUNE.FULL_MAX_FACTOR; b++) {
      seen.add(game.glyphForCell(a, b, 2));
    }
  }
  assert.strictEqual(seen.size, game.TUNE.FULL_MAX_FACTOR * game.TUNE.FULL_MAX_FACTOR, 'all 100 cells should have distinct icons at stage 2');
});

check('a cell\'s icon is deterministic (stable across calls/sessions)', function () {
  assert.strictEqual(game.glyphForCell(4, 7, 1), game.glyphForCell(4, 7, 1));
  assert.strictEqual(game.glyphForCell(4, 7, 2), game.glyphForCell(4, 7, 2));
});

check('fog (0 correct) and the flag (mastered) stay the same icon for every cell', function () {
  assert.strictEqual(game.glyphForCell(1, 1, 0), game.FOG_ICON);
  assert.strictEqual(game.glyphForCell(9, 3, 0), game.FOG_ICON);
  assert.strictEqual(game.glyphForCell(1, 1, game.TUNE.MASTERY_TARGET), game.FLAG_ICON);
  assert.strictEqual(game.glyphForCell(9, 3, game.TUNE.MASTERY_TARGET), game.FLAG_ICON);
});

// ---------- report ----------
if (failures.length) {
  console.log('SMOKE TEST FAILED (' + failures.length + ' failure(s))');
  process.exit(1);
} else {
  console.log('SMOKE TEST PASSED');
  process.exit(0);
}

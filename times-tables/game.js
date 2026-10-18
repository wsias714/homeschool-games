// Player names come from the local server's /names.js (private). Public default is Player 1/2/3.
var PN = Object.assign({ P1: 'Player 1', P2: 'Player 2', P3: 'Player 3' }, (typeof window !== 'undefined' && window.PLAYER_NAMES) || {});
/* ============================================================
   TIMES TABLE TRAIL
   An explorer's map: a grid of multiplication facts, revealed one
   factor-block at a time. One cell glows as the "target" (the
   least-practiced fact) with a compass marker sitting on it --
   answer it right and the marker hops to the next target, the
   cell's fog clears toward a planted flag, and a footprint trail
   connects the facts mastered so far. Master a whole factor block
   and new territory unlocks.

   Grid math (pure, no DOM) lives above the DOM-wiring block below
   so smoke-test.js can require() this file headlessly in Node --
   same split used in sound-it-out/game.js and dino-roar/game.js.
   ============================================================ */

// ---------- TUNABLES (safe to fiddle with mid-session) ----------
var TUNE = {
  START_MAX_FACTOR: 2,     // the first unlocked block is 1..2 x 1..2
  FULL_MAX_FACTOR:  10,    // grid tops out at 10x10 (100 facts)
  MASTERY_TARGET:   3,     // correct answers needed to master a fact
  REVIEW_CHANCE:    0.15,  // odds a turn re-quizzes an already-mastered fact
  MAX_DIGITS:       3,     // longest typed answer (100 is 3 digits)
  TRAIL_LENGTH:     10,    // how many recent mastered cells the footprint trail keeps
  PLAYERS:          ['P1', 'P2'],
  PLAYER_COLORS:    { P1: '#b06bff', P2: '#36e07a' }
};

// ---------- PURE GRID LOGIC ----------
function cellKey(a, b) { return a + ',' + b; }

// Stable per-cell index (independent of how much of the grid is currently
// unlocked) used to deterministically assign each cell its own icon.
function cellIndex(a, b) {
  return (a - 1) * TUNE.FULL_MAX_FACTOR + (b - 1);
}

var FOG_ICON = '🌫️';
var FLAG_ICON = '🚩';

// One icon per cell at the "1 correct answer" stage -- animals.
var LAYER1_ICONS = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
  '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔',
  '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺',
  '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜',
  '🪲', '🪳', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖',
  '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬',
  '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘',
  '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄',
  '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮',
  '🐈', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝'
];

// One icon per cell at the "2 correct answers" stage -- food/treats.
var LAYER2_ICONS = [
  '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈',
  '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦',
  '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔',
  '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈',
  '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕',
  '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕',
  '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤',
  '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨',
  '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿',
  '🍩', '🍪', '🌰', '🥜', '🍯', '🍋‍🟩', '🫘', '🫙', '🥛', '🍵'
];

// The per-cell glyph for a given correct-answer count. Fog (0 correct) and
// the planted flag (mastered) look the same for every cell -- only the two
// intermediate stages get a per-cell icon, deterministically keyed off
// (a,b) so a square keeps the same icon across sessions and no two squares
// share an icon within the same stage.
function glyphForCell(a, b, correct) {
  var stageIdx = Math.min(correct, TUNE.MASTERY_TARGET);
  if (stageIdx >= TUNE.MASTERY_TARGET) return FLAG_ICON;
  if (stageIdx === 0) return FOG_ICON;
  var layer = stageIdx === 1 ? LAYER1_ICONS : LAYER2_ICONS;
  return layer[cellIndex(a, b)];
}

function isMastered(cell) {
  return !!cell && cell.correct >= TUNE.MASTERY_TARGET;
}

function unlockedCells(maxFactor) {
  var cells = [];
  for (var a = 1; a <= maxFactor; a++) {
    for (var b = 1; b <= maxFactor; b++) cells.push([a, b]);
  }
  return cells;
}

function tierMastered(gridState, maxFactor) {
  return unlockedCells(maxFactor).every(function (p) {
    return isMastered(gridState[cellKey(p[0], p[1])]);
  });
}

// Derives the current tier from grid state alone (event-sourced --
// no separately-stored "current tier" that could drift from the log).
function computeMaxFactor(gridState) {
  var maxFactor = TUNE.START_MAX_FACTOR;
  while (maxFactor < TUNE.FULL_MAX_FACTOR && tierMastered(gridState, maxFactor)) {
    maxFactor++;
  }
  return maxFactor;
}

function isGameComplete(gridState) {
  return tierMastered(gridState, TUNE.FULL_MAX_FACTOR);
}

// Picks the next fact to quiz: weighted toward the least-practiced
// unlocked, not-yet-mastered cell (this IS the "objective" the marker
// moves toward). Occasionally resurfaces a mastered cell for review.
function selectTarget(gridState, maxFactor, rand) {
  rand = rand || Math.random;
  var all = unlockedCells(maxFactor);
  var unmastered = all.filter(function (p) { return !isMastered(gridState[cellKey(p[0], p[1])]); });
  var pool = unmastered.length ? unmastered : all;

  if (rand() < TUNE.REVIEW_CHANCE) {
    var mastered = all.filter(function (p) { return isMastered(gridState[cellKey(p[0], p[1])]); });
    if (mastered.length) pool = mastered;
  }

  var counts = pool.map(function (p) {
    var c = gridState[cellKey(p[0], p[1])];
    return c ? c.correct : 0;
  });
  var minCount = Math.min.apply(null, counts);
  var leastPracticed = pool.filter(function (p, i) { return counts[i] === minCount; });
  return leastPracticed[Math.floor(rand() * leastPracticed.length)];
}

// (a,b) and (b,a) are deliberately independent facts -- no mirror
// shortcut. Mastering 3x7 does not touch 7x3's state.
function applyAnswer(gridState, a, b, correct) {
  var key = cellKey(a, b);
  var cell = gridState[key] || { correct: 0, wrong: 0 };
  if (correct) cell.correct++; else cell.wrong++;
  gridState[key] = cell;
  return gridState;
}

// Rebuilds grid state from the server's event log -- this is how
// progress survives a reload/new session with no localStorage.
function replayLog(records) {
  var gridState = {};
  records.forEach(function (r) {
    if (!r || (r.game && r.game !== 'times-tables')) return;
    applyAnswer(gridState, r.a, r.b, r.correct === true);
  });
  return gridState;
}

// The footprint trail: replays the log in chronological order and
// returns the [a,b] pairs in the order each fact FIRST crossed
// MASTERY_TARGET. Independent from replayLog's final tallies -- this
// is about *when* mastery happened, not just the end state.
function masteryOrder(records) {
  var chronological = records.filter(Boolean).sort(function (x, y) {
    return new Date(x.server_timestamp || 0) - new Date(y.server_timestamp || 0);
  });
  var counts = {};
  var seen = {};
  var order = [];

  chronological.forEach(function (r) {
    if (r.game && r.game !== 'times-tables') return;
    var key = cellKey(r.a, r.b);
    var c = counts[key] || 0;
    if (r.correct === true) c++;
    counts[key] = c;
    if (c >= TUNE.MASTERY_TARGET && !seen[key]) {
      seen[key] = true;
      order.push([r.a, r.b]);
    }
  });

  return order;
}

// ---------- DOM WIRING (only runs in a real browser) ----------
if (typeof document !== 'undefined' && document.getElementById && document.getElementById('grid')) {
  (function () {

    var MIN_CELL_PX = 28;
    var MAX_CELL_PX = 100;

    var state = {
      gridState: {},
      maxFactor: TUNE.START_MAX_FACTOR,
      turn: 0,
      target: null,
      typed: '',
      locked: false,
      cellPx: 40,
      trail: [],
      sessionId: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      sessionAnswered: 0,
      sessionCorrect: 0
    };

    var cellEls = {};
    var colLabelEls = {};
    var rowLabelEls = {};
    var cornerEl = null;
    var markerEl = null;
    var trailSvg = null;
    var trailPolyline = null;

    var els = {
      grid: document.getElementById('grid'),
      boardWrap: document.getElementById('board-wrap'),
      tierNum: document.getElementById('tier-num'),
      turnBanner: document.getElementById('turn-banner'),
      turnName: document.getElementById('turn-name'),
      factText: document.getElementById('fact-text'),
      answerDisplay: document.getElementById('answer-display'),
      feedback: document.getElementById('feedback'),
      keypad: document.getElementById('keypad'),
      questionPanel: document.getElementById('question-panel'),
      winScreen: document.getElementById('win-screen'),
      winStats: document.getElementById('win-stats'),
      confetti: document.getElementById('confetti'),
      pauseBtn: document.getElementById('pause-btn'),
      pauseScreen: document.getElementById('pause-screen'),
      pauseStats: document.getElementById('pause-stats'),
      resumeBtn: document.getElementById('resume-btn'),
      closeTabBtn: document.getElementById('close-tab-btn'),
      tierPrev: document.getElementById('tier-prev'),
      tierNext: document.getElementById('tier-next')
    };

    function currentPlayer() { return TUNE.PLAYERS[state.turn % TUNE.PLAYERS.length]; }
    function regionFor(a, b) { return Math.ceil(Math.max(a, b) / 2); }

    // ---------- grid layout math ----------
    function computeCellPx(maxFactor) {
      var availW = els.boardWrap.clientWidth - 12;
      var availH = els.boardWrap.clientHeight - 12;
      var tracks = maxFactor + 1;
      var raw = Math.floor(Math.min(availW, availH) / tracks);
      var px = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, raw));
      state.cellPx = px;
      return px;
    }

    // row 0 / col 0 are the label track; factor a/b occupy tracks a/b.
    function positionCell(el, row, col, cellPx) {
      el.style.left = (col * cellPx) + 'px';
      el.style.top = (row * cellPx) + 'px';
      el.style.width = cellPx + 'px';
      el.style.height = cellPx + 'px';
      el.style.fontSize = Math.round(cellPx * 0.42) + 'px';
    }

    function relayoutExisting(maxFactor, cellPx) {
      if (cornerEl) positionCell(cornerEl, 0, 0, cellPx);
      Object.keys(colLabelEls).forEach(function (b) {
        positionCell(colLabelEls[b], 0, parseInt(b, 10), cellPx);
      });
      Object.keys(rowLabelEls).forEach(function (a) {
        positionCell(rowLabelEls[a], parseInt(a, 10), 0, cellPx);
      });
      Object.keys(cellEls).forEach(function (key) {
        var parts = key.split(',');
        positionCell(cellEls[key], parseInt(parts[0], 10), parseInt(parts[1], 10), cellPx);
      });
      els.grid.style.width = (cellPx * (maxFactor + 1)) + 'px';
      els.grid.style.height = (cellPx * (maxFactor + 1)) + 'px';
    }

    function layoutGrid() {
      var cellPx = computeCellPx(state.maxFactor);
      relayoutExisting(state.maxFactor, cellPx);
      positionMarker();
      resizeTrailSvg();
      drawTrail();
    }

    // ---------- cell rendering ----------
    function renderCell(a, b) {
      var el = cellEls[cellKey(a, b)];
      if (!el) return;
      var cell = state.gridState[cellKey(a, b)];
      var correct = cell ? cell.correct : 0;
      var stageIdx = Math.min(correct, TUNE.MASTERY_TARGET);
      var mastered = stageIdx === TUNE.MASTERY_TARGET;

      el.className = 'cell fact region-' + regionFor(a, b) + ' ' + (mastered ? 'stage-mastered' : 'stage-' + stageIdx);
      el.innerHTML = '<span class="glyph">' + glyphForCell(a, b, correct) + '</span>';
    }

    function renderGrid() {
      for (var a = 1; a <= state.maxFactor; a++) {
        for (var b = 1; b <= state.maxFactor; b++) renderCell(a, b);
      }
    }

    function addFactCell(a, b, cellPx, animate) {
      var el = document.createElement('div');
      el.className = 'cell fact';
      positionCell(el, a, b, cellPx);
      els.grid.appendChild(el);
      cellEls[cellKey(a, b)] = el;
      renderCell(a, b);
      if (animate) {
        el.classList.add('cell-new');
        setTimeout(function () { el.classList.remove('cell-new'); }, 550);
      }
    }

    // ---------- explorer marker + footprint trail ----------
    function buildMarkerAndTrail() {
      markerEl = document.createElement('div');
      markerEl.id = 'explorer-marker';
      markerEl.innerHTML = '<span class="glyph">🧭</span>';
      els.grid.appendChild(markerEl);

      trailSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trailSvg.id = 'trail-svg';
      trailPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      trailPolyline.setAttribute('fill', 'none');
      trailPolyline.setAttribute('stroke', '#ffd23f');
      trailPolyline.setAttribute('stroke-width', '3');
      trailPolyline.setAttribute('stroke-dasharray', '6 6');
      trailPolyline.setAttribute('opacity', '0.55');
      trailSvg.appendChild(trailPolyline);
      els.grid.appendChild(trailSvg);
    }

    function positionMarker() {
      if (!state.target || !markerEl) return;
      var cellPx = state.cellPx;
      markerEl.style.width = cellPx + 'px';
      markerEl.style.height = cellPx + 'px';
      markerEl.style.fontSize = Math.round(cellPx * 0.5) + 'px';
      markerEl.style.transform = 'translate(' + (state.target[1] * cellPx) + 'px,' + (state.target[0] * cellPx) + 'px)';
    }

    function resizeTrailSvg() {
      if (!trailSvg) return;
      var size = state.cellPx * (state.maxFactor + 1);
      trailSvg.setAttribute('width', size);
      trailSvg.setAttribute('height', size);
    }

    function drawTrail() {
      if (!trailPolyline) return;
      var cellPx = state.cellPx;
      var pts = state.trail.map(function (p) {
        return (p[1] * cellPx + cellPx / 2) + ',' + (p[0] * cellPx + cellPx / 2);
      }).join(' ');
      trailPolyline.setAttribute('points', pts);
    }

    // ---------- grid construction ----------
    function buildGridDom(maxFactor) {
      var cellPx = computeCellPx(maxFactor);
      els.grid.innerHTML = '';
      cellEls = {};
      colLabelEls = {};
      rowLabelEls = {};

      cornerEl = document.createElement('div');
      cornerEl.className = 'cell label';
      positionCell(cornerEl, 0, 0, cellPx);
      els.grid.appendChild(cornerEl);

      for (var b = 1; b <= maxFactor; b++) {
        var colLabel = document.createElement('div');
        colLabel.className = 'cell label';
        colLabel.textContent = b;
        positionCell(colLabel, 0, b, cellPx);
        els.grid.appendChild(colLabel);
        colLabelEls[b] = colLabel;
      }

      for (var a = 1; a <= maxFactor; a++) {
        var rowLabel = document.createElement('div');
        rowLabel.className = 'cell label';
        rowLabel.textContent = a;
        positionCell(rowLabel, a, 0, cellPx);
        els.grid.appendChild(rowLabel);
        rowLabelEls[a] = rowLabel;

        for (var b2 = 1; b2 <= maxFactor; b2++) addFactCell(a, b2, cellPx, false);
      }

      els.grid.style.width = (cellPx * (maxFactor + 1)) + 'px';
      els.grid.style.height = (cellPx * (maxFactor + 1)) + 'px';

      buildMarkerAndTrail();
      resizeTrailSvg();
      drawTrail();
    }

    // Grows an already-built grid by exactly one factor -- only the new
    // row + column are touched, so already-explored terrain is undisturbed.
    function growGrid(oldMax, newMax) {
      var cellPx = computeCellPx(newMax);
      relayoutExisting(oldMax, cellPx);

      var colLabel = document.createElement('div');
      colLabel.className = 'cell label cell-new';
      colLabel.textContent = newMax;
      positionCell(colLabel, 0, newMax, cellPx);
      els.grid.appendChild(colLabel);
      colLabelEls[newMax] = colLabel;

      var rowLabel = document.createElement('div');
      rowLabel.className = 'cell label cell-new';
      rowLabel.textContent = newMax;
      positionCell(rowLabel, newMax, 0, cellPx);
      els.grid.appendChild(rowLabel);
      rowLabelEls[newMax] = rowLabel;

      for (var b = 1; b <= newMax; b++) addFactCell(newMax, b, cellPx, true);
      for (var a = 1; a < newMax; a++) addFactCell(a, newMax, cellPx, true);

      els.grid.style.width = (cellPx * (newMax + 1)) + 'px';
      els.grid.style.height = (cellPx * (newMax + 1)) + 'px';

      resizeTrailSvg();
      drawTrail();
    }

    // ---------- banners / fact display / feedback ----------
    function renderTurn() {
      var p = currentPlayer();
      els.turnName.textContent = PN[p].toUpperCase();
      els.turnBanner.style.color = TUNE.PLAYER_COLORS[p];
    }

    function renderTier() {
      els.tierNum.textContent = state.maxFactor;
    }

    function renderFact() {
      els.factText.textContent = state.target[0] + ' × ' + state.target[1] + ' = ';
      els.answerDisplay.textContent = state.typed;
    }

    function flashFeedback(msg, ok) {
      els.feedback.textContent = msg;
      els.feedback.className = ok ? 'ok' : 'bad';
      setTimeout(function () { els.feedback.textContent = ''; els.feedback.className = ''; }, 900);
    }

    var audioCtx = null;
    function beep(freq, dur) {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.frequency.value = freq;
        osc.connect(gain); gain.connect(audioCtx.destination);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (dur || 0.15));
        osc.start(); osc.stop(audioCtx.currentTime + (dur || 0.15));
      } catch (e) { /* no audio available -- silently skip */ }
    }

    function celebrate(count) {
      var colors = ['#ffd23f', '#7cc9ff', '#ff9f7c', '#36e07a', '#b06bff'];
      for (var i = 0; i < count; i++) {
        var piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = (Math.random() * 0.4) + 's';
        piece.style.animationDuration = (1.2 + Math.random() * 0.8) + 's';
        els.confetti.appendChild(piece);
        (function (p) { setTimeout(function () { p.remove(); }, 2200); })(piece);
      }
    }

    function pickNewTarget() {
      state.target = selectTarget(state.gridState, state.maxFactor, Math.random);
      state.typed = '';
      renderFact();
      positionMarker();
      refreshNavButtons();
    }

    // Left/right arrows nudge the practice focus to an easier/harder
    // diagonal tier square (2x2, 3x3, ...) for one question only -- the
    // next question after that reverts to the normal weighted auto-pick.
    function refreshNavButtons() {
      if (!state.target) return;
      var n = Math.max(state.target[0], state.target[1]);
      els.tierPrev.disabled = state.locked || n <= 1;
      els.tierNext.disabled = state.locked || n >= state.maxFactor;
    }

    function navTier(direction) {
      if (state.locked || !state.target) return;
      var n = Math.max(state.target[0], state.target[1]) + direction;
      if (n < 1 || n > state.maxFactor) return;
      state.target = [n, n];
      state.typed = '';
      renderFact();
      positionMarker();
      refreshNavButtons();
    }

    function handleKey(k) {
      if (state.locked) return;
      if (k === 'back') {
        state.typed = state.typed.slice(0, -1);
        renderFact();
        return;
      }
      if (k === 'go') { submitAnswer(); return; }
      if (state.typed.length < TUNE.MAX_DIGITS) {
        state.typed += k;
        renderFact();
      }
    }

    function track(a, b, correct) {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: 'times-tables',
          session_id: state.sessionId,
          player: currentPlayer(),
          a: a, b: b, correct: correct,
          tier: state.maxFactor
        })
      }).catch(function () { /* tracking is best-effort, never blocks the game */ });
    }

    // Locks input immediately on submit and unlocks only after the
    // pacing delay below has explicitly reset state.typed -- this is
    // what guarantees a clean input every turn (no stale digits carried
    // into the next question, no double-submits from a fast second tap).
    function submitAnswer() {
      if (state.locked || !state.typed || !state.target) return;
      var a = state.target[0], b = state.target[1];
      var guess = parseInt(state.typed, 10);
      var correct = guess === a * b;

      state.locked = true;
      els.keypad.classList.add('locked');
      els.pauseBtn.disabled = true;
      refreshNavButtons();

      state.sessionAnswered++;
      if (correct) state.sessionCorrect++;

      applyAnswer(state.gridState, a, b, correct);
      track(a, b, correct);

      if (correct) {
        var cell = state.gridState[cellKey(a, b)];
        if (cell.correct === TUNE.MASTERY_TARGET) {
          state.trail.push([a, b]);
          if (state.trail.length > TUNE.TRAIL_LENGTH) state.trail.shift();
        }

        flashFeedback('✓ ' + a + ' × ' + b + ' = ' + (a * b), true);
        beep(880, 0.12);
        renderGrid();
        drawTrail();

        var wasFactor = state.maxFactor;
        state.maxFactor = computeMaxFactor(state.gridState);
        var grew = state.maxFactor > wasFactor;
        var complete = isGameComplete(state.gridState);

        setTimeout(function () {
          if (complete) { showWin(); return; }
          if (grew) { growGrid(wasFactor, state.maxFactor); celebrate(40); }
          state.turn++;
          pickNewTarget();
          renderTurn();
          renderTier();
          state.locked = false;
          els.keypad.classList.remove('locked');
          els.pauseBtn.disabled = false;
        }, 700);
      } else {
        flashFeedback('Try again!', false);
        beep(160, 0.2);
        setTimeout(function () {
          state.typed = '';
          renderFact();
          state.locked = false;
          els.keypad.classList.remove('locked');
          els.pauseBtn.disabled = false;
          refreshNavButtons();
        }, 450);
      }
    }

    function showWin() {
      els.questionPanel.classList.add('hidden');
      els.winScreen.classList.remove('hidden');
      var totalCorrect = 0;
      Object.keys(state.gridState).forEach(function (k) { totalCorrect += state.gridState[k].correct; });
      els.winStats.textContent = 'All 100 facts mastered — ' + totalCorrect + ' correct answers along the way!';
      celebrate(100);
      beep(660, 0.15);
      setTimeout(function () { beep(880, 0.15); }, 150);
      setTimeout(function () { beep(1100, 0.25); }, 300);
    }

    function openPause() {
      if (state.locked || !state.target) return;
      state.locked = true;
      els.keypad.classList.add('locked');
      els.pauseBtn.disabled = true;
      els.tierPrev.disabled = true;
      els.tierNext.disabled = true;
      els.pauseStats.textContent = state.sessionAnswered + ' answered this session (' + state.sessionCorrect + ' correct).';
      els.pauseScreen.classList.remove('hidden');
    }

    function closePause() {
      els.pauseScreen.classList.add('hidden');
      state.locked = false;
      els.keypad.classList.remove('locked');
      els.pauseBtn.disabled = false;
      refreshNavButtons();
    }

    function init() {
      fetch('/api/sessions?game=times-tables')
        .then(function (r) { return r.json(); })
        .then(function (records) {
          state.gridState = replayLog(records);
          state.maxFactor = computeMaxFactor(state.gridState);
          state.trail = masteryOrder(records).slice(-TUNE.TRAIL_LENGTH);

          buildGridDom(state.maxFactor);
          renderTier();
          if (isGameComplete(state.gridState)) { showWin(); return; }
          pickNewTarget();
          renderTurn();
        })
        .catch(function () {
          state.maxFactor = TUNE.START_MAX_FACTOR;
          buildGridDom(state.maxFactor);
          renderTier();
          pickNewTarget();
          renderTurn();
          flashFeedback('Game server not running — progress won’t be saved. Open from http://localhost:8420', false);
        });

      els.keypad.addEventListener('click', function (e) {
        var k = e.target.closest('[data-key]');
        if (k) handleKey(k.getAttribute('data-key'));
      });

      document.addEventListener('keydown', function (e) {
        if (e.key >= '0' && e.key <= '9') handleKey(e.key);
        else if (e.key === 'Backspace' || e.key === 'Delete') handleKey('back');
        else if (e.key === 'Enter') handleKey('go');
      });

      els.pauseBtn.addEventListener('click', openPause);
      els.resumeBtn.addEventListener('click', closePause);
      els.closeTabBtn.addEventListener('click', function () {
        window.close();
      });
      els.tierPrev.addEventListener('click', function () { navTier(-1); });
      els.tierNext.addEventListener('click', function () { navTier(1); });

      window.addEventListener('resize', layoutGrid);
    }

    init();
  })();
}

// ---------- exports for the headless smoke test ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TUNE: TUNE,
    cellKey: cellKey,
    cellIndex: cellIndex,
    isMastered: isMastered,
    unlockedCells: unlockedCells,
    tierMastered: tierMastered,
    computeMaxFactor: computeMaxFactor,
    isGameComplete: isGameComplete,
    selectTarget: selectTarget,
    applyAnswer: applyAnswer,
    replayLog: replayLog,
    masteryOrder: masteryOrder,
    glyphForCell: glyphForCell,
    FOG_ICON: FOG_ICON,
    FLAG_ICON: FLAG_ICON
  };
}

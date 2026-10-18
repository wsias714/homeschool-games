// Player names come from the local server's /names.js (private). Public default is Player 1/2/3.
var PN = Object.assign({ P1: 'Player 1', P2: 'Player 2', P3: 'Player 3' }, (typeof window !== 'undefined' && window.PLAYER_NAMES) || {});
/* ============================================================
   SOUND IT OUT
   Say a word -> it gets scrambled with decoy letters ->
   build it back -> the computer sounds out whatever you built,
   right or wrong.

   All speech lives behind the `speech` adapter at the bottom.
   Everything above it is pure logic, so smoke-test.js can run
   the whole game headless in node.
   ============================================================ */

// ---------- TUNABLES (safe to fiddle with mid-session) ----------
var TUNE = {
  MIN_LEN:    3,     // shortest word we accept
  MAX_LEN:    8,     // longest word we accept
  EXTRA_MIN:  2,     // fewest decoy letters
  EXTRA_MAX:  4,     // most decoy letters
  MAX_ALTS:   5,     // how many guesses we ask the recognizer for
  TTS_RATE:   0.8,   // slower = easier to hear the sounds
  TTS_PITCH:  1.0,
  SPELL_GAP:  260,   // ms between letters when spelling out a win
  PHONICS_MAX: 3,    // strings this short get sounded out phonetically (see PHONICS)
  PLAYERS:    ['P1', 'P2']
};

var VOWELS = 'AEIOU';
var CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

/* Phonics table. The browser voice happily pronounces long strings ("pilwol")
   but falls back to naming letters ("cee-ay") on 2–3 char fragments — useless
   for a sounding-out game. So for short strings we respell each letter (and
   common two-letter combos) as a spoken sound and read them separated, which
   is exactly "sound it out." Consonants carry a light schwa so they voice.
   Digraphs are checked before single letters. Hand-tuned, offline, no fetch. */
var PHONICS_DIGRAPHS = {
  SH:'shh', CH:'chuh', TH:'thh', PH:'fuh', WH:'wuh', CK:'kuh', NG:'nng',
  QU:'kwuh', OO:'oo', EE:'ee', OW:'ow', OA:'oh', AI:'ay', AY:'ay', EA:'ee'
};
var PHONICS_LETTERS = {
  A:'ah', B:'buh', C:'kuh', D:'duh', E:'eh', F:'fuh', G:'guh', H:'huh',
  I:'ih', J:'juh', K:'kuh', L:'luh', M:'muh', N:'nuh', O:'oh', P:'puh',
  Q:'kwuh', R:'ruh', S:'sss', T:'tuh', U:'uh', V:'vuh', W:'wuh', X:'ks',
  Y:'yuh', Z:'zzz'
};

// ---------- pure helpers ----------

function normalizeWord(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z]/g, '');
}

function isUsableWord(s) {
  var w = normalizeWord(s);
  return w.length >= TUNE.MIN_LEN && w.length <= TUNE.MAX_LEN;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function shuffle(arr, rng) {
  rng = rng || Math.random;
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* How many decoys for a word of this length. */
function extraCountFor(len) {
  return clamp(Math.round(len / 2), TUNE.EXTRA_MIN, TUNE.EXTRA_MAX);
}

/* Build the puzzle.
   Decoys are drawn ONLY from letters the word does not contain, so there is
   never a second valid arrangement to confuse a 5-year-old. */
function makeScramble(word, rng) {
  rng = rng || Math.random;
  var w = normalizeWord(word);
  var own = {};
  for (var i = 0; i < w.length; i++) own[w[i]] = true;

  var pool = (VOWELS + CONSONANTS).split('').filter(function (c) { return !own[c]; });
  var decoys = shuffle(pool, rng).slice(0, extraCountFor(w.length));

  var letters = w.split('').concat(decoys);
  var tiles = shuffle(letters, rng).map(function (ch, idx) {
    return { id: idx, ch: ch, placedAt: null };
  });

  var slots = [];
  for (var s = 0; s < w.length; s++) slots.push(null);

  return { word: w, slots: slots, tiles: tiles, decoys: decoys };
}

/* Classic edit distance — used to match a spoken word against the words in
   the spoken sentence. */
function levenshtein(a, b) {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;

  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (j = 1; j <= b.length; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur.slice();
  }
  return prev[b.length];
}

function sentenceWords(sentence) {
  return String(sentence == null ? '' : sentence)
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(function (w) { return w.length >= TUNE.MIN_LEN; });
}

/* Given the recognizer's guesses (and optionally a sentence the child said),
   decide which word we think they meant.

   Isolated single words are the hardest case for speech recognition, so the
   sentence is the tiebreaker: whichever guess also turns up in the sentence
   is almost certainly the real word. */
function pickTarget(alternatives, sentence) {
  var alts = (alternatives || [])
    .map(normalizeWord)
    .filter(isUsableWord);

  // de-dupe, keep recognizer order (best guess first)
  var seen = {}, candidates = [];
  alts.forEach(function (a) {
    if (!seen[a]) { seen[a] = true; candidates.push(a); }
  });

  if (!candidates.length) {
    return { word: null, confident: false, candidates: [], matchedInSentence: false };
  }

  var words = sentenceWords(sentence);
  if (!words.length) {
    return {
      word: candidates[0],
      confident: candidates.length === 1,
      candidates: candidates,
      matchedInSentence: false
    };
  }

  // score each candidate by how close it gets to any word in the sentence
  var best = null;
  candidates.forEach(function (c, idx) {
    var d = Math.min.apply(null, words.map(function (w) { return levenshtein(c, w); }));
    if (!best || d < best.dist || (d === best.dist && idx < best.idx)) {
      best = { word: c, dist: d, idx: idx };
    }
  });

  var exact = candidates.filter(function (c) {
    return words.some(function (w) { return w === c; });
  });

  // reorder so the sentence-backed pick is offered first
  var ordered = [best.word].concat(candidates.filter(function (c) { return c !== best.word; }));

  return {
    word: best.word,
    confident: exact.length === 1,
    candidates: ordered,
    matchedInSentence: best.dist === 0
  };
}

function slotsToString(slots) {
  return slots.map(function (s) { return s ? s.ch : ''; }).join('');
}

function isFull(slots) {
  return slots.every(function (s) { return !!s; });
}

function checkWin(slots, word) {
  return isFull(slots) && slotsToString(slots) === normalizeWord(word);
}

/* Lowercasing matters: speechSynthesis is much more likely to *pronounce* an
   unknown string and much less likely to spell it out letter-by-letter.
   The whole game depends on wrong arrangements sounding like funny nonsense. */
function soundOutText(str) {
  return String(str || '').toLowerCase();
}

/* Respell a string as separated phonic sounds, digraphs first. */
function phonicsRespell(str) {
  var s = normalizeWord(str);
  var out = [], i = 0;
  while (i < s.length) {
    var pair = s.substr(i, 2);
    if (i + 1 < s.length && PHONICS_DIGRAPHS[pair]) {
      out.push(PHONICS_DIGRAPHS[pair]);
      i += 2;
    } else {
      out.push(PHONICS_LETTERS[s[i]] || s[i].toLowerCase());
      i += 1;
    }
  }
  return out.join(' ');
}

/* What the SOUND IT OUT button actually speaks. Long strings pronounce fine as
   one word (the fun "pilwol" mangling); short fragments get the phonics respell
   so the voice sounds them out instead of naming the letters. */
function soundOutBuild(str) {
  var w = normalizeWord(str);
  if (!w) return '';
  return w.length <= TUNE.PHONICS_MAX ? phonicsRespell(w) : w.toLowerCase();
}

// ============================================================
//  Everything below here is browser-only.
// ============================================================

if (typeof document !== 'undefined') (function () {

  // ---------- speech adapter - local API backend ----------
  var currentAudio = null;

  var speech = {
    canListen: !!navigator.mediaDevices || !!navigator.getUserMedia || !!navigator.webkitGetUserMedia,

    listen: function () {
      return new Promise(function (resolve, reject) {
        if (!speech.canListen) return reject(new Error('no-microphone'));

        var gumPromise;
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          // Must be called on navigator.mediaDevices itself — native methods like
          // this reject with "Illegal invocation" if re-bound to a different `this`.
          gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          var legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;
          if (!legacyGetUserMedia) return reject(new Error('no-microphone'));
          gumPromise = new Promise(function (res, rej) {
            legacyGetUserMedia.call(navigator, { audio: true }, res, rej);
          });
        }

        gumPromise
          .then(function (stream) {
            var minDuration = 500, maxDuration = 5000, silenceGap = 800;
            var recordingStart = Date.now();
            var silenceStart = null;

            var audioContext = new (window.AudioContext || window.webkitAudioContext)();
            var analyser = audioContext.createAnalyser();
            var source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            var mediaRecorder = new MediaRecorder(stream);
            var chunks = [];
            mediaRecorder.ondataavailable = function (e) { chunks.push(e.data); };
            mediaRecorder.onstop = function () {
              clearInterval(checkInterval);
              audioContext.close();
              var blob = new Blob(chunks, { type: 'audio/webm' });
              stream.getTracks().forEach(function (t) { t.stop(); });

              fetch('/api/stt', { method: 'POST', body: blob })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                  var transcript = (data.alternatives && data.alternatives[0]) || '';
                  resolve([transcript].concat(data.alternatives ? data.alternatives.slice(1) : []));
                })
                .catch(function (e) { reject(new Error('stt-failed: ' + e.message)); });
            };

            mediaRecorder.start();

            // Auto-stop after a beat of silence (or hit the max duration)
            var silenceThreshold = 30;
            var checkInterval = setInterval(function () {
              var elapsed = Date.now() - recordingStart;
              if (elapsed >= maxDuration) { mediaRecorder.stop(); return; }

              var dataArray = new Uint8Array(analyser.frequencyBinCount);
              analyser.getByteFrequencyData(dataArray);
              var avg = dataArray.reduce(function (a, b) { return a + b; }, 0) / dataArray.length;

              if (avg < silenceThreshold) {
                if (silenceStart === null) silenceStart = Date.now();
                if (elapsed >= minDuration && Date.now() - silenceStart > silenceGap) {
                  mediaRecorder.stop();
                }
              } else {
                silenceStart = null;
              }
            }, 100);
          })
          .catch(reject);
      });
    },

    say: function (text, opts) {
      opts = opts || {};
      return new Promise(function (resolve) {
        fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, rate: opts.rate != null ? opts.rate : TUNE.TTS_RATE })
        })
          .then(function (r) { return r.blob(); })
          .then(function (blob) {
            if (currentAudio) currentAudio.pause();
            currentAudio = new Audio(URL.createObjectURL(blob));
            currentAudio.onended = resolve;
            currentAudio.onerror = resolve;
            currentAudio.play().catch(resolve);
          })
          .catch(resolve);
      });
    },

    stop: function () {
      if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    }
  };

  // ---------- little blip for tile placement ----------
  var actx = null;
  function blip(freq) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.09, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.12);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.12);
    } catch (e) { /* audio is a nice-to-have, never fatal */ }
  }

  // ---------- dom ----------
  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    idle:    $('screen-idle'),
    listen:  $('screen-listen'),
    confirm: $('screen-confirm'),
    sentence: $('screen-sentence'),
    build:   $('screen-build'),
    win:     $('screen-win')
  };

  var SESSION_ID = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  var state = {
    puzzle: null,
    turn: 0,
    lastAlternatives: [],
    askedSentence: false,
    currentWord: null,
    currentSentence: null,
    sentenceSource: null
  };

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('hidden', k !== name);
    });
  }

  function status(msg, warn) {
    var el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('warn', !!warn);
  }

  function renderTurn() {
    var key = TUNE.PLAYERS[state.turn % TUNE.PLAYERS.length];
    var el = $('turn');
    el.textContent = PN[key].toUpperCase() + "'S TURN";
    el.className = key.toLowerCase();
  }

  // ---------- confetti ----------
  var cv = $('confetti'), cx = cv.getContext('2d'), bits = [];
  function sizeCanvas() { cv.width = window.innerWidth; cv.height = window.innerHeight; }
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);

  function burst() {
    var colors = ['#ff2e88', '#ffd23f', '#3ddc84', '#a86cff', '#ffffff'];
    for (var i = 0; i < 180; i++) {
      bits.push({
        x: cv.width / 2, y: cv.height / 3,
        vx: (Math.random() - 0.5) * 18,
        vy: Math.random() * -16 - 4,
        s: 6 + Math.random() * 10,
        c: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.4,
        life: 150
      });
    }
  }

  function tick() {
    cx.clearRect(0, 0, cv.width, cv.height);
    for (var i = bits.length - 1; i >= 0; i--) {
      var b = bits[i];
      b.vy += 0.45; b.x += b.vx; b.y += b.vy; b.rot += b.vr; b.life--;
      if (b.life <= 0 || b.y > cv.height + 40) { bits.splice(i, 1); continue; }
      cx.save();
      cx.translate(b.x, b.y); cx.rotate(b.rot);
      cx.fillStyle = b.c;
      cx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6);
      cx.restore();
    }
    requestAnimationFrame(tick);
  }
  tick();

  // ---------- flow: listening ----------
  function startListening() {
    if (!speech.canListen) {
      status('This browser has no speech recognition — use Chrome. Dad can type the word instead.', true);
      state.lastAlternatives = [];
      renderConfirm({ word: null, candidates: [], confident: false });
      show('confirm');
      return;
    }
    $('listen-prompt').textContent = 'LISTENING…';
    $('listen-hint').textContent = 'Say your word out loud!';
    show('listen');
    status('');

    speech.listen().then(function (alts) {
      state.lastAlternatives = alts;
      var pick = pickTarget(alts, '');
      renderConfirm(pick);
      show('confirm');
    }).catch(function (err) {
      status('Mic problem (' + err.message + '). Dad can type the word.', true);
      renderConfirm({ word: null, candidates: [], confident: false });
      show('confirm');
    });
  }

  // ---------- flow: confirm ----------
  function renderConfirm(pick) {
    var big = $('best-guess');
    if (pick.word) {
      big.textContent = pick.word;
      big.classList.remove('hidden');
      speech.say(soundOutText(pick.word));
    } else {
      big.classList.add('hidden');
    }

    var box = $('candidates');
    box.innerHTML = '';
    (pick.candidates || []).slice(1).forEach(function (c) {
      var b = document.createElement('button');
      b.textContent = c;
      b.onclick = function () { confirmWord(c); };
      box.appendChild(b);
    });

    $('manual-input').value = '';
  }

  // ---------- flow: word confirmed -> sentence step (required) ----------
  function confirmWord(word) {
    var w = normalizeWord(word);
    if (!isUsableWord(w)) {
      status('Words need to be ' + TUNE.MIN_LEN + '–' + TUNE.MAX_LEN + ' letters. Try another one!', true);
      return;
    }
    state.currentWord = w;
    state.currentSentence = null;
    state.sentenceSource = null;
    startSentenceStep(w);
  }

  function startSentenceStep(word) {
    show('sentence');
    status('');
    $('sentence-result').style.display = 'none';
    $('sentence-manual').style.display = 'none';
    $('sentence-show-manual').style.display = 'none';
    $('sentence-input').value = '';
    $('sentence-mic-btn').style.display = '';

    speech.say('Now use ' + soundOutText(word) + ' in a sentence.');

    // Offer the typed fallback after a moment, in case mic isn't available/working
    setTimeout(function () {
      if (!screens.sentence.classList.contains('hidden') && $('sentence-result').style.display === 'none') {
        $('sentence-show-manual').style.display = '';
      }
    }, 1500);
  }

  function recordSentenceAttempt() {
    $('sentence-mic-btn').style.display = 'none';
    $('sentence-show-manual').style.display = 'none';
    speech.listen().then(function (alts) {
      var heard = (alts && alts[0]) || '';
      state.currentSentence = heard;
      state.sentenceSource = 'mic';
      $('sentence-heard').textContent = '"' + heard + '"';
      $('sentence-result').style.display = '';
    }).catch(function () {
      status("Didn't catch that — try again or type it.", true);
      $('sentence-mic-btn').style.display = '';
      $('sentence-show-manual').style.display = '';
    });
  }

  function submitManualSentence() {
    var text = $('sentence-input').value.trim();
    if (!text) return;
    state.currentSentence = text;
    state.sentenceSource = 'manual';
    proceedToBuild();
  }

  function proceedToBuild() {
    if (!state.currentSentence) return; // sentence is required — never skip
    beginPuzzle(state.currentWord);
  }

  // ---------- flow: build ----------
  function beginPuzzle(word) {
    var w = normalizeWord(word);
    state.puzzle = makeScramble(w);
    renderPuzzle();
    show('build');
    status('');
    speech.say("Okay! Build the word " + soundOutText(w));
  }

  function renderPuzzle() {
    var p = state.puzzle;

    var slotBox = $('slots');
    slotBox.innerHTML = '';
    p.slots.forEach(function (tile, i) {
      var d = document.createElement('div');
      d.className = 'slot' + (tile ? ' filled' : '');
      d.textContent = tile ? tile.ch : '';
      if (tile) d.onclick = function () { unplace(i); };
      slotBox.appendChild(d);
    });

    var tileBox = $('tiles');
    tileBox.innerHTML = '';
    p.tiles.forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'tile' + (t.placedAt !== null ? ' used' : '');
      d.textContent = t.ch;
      d.onclick = function () { place(t); };
      tileBox.appendChild(d);
    });
  }

  function place(tile) {
    var p = state.puzzle;
    if (tile.placedAt !== null) return;
    var i = p.slots.indexOf(null);
    if (i === -1) return;
    p.slots[i] = tile;
    tile.placedAt = i;
    blip(520 + i * 60);
    renderPuzzle();
    $('slots').children[i].classList.add('pop');
    if (isFull(p.slots)) evaluate();
  }

  function unplace(i) {
    var p = state.puzzle;
    var tile = p.slots[i];
    if (!tile) return;
    tile.placedAt = null;
    p.slots[i] = null;
    blip(260);
    renderPuzzle();
  }

  function evaluate() {
    var p = state.puzzle;
    if (checkWin(p.slots, p.word)) {
      win();
    } else {
      // Wrong, but full — say it anyway. Hearing the nonsense IS the lesson.
      setTimeout(soundItOut, 250);
    }
  }

  function soundItOut() {
    var text = slotsToString(state.puzzle.slots);
    if (!text) { speech.say('Put some letters in first!'); return; }
    speech.stop();
    speech.say(soundOutBuild(text));
  }

  function trackCompletion(word) {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: SESSION_ID,
        player: TUNE.PLAYERS[state.turn % TUNE.PLAYERS.length],
        word: word,
        sentence: state.currentSentence,
        sentence_source: state.sentenceSource,
        game: 'sound-it-out'
      })
    }).catch(function () { /* tracking is best-effort, never blocks the game */ });
  }

  function win() {
    var word = state.puzzle.word;
    Array.prototype.forEach.call($('slots').children, function (el) {
      el.classList.add('correct');
    });
    blip(880);
    setTimeout(function () {
      $('win-word').textContent = word;
      show('win');
      burst();

      // say it -> spell it -> say it again
      speech.say(soundOutText(word)).then(function () {
        return word.split('').reduce(function (chain, ch) {
          return chain.then(function () {
            return new Promise(function (res) {
              speech.say(ch, { rate: 0.7 }).then(function () {
                setTimeout(res, TUNE.SPELL_GAP);
              });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        return speech.say(soundOutText(word), { rate: 0.7 });
      });

      trackCompletion(word);
      state.turn++;
      renderTurn();
    }, 700);
  }

  // ---------- wiring ----------
  $('mic-btn').onclick   = startListening;
  $('retry-btn').onclick = startListening;
  $('again-btn').onclick = function () { show('idle'); status(''); startListening(); };

  $('best-guess').onclick = function () { confirmWord($('best-guess').textContent); };

  $('manual-go').onclick = function () { confirmWord($('manual-input').value); };
  $('manual-input').onkeydown = function (e) {
    if (e.key === 'Enter') confirmWord($('manual-input').value);
  };

  // Sentence step
  $('sentence-mic-btn').onclick = recordSentenceAttempt;
  $('sentence-retry-btn').onclick = function () {
    $('sentence-result').style.display = 'none';
    $('sentence-mic-btn').style.display = '';
    recordSentenceAttempt();
  };
  $('sentence-continue-btn').onclick = proceedToBuild;
  $('sentence-show-manual').onclick = function () {
    $('sentence-manual').style.display = '';
    $('sentence-show-manual').style.display = 'none';
    $('sentence-input').focus();
  };
  $('sentence-go').onclick = submitManualSentence;
  $('sentence-input').onkeydown = function (e) {
    if (e.key === 'Enter') submitManualSentence();
  };

  $('sound-btn').onclick = soundItOut;
  $('clear-btn').onclick = function () {
    state.puzzle.tiles.forEach(function (t) { t.placedAt = null; });
    state.puzzle.slots = state.puzzle.slots.map(function () { return null; });
    renderPuzzle();
  };

  // Big friendly keyboard shortcut: space = sound it out while building.
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && !screens.build.classList.contains('hidden')) {
      e.preventDefault();
      soundItOut();
    }
  });

  renderTurn();
  show('idle');

  // Check backend connectivity
  fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ready' })
  }).catch(function () {
    status('Game server not running — open from http://localhost:8420', true);
  });

  if (!speech.canListen) {
    status('Microphone not available — you can type words instead.', true);
  }

})();

// ---------- exports for the headless smoke test ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TUNE: TUNE,
    normalizeWord: normalizeWord,
    isUsableWord: isUsableWord,
    extraCountFor: extraCountFor,
    shuffle: shuffle,
    makeScramble: makeScramble,
    levenshtein: levenshtein,
    sentenceWords: sentenceWords,
    pickTarget: pickTarget,
    slotsToString: slotsToString,
    isFull: isFull,
    checkWin: checkWin,
    soundOutText: soundOutText,
    phonicsRespell: phonicsRespell,
    soundOutBuild: soundOutBuild
  };
}

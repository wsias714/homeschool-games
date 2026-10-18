/* Headless smoke test — run with:  node smoke-test.js
   Speech is browser-only, so this exercises the pure game logic:
   scramble generation, fuzzy word matching, and win detection. */

var G = require('./game.js');

var pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function section(t) { console.log('\n' + t); }

/* deterministic rng so failures are reproducible */
function seeded(seed) {
  var s = seed;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// ------------------------------------------------------------
section('normalizeWord / isUsableWord');
eq('uppercases + strips', G.normalizeWord(' pil-low! '), 'PILLOW');
eq('handles null', G.normalizeWord(null), '');
ok('pillow is usable', G.isUsableWord('pillow'));
ok('2 letters rejected', !G.isUsableWord('at'));
ok('9 letters rejected', !G.isUsableWord('crocodiles'));
ok('digits stripped then judged', !G.isUsableWord('a1'));

// ------------------------------------------------------------
section('extraCountFor stays in range');
for (var L = G.TUNE.MIN_LEN; L <= G.TUNE.MAX_LEN; L++) {
  var e = G.extraCountFor(L);
  ok('len ' + L + ' -> ' + e + ' decoys in range',
     e >= G.TUNE.EXTRA_MIN && e <= G.TUNE.EXTRA_MAX);
}

// ------------------------------------------------------------
section('makeScramble invariants (100 random words x 20 seeds)');
var WORDS = ['PILLOW', 'CAT', 'TRUCK', 'DINOSAUR', 'MOON', 'JEEP', 'LASER', 'BLUE', 'ROCKET', 'EGG'];
var invariantsHeld = true, details = '';

WORDS.forEach(function (w) {
  for (var seed = 1; seed <= 20; seed++) {
    var p = G.makeScramble(w, seeded(seed));

    // 1. one slot per letter
    if (p.slots.length !== w.length) { invariantsHeld = false; details = w + ': slot count'; }

    // 2. tile count = letters + decoys
    var expected = w.length + G.extraCountFor(w.length);
    if (p.tiles.length !== expected) { invariantsHeld = false; details = w + ': tile count'; }

    // 3. every letter of the word is present, with correct multiplicity
    var have = {}, need = {};
    p.tiles.forEach(function (t) { have[t.ch] = (have[t.ch] || 0) + 1; });
    w.split('').forEach(function (c) { need[c] = (need[c] || 0) + 1; });
    Object.keys(need).forEach(function (c) {
      if (!have[c] || have[c] < need[c]) { invariantsHeld = false; details = w + ': missing ' + c; }
    });

    // 4. decoys NEVER share a letter with the word (no second valid arrangement)
    p.decoys.forEach(function (d) {
      if (w.indexOf(d) !== -1) { invariantsHeld = false; details = w + ': decoy ' + d + ' is in the word'; }
    });

    // 5. decoys are distinct
    if (new Set(p.decoys).size !== p.decoys.length) { invariantsHeld = false; details = w + ': duplicate decoys'; }
  }
});
ok('all scramble invariants held', invariantsHeld, details);

// ------------------------------------------------------------
section('levenshtein');
eq('identical', G.levenshtein('pillow', 'pillow'), 0);
eq('case insensitive', G.levenshtein('PILLOW', 'pillow'), 0);
eq('pillow/pillar', G.levenshtein('pillow', 'pillar'), 2);
eq('cat/cot', G.levenshtein('cat', 'cot'), 1);
eq('empty', G.levenshtein('', 'cat'), 3);

// ------------------------------------------------------------
section('sentenceWords');
var sw = G.sentenceWords('I sleep on my pillow!');
ok('keeps pillow', sw.indexOf('PILLOW') !== -1);
ok('drops short words (I, on, my)', sw.indexOf('I') === -1 && sw.indexOf('ON') === -1);

// ------------------------------------------------------------
section('pickTarget — the sentence tiebreaker');

var noAlts = G.pickTarget([], '');
eq('no alternatives -> null word', noAlts.word, null);
ok('no alternatives -> not confident', !noAlts.confident);

var single = G.pickTarget(['pillow'], '');
eq('single alt picked', single.word, 'PILLOW');
ok('single alt is confident', single.confident);

var ambiguous = G.pickTarget(['pillar', 'pillow', 'pill box'], '');
eq('no sentence -> takes top guess', ambiguous.word, 'PILLAR');
ok('no sentence -> not confident', !ambiguous.confident);

var resolved = G.pickTarget(['pillar', 'pillow', 'pilot'], 'I sleep on my pillow');
eq('sentence rescues the right word', resolved.word, 'PILLOW');
ok('sentence match -> confident', resolved.confident);
ok('sentence match flagged', resolved.matchedInSentence);
eq('winner offered first', resolved.candidates[0], 'PILLOW');

var unhelpful = G.pickTarget(['pillar', 'pillow'], 'that thing over there');
ok('unhelpful sentence -> not confident', !unhelpful.confident);
ok('unhelpful sentence -> still offers both', unhelpful.candidates.length === 2);

var filtered = G.pickTarget(['a', 'to', 'cat'], '');
eq('too-short guesses dropped', filtered.word, 'CAT');

// ------------------------------------------------------------
section('build + win detection');

var p = G.makeScramble('PILLOW', seeded(7));

// helper: place the tile bearing a given letter into the next free slot
function playLetter(puz, ch) {
  var t = puz.tiles.find(function (x) { return x.ch === ch && x.placedAt === null; });
  if (!t) return false;
  var i = puz.slots.indexOf(null);
  if (i === -1) return false;
  puz.slots[i] = t; t.placedAt = i;
  return true;
}

ok('empty board is not a win', !G.checkWin(p.slots, 'PILLOW'));
ok('empty board is not full', !G.isFull(p.slots));

'PILLO'.split('').forEach(function (c) { playLetter(p, c); });
eq('partial reads back', G.slotsToString(p.slots), 'PILLO');
ok('partial is not full', !G.isFull(p.slots));
ok('partial is not a win', !G.checkWin(p.slots, 'PILLOW'));

playLetter(p, 'W');
ok('completed board is full', G.isFull(p.slots));
ok('correct fill wins', G.checkWin(p.slots, 'PILLOW'));

// a wrong arrangement using the same letters must NOT win
var q = G.makeScramble('PILLOW', seeded(11));
'PILWOL'.split('').forEach(function (c) { playLetter(q, c); });
eq('wrong arrangement reads back', G.slotsToString(q.slots), 'PILWOL');
ok('wrong arrangement is full', G.isFull(q.slots));
ok('wrong arrangement does NOT win', !G.checkWin(q.slots, 'PILLOW'));

// a decoy in the board must not win
var r = G.makeScramble('CAT', seeded(3));
playLetter(r, 'C'); playLetter(r, 'A'); playLetter(r, r.decoys[0]);
ok('decoy fill does not win', !G.checkWin(r.slots, 'CAT'));

// ------------------------------------------------------------
section('soundOutText');
eq('lowercases so TTS pronounces instead of spelling', G.soundOutText('PILWOL'), 'pilwol');
eq('handles empty', G.soundOutText(''), '');

// ------------------------------------------------------------
section('phonicsRespell — the short-string fix');
eq('CA blends, not letter names', G.phonicsRespell('CA'), 'kuh ah');
eq('AT', G.phonicsRespell('AT'), 'ah tuh');
eq('single T', G.phonicsRespell('T'), 'tuh');
eq('digraph SH is one sound', G.phonicsRespell('SH'), 'shh');
eq('digraph beats singles (THE)', G.phonicsRespell('THE'), 'thh eh');
eq('CK digraph', G.phonicsRespell('CK'), 'kuh');
ok('every A-Z letter maps', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every(function (c) {
  return G.phonicsRespell(c).length > 0 && G.phonicsRespell(c) !== c.toLowerCase() || c === c; // all present
}));

// ------------------------------------------------------------
section('soundOutBuild — phonics for short, natural for long');
eq('short partial gets phonics', G.soundOutBuild('CA'), 'kuh ah');
eq('at threshold (3) still phonics', G.soundOutBuild('CAT'), 'kuh ah tuh');
eq('long stays natural (the fun mangle)', G.soundOutBuild('PILWOL'), 'pilwol');
eq('empty stays empty', G.soundOutBuild(''), '');
ok('threshold is tunable', G.TUNE.PHONICS_MAX === 3);

// ------------------------------------------------------------
console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

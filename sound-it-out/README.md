# Sound It Out

A voice-driven word-scramble game for the boys. A boy **says a word**
out loud → the game **scrambles its letters with a few decoys** → he **builds it back** →
the computer **sounds out whatever he built**, right or wrong. Getting a wrong
arrangement to come out as funny nonsense is the whole point — that's the feedback that
teaches the sounds.

## Purpose

- Reading: hear letters become sounds, and sounds become a word.
- Writing: the win screen shows the word huge, to copy onto a whiteboard by hand.
- No backend, no AI service, no cost — all speech is built into Chrome.

## Setup

Nothing to install. But it **must be served over http**, not opened as a file —
the microphone will not work from `file://`.

## Run

```
cd C:\Users\wades\Projects\sound-it-out
py -m http.server 8000
```

Then open **Chrome** (or Edge) at **http://localhost:8000**
The first time, Chrome asks to use the microphone — click **Allow**.

- Press the big 🎤, say one word (e.g. "pillow").
- It **always** asks you to **use it in a sentence** next — a whole sentence sharpens
  single-word recognition every time.
- Confirm the word (tap a guess, or Dad types it in the box), then build it.
- **SOUND IT OUT** (or the spacebar) speaks the current letters anytime.
- Filling all the slots correctly wins: confetti, it says + spells the word, and shows
  it huge to copy down.

### Requirements / limits

- **Chrome or Edge only.** Firefox has no speech recognition.
- **Needs internet** — recognition round-trips to Google's servers.
- Speech synthesis (the "sound it out" voice) works offline once the page is loaded.
- If speech recognition is unavailable, the **type-it-in** box runs the whole game.

## Test

Headless logic test (no browser needed):

```
node smoke-test.js
```

Covers scramble invariants (every word letter present; decoys never overlap the word),
the sentence-tiebreaker matcher, and win/lose detection.

## Status

Built 2026-07-20 (solo build with Dad). First live check went well: long wrong
arrangements ("pilwol") pronounce as intended; only **2–3 letter** fragments failed
(the voice named the letters). Fixed 2026-07-21 with an offline phonics table — short
strings are now respelled as separated sounds ("CA" → "kuh ah"). The **use-it-in-a-
sentence** step is now always on. Logic verified headless — 58/58 pass.
**Not yet played live with all three boys** as a full session.

### Tunables

Top of `game.js`, `TUNE` object: word length limits, decoy count, TTS rate, number of
recognizer guesses, and the player names.

### Ideas parked for next time

- Show a picture of the word.
- A timer / race-the-clock mode.
- Keep a per-boy score.

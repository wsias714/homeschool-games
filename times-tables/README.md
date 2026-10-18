# Times Table Trail

A multiplication-facts drill for two players, built for `/homeschool-coding`
sessions, styled as an explorer's map. Each unlocked factor block is its own
territory (grassland, desert, forest, tundra, volcanic), a compass marker
sits on the current target fact, and a footprint trail connects the cells
mastered most recently. Answering the target right hops the marker to the
next least-practiced fact and slowly clears the fog off the map, one cell
at a time, toward a full 10×10 = 100-fact grid.

## How it works

- Player 1 and Player 2 take turns. Whoever's turn it is types the product for
  the target fact (`3 × 4 = ?`) shown in the sidebar, using the on-screen
  keypad (ENTER/DELETE included) or a physical keyboard. Input locks briefly
  after each answer so the display always resets cleanly before the next turn.
- The grid starts unlocked only for **1s and 2s** (`maxFactor = 2`) and is
  built to fill the screen at that size. Once every unlocked cell has been
  answered correctly `MASTERY_TARGET` (3) times, the grid **grows live** —
  a new row and column animate in for the next factor, then the whole board
  resizes down to fit — out to the full 10×10 = 100 facts.
- Each cell has 4 visual stages as it's practiced: fog 🌫️ → footprint 👣 →
  landmark 🏕️ → flag planted 🚩 (mastered).
- `(a,b)` and `(b,a)` are tracked and drilled **independently** — there's no
  shortcut where knowing 3×7 auto-solves 7×3. Both have to be earned.
- Target selection weights toward whichever unlocked, not-yet-mastered cell
  has the fewest correct answers so far, with an occasional (~15%) pop quiz
  on an already-mastered cell so old facts don't fade.
- Progress is **not** stored in `localStorage`. On load the game replays its
  full answer history from the shared game-server's log to rebuild exactly
  where it left off (grid state, tier, and the footprint trail) — see "Run"
  below, this is why the server is required.

## Run

Needs the shared homeschool game server (it's what makes progress persist
across sessions):

```
cd ../coding/game-server
./start-server.sh
```

Then open **http://localhost:8420/times-tables**

Progress: **http://localhost:8420/times-tables/tracker.html** — a
session-by-session log of every answer, plus a lifetime 10×10 heatmap
showing how many times each individual fact has been answered correctly
(e.g. "2×2 — 5 correct").

If the server isn't running, the game still plays, but a message says
progress won't be saved and it starts fresh each reload.

## Test

Headless logic test (no browser needed):

```
node smoke-test.js
```

Covers mastery thresholds, independent (a,b)/(b,a) tracking, tier-growth
gating, least-practiced target weighting, log-replay reconstruction, and
footprint-trail ordering (`masteryOrder`).

## Tunables

Top of `game.js`, `TUNE` object: `START_MAX_FACTOR`, `FULL_MAX_FACTOR`,
`MASTERY_TARGET` (correct answers to master a fact), `REVIEW_CHANCE`
(odds of a review question), `TRAIL_LENGTH` (how many recent mastered
cells the footprint trail keeps), and the player names/colors.

## Status

Built 2026-09-10, reskinned 2026-09-12 after first live feedback from Wade:
full-viewport layout (board + always-visible keypad, no more small centered
card), a guaranteed input-lock/reset pause between turns so stale digits
can't carry over, a grid that only builds what's unlocked and grows live
tier-by-tier instead of showing the whole dimmed 10×10 up front, and the
explorer-map reskin (terrain regions, fog→flag cell stages, a hopping
compass marker, and a persistent footprint trail). Verified headless
(smoke test, 11 cases) plus static/manual reasoning against the real game
server — no browser automation available in this environment, so **final
visual sign-off is Wade's**. Not yet played live with the boys post-reskin.

### Parked ideas for next session

- Let the boys pick a skin for the explorer marker (rocket, treasure ship,
  race car — kept generic on purpose so this is a live Phase-1 choice).
- A visible per-player streak counter.
- Confetti/beep polish pass once played live and we see what lands.

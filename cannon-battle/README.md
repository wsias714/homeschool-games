# Cannon Battle

A Caribbean harbour battle for two players, built for `/homeschool-coding`
sessions after a tall-ships festival visit. Five real ports, each a
bigger numbered grid than the last, with a fleet of ships anchored — or, from
port 3 on, slowly drifting — across three consecutive cells, Battleship
style. Dial in POWDER SCOOPS (the column) and ELEVATION NOTCHES (the row) to
name the exact cell a ship sits on, and fire.

## How it works

- Player 1 and Player 2 take turns firing one shot each. Whoever's turn it is
  picks a cannon, dials a column and row, and pulls the trigger.
- **The board is a numbered grid**, not an abstract bearing/range pair. Every
  column and row is labeled on screen. `COLUMN × ROW` is shown as both the
  equation and a countable dot array, the same mental model as Times Table
  Trail's grid — reading a ship's position off the grid and dialing those
  exact coordinates in is the core loop.
- **Each ship spans 3 cells**, placed horizontally or vertically —
  Battleship-style. A shot is judged against the live ship it landed
  closest to, and reports a direction (`SHORT BY 3`, `LEFT BY 2`) so a miss
  is information, not just failure.
- **Cannon choice caps which column you can reach**, not an abstract range —
  a real spatial trade-off. The 6-pounder only reaches column 3; the
  24-pounder reaches every column on the biggest boards but reloads in 8s
  instead of 3s. `generateFleet()` only ever places a ship within reach of
  some unlocked cannon at that level — smoke-tested across every
  level/cannon combination, so a ship the boys cannot possibly hit is never
  spawned.
- **Five ports, one unlocked at a time**, each a real Caribbean location with
  a one-line geography fact on its level-select card: Nassau (5×1, 1 ship,
  anchored) → Havana (5×3, 2 ships, anchored) → San Juan (6×4, 3 ships,
  drifting) → Port Royal (6×5, 4 ships, drifting) → Bridgetown (6×6, 5 ships,
  drifting). A port unlocks once the previous one's fleet is sunk — recomputed
  by replaying the shared game-server log, same pattern `times-tables/game.js`
  uses for its mastery grid, so progress survives a reload.
- **From port 3 on, ships drift slowly** (a deterministic back-and-forth
  bounce within the grid, so they never leave it) and a third dial appears —
  **FUSE, labeled "SQUARES TO LEAD"** — the number of move-ticks to delay the
  shot. `evaluateShot()` judges the shot against where the ship *will be* at
  impact, not where it was when fired, so a delayed shot has to be aimed at
  the ship's future cell — addition layered on top of the existing
  multiplication (current cell + lead = the cell to dial in).
- Sink every ship in a fleet to clear the port. Enemy ships fire back on a
  timer — every broadside that lands costs the fort one of its 5 wall
  segments, visibly crumbling on the skyline. Walls reset each page load
  (the per-sitting arcade challenge); **port progress persists** across
  sessions via the shared log.
- Terrain (rocks, cliffs, palm trees) frames the fort, and firing plays a
  ramrod-loading animation during reload plus a muzzle flash and drifting
  smoke puffs on release.

## Run

Needs the shared homeschool game server (it's what makes port progress
persist across sessions):

```
cd ../coding/game-server
./start-server.sh
```

Then open **http://localhost:8420/cannon-battle**

Progress: **http://localhost:8420/cannon-battle/tracker.html** — per-boy
shots/hits/accuracy/ships-sunk, plus a full shot-by-shot session log. Reads
both the current grid-based log format and shots logged before the v2
redesign (see Status below), so old sessions still display correctly.

If the server isn't running, the game still plays, but a message says
progress won't be saved and every port starts locked except Nassau.

## Test

Headless logic test (no browser needed):

```
node smoke-test.js
```

Covers: level/cannon table invariants (every level's grid width is reachable
by its best unlocked cannon; movement is off for levels 1–2 and on for 3–5);
the bounce-drift math (zigzag correctness, never out of grid bounds, safe at
zero room to move); ship-cell placement for static and moving/horizontal/
vertical ships; fleet generation (no overlaps, correct ship count and
reachable columns/rows, for every level); shot scoring in all four miss
directions; `evaluateShot` (exact hits, no re-hit of a dead segment, a
sunk ship skipped, a moving ship judged at the *future* step a FUSE delay
computes — the core lead-the-target mechanic); fleet-clear/level-advance
from log replay (backward-compatible with the pre-redesign log schema, and
ignores other games' records); and per-player stat tallying.

## Tunables

Top of `game.js`, `TUNE` object: `MAX_POWDER` (physical scoop cap), `MAX_FUSE`,
`FORT_WALLS`, `BROADSIDE_MS`, `SHIP_CELLS`, `CANNONS` (powder/column cap and
reload time per cannon), and `LEVELS` — the five ports, each with its grid
size, ship count, unlocked cannons, and `moving`/`moveEverySec`. Adding a
sixth port is a matter of appending one entry to `LEVELS` (kept within an
unlocked cannon's `maxPowder`) and a name to `SHIP_NAMES`.

## Status

Built 2026-09-15 as a solo prep session, played live with the boys across
sessions on 2026-09-15 and 2026-09-20 (54 shots, 34 hits, 4 fleets sunk —
see `tracker.html`). Two early feedback rounds (bearing/range aiming
accuracy, visual polish, a smoke-explosion muzzle effect) were folded in
under the original bearing+range aiming model — see git history / session
memory for that detail, since the model itself was later replaced.

**2026-09-21 — v2 redesign: bearing+range replaced with a numbered
Battleship grid.** Wade's feedback after the second live session asked for
five things at once: (1) make the battlefield a labeled grid and have the
math solve for the exact cell a 3-cell-long ship sits on; (2) more ships as
levels get harder; (3) another `/visual-inspect` pass plus fort terrain
(rocks/cliffs/trees) and a cannon load/fire animation; (4) more ship names
and a 5-level Caribbean map-select screen for light geography; (5) after
level 2, slow ship drift with a FUSE/timed-shot dial to lead the target.
This replaced the entire aiming model (see `game.js`'s `TUNE.LEVELS`,
`shipCellsAtSteps`, `evaluateShot`) rather than extending the old one —
pure logic and a 32-case smoke test were written and passing *before* any
rendering code, which caught two real bugs early: a moving ship's bounce
math could place it outside the grid, and a miss's "nearest cell" feedback
fallback could report a false hit on an already-destroyed ship segment.

A full `/visual-inspect` pass (headless Chromium via Playwright — the
interactive browser extension still isn't available in this environment)
covered the level-select screen (both fully-unlocked, matching Wade's real
progress, and a mocked-locked state), a static level's board/fire sequence,
and — the highest-risk untested piece — a moving-ship level's FUSE dial and
drift. That pass caught a real bug the smoke test couldn't: the sidebar's
per-ship "col/row" readout was only re-rendered on fleet spawn and after a
shot landed, so on a moving-ship level it froze at the ship's starting
position instead of tracking its live drift — silently contradicting what
the canvas correctly showed moving underneath it. Fixed by re-rendering the
sidebar on a 300ms throttle inside the main animation loop, gated to levels
with `moving: true`. Confirmed fixed with a before/after screenshot showing
the sidebar values change as the ships drift. `tracker.html` and this file
were updated for the new schema (`level`/`col`/`row`/`fuse` in place of
`tier`/`bearing`/`powder`/`elevation`/`mark`), with the shot-log table kept
backward-compatible with pre-redesign log rows.

**2026-09-21 (same day) — adversarial review, 4 correctness/security bugs
fixed.** Ran an independent adversarial pass (Grok CLI, given the same
files a human reviewer would want) specifically looking for what the v2
redesign's own smoke test couldn't catch on its own claims. Every finding
was independently reproduced against the real code before fixing:

- **Moving fleets could overlap after spawn** — confirmed at 465/600
  simulated fleets (77%) developing a genuine cell collision within 20
  steps of drift, because `generateFleet`'s overlap check only ever looked
  at each ship's placement cells (step 0), never its drift path. Two
  independently-bouncing ships with different phase/orientation/slack can
  start clear and still cross later; `evaluateShot` credits a hit to
  whichever live ship is first in the fleet array, so a shot at the
  overlap cell could silently hit the wrong ship. Fixed by checking
  `shipCellsAtSteps` overlap across a full bounce period for every
  candidate placement, not just its spawn cells; verified 0/600 after the
  fix. New smoke test checks every step, not just spawn.
- **FUSE-delayed shots could show HIT on empty water** — `fire()`'s ball
  flight time (`650 + fuse*400` ms) was completely disconnected from how
  long the ship actually takes to reach the future cell it was scored
  against (`moveEverySec` is *seconds*, not tied to that formula at all).
  A fuse=1 shot on a 4s-per-step level could visibly land ~3 seconds
  before the ship it was credited against ever got there — directly
  undermining the FUSE mechanic's whole premise. Fixed by extracting the
  timing into a pure, now-smoke-tested `impactFlightDurationMs()` that
  waits however long is really left until the scored step occurs (floored
  at a normal ballistic travel time so fuse=0 still feels immediate).
- **Firing then leaving the board (Change Port) could strand FIRE
  disabled, or silently drop a fleet-clearing hit** — `startLevel`/
  `newFleet` never cancelled a pending reload or reset the lock, and
  `showLevelSelect` never resolved a still-in-flight shot before
  `drawScene` (and its landed-shot resolution) stopped running for that
  screen. Fixed: `newFleet` now cancels any pending reload and unlocks the
  trigger; `showLevelSelect` resolves an in-flight *player* shot
  immediately (crediting/tracking it) while discarding a pending *enemy*
  one, so leaving early never costs a wall you didn't actually take.
- **A same-frame win + lose could show both overlays** — a fleet-clearing
  player shot and a fort-emptying enemy broadside landing in the same
  animation frame could each fire their own overlay/track logic
  independently. Added a `state.roundOver` flag set by whichever terminal
  shot resolves first in that frame's batch, guarding the other's overlay
  (the earlier one's hit-credit/tracking still always applies).

Plus two lower-severity fixes: the Python game server (shared by all six
games, `coding/game-server/server.py`) now rejects a missing/negative/
oversized `Content-Length` before reading the body (it's single-threaded —
an invalid one could otherwise block every game on the port), caps
`/api/track` bodies at 4KB and validates they're a JSON object, and uses
`allow_nan=False` so a `NaN`/`Infinity` field can never get written into
the log in a form that would later break `/api/sessions` for that whole
game. `tracker.html`'s shot-log table now builds cells with `textContent`
instead of `innerHTML` — every field in a tracked record is
client-supplied with no server-side content validation, so a crafted
`player` value could otherwise inject markup that ran on the next person
to open the tracker page.

Deliberately **not** fixed: a client can already POST
`{fleetCleared:true}` directly and unlock a port with zero real shots —
this is the same trust model every game on this shared server already
uses (progress is "whatever the log replays to"), not something specific
to Cannon Battle, and fixing it for real means the server independently
verifying a shot sequence rather than trusting client telemetry, a bigger
change than this pass's scope for a private LAN server two five-year-olds
use. Worth revisiting only if that trust model ever needs to change
project-wide.

**2026-09-22 — v3 look-and-feel redesign (same rules, same log).** A
design pass aimed at making the game read at a glance for kids who can't
read yet, and giving every shot a payoff. The math, levels, progression and
tracking schema are unchanged; `computeLevel` still replays the same log.

- **Voyage map** (`chart.js`): the level list became an SVG chart of the
  Caribbean with coastlines, a compass rose and the five ports. Tapping a
  port shows its city, country, a fact and a preview of its fleet. After a
  win, a little ship sails the route to the next port.
- **Readable board:** a bright top-down sea. Each ship is three sails on
  three squares, and each ship has its own sail colour, so you can see
  which squares a ship covers. The pointy bow shows which way a moving
  ship is heading. Each square shows its column × row product faintly. The
  dialed column and row light up as lanes. Columns the chosen cannon can't
  reach are hatched.
- **Feedback you can see:** a miss leaves a white peg and an arrow pointing
  the way to turn the dial, with a number for how many clicks
  (`aimHint()`). "Hit!", "Sunk!" and "Splash!" pop up on the board. Hit
  sails burn, sunk ships go under and leave floating wreckage, and gold
  coins fly into a treasure chest (`coinsForShot()`: 1 per hit, +2 for a
  sink). Before a broadside, the ship about to fire glows red.
- **Sound:** synthesized with WebAudio, no audio files. Includes a mute
  button that is remembered between visits.
- **Sidebar:** a turn badge in the player's colour, cannon buttons that say
  how far each one reaches, big dials that disable at their limits, a beat
  counter (one dot per second) on moving levels, and a fleet list with each
  ship's colour, position, heading and hit pips.
- Fonts are vendored locally (IM Fell English, Fredoka; OFL) so the game
  works offline.

Verified with the smoke test (46 cases, adding colours, heading, the hint
and whether following it reaches the ship, coins, and chart geometry) and a
headless-Chromium pass with `/api/track` mocked, so no test shots reached
the real log. The pass covered the map, the voyage animation, level 1
miss/hit/sink/win, a moving level, the fort falling and being mended (fake
clock), a 1280×720 laptop and a 390px phone. That pass found and fixed:
dials overflowing the sidebar, the Fire button squashed on short screens,
the phone header overlapping, and winning a replayed early port unlocking
one level too many.

**2026-09-23 — bigger boards, harder math.** Wade said the v3 board felt too
zoomed in and asked for a grid about 1.5–2x bigger, with harder math okay.
The change splits the difference: boards grew from 5×1 / 5×3 / 6×4 / 6×5 /
6×6 to **6×2 / 6×4 / 8×5 / 8×6 / 9×7** (hardest answer 36 → 63), cannon
reach is now 4 / 6 / 9 columns (was 3 / 5 / 6), and squares are drawn
about 15% smaller, capped at 86px, so more sea shows around the board.
Two robustness fixes came with it:
- `OVERLAP_CHECK_STEPS` is now the LCM of every possible bounce period.
  Wider boards mean longer drifts, and the old `4 × MAX_POWDER` no longer
  covered them.
- `generateFleet` restarts a fleet that gets boxed in instead of spawning
  it short-handed. That had happened on the 9×7 board; 0 short fleets in
  10,000 test generations after the fix.
You also can't fire again while your own ball is still in the air.

### Parked ideas for next session

- A visible per-player streak counter, now that there's real play data to
  see what actually excites the boys.
- Consider whether ship *speed* should increase with FUSE-dial mastery
  (currently only `moveEverySec` varies by level, 4s→2s) once the FUSE
  mechanic has been played live and Wade has a read on pacing.

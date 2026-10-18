# Dino Roar 🦖

Two-player co-op dino-lab defense for two players (P1 & P2). Drive across 5 sectors and hold each research lab against waves of land + air dinosaurs. Sector 5 is the final stand. No hard game-over — the lab takes a beating but you always get to keep fighting.

## How to play
Open `index.html` in a browser (double-click it, or use Live Server). Everything runs locally — no build step.

### Each sector = two parts
1. **DRIVE TO LAB** — split-screen, top-down. Each boy drives his jeep down a **curvy dirt road** through the jungle (trees, a smoking volcano with lava). Stay on the road to keep your speed; go off-road and you bog down. A few dinos wander onto the road — bump one and you stall for a moment (never a death); honk/ram a dino just ahead with your fire key. Both jeeps must reach the lab.
2. **DEFEND THE LAB** — first-person turret. Dinos charge straight at you from the horizon (a volcano erupting behind them) and grow as they close. Aim is **side-to-side** across the field with limited up/down (up = pteros, down = ground dinos). **Rifle** is your fire key; **grenade** throws a big splash at your crosshair on a short reload. Hold the **scope** to magnify the far wave.

Clear all 5 labs → **ALL LABS SECURED!** win screen with both scores.

## Controls
| | Player 1 (purple) | Player 2 (green) |
|---|---|---|
| Drive: throttle / reverse | `W` / `S` | `↑` / `↓` |
| Drive: steer | `A` / `D` | `←` / `→` |
| Defend: move crosshair | `W A S D` | Arrow keys |
| Rifle / honk-ram | `Space` (or any key near it — toddler-proof) | `Enter` |
| Grenade | `E` | Right `Shift` |
| Scope (magnify far wave) | `Q` | `/` |

`RESTART ↻` button resets everything.

## Dinos (now with more detail — scales, claws, teeth, horns)
- **Raptor** — fast, weak, swarms.
- **T-Rex** — slow, tough, scary, back ridge (sector 2+). *Little-brother moment: the roar.*
- **Ptero** — swoops from the sky with a crest + wing membranes; only the up-aim reaches it.
- **Alpha** — the big red boss-dino with brow horns and back spikes (sector 3+, packs in sector 5).

## Tuning
All knobs live at the top of `game.js`:
- **Driving** — `T_CFG` (dino spawn/speed per sector), `T_MAXSPD`/`T_ACCEL`/`T_TURN` (jeep feel), `ROAD_HALF` (road width), `T_OFFROAD` (off-road slowdown).
- **Defending** — `D_CFG` (wave size/speed/air-share/alphas), `D_ZSPD` (how fast dinos close), `X_HIT_R` (rifle forgiveness), `GREN_CD`/`GREN_R`/`GREN_DMG` (grenade), `SCOPE_ZOOM`.
- **Dinos** — `DINO` (hp/score/damage/size/colors), `LAB_MAX` (lab health).

## Test
```
node smoke-test.js
```
Stubs the browser, turns on self-play (`AUTOPLAY`), and drives all 5 sectors through drive + defend to the win screen, asserting no exceptions.

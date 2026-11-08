# Battle Fighter

Two-player co-op for the kitchen table. One player runs the **aircraft carrier**, the other flies the **fighter** off its deck. Shared goals, shared win, separate star counts.

## Controls
- **Carrier (WASD + Space):** A/D sail, W/S raise/lower the launcher, **Q/E slide the carrier up/down** the screen a little, **mash Space 3 times** to launch (any key near the spacebar, or a mouse click, also counts). The charge ring above the launcher fills, then leaks away if you stop.
  - Aim **low** (under 60 degrees) = surface-to-surface missile. It flies **where the launcher points**; a short dotted guide shows the heading. It only steers itself if a ship or land target is already inside a narrow 16-degree cone, so the aim has to be roughly right. 2 hits per target.
  - Aim **high** (60 degrees or more) = three flak shells that burst near planes.
- **Fighter (Arrows + Enter):** it cruises on its own. Left/Right turn it (hold to go faster; it bounces off the screen edges), Up/Down climb and dive, hold **Enter for heat-seeking air-to-air missiles** (unlimited, they steer toward a bogey inside a wide 55-degree cone), **Right Shift (or /) for an air-to-surface missile** (4 shots, pointed down the way the plane faces, 30-degree steering cone). A pass over the carrier repairs one hit and reloads the missiles. Any arrow takes off from the deck.
  - The plane alternates **blue / red** on every launch.

## World tour (5 missions)
The game opens on a world map. Pick a mission with ←/→ (or click a pin) and press Space or Enter. Winning one sails the carrier to the next pin and unlocks it; progress is saved in the browser (`localStorage` key `battle-fighter.progress`, mission numbers only). Roles swap for every new mission.

| # | Mission | Where | Goals (ships / land / bogies) | New thing |
|---|---|---|---|---|
| 1 | Pacific Islands | Pacific Ocean, sunset | 3 / 2 / 5 | learn the ropes |
| 2 | North Atlantic | storm, snow, icebergs | 4 / 3 / 6 | **submarines**: only hittable when surfaced; they fire a slow torpedo the carrier must steer away from |
| 3 | Desert Coast | Mediterranean, bright day | 4 / 4 / 8 | **lots of bombers** |
| 4 | Arctic Night | stars, aurora, searchlights | 5 / 4 / 8 | **night fight**: bogies blink |
| 5 | Volcano Fortress | Ring of Fire, erupting volcano | 5 / 4 / 10 | **boss battleship** (12 hp, 3-shell salvos, boss bar) as the last ship |

## Goals and extras
- Either player's missiles can hit ships and land (stars go to whoever fired); only the air-to-air missiles and flak hurt bogies. About half the bogies explode, half spin into the sea.
- **Parachute crates** drift down every 15-20 seconds. The plane can grab one in the air, or the carrier can catch it on the deck: **repair kit** (+2 hull, plane fully repaired), **rapid fire** (10 s: 2 presses launch, faster missiles) or **triple missiles** (next 3 launches fire a fan of 3).
- **TEAM COMBO**: when the carrier and the fighter both score within about 2.5 seconds, each gets a bonus star.
- When all three bars are full the sky is clear and **the fighter has to land on the carrier** (green box and "LAND HERE!"; the carrier can slide underneath to help; after about 15 seconds the autopilot lends a hand). Touching down wins, with fireworks.
- Background decoration: marines in landing boats and defenders on the beach shoot at each other (nobody gets hurt; a "hit" soldier just ducks).

## Extra room
Carrier hull takes **8** hits, the plane **6**. Hull gone is a no-punishment "Rally the fleet" (hull refills, goals kept). A downed plane respawns on the deck.

## Roles swap
Names on the HUD swap sides for each new mission (`PN.P1` / `PN.P2` from the private names file; no names in this repo).

## Code
`game.js` has a DOM-free logic half (`createState(seed, round, level)` / `step`, run by `smoke-test.js`, which also proves every target in every mission is reachable and plays each mission to the win) and a drawing half that only starts when a `#gc` canvas exists. Tunables are in `TUNE`.

`node battle-fighter/smoke-test.js`

# Battle Fighter

Two-player co-op for the kitchen table. One player runs the **aircraft carrier**, the other flies the **fighter** off its deck. Shared goals, shared win, separate star counts.

## Controls
- **Carrier (WASD + Space):** A/D sail, W/S raise/lower the launcher, **Q/E slide the carrier up/down** the screen a little, **mash Space 3 times** to launch (any key near the spacebar, or a mouse click, also counts). The charge ring above the launcher fills, then leaks away if you stop.
  - Aim **low** (under 60 degrees) = surface-to-surface missile. It flies **where the launcher points**; a short dotted guide shows the heading. It only steers itself if a ship or land target is already inside a narrow 16-degree cone, so the aim has to be roughly right. 2 hits per target.
  - Aim **high** (60 degrees or more) = three flak shells that burst near planes.
- **Fighter (Arrows + Enter):** it cruises on its own. Left/Right turn it (hold to go faster; it bounces off the screen edges), Up/Down climb and dive, hold Enter for guns, **Right Shift (or /) for an air-to-surface missile** (4 shots, pointed down the way the plane faces, 30-degree steering cone). A pass over the carrier repairs one hit and reloads the missiles. Any arrow takes off from the deck.
  - The plane alternates **blue / red** on every launch.

## Goals
- Carrier: sink **5 ships**, destroy **4 land targets** (radar, bunker, fuel, SAM). Fighter: shoot down **8 bogies**. About half explode, half spin into the sea. Either player's missiles can hit ships and land (stars go to whoever fired); only the guns and flak hurt bogies.
- When all three bars are full the sky is clear and **the fighter has to land on the carrier** (a green box and "LAND HERE!" show where; the carrier can slide underneath to help; after about 15 seconds the autopilot lends a hand). Touching down wins, with fireworks.
- Background decoration: marines in landing boats and defenders on the beach shoot at each other (nobody gets hurt; a "hit" soldier just ducks).

## Extra room
Carrier hull takes **8** hits, the plane **6**. Hull gone is a no-punishment "Rally the fleet" (hull refills, goals kept). A downed plane respawns on the deck.

## Roles swap
Names on the HUD swap sides each round (`PN.P1` / `PN.P2` from the private names file; no names in this repo).

## Code
`game.js` has a DOM-free logic half (`createState` / `step`, run by `smoke-test.js`) and a drawing half that only starts when a `#gc` canvas exists. Tunables are in `TUNE`.

`node battle-fighter/smoke-test.js`

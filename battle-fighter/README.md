# Battle Fighter

Two-player co-op for the kitchen table. One player runs the **aircraft carrier**, the other flies the **fighter** off its deck. Shared goals, shared win, separate star counts.

## Controls
- **Carrier (WASD + Space):** A/D sail, W/S raise/lower the launcher, **mash Space 3 times** to launch (any key near the spacebar, or a mouse click, also counts). The charge ring above the launcher fills, then leaks away if you stop.
  - Aim **low** = surface-to-surface missile that gently homes in on ships and land targets (2 hits each).
  - Aim **high** (48 degrees or more) = three flak shells that burst near planes.
- **Fighter (Arrows + Enter):** it cruises on its own. Left/Right turn it round (hold to go faster), Up/Down climb and dive, hold Enter for guns. Fly over the carrier to repair one hit. Any arrow takes off from the deck.
  - The plane alternates **blue / red** on every launch.

## Goals (all three fill the bars, then fireworks)
- Carrier: sink **5 ships**, destroy **4 land targets** (radar, bunker, fuel, SAM).
- Fighter: shoot down **8 bogies**. About half explode, half spin into the sea.
- The plane can only hurt bogies; the carrier's missiles only hurt ships and land. Flak also hurts bogies.

## Extra room
Carrier hull takes **8** hits, the plane **6**. Hull gone is a no-punishment "Rally the fleet" (hull refills, goals kept). A downed plane respawns on the deck.

## Roles swap
Names on the HUD swap sides each round (`PN.P1` / `PN.P2` from the private names file; no names in this repo).

## Code
`game.js` has a DOM-free logic half (`createState` / `step`, run by `smoke-test.js`) and a drawing half that only starts when a `#gc` canvas exists. Tunables are in `TUNE`.

`node battle-fighter/smoke-test.js`

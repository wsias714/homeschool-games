# Space Blasters

A two-player co-op space shooter built with two players during `/homeschool-coding` sessions. Fly through **12 sectors**, clear each of aliens and asteroids, gear up at planet-orbiting moon bases in between, survive the **asteroid-field race (sector 11)**, and beat the **Earth boss (sector 12)** to win.

## How to run
No build step — it's a single static HTML/canvas game.
- Double-click `index.html`, **or** from this folder run: `start index.html`

## Controls (two players, one laptop)
| | Move / menus | Fire |
|---|---|---|
| **Player 1** (purple, left) | `W` `A` `S` `D` | `Space` — **or** any space-adjacent key (Z X C V B N M , .) **or a mouse/trackpad button** |
| **Player 2** (green, right) | Arrow keys | `Enter` |

> Player 1's fire is intentionally forgiving (lots of keys + the mouse) so a little one mashing near the spacebar just shoots — and right-click never opens a menu.

- Fly in all 4 directions (and diagonals). Your weapon fires the way you're flying.
- At the **moon base**: each player's left/right changes their ship; then on the sector **map**, left/right moves the cursor and Space/Enter warps.

## The loop
1. **Fight** a sector — clear every alien and asteroid (asteroids split big → medium → small).
2. **Land** on the moon base (it orbits a planet) to recharge shields. Each ship steers slowly up its own **landing strip** — line up in the lane and ride it to the pad.
3. **Gear up (10 seconds)** — you're handed a **new random weapon** (each player gets a different one, and it changes every time). During this window you can **override your gun** with ←/→ and **swap your ship** with ↑/↓.
4. **Map** — pick which **system** to explore next from a star map of mini planets; your progress (✓) is shown.
5. After all **10 normal sectors**, the finale: **Sector 11 = asteroid-field race** — dodge asteroids AND **fast comets** that zip through in bursts; fill the meter to cross → cruise at regular speed to **Sector 12 = Earth boss**.
6. **Sector 12 = Earth boss.** Defend the **connected space city** along the Earth (aliens chip away at its blocks over time — you lose points and the city gets battered, but you can still win). Friendly **ally ships** launch from the city to help. Clear the boss's waves, expose its core, dodge/shoot down its heatseekers, and destroy the Death Star → **win screen** with points, total, and finish time.

## The 6 guns (randomly assigned at each base — override with ←/→ during gear-up)
1. **BLASTER** — fast single bolts.
2. **LASER** — a continuous held beam; melts and pierces through everything.
3. **SHOCKWAVE** — an expanding ring that sweeps everything it passes.
4. **DOUBLE** — two parallel bolts.
5. **DETONATOR** — a lobbed grenade, medium range, big explosion radius.
6. **TRI-SHOT** — three bolts at once: straight + two diagonals.

## The 8 ships (pick at each base with ↑/↓)
**STAR DART** (arrow), **X-WING**, **STARCRUISER** (Star-Trek style), **TIE FIGHTER**, **BOMBER** (bomb shape), **JET** (airplane), **FALCON** (Millennium-Falcon style), **STAR DESTROYER**. Looks only — same handling for everyone.

## Enemies
- **Grunt saucers** — drift in, weave, fire a single aimed shot.
- **Hunter warships** (red, spiky) — tougher (5 hits), slowly stalk you, fire a **3-way spread**. From **sector 5+**.
- **Gunner saucers** (teal, twin-barrel) — fire **double/tri spread shots** in matching colors (cyan = double, violet = tri). From **sectors 8–10**.
- **Seeker saucers** (violet, missile pods) — launch a **heatseeker missile** that chases a player. From **sectors 8–10**.
- **Heatseeker missiles** home in on whoever they've locked (you can see the lock ring in that player's color). **The other player shoots them down** — any shot/beam/blast destroys a missile. This is the big co-op moment.
- **The Earth boss — a Death Star** (sector 12). The aliens fly out of it. Clear its waves first (the boss holds its fire), then its **core opens up** (HP bar at the top) — only then does it fire its spread cannon and **3 heatseekers at once**. Blast the exposed core to win.
- **Ally defenders** — friendly NPC ships launch from the space city and help you shoot down aliens, missiles, and the boss. (They can't be destroyed — they're your wingmen.)

## Shields (5 hits)
- Pips fill in **half steps**. **Asteroid bump = ½ shield. Alien collision or alien shot = 1 full shield.** Brief invulnerability after each hit.
- At 0 the ship goes down and **respawns** after a couple seconds with 2 shields — no hard game over.
- Recharge to full by landing on the base between sectors.

## Backgrounds
- The starfield scrolls so you feel like you're flying forward; each sector has its own **nebula colors** and sometimes a ringed **planet**. During **warp** you streak through flying asteroids.
- The **sector map** shows each system as a little planet with a nebula glow (finale systems 11 & 12 stay 🔒 locked until the first 10 are done).
- **Sector 11** races toward the home planet ahead; **Sector 12** puts a giant Earth along the bottom for a low-orbit feel.
- Moon bases now **orbit a planet** (with a drawn orbit path).

## Tuning (top of `game.js`)
- `SHIP1_COLOR` / `SHIP2_COLOR`, `ASTEROID_BURST`
- Shields: `DMG_ASTEROID` (½), `DMG_ALIEN_SHOT` / `DMG_ALIEN_BODY` (1)
- Enemy speed: `AST_SPD_MIN`/`AST_SPD_RND`, alien `swaySpd`; tougher alien stats in `HUNTER`
- Weapons: `WEAPONS`, `WEAPON_CD`, per-gun damage consts; ships in `SHIP_MODELS`
- Sectors: `TOTAL_SECTORS` (12), `NORMAL_SECTORS`, `RACE_IDX`, `EARTH_IDX`; difficulty/enemy counts in `startSector()`
- Finale: `RACE_GOAL_FR` (race length), `RACE_AST_SPD`, `COMET_SPD`, `TRAVEL_FR`, `EARTH_WAVES`
- Boss/city: `BOSS_HP`, `BOSS_R` (size/hitbox), `BOSS_MISSILE_CD`, `CITY_SEGMENTS`, `CITY_SEG_HP` (city toughness), `STATION_DESTROY_FR`, `STATION_PENALTY`
- Fire keys: `P1_FIRE` set (Player-1 fire aliases)
- Missiles: `MISSILE_SPD`, `MISSILE_TURN` (homing tightness), `DMG_MISSILE`; new enemy stats `GUNNER`/`SEEKER`
- Base timing/landing: `LAND_TIMEOUT`, `GEARUP_FR`, `MAP_TIMEOUT`, `STRIP_DX`/`STRIP_HALF`/`STRIP_LEN`

## Roadmap (next sessions)
- **Each boy designs his own moon base** (still the open question for them).
- A true zoomed-in docking view; collectible power-up drops; a second boss phase; saving stations could grant an end bonus.

## Tech
Vanilla JavaScript + HTML5 canvas, single file. Patterns (game loop, particle system, `beep` sound, panel scaffold) adapted from the sibling `train-racer` project. Verified each build with a headless smoke test that drives all 10 sectors to the win screen (every weapon + hunter aliens + map + win) with no exceptions.

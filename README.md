# Homeschool games

Small static HTML/canvas games for kitchen-table coding sessions, plus a tiny local server that serves them, logs progress and provides speech endpoints.

| Game | What | Status |
|---|---|---|
| `times-tables` | Times Table Trail: multiplication facts as an explorer's map | live |
| `cannon-battle` | Battleship-style harbour battle, aim with numbers | live |
| `sound-it-out` | Say a word, rebuild it from scrambled letters, hear it sounded out | live |
| `dino-roar` | 2-player co-op dino-lab defense | archived |
| `space-blasters` | 2-player co-op space shooter | archived |
| `train-racer` | Railway Rush | archived |

## Run
The server runs as a user service (`systemd/homeschool-games.service`, symlinked into `~/.config/systemd/user`) on <http://localhost:8420>. Open `http://localhost:8420/<game>/`. Without the server a game still plays, but progress is not saved and `sound-it-out` has no speech.

```
systemctl --user restart homeschool-games.service
npm test          # smoke tests for each live game + server tests
```

## Private data (not in this repo)
Progress logs and player names live in the Dropbox app folder `~/Dropbox/Apps/HomeschoolGames/`:
- `data/<game>-log.jsonl`: one line per answer or shot (player is `P1`/`P2`/`P3`)
- `names.json`: `{"P1": "...", "P2": "...", "P3": "..."}`, served to the games as `/names.js`. Without it the games show Player 1 / Player 2 / Player 3.

The code never contains real names. Keep it that way: this repo is public.

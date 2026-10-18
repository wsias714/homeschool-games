# CLAUDE.md

Notes for Claude Code sessions in this repo. General new-app checklist: `~/Projects/APPS.md`. Reference entry: `~/Projects/obligations/reference/apps.md`.

## Project
Static HTML/canvas games (no build step) plus `server/server.py` (stdlib Python, localhost:8420). Public repo.

## Rules
- **No real names in this repo, ever.** Games use `P1`/`P2`/`P3` internally and show `PN[...]` from `window.PLAYER_NAMES`, which the server serves from the private `~/Dropbox/Apps/HomeschoolGames/names.json`. Default display is "Player 1" etc. No names in comments, READMEs, test data or screenshots.
- Progress logs (`*.jsonl`) and `names.json` are private Dropbox data. Never commit them (`.gitignore` blocks them).
- Run `npm test` before every commit. `npm run check` is the same.
- Live games: times-tables, cannon-battle, sound-it-out. dino-roar, space-blasters, train-racer are archived (leave alone unless asked).
- Server unit: `homeschool-games.service`. After editing `server/server.py`: `systemctl --user restart homeschool-games.service`.
- No deploy: games run from the local server. (They are not on GitHub Pages: progress and speech need the server.)

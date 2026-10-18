# Game Server

Local HTTP server for the homeschool games: serves each game, logs progress to `~/Dropbox/Apps/HomeschoolGames/data/`, serves private player names at `/names.js`, and offers speech APIs.

## Quick Start

```bash
systemctl --user restart homeschool-games.service   # normally always running
# or by hand: python3 server/server.py
```

Server runs on `http://localhost:8420` with these routes:

- `http://localhost:8420/space-blasters/` — Space Blasters
- `http://localhost:8420/dino-roar/` — Dino Roar
- `http://localhost:8420/train-racer/` — Train Racer
- `http://localhost:8420/sound-it-out/` — Sound It Out (with mic + speaker)

## API Endpoints

### POST `/api/stt` — Speech-to-Text
Convert an audio blob to text.

**Request:**
- Body: raw audio blob (webm/opus from `MediaRecorder`)
- Content-Type: `audio/webm`

**Response (JSON):**
```json
{
  "alternatives": ["word_that_was_heard"]
}
```

### POST `/api/tts` — Text-to-Speech
Convert text to audio.

**Request (JSON):**
```json
{
  "text": "pillow",
  "rate": 0.8
}
```

**Response:**
- Body: WAV audio file
- Content-Type: `audio/wav`

## Notes

- **STT Backend**: requires `whisper-cpp` and `ggml-base.en.bin` model in `models/`
  - Install: `pacman -S whisper-cpp`
  - Model: download from https://huggingface.co/ggerganov/whisper.cpp/
  - If missing, the API returns `[offline mode: manual input required]`

- **TTS Backend**: requires `piper-tts` and a voice model in `models/`
  - Install: `yay -S piper-tts`
  - Voice: download a `.onnx` + `.json` pair (e.g. `en_US-lessac-medium`)
  - If missing, TTS returns silence (game still works, just no audio)

- **ffmpeg**: required for audio conversion
  - Install: `pacman -S ffmpeg`

## Systemd User Service

To auto-start the server on login, use the included service:

```bash
systemctl --user enable homeschool-games.service
systemctl --user start homeschool-games.service
systemctl --user status homeschool-games.service
```

(Note: this may not work in restricted environments; run `start-server.sh` manually instead.)

## Troubleshooting

### "No speech recognition" in the game
- Microphone permission might be blocked — check browser settings
- Server may not be reachable — confirm `http://localhost:8420/` loads in browser
- Try typing the word instead (manual input fallback)

### No audio pronunciation
- Check `piper-tts` and voice model are installed
- Try `curl -X POST http://localhost:8420/api/tts -d '{"text":"hello"}' -H 'Content-Type: application/json' -o /tmp/test.wav`
- If that fails, TTS backend is not available

### Speech recognition not working
- Check `whisper-cpp` and model are installed
- Try recording manually: `ffmpeg -f pulse -i default -t 3 /tmp/test.webm`
- Then: `curl -X POST http://localhost:8420/api/stt --data-binary @/tmp/test.webm`

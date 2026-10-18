#!/usr/bin/env python3
"""
Game server for homeschool coding games.
Serves static game files and speech API endpoints.
"""

import os
import sys
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path

GAME_ROOT = Path(__file__).parent.parent
MODELS_DIR = Path(__file__).parent / 'models'
# Progress logs and the private player names live in a Dropbox App folder, never in the repo:
# Dropbox is the off-machine copy. Override with GAMES_DATA_DIR (tests, other machines).
APP_DIR = Path(os.environ.get('GAMES_APP_DIR', Path.home() / 'Dropbox' / 'Apps' / 'HomeschoolGames'))
DATA_DIR = Path(os.environ.get('GAMES_DATA_DIR', APP_DIR / 'data'))
NAMES_FILE = APP_DIR / 'names.json'
PORT = 8420

KNOWN_GAMES = {'space-blasters', 'dino-roar', 'train-racer', 'sound-it-out', 'times-tables', 'cannon-battle'}

DATA_DIR.mkdir(parents=True, exist_ok=True)

def log_file_for(game):
    if game not in KNOWN_GAMES:
        game = 'sound-it-out'
    return DATA_DIR / f'{game}-log.jsonl'

def _json_safe(value):
    try:
        json.dumps(value, allow_nan=False)
        return True
    except (ValueError, TypeError):
        return False

class GameHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path

        if path.startswith('/api/sessions'):
            self.handle_get_sessions()
            return
        if path == '/names.js':
            self.handle_names()
            return

        # Redirect /game-name/ to /game-name/index.html
        if path in ['/', '/space-blasters', '/dino-roar', '/train-racer', '/sound-it-out', '/times-tables', '/cannon-battle']:
            game = path.strip('/') or 'index'
            if game != 'index':
                path = f'/{game}/index.html'

        # Serve from game directories
        if path.startswith('/space-blasters/') or path == '/space-blasters':
            self.path = path.replace('/space-blasters', '', 1) or '/index.html'
            self.directory = str(GAME_ROOT / 'space-blasters')
        elif path.startswith('/dino-roar/') or path == '/dino-roar':
            self.path = path.replace('/dino-roar', '', 1) or '/index.html'
            self.directory = str(GAME_ROOT / 'dino-roar')
        elif path.startswith('/train-racer/') or path == '/train-racer':
            self.path = path.replace('/train-racer', '', 1) or '/index.html'
            self.directory = str(GAME_ROOT / 'train-racer')
        elif path.startswith('/sound-it-out/') or path == '/sound-it-out':
            self.path = path.replace('/sound-it-out', '', 1) or '/index.html'
            self.directory = str(GAME_ROOT / 'sound-it-out')
        elif path.startswith('/times-tables/') or path == '/times-tables':
            self.path = path.replace('/times-tables', '', 1) or '/index.html'
            self.directory = str(GAME_ROOT / 'times-tables')
        elif path.startswith('/cannon-battle/') or path == '/cannon-battle':
            self.path = path.replace('/cannon-battle', '', 1) or '/index.html'
            self.directory = str(GAME_ROOT / 'cannon-battle')
        else:
            self.send_error(404)
            return

        super().do_GET()

    MAX_BODY_BYTES = 10 * 1024 * 1024  # generous enough for a short audio blob

    def do_POST(self):
        path = self.path
        raw_length = self.headers.get('Content-Length')
        try:
            content_length = int(raw_length) if raw_length is not None else -1
        except ValueError:
            content_length = -1
        # A missing/non-numeric/negative Content-Length would otherwise
        # reach rfile.read() as read(-1) (block until the client closes
        # the connection) or as a huge allocation -- either one wedges
        # this single-threaded server for every game on this port.
        if content_length < 0 or content_length > self.MAX_BODY_BYTES:
            self.send_error(400, 'Invalid or oversized Content-Length')
            return
        body = self.rfile.read(content_length)

        if path == '/api/stt':
            self.handle_stt(body)
        elif path == '/api/tts':
            self.handle_tts(body)
        elif path == '/api/track':
            self.handle_track(body)
        else:
            self.send_error(404)

    MAX_TRACK_BYTES = 4096  # a shot/answer record is a handful of fields; nothing legitimate is close to this

    def handle_track(self, body):
        """Record a completed word/answer to that game's session log."""
        try:
            if len(body) > self.MAX_TRACK_BYTES:
                self.send_error(400, 'Record too large')
                return

            record = json.loads(body.decode())
            if not isinstance(record, dict):
                self.send_error(400, 'Record must be a JSON object')
                return

            game = record.get('game', 'sound-it-out')
            if game not in KNOWN_GAMES:
                self.send_error(400, 'Unknown game')
                return
            record['server_timestamp'] = datetime.now(timezone.utc).isoformat()

            # allow_nan=False: json.loads happily accepts the NaN/Infinity/
            # -Infinity tokens as floats, but writing them back out would
            # produce a line handle_get_sessions's json.dumps(records) can
            # never re-serialize as a whole -- every session listing for
            # this game would break until that one line is found and
            # removed. Reject it here instead of ever writing it.
            line = json.dumps(record, allow_nan=False)

            with open(log_file_for(game), 'a') as f:
                f.write(line + '\n')

            response = json.dumps({'ok': True}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)

        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
            # Malformed body, non-finite float, or similar client error --
            # not a server fault, and nothing was written.
            self.send_error(400, str(e))
        except Exception as e:
            print(f'Track error: {e}', file=sys.stderr)
            self.send_error(500, str(e))

    def handle_names(self):
        """Player display names from the private names.json ({"P1": "...", "P2": "...", "P3": "..."}).
        The public games only know P1/P2/P3 and fall back to "Player 1" etc. when this is absent."""
        try:
            names = json.loads(NAMES_FILE.read_text())
            names = {k: str(v)[:20] for k, v in names.items() if k in ('P1', 'P2', 'P3')}
        except (OSError, ValueError, AttributeError):
            names = {}
        body = ('window.PLAYER_NAMES = ' + json.dumps(names) + ';\n').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/javascript')
        self.send_header('Content-Length', len(body))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def handle_get_sessions(self):
        """Return all tracked records for one game (?game=, default sound-it-out) as a JSON array."""
        query = parse_qs(urlparse(self.path).query)
        game = query.get('game', ['sound-it-out'])[0]

        records = []
        if game in KNOWN_GAMES:
            log_file = log_file_for(game)
        else:
            log_file = None
        if log_file and log_file.exists():
            with open(log_file) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(rec, dict):
                        continue
                    records.append(rec)

        try:
            response = json.dumps(records, allow_nan=False).encode()
        except ValueError:
            # A line somehow made it in with a NaN/Infinity value (older
            # data, or a hand-edited file) -- drop just the offending
            # records instead of failing this whole game's session list.
            records = [r for r in records if _json_safe(r)]
            response = json.dumps(records, allow_nan=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)

    def handle_stt(self, audio_data):
        """Speech-to-text: convert audio blob to transcript."""
        try:
            # Save audio to temp file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
                temp_audio = f.name
                f.write(audio_data)

            # Convert to WAV using ffmpeg
            temp_wav = temp_audio.replace('.webm', '.wav')
            subprocess.run([
                'ffmpeg', '-i', temp_audio, '-acodec', 'pcm_s16le',
                '-ar', '16000', '-ac', '1', temp_wav
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

            # Use whisper-cpp if available, otherwise echo back a placeholder
            try:
                result = subprocess.run([
                    'whisper-cpp', temp_wav,
                    '--model', str(MODELS_DIR / 'ggml-base.en.bin'),
                    '--language', 'en',
                    '-j', '1'
                ], capture_output=True, text=True, check=True)
                transcript = result.stdout.strip().split('\n')[-1] if result.stdout else ''
            except (FileNotFoundError, subprocess.CalledProcessError):
                transcript = '[offline mode: manual input required]'

            # Clean up
            os.unlink(temp_audio)
            os.unlink(temp_wav)

            # Return transcript as single-element array (game expects alternatives)
            response = json.dumps({'alternatives': [transcript]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)

        except Exception as e:
            print(f'STT error: {e}', file=sys.stderr)
            self.send_error(500, str(e))

    def handle_tts(self, body):
        """Text-to-speech: convert text to audio blob."""
        try:
            payload = json.loads(body.decode())
            text = payload.get('text', '')
            rate = payload.get('rate', 1.0)

            if not text:
                self.send_error(400, 'Missing text parameter')
                return

            # Use piper-tts if available, otherwise return silent audio
            temp_wav = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name

            try:
                # Try piper-tts
                subprocess.run([
                    'piper',
                    '--model', str(MODELS_DIR / 'en_US-lessac-medium.onnx'),
                    '--output_file', temp_wav
                ], input=text.encode(), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (FileNotFoundError, subprocess.CalledProcessError):
                # Fallback: generate a minimal silent WAV
                import wave, struct
                with wave.open(temp_wav, 'wb') as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(16000)
                    wav.writeframes(struct.pack('<h', 0) * 1600)  # 100ms of silence

            # Read audio file
            with open(temp_wav, 'rb') as f:
                audio_data = f.read()

            os.unlink(temp_wav)

            # Return audio
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', len(audio_data))
            self.end_headers()
            self.wfile.write(audio_data)

        except Exception as e:
            print(f'TTS error: {e}', file=sys.stderr)
            self.send_error(500, str(e))

    def end_headers(self):
        # Allow cross-origin for the API endpoints
        if self.path.startswith('/api/'):
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        # Quiet logging
        pass

if __name__ == '__main__':
    print(f'Starting game server on http://localhost:{PORT}', file=sys.stderr)
    print(f'Games: http://localhost:{PORT}/space-blasters', file=sys.stderr)
    print(f'       http://localhost:{PORT}/dino-roar', file=sys.stderr)
    print(f'       http://localhost:{PORT}/train-racer', file=sys.stderr)
    print(f'       http://localhost:{PORT}/sound-it-out', file=sys.stderr)
    print(f'       http://localhost:{PORT}/times-tables', file=sys.stderr)
    print(f'       http://localhost:{PORT}/cannon-battle', file=sys.stderr)

    server = HTTPServer(('127.0.0.1', PORT), GameHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down...', file=sys.stderr)
        server.shutdown()

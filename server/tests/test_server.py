import json, os, sys, tempfile, threading, unittest, urllib.request
from pathlib import Path

tmp = tempfile.mkdtemp()
os.environ['GAMES_APP_DIR'] = tmp
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402
from http.server import HTTPServer  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = HTTPServer(('127.0.0.1', 0), server.GameHandler)
        cls.base = f'http://127.0.0.1:{cls.httpd.server_address[1]}'
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def get(self, path):
        return urllib.request.urlopen(self.base + path).read().decode()

    def test_names_default_empty(self):
        self.assertIn('window.PLAYER_NAMES = {}', self.get('/names.js'))

    def test_names_from_private_file_only_known_keys(self):
        Path(tmp, 'names.json').write_text(json.dumps({'P1': 'Ann', 'P2': 'Bo', 'X': 'no'}))
        text = self.get('/names.js')
        self.assertIn('"P1": "Ann"', text)
        self.assertNotIn('"X"', text)

    def test_track_roundtrip(self):
        req = urllib.request.Request(self.base + '/api/track', data=json.dumps(
            {'game': 'times-tables', 'player': 'P1', 'correct': True}).encode(), method='POST')
        urllib.request.urlopen(req)
        rows = json.loads(self.get('/api/sessions?game=times-tables'))
        self.assertEqual(rows[0]['player'], 'P1')
        self.assertTrue(Path(tmp, 'data', 'times-tables-log.jsonl').exists())


if __name__ == '__main__':
    unittest.main()

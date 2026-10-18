"""ブロックス用の簡易サーバー(Python標準ライブラリのみ)

  python server.py            → http://localhost:8765/ で起動

API:
  GET  /api/records        対局記録の一覧(新しい順)
  GET  /api/records/<id>   対局記録1件
  POST /api/records        対局記録を保存し {"id": ...} を返す

記録は records/<id>.json として保存する。
"""
import json
import re
import secrets
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent
RECORDS = BASE / 'records'
STATIC = {'/': 'index.html', '/index.html': 'index.html', '/tetris.html': 'tetris.html', '/config.js': 'config.js'}
CONTENT_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8'}
ID_RE = re.compile(r'^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$')
MAX_BODY = 1024 * 1024
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


def is_valid_record(rec):
    if not isinstance(rec, dict) or not isinstance(rec.get('moves'), list):
        return False
    if not isinstance(rec.get('human'), int) or not 0 <= rec['human'] < 4:
        return False
    return all(isinstance(m, dict) and isinstance(m.get('p'), int) and 0 <= m['p'] < 4 for m in rec['moves'])


def summary(rid, rec):
    return {
        'id': rid,
        'date': rec.get('date'),
        'human': rec.get('human'),
        'moves': len(rec.get('moves', [])),
        'result': rec.get('result'),
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in STATIC:
            file = BASE / STATIC[path]
            if not file.exists():
                return self.send_json(404, {'error': 'not found'})
            body = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', CONTENT_TYPES[file.suffix])
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return

        if path == '/api/records':
            items = []
            for f in sorted(RECORDS.glob('*.json'), reverse=True):
                try:
                    items.append(summary(f.stem, json.loads(f.read_text(encoding='utf-8'))))
                except (OSError, ValueError):
                    continue  # 壊れたファイルは一覧に出さない
            return self.send_json(200, items)

        m = re.fullmatch(r'/api/records/([^/]+)', path)
        if m:
            rid = m.group(1)
            file = RECORDS / f'{rid}.json'
            if not ID_RE.match(rid) or not file.exists():
                return self.send_json(404, {'error': 'not found'})
            return self.send_json(200, json.loads(file.read_text(encoding='utf-8')))

        self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/api/records':
            return self.send_json(404, {'error': 'not found'})
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_BODY:
            return self.send_json(413, {'error': 'body too large or empty'})
        try:
            rec = json.loads(self.rfile.read(length).decode('utf-8'))
        except ValueError:
            return self.send_json(400, {'error': 'invalid json'})
        if not is_valid_record(rec):
            return self.send_json(400, {'error': 'invalid record'})

        RECORDS.mkdir(exist_ok=True)
        rid = f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(3)}"
        (RECORDS / f'{rid}.json').write_text(json.dumps(rec, ensure_ascii=False), encoding='utf-8')
        self.send_json(201, {'id': rid})


if __name__ == '__main__':
    # 自分のPCからのみアクセスできるよう 127.0.0.1 で待ち受ける
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'ブロックス: http://localhost:{PORT}/  (Ctrl+C で停止)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

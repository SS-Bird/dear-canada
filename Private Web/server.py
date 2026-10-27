#!/usr/bin/env python3
"""Serve the private notebook site and save what you write to data/notebook.json.

    python3 server.py          then open http://localhost:8010

No dependencies. The first save each day also copies the previous file to data/backups/.
"""
import json
import os
import shutil
import threading
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data" / "notebook.json"
BACKUPS = ROOT / "data" / "backups"
PORT = int(os.environ.get("PORT", 8010))
API = "/api/notebook"
lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith(API) or (len(args) > 1 and str(args[1])[:1] in "45"):
            super().log_message(fmt, *args)

    def reply(self, code, obj=None, body=None):
        body = body if body is not None else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] != API:
            return super().do_GET()
        with lock:
            if not DATA.exists():
                self.send_response(204)  # no notebook yet; the page starts a new one
                self.end_headers()
                return
            return self.reply(200, body=DATA.read_bytes())

    def do_PUT(self):
        if self.path.split("?")[0] != API:
            return self.reply(404, {"error": "not found"})
        try:
            incoming = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except ValueError:
            return self.reply(400, {"error": "body is not JSON"})
        with lock:
            current_rev = json.loads(DATA.read_text()).get("rev", 0) if DATA.exists() else 0
            # The page sends the revision it last loaded; anything else means another tab saved in between.
            if DATA.exists() and incoming.get("rev", 0) != current_rev:
                return self.reply(409, {"error": "stale", "rev": current_rev})
            if DATA.exists():
                BACKUPS.mkdir(parents=True, exist_ok=True)
                daily = BACKUPS / f"notebook-{date.today()}.json"
                if not daily.exists():
                    shutil.copy2(DATA, daily)
            incoming["rev"] = current_rev + 1
            DATA.parent.mkdir(parents=True, exist_ok=True)
            tmp = DATA.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(incoming, ensure_ascii=False, indent=1))
            tmp.replace(DATA)
        return self.reply(200, {"rev": incoming["rev"]})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Notebook at http://localhost:{PORT}  (saving to {DATA.relative_to(ROOT)}; Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

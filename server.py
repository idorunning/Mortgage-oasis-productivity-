#!/usr/bin/env python3
"""Local dashboard server for Mortgage Oasis.

Serves the dashboard and its data on 127.0.0.1 only (never exposed to the
network) and provides POST /api/refresh, which pulls the latest Tracker and
statements from Google on THIS machine (see scripts/gdrive_refresh.py). Client
data never leaves the computer except to talk to the owner's own Google account.

    python server.py                 # start, open the dashboard in the browser
    python server.py --no-browser    # start without opening a browser

Config (port + Google IDs) is read from config.json — copy config.example.json
and fill it in; see SETUP-WINDOWS.md.
"""
import json
import os
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

REPO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(REPO, "scripts"))

_refresh_lock = threading.Lock()


def load_config():
    path = os.path.join(REPO, "config.json")
    if not os.path.exists(path):
        example = os.path.join(REPO, "config.example.json")
        cfg = json.load(open(example)) if os.path.exists(example) else {}
        cfg.setdefault("port", 8000)
        return cfg
    return json.load(open(path))


def _same_origin(handler):
    """Reject cross-site POSTs (a drive-by page hitting localhost). Same-origin
    or tool requests with no Origin are allowed; anything else is refused."""
    origin = handler.headers.get("Origin")
    if origin is None:
        return True
    return origin.startswith("http://127.0.0.1") or origin.startswith("http://localhost")


class Handler(SimpleHTTPRequestHandler):
    config = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO, **kwargs)

    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Always serve fresh data — the file changes under us on refresh.
        if self.path.startswith("/data/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/refresh":
            return self._json(404, {"ok": False, "error": "Not found"})
        if not _same_origin(self):
            return self._json(403, {"ok": False, "error": "Cross-site request refused"})
        if not _refresh_lock.acquire(blocking=False):
            return self._json(409, {"ok": False, "error": "A refresh is already running"})
        try:
            import gdrive_refresh
            config_path = os.path.join(REPO, "config.json")
            if not os.path.exists(config_path):
                return self._json(400, {"ok": False, "error":
                    "No config.json yet — see SETUP-WINDOWS.md to connect Google."})
            result = gdrive_refresh.refresh_all(gdrive_refresh.load_config(config_path))
            self._json(200, {"ok": True, "summary": result["summary"]})
        except FileNotFoundError as err:
            self._json(400, {"ok": False, "error": str(err)})
        except Exception as err:  # surface the real reason to the dashboard
            self._json(500, {"ok": False, "error": "%s: %s" % (type(err).__name__, err)})
        finally:
            _refresh_lock.release()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


def main():
    config = load_config()
    port = int(config.get("port", 8000))
    open_browser = "--no-browser" not in sys.argv
    Handler.config = config

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://127.0.0.1:%d/admin/" % port
    print("Mortgage Oasis dashboard running at %s" % url)
    print("(local only — press Ctrl+C to stop)")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


if __name__ == "__main__":
    main()

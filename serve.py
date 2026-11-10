#!/usr/bin/env python3
"""Offline launcher for the Sensora Bus demo.

Browsers block fetch() of local files when index.html is opened by double-click (file://), so the
demo must be served over http.  Run:  python3 serve.py   then open the printed URL.
Only the Python standard library is used; binds to 127.0.0.1 (not exposed on the network).
"""
import argparse
import functools
import http.server
import os
import webbrowser

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--no-browser", action="store_true")
a = ap.parse_args()
root = os.path.dirname(os.path.abspath(__file__))


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript",
                      ".mjs": "text/javascript", ".bin": "application/octet-stream", ".json": "application/json"}

    def log_message(self, *args):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(H, directory=root))
url = f"http://127.0.0.1:{a.port}/index.html"
print(f"Sensora Bus demo served from {root}\nOpen {url}  (Ctrl+C to stop)")
if not a.no_browser:
    try:
        webbrowser.open(url)
    except Exception:
        pass
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass

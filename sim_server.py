#!/usr/bin/env python3
"""Lightweight HTTP server for simulation API (dev mode).

Listens on port 3001, handles /api/sim/run to trigger Python simulation.
Vite proxies /api/* to this server.
"""

import json
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

from run_simulation import run_sim


class SimHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/sim/run":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length > 0 else {}
                duration = body.get("duration", 120)
                corridor = body.get("corridor", 5)
                seed = body.get("seed", 42)
                cone = body.get("cone", True)

                # Run simulation (blocks)
                result = run_sim(duration, corridor, seed, cone)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "ok": True,
                    "outcome": result["outcome"],
                    "updates": result["updates"],
                    "final_error": result["final_error"],
                }).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress default logging


if __name__ == "__main__":
    port = 3001
    server = HTTPServer(("", port), SimHandler)
    print(f"Sim API server on http://localhost:{port}")
    print("  POST /api/sim/run  {{duration, corridor, seed, cone}}")
    server.serve_forever()

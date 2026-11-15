"""Lets a device's instrumented tests command test-machine: each POST body is one JSON command line,
written to test-machine's stdin, and answered with the next line test-machine prints.

Usage: python3 test-machine-control.py <stdin fifo> <stdout file> <port>
"""

import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FIFO, OUT, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
TIMEOUT_S = 60
lock = threading.Lock()


def lines():
    with open(OUT, encoding="utf-8") as out:
        return out.read().splitlines()


def command(line):
    with lock:
        seen = len(lines())
        with open(FIFO, "w", encoding="utf-8") as stdin:
            stdin.write(line.strip() + "\n")
        deadline = time.monotonic() + TIMEOUT_S
        while time.monotonic() < deadline:
            printed = lines()
            if len(printed) > seen:
                return printed[seen]
            time.sleep(0.05)
        return '{"error":"test-machine did not answer"}'


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8")
        answer = command(body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(answer)))
        self.end_headers()
        self.wfile.write(answer)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

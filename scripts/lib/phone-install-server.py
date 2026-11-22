"""The page an iPhone installs Broski from, served on loopback for `tailscale serve` to publish on the tailnet.

Usage: phone-install-server.py <dir> <token> <port> <tailnet-ip> <broski-link> <bundle-id>

Everything is under /<token>/: the page with the itms-services link, manifest.plist, Broski.ipa and icon.png from
<dir> (read per request, so a new build needs no restart), and pair, a page with a fresh `broski-link pair` link whose
LAN address is this Mac's tailnet address, so a phone off the LAN pairs through Tailscale. <broski-link> is the binary
that runs `broski-link pair`, empty when there is none; <bundle-id> is the app's, for the manifest.
"""

import html
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT, TOKEN, PORT, TAILNET_IP = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4]
BROSKI_LINK, BUNDLE_ID = sys.argv[5], sys.argv[6]
FILES = {"Broski.ipa": "application/octet-stream", "icon.png": "image/png"}

STYLE = """body{font:18px -apple-system,sans-serif;text-align:center;padding:48px 24px;background:#f5f5f7;color:#1d1d1f}
a.button{display:inline-block;padding:18px 44px;border-radius:999px;background:#5b5fc7;color:#fff;font-weight:600;
text-decoration:none}p{color:#555}code{display:block;word-break:break-all;font-size:12px;text-align:left;margin-top:24px}"""

INSTALL = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,
initial-scale=1"><title>Install Broski</title><style>{style}</style></head><body><h1>Broski</h1>
<p>{built}</p><a class="button" href="{link}">Install</a><p>Then wait for the icon on the Home Screen.</p></body></html>"""

PAIR = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,
initial-scale=1"><title>Pair Broski</title><style>{style}</style></head><body><h1>Pair Broski</h1>
<a class="button" href="{link}">Open in Broski</a><p>Or copy the link and paste it in Broski.</p>
<code>{text}</code></body></html>"""

MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array>
<dict><key>kind</key><string>software-package</string><key>url</key><string>{base}/Broski.ipa</string></dict>
<dict><key>kind</key><string>display-image</string><key>url</key><string>{base}/icon.png</string></dict>
<dict><key>kind</key><string>full-size-image</string><key>url</key><string>{base}/icon.png</string></dict>
</array><key>metadata</key><dict><key>bundle-identifier</key><string>{bundle}</string>
<key>bundle-version</key><string>1.0</string><key>kind</key><string>software</string>
<key>title</key><string>Broski</string></dict></dict></array></dict></plist>"""


def pairing_link():
    """A fresh offer, its LAN address replaced by this Mac's tailnet address on the daemon's port."""
    out = subprocess.run([BROSKI_LINK, "pair"], capture_output=True, text=True, timeout=20).stdout
    link = next((word for word in out.split() if word.startswith("broski://pair?")), None)
    if link is None:
        return None
    parts = urllib.parse.urlsplit(link)
    query = urllib.parse.parse_qsl(parts.query)
    lan = dict(query).get("l")
    if lan:
        port = lan.split(",")[0].rsplit(":", 1)[1]
        query = [(key, f"{TAILNET_IP}:{port}" if key == "l" else value) for key, value in query]
    encoded = urllib.parse.urlencode(query, safe=":,", quote_via=urllib.parse.quote)
    return urllib.parse.urlunsplit(parts._replace(query=encoded))


class Handler(BaseHTTPRequestHandler):
    def send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command == "GET":
            self.wfile.write(body)

    def route(self):
        prefix = f"/{TOKEN}/"
        path = urllib.parse.urlsplit(self.path).path
        if not path.startswith(prefix):
            return self.send(404, "text/plain", b"not found")
        name = path[len(prefix):]
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host")
        base = f"https://{host}/{TOKEN}"
        if name == "":
            manifest = urllib.parse.quote(f"{base}/manifest.plist", safe="")
            link = f"itms-services://?action=download-manifest&url={manifest}"
            built = html.escape((ROOT / "built.txt").read_text().strip()) if (ROOT / "built.txt").exists() else ""
            return self.send(200, "text/html", INSTALL.format(style=STYLE, built=built, link=html.escape(link)).encode())
        if name == "manifest.plist":
            return self.send(200, "text/xml", MANIFEST.format(base=base, bundle=html.escape(BUNDLE_ID)).encode())
        if name == "pair":
            if not BROSKI_LINK:
                return self.send(503, "text/plain", b"no broski-link binary on this Mac")
            link = pairing_link()
            if link is None:
                return self.send(503, "text/plain", b"broski-link pair printed no link")
            body = PAIR.format(style=STYLE, link=html.escape(link), text=html.escape(link, quote=False))
            return self.send(200, "text/html", body.encode())
        if name in FILES and (ROOT / name).exists():
            return self.send(200, FILES[name], (ROOT / name).read_bytes())
        return self.send(404, "text/plain", b"not found")

    do_GET = route
    do_HEAD = route


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

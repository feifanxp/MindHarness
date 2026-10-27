"""SPA-aware static file server. Falls back to index.html for non-file routes."""

import http.server
import os
import sys
from urllib.parse import urlsplit, urlunsplit

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
DIRECTORY = os.getcwd()

def normalize_base_path(value: str | None) -> str:
    raw = (value or "").strip()
    if raw == "" or raw == "/":
        return "/"
    raw = raw.rstrip("/")
    raw = raw.lstrip("/")
    if raw == "":
        return "/"
    return f"/{raw}"

BASE_PATH = normalize_base_path(os.environ.get("APP_BASE_PATH"))
ENABLE_SERVICE_WORKER = os.environ.get("APP_ENABLE_SERVICE_WORKER", "true").strip().lower()
ENABLE_SERVICE_WORKER_VALUE = (
    "true" if ENABLE_SERVICE_WORKER in {"1", "true", "yes", "on"} else "false"
)
RUNTIME_CONFIG_JS = (
    f"window.__APP_BASE_PATH__ = \"{BASE_PATH}\";\n"
    f"window.__ENABLE_SERVICE_WORKER__ = {ENABLE_SERVICE_WORKER_VALUE};\n"
)

# Compute the base href and script src for index.html injection.
# This avoids any client-side base-path inference (no document.write, no XHR, no eval).
BASE_HREF = "/" if BASE_PATH == "/" else f"{BASE_PATH}/"
RUNTIME_SCRIPT_SRC = "/runtime-config.js" if BASE_PATH == "/" else f"{BASE_PATH}/runtime-config.js"

# Read and patch index.html at startup.
_index_path = os.path.join(DIRECTORY, "index.html")
with open(_index_path) as _f:
    _INDEX_RAW = _f.read()
INDEX_HTML = (
    _INDEX_RAW
    .replace('<base href="/" />', f'<base href="{BASE_HREF}" />')
    .replace('<script src="/runtime-config.js"></script>',
             f'<script src="{RUNTIME_SCRIPT_SRC}"></script>')
).encode("utf-8")


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def _resolve_path(self):
        parsed = urlsplit(self.path)
        request_path = parsed.path

        if BASE_PATH != "/":
            if request_path == "/":
                redirect_target = urlunsplit(("", "", f"{BASE_PATH}/", "", ""))
                return ("redirect", redirect_target)
            if request_path == BASE_PATH:
                redirect_target = urlunsplit(("", "", f"{BASE_PATH}/", "", ""))
                return ("redirect", redirect_target)
            if not request_path.startswith(f"{BASE_PATH}/"):
                return ("not_found", None)

            request_path = request_path[len(BASE_PATH) :] or "/"

        return ("path", request_path)

    def do_GET(self):
        status, value = self._resolve_path()
        if status == "redirect":
            self.send_response(302)
            self.send_header("Location", value)
            self.end_headers()
            return
        if status == "not_found":
            self.send_error(404, "Not found")
            return

        request_path = value
        if request_path == "/runtime-config.js":
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(RUNTIME_CONFIG_JS.encode("utf-8"))
            return

        # If the path maps to an actual file (other than index.html), serve it normally
        path = self.translate_path(request_path)
        if os.path.isfile(path) and request_path != "/index.html":
            self.path = request_path
            return super().do_GET()
        # Serve patched index.html (with correct base href and script src)
        self._serve_index()

    def _serve_index(self):
        """Serve the patched index.html with correct base href."""
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(INDEX_HTML)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(INDEX_HTML)

    def do_HEAD(self):
        status, value = self._resolve_path()
        if status == "redirect":
            self.send_response(302)
            self.send_header("Location", value)
            self.end_headers()
            return
        if status == "not_found":
            self.send_error(404, "Not found")
            return

        request_path = value
        if request_path == "/runtime-config.js":
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return
        path = self.translate_path(request_path)
        if os.path.isfile(path) and request_path != "/index.html":
            self.path = request_path
            return super().do_HEAD()
        # Serve patched index.html headers
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(INDEX_HTML)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), SPAHandler)
    print(f"Serving SPA on 0.0.0.0:{PORT}")
    server.serve_forever()

import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
DIRECTORY = "/Users/diz9711/Desktop/Zeno"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        print(f"[ZENO] {self.address_string()} - {format % args}")

os.chdir(DIRECTORY)
with http.server.HTTPServer(("", PORT), Handler) as httpd:
    print(f"[ZENO] Serving at http://localhost:{PORT}")
    httpd.serve_forever()

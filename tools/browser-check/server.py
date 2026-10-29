"""Local server for tools/browser-check. Serves the project root, builds /__check pages
(index.html + harness + test scripts), stores posted logs in out/, and holds the page's
load event open until the test finishes so headless --screenshot waits for it."""
import http.server, os, sys, threading, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
done = {}


def event(key):
    return done.setdefault(key, threading.Event())


# Linked as /__script?f=<path under tools/browser-check>, not inlined, so index.html's CSP (script-src 'self') allows it.
def script(path):
    rel = os.path.relpath(path, HERE).replace(os.sep, '/')
    return f'<script src="/__script?f={urllib.parse.quote(rel)}"></script>' if os.path.exists(path) else ''


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def params(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return query.get('test', ['smoke'])[0], query.get('phase', ['1'])[0]

    def do_GET(self):
        if self.path.startswith('/__check'):
            test, phase = self.params()
            page = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
            tests = os.path.join(HERE, 'tests')
            # Every test runs on the thread layout: the empty desktop bridge (stand-in.js) comes
            # before the test's own head, which may put in parts of its own (window.__standIn).
            # Without it the page drew the deleted old frame.
            head = (
                script(os.path.join(HERE, 'harness.js'))
                + script(os.path.join(HERE, 'stand-in.js'))
                + script(os.path.join(tests, test + '.head.js'))
            )
            tail = script(os.path.join(tests, test + '.js')) + f'<img alt="" style="display:none" src="/__hold?test={test}&phase={phase}">'
            page = page.replace('<head>', '<head>' + head, 1).replace('</body>', tail + '</body>', 1)
            # Since 0.3.74 index.html's CSP has default-src 'none' and no connect-src, which blocks
            # the harness's report POST (every test printed "NO LOG"). Only this test page allows
            # requests to its own server; the app's own policy is unchanged.
            page = page.replace("default-src 'none';", "default-src 'none'; connect-src 'self';", 1)
            body = page.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith('/__script'):
            rel = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('f', [''])[0]
            path = os.path.abspath(os.path.join(HERE, rel))
            if not path.startswith(HERE + os.sep) or not os.path.isfile(path):
                self.send_error(404)
                return
            body = open(path, 'rb').read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith('/__hold'):
            event(self.params()).wait(90)
            time.sleep(0.5)
            self.send_response(204)
            self.end_headers()
            return
        return super().do_GET()

    def do_POST(self):
        test, phase = self.params()
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, f'{test}-{phase}.log'), 'wb') as log:
            log.write(data)
        event((test, phase)).set()
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()

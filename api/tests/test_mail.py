import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.config import cfg
from app.services.mail import AppsScriptMailer


class FakeAppsScript(BaseHTTPRequestHandler):
    """Behaves like a deployed Apps Script web app: POST /exec answers 302 to a result URL that returns the text."""
    received: list = []
    verdict = "ok"
    secret = "s3cret"

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        FakeAppsScript.received.append(body)
        FakeAppsScript.verdict = "ok" if body.get("secret") == self.secret else "forbidden"
        self.send_response(302)
        self.send_header("Location", "/result")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/plain")
        self.end_headers()
        self.wfile.write(FakeAppsScript.verdict.encode())

    def log_message(self, *a):
        pass


@pytest.fixture
def relay(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), FakeAppsScript)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    FakeAppsScript.received = []
    monkeypatch.setattr(cfg, "apps_script_mail_url", f"http://127.0.0.1:{srv.server_port}/exec")
    monkeypatch.setattr(cfg, "mail_from", "Space hopes <spacehopes@gmail.com>")
    yield srv
    srv.shutdown()


async def test_relay_posts_the_message_and_follows_the_redirect(relay, monkeypatch):
    monkeypatch.setattr(cfg, "apps_script_mail_secret", "s3cret")
    await AppsScriptMailer().send("reader@example.com", "Hello", "plain text", "<p>html</p>")
    got = FakeAppsScript.received[0]
    assert got["to"] == "reader@example.com" and got["subject"] == "Hello" and got["html"] == "<p>html</p>"
    assert got["name"] == "Space hopes"  # the display name taken from MAIL_FROM


async def test_relay_refusal_is_reported_not_swallowed(relay, monkeypatch):
    monkeypatch.setattr(cfg, "apps_script_mail_secret", "wrong")
    with pytest.raises(RuntimeError, match="forbidden"):
        await AppsScriptMailer().send("reader@example.com", "Hello", "text")

"""Email behind a small interface: Resend when RESEND_API_KEY is set, otherwise SMTP (Mailpit locally)."""
import logging
from email.message import EmailMessage
from email.utils import parseaddr
from typing import Protocol

import aiosmtplib
import httpx

from ..config import cfg

log = logging.getLogger("mail")


class Mailer(Protocol):
    async def send(self, to: str, subject: str, text: str, html: str | None = None) -> None: ...


class ResendMailer:
    async def send(self, to, subject, text, html=None):
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post("https://api.resend.com/emails",
                             headers={"Authorization": f"Bearer {cfg.resend_api_key}"},
                             json={"from": cfg.mail_from, "to": [to], "subject": subject, "text": text,
                                   **({"html": html} if html else {})})
            r.raise_for_status()


class AppsScriptMailer:
    """Posts the message to a small Google Apps Script web app that sends it from the Gmail account it belongs to.
    Plain HTTPS: no SMTP port needed. The shared secret keeps strangers from using the relay."""

    async def send(self, to, subject, text, html=None):
        name = parseaddr(cfg.mail_from)[0] or "Space hopes"
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:  # Apps Script answers through a redirect
            r = await c.post(cfg.apps_script_mail_url, json={"secret": cfg.apps_script_mail_secret, "to": to, "subject": subject,
                                                             "text": text, "html": html, "name": name})
        r.raise_for_status()
        if r.text.strip() != "ok":
            raise RuntimeError(f"mail relay refused: {r.text.strip()[:120]}")


class SmtpMailer:
    async def send(self, to, subject, text, html=None):
        m = EmailMessage()
        m["From"], m["To"], m["Subject"] = cfg.mail_from, to, subject
        m.set_content(text)
        if html:
            m.add_alternative(html, subtype="html")
        implicit = cfg.smtp_port == 465  # port 465 speaks TLS from the first byte; 587 upgrades with STARTTLS
        await aiosmtplib.send(m, hostname=cfg.smtp_host, port=cfg.smtp_port, username=cfg.smtp_user or None,
                              password=cfg.smtp_password or None, use_tls=implicit, start_tls=(cfg.smtp_tls and not implicit) or None,
                              timeout=20)


mailer: Mailer = ResendMailer() if cfg.resend_api_key else AppsScriptMailer() if cfg.apps_script_mail_url else SmtpMailer()


async def send_safe(to: str, subject: str, text: str, html: str | None = None):
    """Never let an email failure break a request."""
    try:
        await mailer.send(to, subject, text, html)
    except Exception as e:  # noqa: BLE001
        log.warning("mail failed (%s): %s", type(e).__name__, str(e)[:200])  # never logs the recipient


def wrap_html(body: str) -> str:
    return ('<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;'
            f'font-size:17px;line-height:1.6">{body}</div>')

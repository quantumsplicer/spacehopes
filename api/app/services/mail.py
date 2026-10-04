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


def provider_name() -> str:
    if cfg.resend_api_key:
        return "Resend"
    if cfg.apps_script_mail_url:
        return "Gmail (Google Apps Script relay)"
    if cfg.smtp_host in ("", "mailpit"):
        return "Local test inbox (Mailpit)" if cfg.is_dev else "none"
    return f"SMTP ({cfg.smtp_host}:{cfg.smtp_port})"


def explain(e: Exception) -> str:
    """A plain-language reason for a failed send, with what to do about it."""
    t = str(e).lower()
    if "forbidden" in t:
        return "The relay rejected the secret. APPS_SCRIPT_MAIL_SECRET must equal SECRET in the Apps Script."
    if "bad address" in t:
        return "That email address does not look valid."
    if "refused" in t and "relay" in t:
        return f"The relay answered but refused the message: {str(e)[:160]}"
    if "authorization" in t or "permission" in t or "gmailapp" in t:
        return ("Google has not given the script permission to use Gmail yet. Open the script, run the function authorize, "
                "approve the permission, then deploy a new version.")
    if "534" in t or "535" in t or "authentication" in t or "username and password" in t or "unexpected eof" in t or "disconnected" in t:
        return "The mail server refused the login. For Gmail use a 16-character App Password. Render's free plan blocks SMTP; use the Apps Script relay there."
    if "name or service not known" in t or "getaddrinfo" in t or "nodename" in t:
        return "The mail server address could not be found. Check the URL or host name."
    if "timed out" in t or "timeout" in t:
        return "The mail service did not answer in time. If you are using SMTP, the port may be blocked on this host."
    if "401" in t or "403" in t:
        return "The mail service rejected the credentials."
    return f"{type(e).__name__}: {str(e)[:160]}"


async def send_safe(to: str, subject: str, text: str, html: str | None = None):
    """Never let an email failure break a request."""
    try:
        await mailer.send(to, subject, text, html)
    except Exception as e:  # noqa: BLE001
        log.warning("mail failed (%s): %s", type(e).__name__, str(e)[:200])  # never logs the recipient


def wrap_html(body: str) -> str:
    return ('<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;'
            f'font-size:17px;line-height:1.6">{body}</div>')

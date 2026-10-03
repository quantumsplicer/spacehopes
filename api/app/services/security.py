"""Hashing helpers. Raw IPs and user agents are never stored; only salted hashes."""
import hashlib
import hmac
import secrets

from fastapi import Request

from ..config import cfg


def _h(*parts: str) -> str:
    return hashlib.sha256((cfg.ip_salt + "|" + "|".join(parts)).encode()).hexdigest()


def client_ip(request: Request) -> str:
    if cfg.client_ip_header:  # only set where the platform's proxy writes this header and nothing else can reach us
        v = request.headers.get(cfg.client_ip_header, "").split(",")[0].strip()
        if v:
            return v[:64]
    return request.client.host if request.client else "0.0.0.0"


def fingerprint(request: Request) -> str:
    """Salted hash of IP + user agent: used for comment rate limits and blocks."""
    return _h("fp", client_ip(request), request.headers.get("user-agent", "")[:200])


def ip_only_hash(request: Request) -> str:
    return _h("ip", client_ip(request))


def anon_hash(anon_id: str) -> str:
    return _h("anon", anon_id[:80])


def token() -> str:
    return secrets.token_urlsafe(32)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hash_code(code: str) -> str:
    return hashlib.sha256((cfg.secret_key + "|code|" + code.strip().lower()).encode()).hexdigest()


def safe_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def device_label(ua: str) -> str:
    ua = ua or ""
    os_ = next((n for k, n in (("iPad", "iPad"), ("iPhone", "iPhone"), ("Android", "Android"), ("Windows", "Windows"),
                               ("Macintosh", "Mac"), ("Linux", "Linux")) if k in ua), "Unknown device")
    br = next((n for k, n in (("Edg/", "Edge"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")) if k in ua), "browser")
    return f"{br} on {os_}"

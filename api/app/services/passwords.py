"""Password hashing and policy. scrypt (memory-hard, standard library), a random salt per password,
constant-time comparison, and a dummy verify so that unknown login IDs take as long as known ones."""
import base64
import hashlib
import hmac
import os
import re

N, R, P = 2**15, 8, 1
MAXMEM = 128 * 1024 * 1024
LOGIN_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")

COMMON = {
    "admin@123", "admin123", "admin@1234", "password", "password1", "password123", "password@123", "12345678", "123456789",
    "1234567890", "qwerty123", "qwertyuiop", "letmein123", "welcome123", "iloveyou", "abc12345", "changeme", "changeme123",
    "spacehopes", "space hopes", "spacehopes123", "spacehopes@123", "saravanan", "saravanan123", "murugan123",
}


def _derive(password: str, salt: bytes, n=N, r=R, p=P) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=MAXMEM, dklen=32)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    return f"scrypt${N}${R}${P}${base64.b64encode(salt).decode()}${base64.b64encode(_derive(password, salt)).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        calc = _derive(password, base64.b64decode(salt), int(n), int(r), int(p))
        return hmac.compare_digest(calc, base64.b64decode(digest))
    except Exception:  # noqa: BLE001
        return False


DUMMY_HASH = hash_password(base64.b64encode(os.urandom(18)).decode())


def verify_or_dummy(password: str, stored: str | None) -> bool:
    """Always does one full scrypt, whether or not the account exists."""
    if stored is None:
        verify_password(password, DUMMY_HASH)
        return False
    return verify_password(password, stored)


def policy_error(password: str, login_id: str, old: str | None = None) -> str | None:
    """Returns a plain-language reason, or None if the new password is acceptable."""
    if len(password) < 12:
        return "Use at least 12 characters."
    if len(password) > 128:
        return "Use at most 128 characters."
    low = password.lower()
    if low in COMMON or any(c in low for c in ("admin@123", "password", "qwerty", "12345678")):
        return "That password is too easy to guess."
    if login_id and login_id.lower() in low:
        return "The password must not contain your login ID."
    if old is not None and password == old:
        return "Choose a password different from the current one."
    if len(set(password)) < 6:
        return "Use a wider mix of characters."
    kinds = sum(bool(re.search(p, password)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    if kinds < 3:
        return "Mix at least three kinds of characters: lower case, upper case, numbers, symbols."
    return None

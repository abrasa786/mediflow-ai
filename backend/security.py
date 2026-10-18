"""Auth, rate limiting and PII redaction for the Mediflow API."""

import hashlib
import os
import re
import time
from collections import defaultdict, deque

import httpx
from fastapi import Header, HTTPException

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or ""

RATE_LIMIT = 30          # requests …
RATE_WINDOW = 60.0       # … per 60 seconds, per user
TOKEN_CACHE_TTL = 120.0  # seconds a verified token is trusted before re-checking

_token_cache: dict[str, tuple[dict, float]] = {}
_hits: dict[str, deque] = defaultdict(deque)


def _cache_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def verify_token(token: str) -> dict:
    """Validate a Supabase access token with Supabase Auth; returns the user dict."""
    key = _cache_key(token)
    cached = _token_cache.get(key)
    if cached and cached[1] > time.time():
        return cached[0]
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(500, "Server auth is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).")
    async with httpx.AsyncClient(timeout=10) as http:
        res = await http.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
        )
    if res.status_code != 200:
        raise HTTPException(401, "Your session has expired. Please log in again.")
    user = res.json()
    _token_cache[key] = (user, time.time() + TOKEN_CACHE_TTL)
    if len(_token_cache) > 5000:  # keep memory bounded
        now = time.time()
        for k in [k for k, (_, exp) in _token_cache.items() if exp < now]:
            _token_cache.pop(k, None)
    return user


def check_rate_limit(user_id: str):
    now = time.time()
    q = _hits[user_id]
    while q and q[0] <= now - RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, "You're going a bit fast 😅 Please wait a minute and try again.")
    q.append(now)


async def require_user(authorization: str = Header(default="")) -> dict:
    """FastAPI dependency: 401 without a valid Supabase JWT, 429 above 30 req/min."""
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Please log in to use Mediflow AI.")
    token = authorization[7:].strip()
    user = await verify_token(token)
    check_rate_limit(user["id"])
    user["_token"] = token  # lets endpoints call Supabase as this user (RLS applies)
    return user


# ── PII redaction: only the health query ever reaches the AI ──
_PATTERNS = [
    (re.compile(r"\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b"), "[aadhaar]"),                 # Aadhaar (12 digits)
    (re.compile(r"(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b"), "[phone]"),               # Indian mobile
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),                                 # email
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"), "[pan]"),                                     # PAN
    (re.compile(r"(?im)^\s*(patient\s*name|name|mr\.?|mrs\.?|ms\.?)\s*[:\-].*$"), "[name line removed]"),
    (re.compile(r"(?im)^\s*(uhid|mrn|patient\s*id|lab\s*no|reg(istration)?\s*no)\s*[:\-].*$"), "[id line removed]"),
    (re.compile(r"\bMF-\d{4}-\d{5}\b"), "[patient-id]"),
]


def redact(text: str, names: list[str] | None = None) -> str:
    if not text:
        return text
    out = text
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    for name in names or []:
        for part in {name.strip(), *name.split()}:
            if len(part) >= 3:
                out = re.sub(rf"\b{re.escape(part)}\b", "[name]", out, flags=re.IGNORECASE)
    return out

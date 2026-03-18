"""Authentication helpers: password hashing and JWT token management."""
from __future__ import annotations

import datetime
import os
import secrets

import bcrypt
import jwt

# Secret key — loaded from env, persisted file, or generated once and saved
_SECRET_KEY = os.environ.get("ENCODER_JWT_SECRET", "")


def _get_secret() -> str:
    """Return JWT secret.

    Priority:
    1. ENCODER_JWT_SECRET env var (set at runtime)
    2. .jwt_secret file next to the database (persists across restarts)
    3. Generate a new secret and save it to .jwt_secret

    This ensures tokens remain valid across server restarts.
    """
    global _SECRET_KEY
    if _SECRET_KEY:
        return _SECRET_KEY

    secret_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".jwt_secret")
    secret_file = os.path.normpath(secret_file)

    if os.path.exists(secret_file):
        with open(secret_file) as f:
            _SECRET_KEY = f.read().strip()
    else:
        _SECRET_KEY = secrets.token_hex(32)
        with open(secret_file, "w") as f:
            f.write(_SECRET_KEY)

    return _SECRET_KEY


JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 30


def hash_password(password: str) -> str:
    """Hash a password with bcrypt. Returns the hash as a UTF-8 string."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_token(user_id: int, username: str) -> str:
    """Create a signed JWT with user_id and username claims, expiring in JWT_EXPIRY_DAYS."""
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=JWT_EXPIRY_DAYS),
        "iat": datetime.datetime.now(datetime.timezone.utc),
    }
    return jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    """Decode and verify a JWT. Returns the payload dict or None if invalid/expired."""
    try:
        return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None

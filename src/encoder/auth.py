"""Authentication helpers: password hashing and JWT token management."""
from __future__ import annotations

import datetime
import os

import bcrypt
import jwt

# Secret key — generated once per installation, stored in env or auto-generated
_SECRET_KEY = os.environ.get("ENCODER_JWT_SECRET", "")


def _get_secret() -> str:
    """Return JWT secret, generating one if not set."""
    global _SECRET_KEY
    if not _SECRET_KEY:
        import secrets
        _SECRET_KEY = secrets.token_hex(32)
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

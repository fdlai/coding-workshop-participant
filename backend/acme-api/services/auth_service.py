import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models.user import User
from schemas.user import normalize_username
from dotenv import load_dotenv

load_dotenv()

PBKDF2_PREFIX = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 600_000
security = HTTPBearer()


PLACEHOLDER_SECRETS = {"change-me-in-production", "acme-dev-secret-change-me"}
MIN_SECRET_LENGTH = 32
SECRET_FILE = Path(__file__).resolve().parent.parent / "jwt_secret.key"


def _usable(secret: str, min_length: int = 1) -> bool:
    return len(secret) >= min_length and secret not in PLACEHOLDER_SECRETS


def get_jwt_secret() -> str:
    """Return the JWT signing secret.

    ``JWT_SECRET_KEY`` from the environment wins (any non-placeholder value, as before);
    otherwise ``jwt_secret.key`` in the application directory is used and must be at
    least 32 characters. A placeholder is never accepted, and no secret is ever
    generated here (see ``scripts/generate_jwt_secret.py``).
    """
    secret = settings.JWT_SECRET_KEY.strip()
    if _usable(secret):
        return secret
    if SECRET_FILE.is_file():
        secret = SECRET_FILE.read_text(encoding="utf-8").strip()
        if _usable(secret, MIN_SECRET_LENGTH):
            return secret
    raise RuntimeError(
        "No valid JWT secret: set JWT_SECRET_KEY or create jwt_secret.key "
        "with `python scripts/generate_jwt_secret.py`."
    )


def _pbkdf2(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)


def hash_password(password: str) -> str:
    """Hash a password with PBKDF2-HMAC-SHA256.

    PBKDF2 needs almost no memory, which matters because the Lambda has only 128 MB
    (Argon2's 64 MB per hash exceeds it). Format: pbkdf2_sha256$iterations$salt$hash.
    """
    salt = secrets.token_bytes(16)
    digest = _pbkdf2(password, salt, PBKDF2_ITERATIONS)
    return "$".join(
        [
            PBKDF2_PREFIX,
            str(PBKDF2_ITERATIONS),
            base64.b64encode(salt).decode(),
            base64.b64encode(digest).decode(),
        ]
    )


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a PBKDF2 hash, or a legacy Argon2 hash from older accounts."""
    if password_hash.startswith(PBKDF2_PREFIX + "$"):
        try:
            _, iterations, salt, expected = password_hash.split("$")
            digest = _pbkdf2(password, base64.b64decode(salt), int(iterations))
            return hmac.compare_digest(digest, base64.b64decode(expected))
        except ValueError:
            return False
    from pwdlib import PasswordHash  # legacy hashes only; imported lazily to save memory

    return PasswordHash.recommended().verify(password, password_hash)


def create_access_token(username: str) -> str:
    """Issue a signed JWT access token for a valid user."""
    expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    expires_at = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": username, "exp": expires_at}
    return jwt.encode(payload, get_jwt_secret(), algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> str:
    """Validate a JWT and return its subject."""
    try:
        payload = jwt.decode(
            token, get_jwt_secret(), algorithms=[settings.JWT_ALGORITHM]
        )
        username = payload.get("sub")
        if username is None:
            raise ValueError("Missing subject in token")
        return username
    except (JWTError, ValueError) as exc:  # pragma: no cover - exercised by API tests
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        ) from exc


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    """Validate a username/password pair and return the active user record."""
    user = (
        db.query(User)
        .filter(func.lower(User.username) == normalize_username(username))
        .first()
    )
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def get_current_user(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """Return the authenticated user from the bearer token."""
    username = decode_access_token(credentials.credentials)
    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or inactive user",
        )
    return user


def require_roles(*allowed_roles: str):
    """Create a dependency ensuring the current user has an allowed role."""

    def _dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized for this action",
            )
        return current_user

    return _dependency

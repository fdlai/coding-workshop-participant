from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models.user import User
from schemas.auth import LoginRequest, PasswordChangeRequest, TokenResponse
from schemas.user import UserPublic
from services.auth_service import (
    authenticate_user,
    create_access_token,
    get_current_user,
    hash_password,
    refresh_access_token,
    security,
    verify_password,
)


router = APIRouter(tags=["authentication"])


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Authenticate a user and issue a JWT access token."""
    user = authenticate_user(db, payload.username, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    token = create_access_token(user.username)
    return TokenResponse(
        access_token=token,
        token_type="bearer",  # nosec B106 - OAuth2 token type, not a password
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/auth/refresh", response_model=TokenResponse)
def refresh(
    current_user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenResponse:
    """Renew a still-valid token for an active user, up to the maximum session length."""
    return TokenResponse(
        access_token=refresh_access_token(credentials.credentials),
        token_type="bearer",  # nosec B106 - OAuth2 token type, not a password
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/auth/me", response_model=UserPublic)
def get_authenticated_user(current_user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user record for the active session."""
    return current_user


@router.get("/users/me", response_model=UserPublic)
def get_current_user_profile(current_user: User = Depends(get_current_user)) -> User:
    """Alias endpoint for the current-user profile."""
    return current_user


@router.post("/auth/change-password")
def change_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Allow a logged-in user to change their own password."""
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    current_user.password_hash = hash_password(payload.new_password)
    db.add(current_user)
    db.commit()
    return {"status": "success"}

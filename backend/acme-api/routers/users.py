"""User administration and profile endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.user import (
    PasswordReset,
    Role,
    RoleUpdate,
    SelfProfileUpdate,
    StatusUpdate,
    UserCreate,
    UserPublic,
    UserSummary,
    UserUpdate,
)
from services import relationship_service as rel
from services import user_service
from services.auth_service import get_current_user, require_roles


router = APIRouter(prefix="/users", tags=["users"])

require_admin = require_roles("admin")


@router.get("", response_model=list[UserPublic])
def list_users(
    role: Role | None = None,
    is_active: bool | None = None,
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    """List users (administrators only)."""
    return user_service.list_users(
        db, role=role, is_active=is_active, search=search, limit=limit, offset=offset
    )


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    """Create a user account (administrators only)."""
    return user_service.create_user(db, admin, payload)


@router.patch("/me", response_model=UserPublic)
def update_me(
    payload: SelfProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Update the caller's own permitted profile fields."""
    return user_service.update_own_profile(db, current_user, payload)


@router.get("/{user_id}", response_model=UserPublic | UserSummary)
def get_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User | UserSummary:
    """Return a user visible to the caller.

    Administrators and the user themselves receive the full profile. Managers
    may view their assigned employees and employees their assigned managers,
    each as a reduced summary.
    """
    user = user_service.get_user_or_404(db, user_id)
    if current_user.role == "admin" or current_user.id == user.id:
        return UserPublic.model_validate(user)
    related = (
        current_user.role == "manager" and rel.is_managed_by(db, user.id, current_user.id)
    ) or (
        current_user.role == "employee" and rel.is_managed_by(db, current_user.id, user.id)
    )
    if not related:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return UserSummary.model_validate(user)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    payload: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    """Edit a user's profile fields (administrators only)."""
    user = user_service.get_user_or_404(db, user_id)
    return user_service.update_user(db, admin, user, payload)


@router.patch("/{user_id}/role", response_model=UserPublic)
def change_user_role(
    user_id: int,
    payload: RoleUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    """Change a user's role (administrators only)."""
    user = user_service.get_user_or_404(db, user_id)
    return user_service.change_role(db, admin, user, payload.role)


@router.patch("/{user_id}/status", response_model=UserPublic)
def change_user_status(
    user_id: int,
    payload: StatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    """Activate or deactivate a user (administrators only)."""
    user = user_service.get_user_or_404(db, user_id)
    return user_service.set_active_status(db, admin, user, payload.is_active)


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_user_password(
    user_id: int,
    payload: PasswordReset,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    """Reset another user's password (administrators only)."""
    user = user_service.get_user_or_404(db, user_id)
    user_service.reset_password(db, admin, user, payload.new_password)

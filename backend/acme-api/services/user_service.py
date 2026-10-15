"""Business logic for user administration."""

from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.project import Project
from models.user import EmployeeManager, User
from schemas.user import (
    SelfProfileUpdate,
    UserCreate,
    UserUpdate,
    normalize_username,
)
from services.audit_service import record_audit
from services.auth_service import hash_password
from services.scheduling_rules import end_open_assignments, lock_employee, utc_today


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def get_user_or_404(db: Session, user_id: int) -> User:
    """Return the user with the given id or raise 404."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


def _email_taken(db: Session, email: str, exclude_id: int | None = None) -> bool:
    query = select(User.id).where(func.lower(User.email) == email.lower())
    if exclude_id is not None:
        query = query.where(User.id != exclude_id)
    return db.execute(query).first() is not None


def _snapshot(user: User, fields: list[str]) -> dict[str, Any]:
    return {field: getattr(user, field) for field in fields}


def list_users(
    db: Session,
    *,
    role: str | None = None,
    is_active: bool | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[User]:
    """List users with optional filters, ordered by username."""
    query = select(User)
    if role is not None:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(User.username).like(pattern),
                func.lower(User.email).like(pattern),
                func.lower(User.first_name).like(pattern),
                func.lower(User.last_name).like(pattern),
            )
        )
    query = query.order_by(User.username).limit(limit).offset(offset)
    return list(db.scalars(query))


def create_user(db: Session, actor: User, payload: UserCreate) -> User:
    """Create a user and its audit record in one transaction."""
    username = normalize_username(payload.username)
    if (
        db.scalar(select(User.id).where(func.lower(User.username) == username))
        is not None
    ):
        raise _conflict("Username is already in use")
    if _email_taken(db, payload.email):
        raise _conflict("Email is already in use")

    user = User(
        username=username,
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        job_title=payload.job_title,
        profile_picture_url=payload.profile_picture_url,
        is_active=payload.is_active,
    )
    try:
        db.add(user)
        db.flush()
        record_audit(
            db,
            actor_id=actor.id,
            action="user.create",
            entity_type="user",
            entity_id=user.id,
            description=f"Created {user.role} account '{user.username}'",
            changes={
                "after": _snapshot(
                    user,
                    [
                        "username",
                        "email",
                        "first_name",
                        "last_name",
                        "role",
                        "job_title",
                        "is_active",
                    ],
                )
            },
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _conflict("Username or email is already in use") from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return user


def _apply_profile_changes(
    db: Session,
    actor: User,
    user: User,
    changes: dict[str, Any],
    *,
    action: str,
    description: str,
) -> User:
    """Apply profile field changes and audit them atomically."""
    changed = {k: v for k, v in changes.items() if getattr(user, k) != v}
    if not changed:
        return user
    if "email" in changed and _email_taken(db, changed["email"], exclude_id=user.id):
        raise _conflict("Email is already in use")

    before = {field: getattr(user, field) for field in changed}
    try:
        for field, value in changed.items():
            setattr(user, field, value)
        record_audit(
            db,
            actor_id=actor.id,
            action=action,
            entity_type="user",
            entity_id=user.id,
            description=description,
            changes={"before": before, "after": changed},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _conflict("Email is already in use") from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return user


def update_user(db: Session, actor: User, user: User, payload: UserUpdate) -> User:
    """Apply an administrator's profile edit to a user."""
    return _apply_profile_changes(
        db,
        actor,
        user,
        payload.model_dump(exclude_unset=True),
        action="user.update",
        description=f"Updated profile of '{user.username}'",
    )


def update_own_profile(db: Session, user: User, payload: SelfProfileUpdate) -> User:
    """Apply a user's edit to their own permitted profile fields."""
    changes = payload.model_dump(exclude_unset=True)
    for required in ("first_name", "last_name"):
        if required in changes and changes[required] is None:
            raise HTTPException(
                status_code=422,
                detail=f"{required} cannot be null",
            )
    return _apply_profile_changes(
        db,
        user,
        user,
        changes,
        action="user.self_update",
        description=f"'{user.username}' updated their own profile",
    )


def _has_role_dependencies(db: Session, user: User) -> str | None:
    """Return a reason string if the user's current role is still in use."""
    if (
        db.scalar(
            select(EmployeeManager.employee_id)
            .where(
                or_(
                    EmployeeManager.employee_id == user.id,
                    EmployeeManager.manager_id == user.id,
                )
            )
            .limit(1)
        )
        is not None
    ):
        return "Remove the user's employee-manager relationships before changing their role"
    if (
        db.scalar(select(Project.id).where(Project.manager_id == user.id).limit(1))
        is not None
    ):
        return "Reassign the user's managed projects before changing their role"
    if (
        db.scalar(
            select(MilestoneAssignment.id)
            .where(
                MilestoneAssignment.employee_id == user.id,
                MilestoneAssignment.ended_at.is_(None),
                MilestoneAssignment.planned_end_date >= utc_today(),
            )
            .limit(1)
        )
        is not None
    ):
        return "End the user's active milestone assignments before changing their role"
    return None


def change_role(db: Session, actor: User, user: User, new_role: str) -> User:
    """Change a user's role, refusing changes that would orphan relationships."""
    if user.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrators cannot change their own role",
        )
    if user.role == new_role:
        return user
    reason = _has_role_dependencies(db, user)
    if reason:
        raise _conflict(reason)

    old_role = user.role
    try:
        user.role = new_role
        record_audit(
            db,
            actor_id=actor.id,
            action="user.role_change",
            entity_type="user",
            entity_id=user.id,
            description=f"Changed role of '{user.username}' from {old_role} to {new_role}",
            changes={"before": {"role": old_role}, "after": {"role": new_role}},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return user


def set_active_status(
    db: Session,
    actor: User,
    user: User,
    is_active: bool,
    *,
    now: datetime | None = None,
) -> User:
    """Activate or deactivate a user account.

    Deactivation policy (history is never deleted):
      * An employee's active and future assignments are ended at the start of
        today (UTC) in the same transaction, so no scheduled work remains for
        an account that can no longer sign in. Past work and costs are intact.
      * A manager who still owns active, unarchived projects cannot be
        deactivated until those projects are reassigned or closed.
      * Reactivation never restores ended assignments; schedule them afresh.
    """
    if user.id == actor.id and not is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrators cannot deactivate their own account",
        )
    if user.is_active == is_active:
        return user

    try:
        ended: list[dict[str, Any]] = []
        if not is_active:
            # if trying to deactivate a manager, and they have an active project, we refuse the deactivation
            if (
                user.role == "manager"
                and db.scalar(
                    select(Project.id)
                    .where(
                        Project.manager_id == user.id,
                        Project.status == "active",
                        Project.is_archived.is_(False),
                    )
                    .limit(1)
                )
                is not None
            ):
                raise _conflict(
                    "Reassign or close the manager's active projects before deactivating them"
                )
            if user.role == "employee":
                # freeze an employee's row to prevent further modifications while deactivating
                lock_employee(db, user.id)
                ended = end_open_assignments(
                    db, today=utc_today(now), employee_id=user.id
                )

        user.is_active = is_active
        changes: dict[str, Any] = {
            "before": {"is_active": not is_active},
            "after": {"is_active": is_active},
        }
        if ended:
            changes["ended_assignments"] = ended
        record_audit(
            db,
            actor_id=actor.id,
            action="user.activate" if is_active else "user.deactivate",
            entity_type="user",
            entity_id=user.id,
            description=(
                f"{'Activated' if is_active else 'Deactivated'} account '{user.username}'"
                + (f"; ended {len(ended)} open assignment(s)" if ended else "")
            ),
            changes=changes,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return user


def reset_password(db: Session, actor: User, user: User, new_password: str) -> None:
    """Replace a user's password; the audit record never contains the secret."""
    try:
        user.password_hash = hash_password(new_password)
        record_audit(
            db,
            actor_id=actor.id,
            action="user.password_reset",
            entity_type="user",
            entity_id=user.id,
            description=f"Reset password for '{user.username}'",
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

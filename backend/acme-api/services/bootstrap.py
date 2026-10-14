from sqlalchemy.orm import Session

from models.user import User
from services.auth_service import hash_password


def ensure_initial_admin(
    db: Session,
    *,
    username: str,
    email: str,
    password: str,
    first_name: str = "System",
    last_name: str = "Administrator",
) -> User:
    """Create the first admin user only if no admin account already exists."""
    existing_admin = db.query(User).filter(User.role == "admin").first()
    if existing_admin is not None:
        raise ValueError("An administrator account already exists.")

    user = User(
        username=username,
        email=email,
        first_name=first_name,
        last_name=last_name,
        password_hash=hash_password(password),
        role="admin",
        job_title="Administrator",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

import os

from sqlalchemy.orm import Session

from config import settings
from database import SessionLocal
from services.bootstrap import ensure_initial_admin


def main() -> None:
    """Create the first administrator account from environment variables."""
    username = os.getenv("INITIAL_ADMIN_USERNAME", "admin")
    email = os.getenv("INITIAL_ADMIN_EMAIL", "admin@example.com")
    password = os.getenv("INITIAL_ADMIN_PASSWORD")
    if password is None:
        raise SystemExit(
            "INITIAL_ADMIN_PASSWORD must be set before bootstrapping the initial admin account."
        )

    with SessionLocal() as session:
        try:
            user = ensure_initial_admin(
                session,
                username=username,
                email=email,
                password=password,
            )
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc

    print(f"Created initial admin user: {user.username} ({user.email})")


if __name__ == "__main__":
    main()

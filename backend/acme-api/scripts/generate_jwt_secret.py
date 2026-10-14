"""Create ``jwt_secret.key`` once, with a cryptographically secure random secret.

Run from ``backend/acme-api``::

    python scripts/generate_jwt_secret.py

The file is git-ignored and is packaged into the Lambda zip by the normal deployment.
The script refuses to overwrite an existing file, because replacing the secret signs
every user out. It never prints the secret.
"""

import os
import secrets
import sys
from pathlib import Path

SECRET_FILE = Path(__file__).resolve().parent.parent / "jwt_secret.key"


def main() -> None:
    """Write a new secret file, or exit if one already exists."""
    try:
        with open(SECRET_FILE, "x", encoding="utf-8") as handle:
            handle.write(secrets.token_urlsafe(48))
    except FileExistsError:
        raise SystemExit(f"{SECRET_FILE.name} already exists; not overwriting it.")
    os.chmod(SECRET_FILE, 0o600)
    print(f"Created {SECRET_FILE.name} (secret not displayed). Keep a private backup.")


if __name__ == "__main__":
    sys.exit(main())

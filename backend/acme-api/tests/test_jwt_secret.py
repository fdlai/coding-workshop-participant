"""Tests for JWT secret resolution and the one-time secret generator."""

import re

import pytest

from config import settings
from services import auth_service
from scripts import generate_jwt_secret

GOOD_FILE_SECRET = "f" * 40


@pytest.fixture
def secret_file(tmp_path, monkeypatch):
    path = tmp_path / "jwt_secret.key"
    monkeypatch.setattr(auth_service, "SECRET_FILE", path)
    monkeypatch.setattr(generate_jwt_secret, "SECRET_FILE", path)
    return path


def test_environment_secret_wins_over_file(secret_file, monkeypatch):
    secret_file.write_text(GOOD_FILE_SECRET)
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "explicit-env-secret")
    assert auth_service.get_jwt_secret() == "explicit-env-secret"


def test_file_is_used_when_environment_secret_is_missing_or_placeholder(secret_file, monkeypatch):
    secret_file.write_text(GOOD_FILE_SECRET + "\n")
    for value in ("", "change-me-in-production", "acme-dev-secret-change-me"):
        monkeypatch.setattr(settings, "JWT_SECRET_KEY", value)
        assert auth_service.get_jwt_secret() == GOOD_FILE_SECRET


@pytest.mark.parametrize("content", [None, "", "too-short", "change-me-in-production"])
def test_fails_clearly_without_a_valid_secret(secret_file, monkeypatch, content):
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "change-me-in-production")
    if content is not None:
        secret_file.write_text(content)
    with pytest.raises(RuntimeError, match="No valid JWT secret") as error:
        auth_service.get_jwt_secret()
    assert "change-me-in-production" not in str(error.value).replace("No valid JWT secret", "")


def test_generator_creates_strong_secret_once_and_never_prints_it(secret_file, capsys):
    generate_jwt_secret.main()
    created = secret_file.read_text()
    assert len(created) >= 32
    assert created not in capsys.readouterr().out

    with pytest.raises(SystemExit, match="already exists"):
        generate_jwt_secret.main()
    assert secret_file.read_text() == created


def test_generated_secret_is_usable_for_tokens(secret_file, monkeypatch):
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "")
    generate_jwt_secret.main()
    token = auth_service.create_access_token("someone")
    assert auth_service.decode_access_token(token) == "someone"


def test_lambda_packaging_patterns_include_secret_file_but_not_dotfiles():
    # Same rules as infra/locals.tf, applied with fullmatch like the packaging module does.
    patterns = [r"__pycache__/.*", r"\..*"]
    excluded = lambda path: any(re.fullmatch(p, path) for p in patterns)  # noqa: E731
    assert not excluded("jwt_secret.key")
    assert excluded(".env")
    assert excluded(".gitignore")

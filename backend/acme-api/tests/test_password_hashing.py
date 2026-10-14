"""Password hashing must stay low-memory (Lambda has 128 MB) and keep legacy hashes working."""

from pwdlib import PasswordHash

from services.auth_service import PBKDF2_PREFIX, hash_password, verify_password


def test_hash_is_pbkdf2_salted_and_verifies():
    first = hash_password("CorrectHorse123")
    second = hash_password("CorrectHorse123")
    assert first.startswith(PBKDF2_PREFIX + "$")
    assert first != second  # unique salt per hash
    assert "CorrectHorse123" not in first
    assert verify_password("CorrectHorse123", first)
    assert not verify_password("WrongHorse123", first)


def test_malformed_pbkdf2_hash_is_rejected_not_raised():
    assert verify_password("x", PBKDF2_PREFIX + "$bad") is False
    assert verify_password("x", PBKDF2_PREFIX + "$abc$!!$!!") is False


def test_legacy_argon2_hashes_still_verify():
    legacy = PasswordHash.recommended().hash("LegacyPass123")
    assert verify_password("LegacyPass123", legacy)
    assert not verify_password("Nope", legacy)

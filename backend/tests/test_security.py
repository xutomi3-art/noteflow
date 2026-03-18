"""Tests for backend.core.security — password hashing, JWT tokens."""
from backend.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    create_password_reset_token,
    decode_password_reset_token,
)


class TestPasswordHashing:
    def test_hash_returns_different_string(self):
        hashed = hash_password("MySecret123")
        assert hashed != "MySecret123"
        assert hashed.startswith("$2b$")

    def test_verify_correct_password(self):
        hashed = hash_password("MySecret123")
        assert verify_password("MySecret123", hashed) is True

    def test_verify_wrong_password(self):
        hashed = hash_password("MySecret123")
        assert verify_password("WrongPassword", hashed) is False

    def test_different_hashes_for_same_password(self):
        h1 = hash_password("SamePass123")
        h2 = hash_password("SamePass123")
        assert h1 != h2


class TestJWTTokens:
    def test_create_and_decode_access_token(self):
        token = create_access_token("user-abc-123")
        payload = decode_token(token)
        assert payload is not None
        assert payload["sub"] == "user-abc-123"
        assert payload["type"] == "access"

    def test_create_and_decode_refresh_token(self):
        token = create_refresh_token("user-xyz-789")
        payload = decode_token(token)
        assert payload is not None
        assert payload["sub"] == "user-xyz-789"
        assert payload["type"] == "refresh"

    def test_decode_invalid_token_returns_none(self):
        assert decode_token("not-a-valid-jwt") is None

    def test_decode_tampered_token_returns_none(self):
        token = create_access_token("user-1")
        parts = token.split(".")
        parts[1] = parts[1] + "tampered"
        assert decode_token(".".join(parts)) is None


class TestPasswordResetTokens:
    def test_create_and_decode_reset_token(self):
        pw_hash = "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01"
        token = create_password_reset_token("user-reset-1", pw_hash)
        assert decode_password_reset_token(token, pw_hash) == "user-reset-1"

    def test_reset_token_fails_with_different_password_hash(self):
        old_hash = "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01"
        new_hash = "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ99"
        token = create_password_reset_token("user-reset-2", old_hash)
        assert decode_password_reset_token(token, new_hash) is None

    def test_reset_token_invalid_string(self):
        pw_hash = "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01"
        assert decode_password_reset_token("garbage", pw_hash) is None

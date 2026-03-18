"""Tests for Pydantic request/response schemas — validation rules."""
import pytest
from pydantic import ValidationError

from backend.schemas.auth import RegisterRequest, ResetPasswordRequest


class TestRegisterRequest:
    def test_valid_registration(self):
        req = RegisterRequest(email="user@example.com", name="Alice", password="StrongPass1")
        assert req.email == "user@example.com"
        assert req.name == "Alice"

    def test_name_stripped(self):
        req = RegisterRequest(email="a@b.com", name="  Bob  ", password="StrongPass1")
        assert req.name == "Bob"

    def test_empty_name_rejected(self):
        with pytest.raises(ValidationError, match="Name is required"):
            RegisterRequest(email="a@b.com", name="   ", password="StrongPass1")

    def test_name_too_long_rejected(self):
        with pytest.raises(ValidationError, match="100 characters"):
            RegisterRequest(email="a@b.com", name="A" * 101, password="StrongPass1")

    def test_invalid_email_rejected(self):
        with pytest.raises(ValidationError):
            RegisterRequest(email="not-an-email", name="Test", password="StrongPass1")

    def test_password_too_short(self):
        with pytest.raises(ValidationError, match="at least 8"):
            RegisterRequest(email="a@b.com", name="Test", password="Short1A")

    def test_password_no_lowercase(self):
        with pytest.raises(ValidationError, match="lowercase"):
            RegisterRequest(email="a@b.com", name="Test", password="ALLCAPS123")

    def test_password_no_uppercase(self):
        with pytest.raises(ValidationError, match="uppercase"):
            RegisterRequest(email="a@b.com", name="Test", password="alllower123")

    def test_password_no_digit(self):
        with pytest.raises(ValidationError, match="digit"):
            RegisterRequest(email="a@b.com", name="Test", password="NoDigitsHere")


class TestResetPasswordRequest:
    def test_valid_reset(self):
        req = ResetPasswordRequest(token="abc", new_password="NewPass123")
        assert req.token == "abc"

    def test_weak_password_rejected(self):
        with pytest.raises(ValidationError, match="at least 8"):
            ResetPasswordRequest(token="abc", new_password="short")

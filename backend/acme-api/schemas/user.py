"""Pydantic schemas for user administration and profile endpoints."""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


Role = Literal["admin", "manager", "employee"]

USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,99}$")


def normalize_username(value: str) -> str:
    """Return the canonical (trimmed, lower-case) form of a username."""
    return value.strip().lower()


def _validate_username(value: str) -> str:
    normalized = normalize_username(value)
    if not USERNAME_PATTERN.match(normalized):
        raise ValueError(
            "Username must be 3-100 characters: letters, digits, '.', '_' or '-'."
        )
    return normalized


def _validate_picture_url(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if not re.match(r"^https?://", value, re.IGNORECASE):
        raise ValueError("Profile picture URL must start with http:// or https://.")
    return value


def _strip_required(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Value must not be blank.")
    return value


class UserPublic(BaseModel):
    """Full user payload for administrators and the user themselves."""

    id: int
    username: str
    first_name: str
    last_name: str
    email: EmailStr
    role: str
    job_title: str | None = None
    profile_picture_url: str | None = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSummary(BaseModel):
    """Reduced user payload shown to related (non-admin) users."""

    id: int
    username: str
    first_name: str
    last_name: str
    role: str
    job_title: str | None = None
    profile_picture_url: str | None = None
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    """Payload used when an administrator creates a user."""

    username: str
    email: EmailStr
    first_name: str = Field(..., max_length=100)
    last_name: str = Field(..., max_length=100)
    password: str = Field(..., min_length=8, max_length=128)
    role: Role = "employee"
    job_title: str | None = Field(default=None, max_length=150)
    profile_picture_url: str | None = Field(default=None, max_length=500)
    is_active: bool = True

    model_config = ConfigDict(extra="forbid")

    _username = field_validator("username")(_validate_username)
    _names = field_validator("first_name", "last_name")(_strip_required)
    _picture = field_validator("profile_picture_url")(_validate_picture_url)

    @field_validator("email")
    @classmethod
    def _lower_email(cls, value: str) -> str:
        return value.strip().lower()


class UserUpdate(BaseModel):
    """Administrator-editable profile fields (role/status have dedicated endpoints)."""

    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    job_title: str | None = Field(default=None, max_length=150)
    profile_picture_url: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")

    @field_validator("first_name", "last_name")
    @classmethod
    def _names(cls, value: str | None) -> str | None:
        return None if value is None else _strip_required(value)

    _picture = field_validator("profile_picture_url")(_validate_picture_url)

    @field_validator("email")
    @classmethod
    def _lower_email(cls, value: str | None) -> str | None:
        return None if value is None else value.strip().lower()


class SelfProfileUpdate(BaseModel):
    """Personal fields a user may change on their own profile."""

    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    job_title: str | None = Field(default=None, max_length=150)
    profile_picture_url: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")

    @field_validator("first_name", "last_name")
    @classmethod
    def _names(cls, value: str | None) -> str | None:
        return None if value is None else _strip_required(value)

    _picture = field_validator("profile_picture_url")(_validate_picture_url)


class RoleUpdate(BaseModel):
    """Payload for changing a user's role."""

    role: Role

    model_config = ConfigDict(extra="forbid")


class StatusUpdate(BaseModel):
    """Payload for activating or deactivating a user."""

    is_active: bool

    model_config = ConfigDict(extra="forbid")


class PasswordReset(BaseModel):
    """Administrator-supplied replacement password."""

    new_password: str = Field(..., min_length=8, max_length=128)

    model_config = ConfigDict(extra="forbid")

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserPublic(BaseModel):
    """Safe user payload suitable for authenticated responses."""

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


class UserCreate(BaseModel):
    """Payload used when an administrator creates a user."""

    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8)
    role: str = "employee"
    job_title: str | None = None
    profile_picture_url: str | None = None
    is_active: bool = True


class UserUpdate(BaseModel):
    """Fields that can be patched for a user."""

    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None
    job_title: str | None = None
    profile_picture_url: str | None = None
    is_active: bool | None = None
    role: str | None = None

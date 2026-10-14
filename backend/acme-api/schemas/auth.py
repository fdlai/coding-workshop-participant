from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    """Credentials required to log in."""

    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=8)


class PasswordChangeRequest(BaseModel):
    """Request payload for self-service password changes."""

    current_password: str = Field(..., min_length=8)
    new_password: str = Field(..., min_length=8)


class TokenResponse(BaseModel):
    """JWT response returned after a successful login."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int

model_config = ConfigDict(from_attributes=True)

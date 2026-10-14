"""Pydantic schemas for employee compensation (work terms)."""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


MIN_EFFECTIVE = date(2000, 1, 1)
MAX_EFFECTIVE = date(2100, 12, 31)


class WorkTermsCreate(BaseModel):
    """A new effective-dated compensation record (history is append-only)."""

    hourly_rate: Decimal = Field(..., ge=0, max_digits=12, decimal_places=2)
    weekly_hours: Decimal = Field(..., ge=0, le=168, max_digits=5, decimal_places=2)
    effective_from: date

    model_config = ConfigDict(extra="forbid")

    @field_validator("effective_from")
    @classmethod
    def _sane_date(cls, value: date) -> date:
        if not MIN_EFFECTIVE <= value <= MAX_EFFECTIVE:
            raise ValueError(f"effective_from must be between {MIN_EFFECTIVE} and {MAX_EFFECTIVE}.")
        return value


class WorkTermsOut(BaseModel):
    """A compensation record. Only ever returned to administrators."""

    id: int
    employee_id: int
    hourly_rate: Decimal
    weekly_hours: Decimal
    effective_from: date
    daily_cost: Decimal

    model_config = ConfigDict(from_attributes=True)

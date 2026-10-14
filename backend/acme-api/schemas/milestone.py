"""Pydantic schemas for milestones."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


MilestoneStatus = Literal["pending", "completed"]


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Name must not be blank.")
    return value


class MilestoneCreate(BaseModel):
    """Payload for creating a milestone."""

    name: str = Field(..., max_length=200)
    description: str | None = None
    deliverables: str | None = None
    start_date: date
    end_date: date

    model_config = ConfigDict(extra="forbid")

    _name = field_validator("name")(_clean_name)

    @model_validator(mode="after")
    def _check_dates(self) -> "MilestoneCreate":
        if self.end_date < self.start_date:
            raise ValueError("Milestone start date must be on or before its end date.")
        return self


class MilestoneUpdate(BaseModel):
    """Editable milestone fields."""

    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    deliverables: str | None = None
    start_date: date | None = None
    end_date: date | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)

    @model_validator(mode="after")
    def _no_nulls_for_required(self) -> "MilestoneUpdate":
        for field in ("name", "start_date", "end_date"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null.")
        return self


class MilestoneStatusUpdate(BaseModel):
    """Payload for changing a milestone's status."""

    status: MilestoneStatus

    model_config = ConfigDict(extra="forbid")


class MilestoneOut(BaseModel):
    """Milestone payload."""

    id: int
    project_id: int
    name: str
    description: str | None = None
    deliverables: str | None = None
    start_date: date
    end_date: date
    status: str
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

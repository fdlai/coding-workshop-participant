"""Pydantic schemas for projects."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


ProjectStatus = Literal["active", "completed", "abandoned"]


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Name must not be blank.")
    return value


class ProjectCreate(BaseModel):
    """Payload for an administrator creating a project."""

    name: str = Field(..., max_length=200)
    description: str | None = None
    manager_id: int = Field(..., gt=0)
    start_date: date
    estimated_end_date: date
    estimated_budget: Decimal = Field(..., ge=0, max_digits=14, decimal_places=2)

    model_config = ConfigDict(extra="forbid")

    _name = field_validator("name")(_clean_name)

    @model_validator(mode="after")
    def _check_dates(self) -> "ProjectCreate":
        if self.estimated_end_date < self.start_date:
            raise ValueError("Project end date must not precede its start date.")
        return self


class ProjectUpdate(BaseModel):
    """Editable project fields; ``manager_id`` is administrator-only."""

    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    manager_id: int | None = Field(default=None, gt=0)
    start_date: date | None = None
    estimated_end_date: date | None = None
    estimated_budget: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)

    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)

    @model_validator(mode="after")
    def _no_nulls_for_required(self) -> "ProjectUpdate":
        for field in ("name", "manager_id", "start_date", "estimated_end_date", "estimated_budget"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null.")
        return self


class ProjectStatusUpdate(BaseModel):
    """Payload for changing a project's status."""

    status: ProjectStatus

    model_config = ConfigDict(extra="forbid")


class ProjectOut(BaseModel):
    """Full project payload for administrators and the owning manager."""

    id: int
    name: str
    description: str | None = None
    manager_id: int
    created_by: int
    start_date: date
    estimated_end_date: date
    estimated_budget: Decimal
    status: str
    is_archived: bool
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectEmployeeOut(BaseModel):
    """Project payload for employees: no budget or creator information."""

    id: int
    name: str
    description: str | None = None
    manager_id: int
    start_date: date
    estimated_end_date: date
    status: str
    is_archived: bool

    model_config = ConfigDict(from_attributes=True)

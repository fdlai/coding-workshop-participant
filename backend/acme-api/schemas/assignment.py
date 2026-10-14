"""Pydantic schemas for milestone assignments, scheduling and availability."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from schemas.user import UserSummary


class AssignmentCreate(BaseModel):
    """Payload for scheduling an employee into a milestone."""

    employee_id: int = Field(..., gt=0)
    start_date: date
    planned_end_date: date

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _check_dates(self) -> "AssignmentCreate":
        if self.planned_end_date < self.start_date:
            raise ValueError("Assignment start date must be on or before its end date.")
        return self


class AssignmentUpdate(BaseModel):
    """Editable fields of an assignment that has not yet finished."""

    start_date: date | None = None
    planned_end_date: date | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _no_nulls(self) -> "AssignmentUpdate":
        if not self.model_fields_set:
            raise ValueError("Provide start_date and/or planned_end_date.")
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null.")
        return self


class AssignmentTransfer(BaseModel):
    """Payload for moving an employee from one milestone to another."""

    target_milestone_id: int = Field(..., gt=0)
    start_date: date | None = None
    planned_end_date: date | None = None

    model_config = ConfigDict(extra="forbid")


class AssignmentOut(BaseModel):
    """Assignment payload including its derived effective period and state."""

    id: int
    milestone_id: int
    employee_id: int
    start_date: date
    planned_end_date: date
    ended_at: datetime | None = None
    effective_end_date: date
    state: str
    employee: UserSummary | None = None


class TransferResult(BaseModel):
    """Result of an atomic transfer."""

    source: AssignmentOut
    destination: AssignmentOut


class ScheduleItem(BaseModel):
    """One assignment in an employee's schedule."""

    assignment: AssignmentOut
    project_id: int
    project_name: str
    milestone_name: str


class BusyPeriod(BaseModel):
    """A date range during which an employee is already scheduled."""

    start_date: date
    end_date: date


class AvailabilityEntry(BaseModel):
    """An employee's availability across a requested date range."""

    employee: UserSummary
    is_available: bool
    busy: list[BusyPeriod]

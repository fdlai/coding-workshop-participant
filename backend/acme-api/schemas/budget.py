"""Pydantic schemas for project budget and timeline responses."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from schemas.user import UserSummary


BudgetHealth = Literal["on_track", "at_risk", "over_budget"]


class MilestoneCostOut(BaseModel):
    """Aggregated estimated cost of one milestone (never per employee)."""

    milestone_id: int
    name: str
    status: str
    accrued_cost: Decimal
    projected_cost: Decimal
    total_expected_cost: Decimal


class BudgetOut(BaseModel):
    """Project budget position based on scheduled work, not timesheets."""

    project_id: int
    as_of: date
    accrued_through: date
    estimated_budget: Decimal
    accrued_cost: Decimal
    projected_cost: Decimal
    total_expected_cost: Decimal
    budget_remaining: Decimal
    budget_utilization_percent: Decimal | None
    health: BudgetHealth
    unpriced_days: int
    milestones: list[MilestoneCostOut]
    note: str


class TimelineMilestoneOut(BaseModel):
    """A milestone positioned on the project timeline."""

    id: int
    name: str
    status: str
    start_date: date
    end_date: date
    completed_at: datetime | None = None
    assigned_employee_count: int
    assigned_employees: list[UserSummary] | None = None


class TimelineOut(BaseModel):
    """Project timeline for the Gantt view; contains no cost or budget data."""

    project_id: int
    name: str
    status: str
    is_archived: bool
    start_date: date
    estimated_end_date: date
    today: date
    milestones: list[TimelineMilestoneOut]

"""Pydantic schemas for the role-specific dashboard summaries."""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from schemas.assignment import ScheduleItem
from schemas.audit import AuditLogOut
from schemas.budget import BudgetHealth
from schemas.user import UserSummary


class ProjectHealthOut(BaseModel):
    """A project with budget health; only built for admins and owning managers."""

    id: int
    name: str
    status: str
    manager: UserSummary | None = None
    start_date: date
    estimated_end_date: date
    estimated_budget: Decimal
    total_expected_cost: Decimal
    budget_utilization_percent: Decimal | None
    health: BudgetHealth
    milestones_total: int
    milestones_completed: int
    assigned_employee_count: int


class UpcomingMilestoneOut(BaseModel):
    """A pending milestone that has not yet ended."""

    id: int
    name: str
    project_id: int
    project_name: str
    start_date: date
    end_date: date
    days_remaining: int


class HealthCounts(BaseModel):
    """Number of active projects in each budget-health bucket."""

    on_track: int = 0
    at_risk: int = 0
    over_budget: int = 0


class AdminDashboard(BaseModel):
    """Organization-wide summary for administrators."""

    active_projects: int
    employees: int
    managers: int
    projects_at_risk: int
    health_counts: HealthCounts
    projects: list[ProjectHealthOut]
    recent_activity: list[AuditLogOut]


class ManagerDashboard(BaseModel):
    """Summary of a manager's own projects and team."""

    projects: list[ProjectHealthOut]
    upcoming_milestones: list[UpcomingMilestoneOut]
    team_size: int
    employees_scheduled_now: int
    budget_at_risk: int
    unscheduled_team_members: list[UserSummary]


class EmployeeDashboard(BaseModel):
    """An employee's own assignments and managers; contains no budget data."""

    today: date
    current_assignments: list[ScheduleItem]
    upcoming_assignments: list[ScheduleItem]
    managers: list[UserSummary]

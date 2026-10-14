"""Role-specific dashboard summaries.

Each function returns only data its role may see. Budget figures are computed
with the same on-demand cost engine as the project budget endpoint.
"""

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from schemas.dashboard import (
    AdminDashboard,
    EmployeeDashboard,
    HealthCounts,
    ManagerDashboard,
    ProjectHealthOut,
    UpcomingMilestoneOut,
)
from schemas.user import UserSummary
from services import assignment_service, cost_service, relationship_service
from services.audit_query_service import recent_audit_entries
from services.budget_service import HUNDRED, budget_health
from services.cost_service import money
from services.scheduling_rules import effective_window, utc_today

RECENT_ACTIVITY_LIMIT = 8
UPCOMING_MILESTONE_LIMIT = 6


def _project_health_rows(db: Session, projects: list[Project], today: date) -> list[ProjectHealthOut]:
    """Build budget-health rows for several projects using a fixed number of queries."""
    if not projects:
        return []
    ids = [p.id for p in projects]
    costs = cost_service.calculate_project_costs(db, ids, today)
    managers = {u.id: u for u in db.scalars(select(User).where(User.id.in_({p.manager_id for p in projects})))}

    milestone_counts: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for project_id, status in db.execute(
        select(Milestone.project_id, Milestone.status).where(Milestone.project_id.in_(ids))
    ):
        milestone_counts[project_id][0] += 1
        milestone_counts[project_id][1] += status == "completed"

    employees_by_project: dict[int, set[int]] = defaultdict(set)
    for assignment, milestone in db.execute(
        select(MilestoneAssignment, Milestone)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .where(Milestone.project_id.in_(ids))
    ):
        if effective_window(assignment, milestone) is not None:
            employees_by_project[milestone.project_id].add(assignment.employee_id)

    rows = []
    for project in projects:
        total_breakdown = costs[project.id].total
        total = money(total_breakdown.accrued) + money(total_breakdown.projected)
        budget = money(Decimal(project.estimated_budget))
        manager = managers.get(project.manager_id)
        rows.append(
            ProjectHealthOut(
                id=project.id,
                name=project.name,
                status=project.status,
                manager=UserSummary.model_validate(manager) if manager else None,
                start_date=project.start_date,
                estimated_end_date=project.estimated_end_date,
                estimated_budget=budget,
                total_expected_cost=total,
                budget_utilization_percent=None if budget == 0 else money(total / budget * HUNDRED),
                health=budget_health(total, budget),
                milestones_total=milestone_counts[project.id][0],
                milestones_completed=milestone_counts[project.id][1],
                assigned_employee_count=len(employees_by_project[project.id]),
            )
        )
    return rows


def _count_active_users(db: Session, role: str) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.role == role, User.is_active.is_(True))
    ) or 0


def admin_dashboard(db: Session, *, now: datetime | None = None) -> AdminDashboard:
    """Return organization-wide counts, project health and recent activity."""
    today = utc_today(now)
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.status == "active", Project.is_archived.is_(False))
            .order_by(Project.name)
        )
    )
    rows = _project_health_rows(db, projects, today)
    counts = HealthCounts()
    for row in rows:
        setattr(counts, row.health, getattr(counts, row.health) + 1)
    return AdminDashboard(
        active_projects=len(rows),
        employees=_count_active_users(db, "employee"),
        managers=_count_active_users(db, "manager"),
        projects_at_risk=counts.at_risk + counts.over_budget,
        health_counts=counts,
        projects=rows,
        recent_activity=recent_audit_entries(db, RECENT_ACTIVITY_LIMIT),
    )


def manager_dashboard(db: Session, actor: User, *, now: datetime | None = None) -> ManagerDashboard:
    """Return a manager's own projects, upcoming milestones and team availability."""
    today = utc_today(now)
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.manager_id == actor.id, Project.is_archived.is_(False))
            .order_by(Project.status, Project.name)
        )
    )
    rows = _project_health_rows(db, projects, today)
    active_ids = [p.id for p in projects if p.status == "active"]
    names = {p.id: p.name for p in projects}

    upcoming = []
    if active_ids:
        milestones = db.scalars(
            select(Milestone)
            .where(
                Milestone.project_id.in_(active_ids),
                Milestone.status == "pending",
                Milestone.end_date >= today,
            )
            .order_by(Milestone.end_date, Milestone.id)
            .limit(UPCOMING_MILESTONE_LIMIT)
        )
        upcoming = [
            UpcomingMilestoneOut(
                id=m.id,
                name=m.name,
                project_id=m.project_id,
                project_name=names[m.project_id],
                start_date=m.start_date,
                end_date=m.end_date,
                days_remaining=(m.end_date - today).days,
            )
            for m in milestones
        ]

    team = relationship_service.list_employees_of(db, actor.id)
    team_ids = {u.id for u in team if u.is_active}
    busy_now: set[int] = set()
    if team_ids:
        for assignment, milestone in db.execute(
            select(MilestoneAssignment, Milestone)
            .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
            .where(MilestoneAssignment.employee_id.in_(team_ids))
        ):
            window = effective_window(assignment, milestone)
            if window is not None and window[0] <= today <= window[1]:
                busy_now.add(assignment.employee_id)

    return ManagerDashboard(
        projects=rows,
        upcoming_milestones=upcoming,
        team_size=len(team_ids),
        employees_scheduled_now=len(busy_now),
        budget_at_risk=sum(1 for r in rows if r.status == "active" and r.health != "on_track"),
        unscheduled_team_members=[
            UserSummary.model_validate(u) for u in team if u.id in team_ids and u.id not in busy_now
        ],
    )


def employee_dashboard(db: Session, actor: User, *, now: datetime | None = None) -> EmployeeDashboard:
    """Return an employee's current and upcoming assignments and managers (no budgets)."""
    today = utc_today(now)
    schedule = assignment_service.employee_schedule(db, actor, actor.id, start=None, end=None, now=now)
    return EmployeeDashboard(
        today=today,
        current_assignments=[i for i in schedule if i.assignment.state == "active"],
        upcoming_assignments=[i for i in schedule if i.assignment.state == "scheduled"],
        managers=[UserSummary.model_validate(u) for u in relationship_service.list_managers_of(db, actor.id)],
    )

"""Project budget and timeline views built on the on-demand cost service."""

from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import User
from schemas.budget import BudgetOut, MilestoneCostOut, TimelineMilestoneOut, TimelineOut
from schemas.user import UserSummary
from services import cost_service
from services.access import ensure_can_manage_project, ensure_can_view_project, get_project_or_404
from services.cost_service import money
from services.scheduling_rules import effective_window, utc_today

AT_RISK_PERCENT = Decimal("95")
HUNDRED = Decimal("100")
BUDGET_NOTE = (
    "Estimates based on scheduled work (weekdays, effective-dated work terms); "
    "not actual timesheet or payroll expenditure."
)


def budget_health(total: Decimal, budget: Decimal) -> str:
    """Classify a budget position; a zero budget is on track only while nothing is expected."""
    if total > budget:
        return "over_budget"
    if budget > 0 and total * HUNDRED >= budget * AT_RISK_PERCENT:
        return "at_risk"
    return "on_track"


def build_budget(project: Project, costs: cost_service.ProjectCost, names: dict[int, Milestone], today) -> BudgetOut:
    """Assemble the budget response from calculated costs."""
    total_breakdown = costs.total
    accrued = money(total_breakdown.accrued)
    projected = money(total_breakdown.projected)
    total = accrued + projected
    budget = money(Decimal(project.estimated_budget))
    utilization = None if budget == 0 else money(total / budget * HUNDRED)
    milestones = []
    for milestone_id, breakdown in sorted(costs.milestones.items()):
        milestone = names[milestone_id]
        m_accrued, m_projected = money(breakdown.accrued), money(breakdown.projected)
        milestones.append(
            MilestoneCostOut(
                milestone_id=milestone_id,
                name=milestone.name,
                status=milestone.status,
                accrued_cost=m_accrued,
                projected_cost=m_projected,
                total_expected_cost=m_accrued + m_projected,
            )
        )
    return BudgetOut(
        project_id=project.id,
        as_of=today,
        accrued_through=today - timedelta(days=1),
        estimated_budget=budget,
        accrued_cost=accrued,
        projected_cost=projected,
        total_expected_cost=total,
        budget_remaining=budget - total,
        budget_utilization_percent=utilization,
        health=budget_health(total, budget),
        unpriced_days=total_breakdown.unpriced_days,
        milestones=milestones,
        note=BUDGET_NOTE,
    )


def project_budget(
    db: Session, actor: User, project_id: int, *, now: datetime | None = None
) -> BudgetOut:
    """Return the budget position for admins and the project's own manager only."""
    project = get_project_or_404(db, project_id)
    ensure_can_manage_project(actor, project)
    today = utc_today(now)
    costs = cost_service.calculate_project_costs(db, [project.id], today)[project.id]
    milestones = {m.id: m for m in db.scalars(select(Milestone).where(Milestone.project_id == project.id))}
    return build_budget(project, costs, milestones, today)


def project_timeline(
    db: Session, actor: User, project_id: int, *, now: datetime | None = None
) -> TimelineOut:
    """Return milestones with placement data; employees get counts but not names."""
    project = get_project_or_404(db, project_id)
    ensure_can_view_project(db, actor, project)
    today = utc_today(now)
    milestones = list(
        db.scalars(
            select(Milestone).where(Milestone.project_id == project.id).order_by(Milestone.start_date, Milestone.id)
        )
    )
    assigned: dict[int, dict[int, User]] = {m.id: {} for m in milestones}
    rows = db.execute(
        select(MilestoneAssignment, Milestone, User)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .join(User, User.id == MilestoneAssignment.employee_id)
        .where(Milestone.project_id == project.id)
    )
    for assignment, milestone, employee in rows:
        if effective_window(assignment, milestone) is not None:
            assigned[milestone.id][employee.id] = employee

    show_names = actor.role != "employee"
    items = [
        TimelineMilestoneOut(
            id=m.id,
            name=m.name,
            status=m.status,
            start_date=m.start_date,
            end_date=m.end_date,
            completed_at=m.completed_at,
            assigned_employee_count=len(assigned[m.id]),
            assigned_employees=(
                [UserSummary.model_validate(u) for u in sorted(assigned[m.id].values(), key=lambda u: u.id)]
                if show_names
                else None
            ),
        )
        for m in milestones
    ]
    return TimelineOut(
        project_id=project.id,
        name=project.name,
        status=project.status,
        is_archived=project.is_archived,
        start_date=project.start_date,
        estimated_end_date=project.estimated_end_date,
        today=today,
        milestones=items,
    )

"""On-demand estimated labor-cost calculations.

Costs are never stored. They are derived from immutable assignment periods,
milestone completion cutoffs and effective-dated work terms:

    daily_cost = hourly_rate * weekly_hours / 5     (Monday-Friday only)

Date conventions (all UTC, inclusive ranges):
  * ``accrued``   covers worked weekdays up to *yesterday*; today never accrues.
  * ``projected`` covers weekdays from *today* onward.
  The two ranges are disjoint, so no day is ever counted twice.
  * An assignment's window comes from ``scheduling_rules.effective_window``;
    cancelled or otherwise empty windows contribute zero.
  * A day before an employee's earliest work terms has no rate. It costs zero
    and is reported as an "unpriced" day so the gap is visible, never hidden.

Money stays in ``Decimal`` throughout. Daily costs have at most five decimal
places (2 + 2 places divided by 5), so sums are exact; results are rounded to
cents (half-up) once, at milestone level, and project totals are sums of the
rounded milestone figures so every displayed figure adds up.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.work_terms import EmployeeWorkTerms
from services.scheduling_rules import effective_window

ZERO = Decimal("0")
CENTS = Decimal("0.01")
WORKDAYS_PER_WEEK = Decimal(5)

# (effective_from, daily_cost), ascending by effective_from.
TermsHistory = list[tuple[date, Decimal]]


def money(value: Decimal) -> Decimal:
    """Round a Decimal amount to cents (half-up)."""
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def daily_cost(hourly_rate: Decimal, weekly_hours: Decimal) -> Decimal:
    """Return the cost of one scheduled weekday for the given terms."""
    return Decimal(hourly_rate) * Decimal(weekly_hours) / WORKDAYS_PER_WEEK


def count_weekdays(start: date, end: date) -> int:
    """Count Monday-Friday days in the inclusive range; zero if the range is empty."""
    if end < start:
        return 0
    total = (end - start).days + 1
    weeks, extra = divmod(total, 7)
    count = weeks * 5
    first = start.weekday()
    count += sum(1 for offset in range(extra) if (first + offset) % 7 < 5)
    return count


@dataclass
class CostBreakdown:
    """Accrued and projected cost plus the weekdays that had no rate."""

    accrued: Decimal = ZERO
    projected: Decimal = ZERO
    accrued_days: int = 0
    projected_days: int = 0
    unpriced_days: int = 0

    def add(self, other: "CostBreakdown") -> None:
        """Accumulate another breakdown into this one."""
        self.accrued += other.accrued
        self.projected += other.projected
        self.accrued_days += other.accrued_days
        self.projected_days += other.projected_days
        self.unpriced_days += other.unpriced_days


def _range_cost(start: date, end: date, history: TermsHistory) -> tuple[Decimal, int, int]:
    """Return (cost, priced weekdays, unpriced weekdays) for an inclusive range.

    The range is split at each effective-date boundary and each segment is priced
    with the terms in force for it, so a mid-assignment raise is honored.
    """
    if end < start:
        return ZERO, 0, 0
    cost, priced, unpriced = ZERO, 0, 0
    cursor = start
    first_effective = history[0][0] if history else None
    if first_effective is None or cursor < first_effective:
        gap_end = end if first_effective is None else min(end, first_effective - timedelta(days=1))
        unpriced += count_weekdays(cursor, gap_end)
        cursor = gap_end + timedelta(days=1)
    for index, (effective_from, rate) in enumerate(history):
        if cursor > end:
            break
        next_effective = history[index + 1][0] if index + 1 < len(history) else None
        segment_start = max(cursor, effective_from)
        segment_end = end if next_effective is None else min(end, next_effective - timedelta(days=1))
        if segment_start > segment_end:
            continue
        days = count_weekdays(segment_start, segment_end)
        cost += rate * days
        priced += days
        cursor = segment_end + timedelta(days=1)
    return cost, priced, unpriced


def window_cost(window: tuple[date, date] | None, history: TermsHistory, today: date) -> CostBreakdown:
    """Split an effective window into accrued (< today) and projected (>= today) cost."""
    result = CostBreakdown()
    if window is None:
        return result
    start, end = window
    accrued_cost, accrued_days, accrued_gap = _range_cost(start, min(end, today - timedelta(days=1)), history)
    projected_cost, projected_days, projected_gap = _range_cost(max(start, today), end, history)
    result.accrued = accrued_cost
    result.projected = projected_cost
    result.accrued_days = accrued_days
    result.projected_days = projected_days
    result.unpriced_days = accrued_gap + projected_gap
    return result


def load_terms_histories(db: Session, employee_ids: set[int]) -> dict[int, TermsHistory]:
    """Load every employee's work-terms history in one query."""
    histories: dict[int, TermsHistory] = defaultdict(list)
    if not employee_ids:
        return histories
    rows = db.execute(
        select(EmployeeWorkTerms)
        .where(EmployeeWorkTerms.employee_id.in_(employee_ids))
        .order_by(EmployeeWorkTerms.employee_id, EmployeeWorkTerms.effective_from)
    ).scalars()
    for row in rows:
        histories[row.employee_id].append(
            (row.effective_from, daily_cost(row.hourly_rate, row.weekly_hours))
        )
    return histories


def has_terms_effective_on(db: Session, employee_id: int, day: date) -> bool:
    """Return True if the employee has terms with ``effective_from <= day``."""
    return (
        db.scalar(
            select(EmployeeWorkTerms.id)
            .where(EmployeeWorkTerms.employee_id == employee_id, EmployeeWorkTerms.effective_from <= day)
            .limit(1)
        )
        is not None
    )


def accrued_weekdays_since(db: Session, employee_id: int, since: date, today: date) -> int:
    """Count worked weekdays in ``[since, yesterday]`` across all of an employee's assignments.

    Used to refuse compensation changes that would rewrite already accrued costs.
    """
    last_accrued = today - timedelta(days=1)
    if since > last_accrued:
        return 0
    rows = db.execute(
        select(MilestoneAssignment, Milestone)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .where(MilestoneAssignment.employee_id == employee_id)
    )
    total = 0
    for assignment, milestone in rows:
        window = effective_window(assignment, milestone)
        if window is not None:
            total += count_weekdays(max(window[0], since), min(window[1], last_accrued))
    return total


@dataclass
class ProjectCost:
    """Cost for one project with a per-milestone breakdown (never per-employee)."""

    milestones: dict[int, CostBreakdown] = field(default_factory=dict)

    @property
    def total(self) -> CostBreakdown:
        """Return the project breakdown as the sum of its cent-rounded milestones."""
        result = CostBreakdown()
        for breakdown in self.milestones.values():
            result.add(
                CostBreakdown(
                    accrued=money(breakdown.accrued),
                    projected=money(breakdown.projected),
                    accrued_days=breakdown.accrued_days,
                    projected_days=breakdown.projected_days,
                    unpriced_days=breakdown.unpriced_days,
                )
            )
        return result


def calculate_project_costs(
    db: Session, project_ids: list[int], today: date
) -> dict[int, ProjectCost]:
    """Compute costs for several projects with two queries (reusable for dashboards)."""
    results = {pid: ProjectCost() for pid in project_ids}
    if not project_ids:
        return results
    rows = db.execute(
        select(MilestoneAssignment, Milestone)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .where(Milestone.project_id.in_(project_ids))
    ).all()
    histories = load_terms_histories(db, {a.employee_id for a, _ in rows})
    for milestone in db.scalars(select(Milestone).where(Milestone.project_id.in_(project_ids))):
        results[milestone.project_id].milestones[milestone.id] = CostBreakdown()
    for assignment, milestone in rows:
        breakdown = window_cost(
            effective_window(assignment, milestone), histories.get(assignment.employee_id, []), today
        )
        results[milestone.project_id].milestones[milestone.id].add(breakdown)
    return results

"""Project budget and timeline: numbers, aggregation, permissions and lifecycle effects.

Frozen "today" is Wed 2030-06-12; both linked employees cost $320 per weekday.
"""

from datetime import date, datetime, timezone

from models.assignment import MilestoneAssignment
from tests.conftest import link_employee, login_headers, make_milestone, make_project, make_terms, make_user
from decimal import Decimal

API = "/api/v1"


def add_assignment(db, milestone, employee, start, end, ended_at=None):
    row = MilestoneAssignment(
        milestone_id=milestone.id,
        employee_id=employee.id,
        start_date=start,
        planned_end_date=end,
        ended_at=ended_at,
    )
    db.add(row)
    db.commit()
    return row


def budget(client, user, project_id):
    return client.get(f"{API}/projects/{project_id}/budget", headers=login_headers(client, user))


def d(value):
    return Decimal(value)


def test_budget_numbers(client, world, db):
    # Mon 06-10 .. Wed 06-19: 8 weekdays; 2 accrued (10, 11), 6 projected (12..19).
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    r = budget(client, "adminuser", world.project.id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert d(body["accrued_cost"]) == 640
    assert d(body["projected_cost"]) == 1920
    assert d(body["total_expected_cost"]) == 2560
    assert d(body["estimated_budget"]) == 100000
    assert d(body["budget_remaining"]) == 97440
    assert d(body["budget_utilization_percent"]) == d("2.56")
    assert body["health"] == "on_track"
    assert body["accrued_through"] == "2030-06-11" and body["as_of"] == "2030-06-12"
    assert body["unpriced_days"] == 0


def test_milestone_costs_sum_to_project_totals(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    add_assignment(db, world.milestone2, world.emp2, date(2030, 9, 2), date(2030, 9, 6))
    body = budget(client, "mgr", world.project.id).json()
    assert sum(d(m["total_expected_cost"]) for m in body["milestones"]) == d(body["total_expected_cost"])
    assert sum(d(m["accrued_cost"]) for m in body["milestones"]) == d(body["accrued_cost"])
    assert sum(d(m["projected_cost"]) for m in body["milestones"]) == d(body["projected_cost"])
    by_name = {m["name"]: m for m in body["milestones"]}
    assert d(by_name["M2"]["projected_cost"]) == 1600


def test_empty_project_is_zero(client, world):
    body = budget(client, "mgr", world.project.id).json()
    assert d(body["total_expected_cost"]) == 0 and body["health"] == "on_track"


def test_health_thresholds(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))  # 2560
    for budget_value, expected in (("3200", "at_risk"), ("2560", "at_risk"), ("2559.99", "over_budget"), ("3201", "on_track")):
        world.project.estimated_budget = Decimal(budget_value)
        db.commit()
        body = budget(client, "adminuser", world.project.id).json()
        assert body["health"] == expected, (budget_value, body["health"])
    world.project.estimated_budget = Decimal("2560") * Decimal("0.8")
    db.commit()
    assert budget(client, "adminuser", world.project.id).json()["health"] == "over_budget"


def test_zero_budget(client, world, db):
    world.project.estimated_budget = Decimal("0")
    db.commit()
    assert budget(client, "adminuser", world.project.id).json()["budget_utilization_percent"] is None
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 11))
    assert budget(client, "adminuser", world.project.id).json()["health"] == "over_budget"


def test_raise_mid_project_uses_historical_rate(client, world, db):
    make_terms(db, world.emp, rate="50.00", hours="40", effective_from=date(2030, 6, 12))  # 400/day
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 14))
    body = budget(client, "adminuser", world.project.id).json()
    assert d(body["accrued_cost"]) == 640  # Mon+Tue at old rate
    assert d(body["projected_cost"]) == 1200  # Wed-Fri at new rate


def test_part_time_hours(client, world, db):
    make_terms(db, world.emp, rate="40.00", hours="20", effective_from=date(2030, 6, 1))
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 17), date(2030, 6, 17))
    assert d(budget(client, "adminuser", world.project.id).json()["projected_cost"]) == 160


def test_cancelled_future_assignment_costs_nothing(client, world, db):
    row = add_assignment(
        db, world.milestone, world.emp, date(2030, 6, 20), date(2030, 6, 30),
        ended_at=datetime(2030, 6, 12, 15, 0, tzinfo=timezone.utc),
    )
    assert d(budget(client, "adminuser", world.project.id).json()["total_expected_cost"]) == 0
    assert row.id


def test_assignment_removed_today_accrues_nothing_today(client, world, db):
    add_assignment(
        db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19),
        ended_at=datetime(2030, 6, 12, 9, 0, tzinfo=timezone.utc),
    )
    body = budget(client, "adminuser", world.project.id).json()
    assert d(body["accrued_cost"]) == 640  # 10 and 11 only
    assert d(body["projected_cost"]) == 0


def test_removed_midway_keeps_historical_cost(client, world, db):
    add_assignment(
        db, world.milestone, world.emp, date(2030, 6, 3), date(2030, 6, 19),
        ended_at=datetime(2030, 6, 6, 12, 0, tzinfo=timezone.utc),
    )
    body = budget(client, "adminuser", world.project.id).json()
    assert d(body["accrued_cost"]) == 3 * 320  # 3, 4, 5 June (ended on the 6th: not counted)
    assert d(body["projected_cost"]) == 0


def test_completed_milestone_completion_day_is_billable_later_days_are_not(client, world, db):
    world.milestone.status = "completed"
    world.milestone.completed_at = datetime(2030, 6, 12, 10, 0, tzinfo=timezone.utc)
    db.commit()
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    body = budget(client, "adminuser", world.project.id).json()
    assert d(body["accrued_cost"]) == 640
    assert d(body["projected_cost"]) == 320  # today (completion day, a Wednesday) only


def test_completion_on_weekend_adds_no_extra_day(client, world, db):
    world.milestone.status = "completed"
    world.milestone.completed_at = datetime(2030, 6, 15, 10, 0, tzinfo=timezone.utc)  # Saturday
    db.commit()
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 12), date(2030, 6, 19))
    assert d(budget(client, "adminuser", world.project.id).json()["projected_cost"]) == 3 * 320


def test_unpriced_days_reported_for_rows_without_terms(client, world, db):
    ghost = make_user(db, "ghost", "employee")
    link_employee(db, ghost, world.manager)
    add_assignment(db, world.milestone, ghost, date(2030, 6, 17), date(2030, 6, 18))
    body = budget(client, "adminuser", world.project.id).json()
    assert body["unpriced_days"] == 2 and d(body["total_expected_cost"]) == 0


def test_deactivated_employee_history_preserved(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 3), date(2030, 6, 7))
    world.emp.is_active = False
    db.commit()
    assert d(budget(client, "adminuser", world.project.id).json()["accrued_cost"]) == 1600


def test_abandoning_project_stops_projected_keeps_accrued(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    r = client.patch(
        f"{API}/projects/{world.project.id}/status", json={"status": "abandoned"},
        headers=login_headers(client, "adminuser"),
    )
    assert r.status_code == 200, r.text
    body = budget(client, "adminuser", world.project.id).json()
    assert d(body["accrued_cost"]) == 640
    assert d(body["projected_cost"]) == 0


def test_archived_project_budget_still_readable(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 11))
    client.post(f"{API}/projects/{world.project.id}/archive", headers=login_headers(client, "adminuser"))
    assert d(budget(client, "adminuser", world.project.id).json()["accrued_cost"]) == 640


# ---- permissions -----------------------------------------------------------

def test_budget_permissions(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    assert budget(client, "adminuser", world.project.id).status_code == 200
    assert budget(client, "mgr", world.project.id).status_code == 200
    assert budget(client, "mgr2", world.project.id).status_code == 403
    assert budget(client, "emp", world.project.id).status_code == 403  # assigned employee
    assert budget(client, "stranger", world.project.id).status_code == 403
    assert budget(client, "adminuser", 9999).status_code == 404
    assert client.get(f"{API}/projects/{world.project.id}/budget").status_code in (401, 403)


def test_budget_exposes_no_individual_compensation(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    text = budget(client, "mgr", world.project.id).text.lower()
    for forbidden in ("hourly_rate", "weekly_hours", "daily_cost", "employee", "username"):
        assert forbidden not in text


def test_manager_cannot_read_work_terms(client, world):
    r = client.get(f"{API}/employees/{world.emp.id}/work-terms", headers=login_headers(client, "mgr"))
    assert r.status_code == 403


def test_timeline_visibility(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    admin = client.get(f"{API}/projects/{world.project.id}/timeline", headers=login_headers(client, "adminuser"))
    assert admin.status_code == 200
    m1 = admin.json()["milestones"][0]
    assert m1["assigned_employee_count"] == 1 and m1["assigned_employees"][0]["id"] == world.emp.id
    emp = client.get(f"{API}/projects/{world.project.id}/timeline", headers=login_headers(client, "emp"))
    assert emp.status_code == 200
    assert emp.json()["milestones"][0]["assigned_employees"] is None
    assert "budget" not in emp.text.lower() and "cost" not in emp.text.lower()
    assert client.get(f"{API}/projects/{world.project.id}/timeline", headers=login_headers(client, "mgr2")).status_code == 403
    assert client.get(f"{API}/projects/{world.project.id}/timeline", headers=login_headers(client, "stranger")).status_code == 403


def test_employee_project_view_hides_budget(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    r = client.get(f"{API}/projects/{world.project.id}", headers=login_headers(client, "emp"))
    assert r.status_code == 200
    assert "estimated_budget" not in r.json()

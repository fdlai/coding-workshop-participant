"""Tests for the deterministic, idempotent, transactional demo seed dataset."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from models.assignment import MilestoneAssignment
from models.audit_log import AuditLog
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from models.work_terms import EmployeeWorkTerms
from scripts import seed
from scripts.seed import (
    ADMIN,
    ADMINS,
    DEMO_PROJECTS,
    EMPLOYEES,
    MANAGERS,
    SHOWCASE_DEACTIVATED,
    SHOWCASE_EMPLOYEES,
    SHOWCASE_PROJECT,
    demo_username,
    seed_all,
    seed_organization,
    seed_projects,
    seed_work_terms,
)
from services.cost_service import calculate_project_costs, money
from services.budget_service import budget_health
from services.scheduling_rules import effective_window, ranges_overlap

PASSWORD = "DemoPass123!"
TABLES = (User, EmployeeManager, EmployeeWorkTerms, Project, Milestone, MilestoneAssignment, AuditLog)


def counts(db):
    return [db.query(model).count() for model in TABLES]


def login(client, first, last):
    response = client.post(
        "/api/v1/auth/login", json={"username": demo_username(first, last), "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def seeded(db):
    seed_all(db, PASSWORD)
    db.commit()
    return db


def test_expected_row_counts_per_table(db):
    before = counts(db)
    report = seed_all(db, PASSWORD)
    db.commit()
    added = [after - b for after, b in zip(counts(db), before)]

    assert added[0] == 104 == len(ADMINS) + len(MANAGERS) + len(EMPLOYEES) + len(SHOWCASE_EMPLOYEES)
    assert 80 <= added[1] <= 120
    assert 100 <= added[2] <= 150
    assert 35 <= added[3] <= 45 and added[3] == len(DEMO_PROJECTS) + 1  # plus the showcase
    assert 150 <= added[4] <= 200
    assert 300 <= added[5] <= 450
    assert 150 <= added[6] <= 250
    assert report.created["users:admin"] == len(ADMINS)
    assert report.created["users:manager"] == len(MANAGERS)
    assert report.created["users:employee"] == len(EMPLOYEES) + len(SHOWCASE_EMPLOYEES)
    assert report.created["milestones"] == added[4]
    assert report.created["assignments"] == added[5]


def test_seeding_twice_creates_nothing_new(seeded):
    before = counts(seeded)
    second = seed_all(seeded, PASSWORD)
    seeded.commit()
    assert counts(seeded) == before
    assert second.created == {}


def test_rerun_on_a_different_day_does_not_duplicate_work_terms(seeded):
    before = counts(seeded)
    later = date.today().replace(year=date.today().year + 1)
    seed_work_terms(seeded, today=later)
    seed_projects(seeded, today=later)
    seeded.commit()
    assert counts(seeded) == before


def test_failure_rolls_back_everything(db, monkeypatch):
    before = counts(db)

    def boom(*args, **kwargs):
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(seed, "seed_projects", boom)
    with pytest.raises(RuntimeError):
        seed_all(db, PASSWORD)
        db.commit()
    db.rollback()
    assert counts(db) == before


def test_role_distribution_and_accounts(seeded):
    demo = seeded.query(User).filter(User.username.like("demo.%"))
    assert demo.filter(User.role == "admin").count() == 3
    assert demo.filter(User.role == "manager").count() == 12
    assert demo.filter(User.role == "employee").count() == 89
    assert demo.filter(User.is_active.is_(False)).count() == len(SHOWCASE_DEACTIVATED)
    assert ADMIN[:2] == ("Avery", "Brooks")
    assert demo_username("Avery", "Brooks") == "demo.avery.brooks"


def test_relationships_are_valid(seeded):
    ids = {u.id: u for u in seeded.query(User)}
    for link in seeded.query(EmployeeManager):
        assert ids[link.employee_id].role == "employee"
        assert ids[link.manager_id].role == "manager"
    for project in seeded.query(Project):
        assert ids[project.manager_id].role == "manager"
    for term in seeded.query(EmployeeWorkTerms):
        assert ids[term.employee_id].role == "employee"
    for assignment in seeded.query(MilestoneAssignment):
        assert ids[assignment.employee_id].role == "employee"
    employees = [u for u in ids.values() if u.role == "employee" and u.username.startswith("demo.")]
    linked = {link.employee_id for link in seeded.query(EmployeeManager)}
    assert all(e.id in linked for e in employees)
    per_employee = {}
    for a in seeded.query(MilestoneAssignment):
        per_employee[a.employee_id] = per_employee.get(a.employee_id, 0) + 1
    assert any(e.id not in per_employee for e in employees)  # some staff have no work
    assert max(per_employee.values()) >= 8  # and some are heavily loaded


def test_project_and_milestone_variety_and_dates(seeded):
    today = date.today()
    statuses = {(p.status, p.is_archived) for p in seeded.query(Project)}
    assert {("active", False), ("completed", False), ("abandoned", False), ("completed", True)} <= statuses
    assert any(p.start_date > today for p in seeded.query(Project))  # planned work

    milestones = seeded.query(Milestone).all()
    assert any(m.status == "completed" for m in milestones)
    assert any(m.status == "pending" and m.end_date < today for m in milestones)  # overdue
    assert any(m.status == "pending" and m.start_date > today for m in milestones)  # upcoming
    assert any(m.status == "pending" and m.start_date <= today <= m.end_date for m in milestones)
    for project in seeded.query(Project):
        assert project.start_date <= project.estimated_end_date
        for m in project.milestones:
            assert m.start_date <= m.end_date
            assert (m.status == "completed") == (m.completed_at is not None)


def test_assignments_respect_organization_milestones_and_never_overlap(seeded):
    by_employee = {}
    for a in seeded.query(MilestoneAssignment):
        project = a.milestone.project
        assert seeded.get(EmployeeManager, (a.employee_id, project.manager_id)) is not None
        assert a.milestone.start_date <= a.start_date <= a.planned_end_date <= a.milestone.end_date
        window = effective_window(a, a.milestone)
        if window:
            by_employee.setdefault(a.employee_id, []).append(window)
    for windows in by_employee.values():
        for i, (s1, e1) in enumerate(windows):
            for s2, e2 in windows[i + 1:]:
                assert not ranges_overlap(s1, e1, s2, e2)


def test_work_terms_are_historical_and_price_every_assignment(seeded):
    today = date.today()
    dates = [t.effective_from for t in seeded.query(EmployeeWorkTerms)]
    assert any(d < today for d in dates) and any(d > today for d in dates)
    healths = set()
    for project in seeded.query(Project):
        total = calculate_project_costs(seeded, [project.id], today)[project.id].total
        assert total.unpriced_days == 0
        spent = money(total.accrued) + money(total.projected)
        healths.add("over" if spent > project.estimated_budget else "under")
    assert healths == {"over", "under"}


def test_active_projects_show_every_budget_health_state(seeded):
    today = date.today()
    active = [p for p in seeded.query(Project) if p.status == "active" and not p.is_archived]
    costs = calculate_project_costs(seeded, [p.id for p in active], today)
    health = [
        budget_health(money(costs[p.id].total.accrued) + money(costs[p.id].total.projected), p.estimated_budget)
        for p in active
    ]
    assert health.count("over_budget") >= 3
    assert health.count("at_risk") >= 2
    assert health.count("on_track") >= 8


def test_audit_logs_are_clearly_synthetic_and_consistent(seeded):
    rows = seeded.query(AuditLog).filter(AuditLog.description.like("[Synthetic seed data]%")).all()
    assert len(rows) >= 150
    users = {u.id for u in seeded.query(User)}
    for row in rows:
        assert row.changes["synthetic_seed"] is True
        assert row.actor_id in users
        assert row.created_at.date() <= datetime.now(timezone.utc).date()
    blob = " ".join(str(r.changes) for r in rows).lower()
    assert "password" not in blob and "hash" not in blob


def test_seed_never_modifies_existing_users(db):
    before = {u.username: (u.password_hash, u.role) for u in db.query(User)}
    seed_organization(db, PASSWORD)
    db.commit()
    for username, state in before.items():
        user = db.query(User).filter(User.username == username).one()
        assert (user.password_hash, user.role) == state
    assert all(u.username.startswith("demo.") for u in db.query(User) if u.username not in before)


def test_every_demo_account_shares_one_password(client, seeded):
    hashes = {u.password_hash for u in seeded.query(User).filter(User.username.like("demo.%"))}
    assert len(hashes) == 1
    for first, last in (("Avery", "Brooks"), ("Morgan", "Hayes"), ("Liam", "Anderson")):
        login(client, first, last)
    bad = client.post(
        "/api/v1/auth/login", json={"username": "demo.avery.brooks", "password": "WrongPass123!"}
    )
    assert bad.status_code == 401


def test_role_permissions_for_seeded_accounts(client, seeded):
    admin = login(client, "Avery", "Brooks")
    manager = login(client, "Morgan", "Hayes")
    employee = login(client, "Liam", "Anderson")

    assert client.get("/api/v1/users", headers=admin).status_code == 200
    assert client.get("/api/v1/audit-logs", headers=admin).status_code == 200
    assert client.get("/api/v1/dashboard/admin", headers=admin).status_code == 200

    assert client.get("/api/v1/audit-logs", headers=manager).status_code == 403
    assert client.get("/api/v1/dashboard/manager", headers=manager).status_code == 200
    assert client.get("/api/v1/dashboard/admin", headers=manager).status_code == 403

    for path in ("/api/v1/users", "/api/v1/audit-logs", "/api/v1/dashboard/admin"):
        assert client.get(path, headers=employee).status_code == 403
    assert client.get("/api/v1/dashboard/employee", headers=employee).status_code == 200

    manager_id = seeded.query(User).filter(User.username == "demo.morgan.hayes").one().id
    manager_projects = client.get("/api/v1/projects", headers=manager).json()
    assert manager_projects
    assert all(p["manager_id"] == manager_id for p in manager_projects)


# ------------------------------------------------------------------ showcase project


def showcase_budget(client, seeded, headers):
    project = seeded.query(Project).filter(Project.name == SHOWCASE_PROJECT["name"]).one()
    response = client.get(f"/api/v1/projects/{project.id}/budget", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    return body, {m["name"][:1]: m for m in body["milestones"]}  # keyed "1".."4"


def showcase_user(seeded, first, last):
    return seeded.query(User).filter(User.username == demo_username(first, last)).one()


def test_showcase_budget_matches_the_hand_calculation(client, seeded):
    _, by_scenario = showcase_budget(client, seeded, login(client, "Morgan", "Hayes"))

    # Finished scenarios are fully accrued, whatever day of the week the demo runs.
    expected = {"1": "5000.00", "2": "2000.00", "3": "4000.00"}
    for scenario, total in expected.items():
        milestone = by_scenario[scenario]
        assert milestone["accrued_cost"] == total and milestone["projected_cost"] == "0.00"
    live = by_scenario["4"]
    assert Decimal(live["accrued_cost"]) + Decimal(live["projected_cost"]) == Decimal("8000.00")

    assert not showcase_user(seeded, "Riley", "Shaw").is_active
    terms = seeded.query(EmployeeWorkTerms).filter(
        EmployeeWorkTerms.employee_id == showcase_user(seeded, "Jordan", "Raines").id
    )
    assert sorted(t.hourly_rate for t in terms) == [Decimal("50.00"), Decimal("75.00")]


def test_showcase_live_demo_steps(client, seeded):
    """Rehearses the live part of the demo: only projected cost may move."""
    admin = login(client, "Avery", "Brooks")
    drew = showcase_user(seeded, "Drew", "Kendall")
    before, scenarios = showcase_budget(client, seeded, admin)
    accrued = scenarios["4"]["accrued_cost"]
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())

    def raise_from(day):
        return client.post(
            f"/api/v1/employees/{drew.id}/work-terms",
            json={"hourly_rate": "75.00", "weekly_hours": "40", "effective_from": str(day)},
            headers=admin,
        )

    # A backdated raise over days already worked is refused.
    assert raise_from(monday - timedelta(days=7)).status_code == 409

    # A raise from next Monday adds $200 for each of the 10 remaining weekdays.
    assert raise_from(monday + timedelta(days=7)).status_code == 201
    after, scenarios = showcase_budget(client, seeded, admin)
    assert scenarios["4"]["accrued_cost"] == accrued
    assert Decimal(after["projected_cost"]) - Decimal(before["projected_cost"]) == Decimal("2000.00")

    # Deactivating Drew ends the remaining work but keeps what was already accrued.
    response = client.patch(
        f"/api/v1/users/{drew.id}/status", json={"is_active": False}, headers=admin
    )
    assert response.status_code == 200, response.text
    _, scenarios = showcase_budget(client, seeded, admin)
    assert scenarios["4"]["accrued_cost"] == accrued
    assert scenarios["4"]["projected_cost"] == "0.00"

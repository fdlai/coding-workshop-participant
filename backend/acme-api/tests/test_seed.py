"""Tests for the deterministic, idempotent, transactional demo seed dataset."""

from datetime import date

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
    demo_username,
    seed_all,
    seed_organization,
    seed_projects,
    seed_work_terms,
)
from services.cost_service import calculate_project_costs, money
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

    assert added[0] == 100 == len(ADMINS) + len(MANAGERS) + len(EMPLOYEES)
    assert 80 <= added[1] <= 120
    assert 100 <= added[2] <= 150
    assert 35 <= added[3] <= 45 and added[3] == len(DEMO_PROJECTS)
    assert 150 <= added[4] <= 200
    assert 300 <= added[5] <= 450
    assert 150 <= added[6] <= 250
    assert report.created["users:admin"] == len(ADMINS)
    assert report.created["users:manager"] == len(MANAGERS)
    assert report.created["users:employee"] == len(EMPLOYEES)
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
    assert demo.filter(User.role == "employee").count() == 85
    assert demo.filter(User.is_active.is_(False)).count() == 0
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


def test_audit_logs_are_clearly_synthetic_and_consistent(seeded):
    rows = seeded.query(AuditLog).filter(AuditLog.description.like("[Synthetic seed data]%")).all()
    assert len(rows) >= 150
    users = {u.id for u in seeded.query(User)}
    for row in rows:
        assert row.changes["synthetic_seed"] is True
        assert row.actor_id in users
        assert row.created_at.date() <= date.today()
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

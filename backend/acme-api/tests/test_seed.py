"""Tests for the incremental, idempotent demo seed utility."""

from datetime import date

from models.assignment import MilestoneAssignment
from models.audit_log import AuditLog
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from scripts.seed import (
    DEMO_PROJECTS,
    EMPLOYEES,
    MANAGERS,
    seed_organization,
    seed_projects,
    seed_work_terms,
)
from models.work_terms import EmployeeWorkTerms
from services.cost_service import calculate_project_costs, money
from services.scheduling_rules import effective_window, ranges_overlap


def test_seed_creates_organization_and_is_idempotent(db):
    real_admin_count = db.query(User).count()

    first = seed_organization(db, "DemoPass123!")
    db.commit()
    users_after_first = db.query(User).count()
    links_after_first = db.query(EmployeeManager).count()

    assert first.created["users:admin"] == 1
    assert first.created["users:manager"] == len(MANAGERS)
    assert first.created["users:employee"] == len(EMPLOYEES)
    assert users_after_first == real_admin_count + 1 + len(MANAGERS) + len(EMPLOYEES)
    assert links_after_first > len(EMPLOYEES)  # some employees have multiple managers

    second = seed_organization(db, "DemoPass123!")
    db.commit()
    assert second.created == {}
    assert db.query(User).count() == users_after_first
    assert db.query(EmployeeManager).count() == links_after_first


def test_seed_never_modifies_existing_users_and_audits_what_it_creates(db):
    before = {u.username: (u.password_hash, u.role) for u in db.query(User)}
    seed_organization(db, "DemoPass123!")
    db.commit()

    for username, state in before.items():
        user = db.query(User).filter(User.username == username).one()
        assert (user.password_hash, user.role) == state
    assert db.query(AuditLog).filter(AuditLog.action == "user.create").count() >= 1 + len(MANAGERS) + len(EMPLOYEES)
    assert all(u.username.startswith("demo.") for u in db.query(User) if u.username not in before)


def test_seeded_logins_work(client, db):
    seed_organization(db, "DemoPass123!")
    db.commit()
    response = client.post(
        "/api/v1/auth/login", json={"username": "demo.avery.brooks", "password": "DemoPass123!"}
    )
    assert response.status_code == 200


def test_seed_projects_is_idempotent_and_conflict_free(db):
    today = date(2030, 6, 12)
    seed_organization(db, "DemoPass123!")
    first = seed_projects(db, today=today)
    db.commit()
    assert first.created["projects"] == len(DEMO_PROJECTS)
    counts = (db.query(Project).count(), db.query(Milestone).count(), db.query(MilestoneAssignment).count())

    second = seed_projects(db, today=today)
    db.commit()
    assert "projects" not in second.created
    assert counts == (db.query(Project).count(), db.query(Milestone).count(), db.query(MilestoneAssignment).count())

    statuses = {(p.status, p.is_archived) for p in db.query(Project)}
    assert {("active", False), ("completed", False), ("abandoned", False), ("completed", True)} <= statuses

    by_employee: dict[int, list[tuple[date, date]]] = {}
    for a in db.query(MilestoneAssignment):
        window = effective_window(a, a.milestone)
        if window:
            by_employee.setdefault(a.employee_id, []).append(window)
    for windows in by_employee.values():
        for i, (s1, e1) in enumerate(windows):
            for s2, e2 in windows[i + 1:]:
                assert not ranges_overlap(s1, e1, s2, e2)


def test_seeded_assignments_respect_organization_and_milestones(db):
    seed_organization(db, "DemoPass123!")
    seed_projects(db, today=date(2030, 6, 12))
    db.commit()
    for a in db.query(MilestoneAssignment):
        project = a.milestone.project
        assert db.get(EmployeeManager, (a.employee_id, project.manager_id)) is not None
        assert a.milestone.start_date <= a.start_date <= a.planned_end_date <= a.milestone.end_date


def test_seed_work_terms_idempotent_historical_and_prices_all_assignments(db):
    today = date(2030, 6, 12)
    seed_organization(db, "DemoPass123!")
    first = seed_work_terms(db, today=today)
    db.commit()
    assert first.created["work_terms"] >= len(EMPLOYEES)
    count = db.query(EmployeeWorkTerms).count()
    again = seed_work_terms(db, today=today)
    db.commit()
    assert "work_terms" not in again.created
    assert db.query(EmployeeWorkTerms).count() == count

    dates = [t.effective_from for t in db.query(EmployeeWorkTerms)]
    assert any(d < today for d in dates) and any(d > today for d in dates)

    seed_projects(db, today=today)
    db.commit()
    healths = set()
    for project in db.query(Project):
        total = calculate_project_costs(db, [project.id], today)[project.id].total
        assert total.unpriced_days == 0
        spent = money(total.accrued) + money(total.projected)
        healths.add("over" if spent > project.estimated_budget else "under")
    assert healths == {"over", "under"}


def test_seed_work_terms_never_touches_existing_terms(db):
    today = date(2030, 6, 12)
    seed_organization(db, "DemoPass123!")
    seed_work_terms(db, today=today)
    db.commit()
    row = db.query(EmployeeWorkTerms).first()
    original = (row.id, str(row.hourly_rate), row.effective_from)
    seed_work_terms(db, today=today)
    db.commit()
    db.refresh(row)
    assert (row.id, str(row.hourly_rate), row.effective_from) == original

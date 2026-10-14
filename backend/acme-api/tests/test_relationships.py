"""Tests for employee-manager relationships and safe removal behavior."""

from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
from models.assignment import MilestoneAssignment
from models.audit_log import AuditLog
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager
from services import relationship_service
from tests.conftest import login_headers, make_user


def _link(db, employee, manager):
    db.add(EmployeeManager(employee_id=employee.id, manager_id=manager.id))
    db.commit()


def _project_with_milestone(db, manager, admin, name="P"):
    project = Project(
        name=name,
        manager_id=manager.id,
        created_by=admin.id,
        start_date=date(2020, 1, 1),
        estimated_end_date=date(2040, 1, 1),
        estimated_budget=1000,
    )
    db.add(project)
    db.flush()
    milestone = Milestone(
        project_id=project.id, name="M", start_date=date(2020, 1, 1), end_date=date(2040, 1, 1)
    )
    db.add(milestone)
    db.commit()
    return milestone


def _assign(db, milestone, employee, start, end, ended_at=None):
    assignment = MilestoneAssignment(
        milestone_id=milestone.id,
        employee_id=employee.id,
        start_date=start,
        planned_end_date=end,
        ended_at=ended_at,
    )
    db.add(assignment)
    db.commit()
    return assignment


def _ended_at(assignment):
    value = assignment.ended_at
    return None if value is None else value.replace(tzinfo=timezone.utc)


def _cast(db):
    from models.user import User

    admin = db.query(User).filter(User.username == "adminuser").one()
    return (
        admin,
        make_user(db, "mgr_a", "manager"),
        make_user(db, "mgr_b", "manager"),
        make_user(db, "emp", "employee"),
    )


def test_admin_assigns_employee_to_multiple_managers(client, db):
    _, mgr_a, mgr_b, emp = _cast(db)
    headers = login_headers(client, "adminuser")

    for manager in (mgr_a, mgr_b):
        response = client.post(
            f"/api/v1/managers/{manager.id}/employees", json={"employee_id": emp.id}, headers=headers
        )
        assert response.status_code == 201, response.text
        assert "email" not in response.json()

    managers = client.get(f"/api/v1/employees/{emp.id}/managers", headers=headers).json()
    assert {m["username"] for m in managers} == {"mgr_a", "mgr_b"}
    assert db.query(AuditLog).filter(AuditLog.action == "employee_manager.assign").count() == 2


def test_manager_may_have_multiple_employees_and_zero(client, db):
    _, mgr_a, mgr_b, emp = _cast(db)
    emp2 = make_user(db, "emp2", "employee")
    headers = login_headers(client, "adminuser")
    for employee in (emp, emp2):
        client.post(f"/api/v1/managers/{mgr_a.id}/employees", json={"employee_id": employee.id}, headers=headers)

    assert len(client.get(f"/api/v1/managers/{mgr_a.id}/employees", headers=headers).json()) == 2
    assert client.get(f"/api/v1/managers/{mgr_b.id}/employees", headers=headers).json() == []


def test_duplicate_self_and_invalid_role_combinations_rejected(client, db):
    admin, mgr_a, mgr_b, emp = _cast(db)
    headers = login_headers(client, "adminuser")
    url = f"/api/v1/managers/{mgr_a.id}/employees"

    assert client.post(url, json={"employee_id": emp.id}, headers=headers).status_code == 201
    assert client.post(url, json={"employee_id": emp.id}, headers=headers).status_code == 409
    assert client.post(url, json={"employee_id": mgr_a.id}, headers=headers).status_code == 400
    assert client.post(url, json={"employee_id": mgr_b.id}, headers=headers).status_code == 404
    assert client.post(url, json={"employee_id": admin.id}, headers=headers).status_code == 404
    assert client.post(f"/api/v1/managers/{emp.id}/employees", json={"employee_id": emp.id}, headers=headers).status_code == 400
    assert client.post(f"/api/v1/managers/{emp.id}/employees", json={"employee_id": mgr_b.id}, headers=headers).status_code == 404
    assert client.post(url, json={"employee_id": 99999}, headers=headers).status_code == 404
    assert client.post(url, json={"employee_id": emp.id, "extra": 1}, headers=headers).status_code == 422
    assert db.query(EmployeeManager).count() == 1


def test_inactive_participants_rejected(client, db):
    _, mgr_a, _, emp = _cast(db)
    inactive = make_user(db, "gone", "employee", is_active=False)
    headers = login_headers(client, "adminuser")
    response = client.post(f"/api/v1/managers/{mgr_a.id}/employees", json={"employee_id": inactive.id}, headers=headers)
    assert response.status_code == 409


def test_only_admins_modify_relationships(client, db):
    _, mgr_a, _, emp = _cast(db)
    _link(db, emp, mgr_a)

    for username in ("mgr_a", "emp"):
        headers = login_headers(client, username)
        assert client.post(f"/api/v1/managers/{mgr_a.id}/employees", json={"employee_id": emp.id}, headers=headers).status_code == 403
        assert client.delete(f"/api/v1/managers/{mgr_a.id}/employees/{emp.id}", headers=headers).status_code == 403
    assert db.query(EmployeeManager).count() == 1
    assert client.delete(f"/api/v1/managers/{mgr_a.id}/employees/{emp.id}").status_code == 401


def test_relationship_read_permissions(client, db):
    _, mgr_a, mgr_b, emp = _cast(db)
    stranger = make_user(db, "stranger", "employee")
    _link(db, emp, mgr_a)

    a = login_headers(client, "mgr_a")
    assert [u["username"] for u in client.get(f"/api/v1/managers/{mgr_a.id}/employees", headers=a).json()] == ["emp"]
    assert client.get(f"/api/v1/managers/{mgr_b.id}/employees", headers=a).status_code == 403
    assert client.get(f"/api/v1/employees/{emp.id}/managers", headers=a).status_code == 403

    e = login_headers(client, "emp")
    assert [u["username"] for u in client.get(f"/api/v1/employees/{emp.id}/managers", headers=e).json()] == ["mgr_a"]
    assert client.get(f"/api/v1/employees/{stranger.id}/managers", headers=e).status_code == 403
    assert client.get(f"/api/v1/managers/{mgr_a.id}/employees", headers=e).status_code == 403


def test_remove_missing_relationship_returns_404(client, db):
    _, mgr_a, _, emp = _cast(db)
    response = client.delete(
        f"/api/v1/managers/{mgr_a.id}/employees/{emp.id}", headers=login_headers(client, "adminuser")
    )
    assert response.status_code == 404


def test_removal_ends_active_and_future_assignments_and_preserves_history(client, db):
    admin, mgr_a, mgr_b, emp = _cast(db)
    _link(db, emp, mgr_a)
    _link(db, emp, mgr_b)
    today = datetime.now(timezone.utc).date()
    cutoff = datetime.combine(today, time.min, tzinfo=timezone.utc)
    ms_a = _project_with_milestone(db, mgr_a, admin, "A")
    ms_b = _project_with_milestone(db, mgr_b, admin, "B")

    past = _assign(db, ms_a, emp, today - timedelta(days=30), today - timedelta(days=10))
    already_ended = _assign(
        db, ms_a, emp, today - timedelta(days=20), today + timedelta(days=5),
        ended_at=cutoff - timedelta(days=3),
    )
    active = _assign(db, ms_a, emp, today - timedelta(days=5), today + timedelta(days=5))
    future = _assign(db, ms_a, emp, today + timedelta(days=10), today + timedelta(days=20))
    other_manager = _assign(db, ms_b, emp, today - timedelta(days=5), today + timedelta(days=5))
    ids = (past.id, already_ended.id, active.id, future.id, other_manager.id)

    response = client.delete(
        f"/api/v1/managers/{mgr_a.id}/employees/{emp.id}", headers=login_headers(client, "adminuser")
    )
    assert response.status_code == 200, response.text
    assert sorted(response.json()["ended_assignment_ids"]) == sorted([active.id, future.id])

    db.expire_all()
    assert db.query(MilestoneAssignment).count() == 5
    rows = {a.id: a for a in db.query(MilestoneAssignment).filter(MilestoneAssignment.id.in_(ids))}
    assert _ended_at(rows[active.id]) == cutoff
    assert _ended_at(rows[future.id]) == cutoff
    assert rows[future.id].start_date > today
    assert rows[past.id].ended_at is None
    assert _ended_at(rows[already_ended.id]) == cutoff - timedelta(days=3)
    assert rows[other_manager.id].ended_at is None
    assert rows[active.id].planned_end_date == today + timedelta(days=5)

    assert db.get(EmployeeManager, (emp.id, mgr_a.id)) is None
    assert db.get(EmployeeManager, (emp.id, mgr_b.id)) is not None

    log = db.query(AuditLog).filter(AuditLog.action == "employee_manager.remove").one()
    assert log.actor_id == admin.id
    assert {item["assignment_id"] for item in log.changes["ended_assignments"]} == {active.id, future.id}


def test_removal_uses_injectable_clock_and_excludes_current_day(db):
    admin, mgr_a, _, emp = _cast(db)
    _link(db, emp, mgr_a)
    ms = _project_with_milestone(db, mgr_a, admin)
    fixed_now = datetime(2030, 6, 12, 15, 45, tzinfo=timezone.utc)
    ends_today = _assign(db, ms, emp, date(2030, 6, 3), date(2030, 6, 12))
    ended_yesterday = _assign(db, ms, emp, date(2030, 6, 3), date(2030, 6, 11))

    ended = relationship_service.remove_employee(db, admin, mgr_a.id, emp.id, now=fixed_now)

    assert ended == [ends_today.id]
    db.expire_all()
    assert _ended_at(db.get(MilestoneAssignment, ends_today.id)) == datetime(2030, 6, 12, tzinfo=timezone.utc)
    assert db.get(MilestoneAssignment, ended_yesterday.id).ended_at is None


def test_removal_is_atomic_when_audit_fails(client, db):
    admin, mgr_a, _, emp = _cast(db)
    _link(db, emp, mgr_a)
    today = datetime.now(timezone.utc).date()
    ms = _project_with_milestone(db, mgr_a, admin)
    active = _assign(db, ms, emp, today - timedelta(days=2), today + timedelta(days=2))
    headers = login_headers(client, "adminuser")

    with patch("services.relationship_service.record_audit", side_effect=RuntimeError("boom")):
        failing = TestClient(app, raise_server_exceptions=False)
        response = failing.delete(f"/api/v1/managers/{mgr_a.id}/employees/{emp.id}", headers=headers)

    assert response.status_code == 500
    db.expire_all()
    assert db.get(EmployeeManager, (emp.id, mgr_a.id)) is not None
    assert db.get(MilestoneAssignment, active.id).ended_at is None
    assert db.query(AuditLog).filter(AuditLog.action == "employee_manager.remove").count() == 0

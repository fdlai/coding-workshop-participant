"""Assignment scheduling, removal, transfer, rollback and deactivation tests.

Frozen "today" is 2030-06-12. World milestones: M1 2030-06-01..08-31, M2 09-01..10-31.
"""

from datetime import date, datetime, timezone

import pytest

from models.assignment import MilestoneAssignment
from models.audit_log import AuditLog
from services.scheduling_rules import effective_window
from tests.conftest import link_employee, login_headers, make_milestone, make_project, make_user

API = "/api/v1"


def assign(client, user, milestone_id, employee_id, start, end):
    return client.post(
        f"{API}/milestones/{milestone_id}/assignments",
        json={"employee_id": employee_id, "start_date": start, "planned_end_date": end},
        headers=login_headers(client, user),
    )


def test_manager_schedules_own_employee_and_audits(client, world, db):
    r = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30")
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "scheduled"
    assert db.query(AuditLog).filter_by(action="assignment.create").count() == 1


def test_employee_sees_teammates_without_cost_data(client, world):
    assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30")
    assign(client, "mgr", world.milestone.id, world.emp2.id, "2030-06-20", "2030-06-30")
    url = f"{API}/milestones/{world.milestone.id}/assignments"
    rows = client.get(url, headers=login_headers(client, "emp")).json()
    assert {r["employee"]["username"] for r in rows} == {"emp", "emp2"}
    assert not any("rate" in k or "cost" in k or "email" in k for r in rows for k in {*r, *r["employee"]})
    # a stranger who was never on the project still cannot list it
    assert client.get(url, headers=login_headers(client, "stranger")).status_code == 403


def test_unlinked_employee_rejected_even_for_admin(client, world):
    for who in ("mgr", "adminuser"):
        r = assign(client, who, world.milestone.id, world.stranger.id, "2030-06-20", "2030-06-30")
        assert r.status_code in (403, 409, 422), r.text


def test_unrelated_manager_and_employee_forbidden(client, world):
    assert assign(client, "mgr2", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30").status_code == 403
    assert assign(client, "emp", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30").status_code == 403


def test_inclusive_overlap_rejected_adjacent_allowed(client, world):
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30").status_code == 201
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-30", "2030-07-05").status_code == 409
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-07-01", "2030-07-05").status_code == 201


def test_overlap_across_projects_rejected(client, world, db):
    second = make_project(db, world.manager, world.admin, name="Beta")
    m = make_milestone(db, second, date(2030, 6, 1), date(2030, 8, 31))
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30").status_code == 201
    assert assign(client, "mgr", m.id, world.emp.id, "2030-06-25", "2030-07-10").status_code == 409
    assert assign(client, "mgr", m.id, world.emp.id, "2030-07-01", "2030-07-10").status_code == 201


def test_no_retroactive_start_and_bounds(client, world):
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-11", "2030-06-30").status_code in (409, 422)
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-09-02").status_code in (409, 422)
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-06-12").status_code == 201


def test_deactivated_employee_cannot_be_scheduled(client, world, db):
    world.emp.is_active = False
    db.commit()
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30").status_code == 409


def test_end_today_accrues_no_cost_today(client, world, db):
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-10".replace("10", "12"), "2030-06-30").json()
    r = client.post(f"{API}/assignments/{a['id']}/end", headers=login_headers(client, "mgr"))
    assert r.status_code == 200, r.text
    row = db.get(MilestoneAssignment, a["id"])
    assert effective_window(row, row.milestone) is None  # removed today accrues nothing today
    assert db.query(MilestoneAssignment).count() == 1
    assert r.json()["state"] == "cancelled"


def test_end_midway_keeps_history_and_frees_calendar(client, world, db, monkeypatch):
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-06-30").json()
    later = datetime(2030, 6, 20, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("services.clock.utc_now", lambda: later)
    r = client.post(f"{API}/assignments/{a['id']}/end", headers=login_headers(client, "mgr"))
    assert r.status_code == 200, r.text
    assert r.json()["effective_end_date"] == "2030-06-19"
    # Freed days can be re-booked; history row remains.
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-25").status_code == 201
    assert db.query(MilestoneAssignment).count() == 2
    again = client.post(f"{API}/assignments/{a['id']}/end", headers=login_headers(client, "mgr"))
    assert again.status_code == 409


def test_update_assignment_rules(client, world):
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30").json()
    h = login_headers(client, "mgr")
    assert client.patch(f"{API}/assignments/{a['id']}", json={"planned_end_date": "2030-07-05"}, headers=h).status_code == 200
    assert client.patch(f"{API}/assignments/{a['id']}", json={"planned_end_date": "2030-06-25"}, headers=h).status_code == 200
    assert client.patch(f"{API}/assignments/{a['id']}", json={"planned_end_date": "2030-09-30"}, headers=h).status_code in (409, 422)
    assert client.patch(f"{API}/assignments/{a['id']}", json={}, headers=h).status_code == 422


def test_update_cannot_create_overlap(client, world):
    assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30")
    b = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-07-05", "2030-07-10").json()
    r = client.patch(
        f"{API}/assignments/{b['id']}", json={"start_date": "2030-06-28"}, headers=login_headers(client, "mgr")
    )
    assert r.status_code == 409


# ---- transfers -----------------------------------------------------------
# Transfers move an employee between overlapping milestones (typically of
# different projects), because milestones within one project never overlap.

def beta(db, world, manager=None):
    project = make_project(db, manager or world.manager, world.admin, name="Beta")
    return make_milestone(db, project, date(2030, 7, 1), date(2030, 8, 31), name="B1")


def transfer(client, user, assignment_id, milestone_id, start="2030-07-10", end="2030-07-31"):
    return client.post(
        f"{API}/assignments/{assignment_id}/transfer",
        json={"target_milestone_id": milestone_id, "start_date": start, "planned_end_date": end},
        headers=login_headers(client, user),
    )


def test_transfer_is_atomic_success(client, world, db):
    b1 = beta(db, world)
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-08-30").json()
    r = transfer(client, "mgr", a["id"], b1.id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["destination"]["milestone_id"] == b1.id
    assert body["source"]["effective_end_date"] == "2030-07-09"
    assert db.query(MilestoneAssignment).count() == 2
    assert db.query(AuditLog).filter_by(action="assignment.transfer").count() == 1


def test_transfer_conflict_rolls_back(client, world, db):
    b1 = beta(db, world)
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-07-15").json()
    assert assign(client, "mgr", b1.id, world.emp.id, "2030-07-20", "2030-07-25").status_code == 201
    r = transfer(client, "mgr", a["id"], b1.id)
    assert r.status_code == 409
    db.expire_all()
    assert db.query(MilestoneAssignment).count() == 2
    assert db.get(MilestoneAssignment, a["id"]).ended_at is None
    assert db.query(AuditLog).filter_by(action="assignment.transfer").count() == 0


def test_transfer_rolls_back_when_audit_fails(client, world, db, monkeypatch):
    from fastapi.testclient import TestClient
    from main import app

    b1 = beta(db, world)
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-08-30").json()
    headers = login_headers(client, "mgr")

    def boom(*args, **kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr("services.assignment_service.record_audit", boom)
    safe = TestClient(app, raise_server_exceptions=False)
    r = safe.post(
        f"{API}/assignments/{a['id']}/transfer",
        json={"target_milestone_id": b1.id, "start_date": "2030-07-10", "planned_end_date": "2030-07-31"},
        headers=headers,
    )
    assert r.status_code == 500
    db.expire_all()
    assert db.query(MilestoneAssignment).count() == 1
    assert db.get(MilestoneAssignment, a["id"]).ended_at is None


def test_transfer_to_other_managers_project_requires_link(client, world, db):
    m = beta(db, world, manager=world.other_manager)
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-08-30").json()
    r = transfer(client, "adminuser", a["id"], m.id)
    assert r.status_code in (403, 409)
    db.expire_all()
    assert db.query(MilestoneAssignment).count() == 1
    assert db.get(MilestoneAssignment, a["id"]).ended_at is None


# ---- rollback on creation ---------------------------------------------------

def test_create_rolls_back_when_audit_fails(client, world, db, monkeypatch):
    monkeypatch.setattr("services.assignment_service.record_audit", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    from fastapi.testclient import TestClient
    from main import app

    safe = TestClient(app, raise_server_exceptions=False)
    r = safe.post(
        f"{API}/milestones/{world.milestone.id}/assignments",
        json={"employee_id": world.emp.id, "start_date": "2030-06-20", "planned_end_date": "2030-06-30"},
        headers=login_headers(client, "mgr"),
    )
    assert r.status_code == 500
    assert db.query(MilestoneAssignment).count() == 0


# ---- milestone completion bounds the window -----------------------------------

def test_completed_milestone_bounds_effective_end(client, world, db):
    a = assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-12", "2030-08-30").json()
    r = client.patch(
        f"{API}/milestones/{world.milestone.id}/status", json={"status": "completed"}, headers=login_headers(client, "mgr")
    )
    assert r.status_code == 200
    db.expire_all()
    row = db.get(MilestoneAssignment, a["id"])
    # Completion day is inclusive; later days are freed.
    assert effective_window(row, row.milestone) == (date(2030, 6, 12), date(2030, 6, 12))


# ---- deactivation policy ------------------------------------------------------

def test_deactivating_employee_ends_open_assignments_preserves_history(client, world, db):
    assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30")
    r = client.patch(f"{API}/users/{world.emp.id}/status", json={"is_active": False}, headers=login_headers(client, "adminuser"))
    assert r.status_code == 200, r.text
    db.expire_all()
    rows = db.query(MilestoneAssignment).all()
    assert len(rows) == 1 and rows[0].ended_at is not None
    audit = db.query(AuditLog).filter_by(action="user.deactivate").one()
    assert "ended_assignments" in audit.changes


def test_deactivating_manager_with_active_projects_blocked(client, world):
    r = client.patch(f"{API}/users/{world.manager.id}/status", json={"is_active": False}, headers=login_headers(client, "adminuser"))
    assert r.status_code == 409


# ---- visibility, availability, schedule ------------------------------------------

def test_schedule_visibility(client, world):
    assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30")
    assert len(client.get(f"{API}/employees/{world.emp.id}/schedule", headers=login_headers(client, "emp")).json()) == 1
    assert len(client.get(f"{API}/employees/{world.emp.id}/schedule", headers=login_headers(client, "mgr")).json()) == 1
    assert client.get(f"{API}/employees/{world.emp.id}/schedule", headers=login_headers(client, "mgr2")).status_code == 403
    assert client.get(f"{API}/employees/{world.emp.id}/schedule", headers=login_headers(client, "stranger")).status_code == 403


def test_availability(client, world):
    assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30")
    h = login_headers(client, "mgr")
    r = client.get(f"{API}/availability?start=2030-06-25&end=2030-07-02&project_id={world.project.id}", headers=h)
    assert r.status_code == 200, r.text
    by_name = {e["employee"]["username"]: e for e in r.json()}
    assert by_name["emp"]["is_available"] is False
    assert by_name["emp2"]["is_available"] is True
    assert "stranger" not in by_name
    assert client.get(f"{API}/availability?start=2030-06-25&end=2030-07-02", headers=login_headers(client, "emp")).status_code == 403


# ---- Phase 2 removal flow shares the same rules ---------------------------------

def test_removing_employee_from_manager_ends_work_keeps_rows(client, world, db):
    assign(client, "mgr", world.milestone.id, world.emp.id, "2030-06-20", "2030-06-30")
    r = client.delete(f"{API}/managers/{world.manager.id}/employees/{world.emp.id}", headers=login_headers(client, "adminuser"))
    assert r.status_code in (200, 204), r.text
    db.expire_all()
    rows = db.query(MilestoneAssignment).all()
    assert len(rows) == 1 and rows[0].ended_at is not None
    # No longer organizationally assigned, so cannot be scheduled again.
    assert assign(client, "mgr", world.milestone.id, world.emp.id, "2030-07-10", "2030-07-12").status_code in (403, 409, 422)

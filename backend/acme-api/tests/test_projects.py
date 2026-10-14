"""Project permission, status and archive tests."""

from datetime import date

from models.audit_log import AuditLog
from models.assignment import MilestoneAssignment
from tests.conftest import login_headers, make_user

API = "/api/v1"


def payload(manager_id, **overrides):
    data = {
        "name": "New Project",
        "manager_id": manager_id,
        "start_date": "2030-01-01",
        "estimated_end_date": "2030-12-31",
        "estimated_budget": "50000.00",
    }
    data.update(overrides)
    return data


def test_admin_creates_project_and_audits(client, world, db):
    h = login_headers(client, "adminuser")
    r = client.post(f"{API}/projects", json=payload(world.manager.id), headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "active"
    assert db.query(AuditLog).filter_by(action="project.create").count() == 1


def test_manager_and_employee_cannot_create(client, world):
    for name in ("mgr", "emp"):
        r = client.post(f"{API}/projects", json=payload(world.manager.id), headers=login_headers(client, name))
        assert r.status_code == 403


def test_create_rejects_non_manager_owner_and_bad_dates(client, world):
    h = login_headers(client, "adminuser")
    assert client.post(f"{API}/projects", json=payload(world.emp.id), headers=h).status_code in (404, 422)
    bad = payload(world.manager.id, estimated_end_date="2029-01-01")
    assert client.post(f"{API}/projects", json=bad, headers=h).status_code == 422


def test_manager_sees_only_own_projects(client, world, db):
    h = login_headers(client, "mgr2")
    assert client.get(f"{API}/projects", headers=h).json() == []
    assert client.get(f"{API}/projects/{world.project.id}", headers=h).status_code == 403
    own = login_headers(client, "mgr")
    assert len(client.get(f"{API}/projects", headers=own).json()) == 1


def test_employee_sees_projects_without_budget(client, world, db):
    db.add(
        MilestoneAssignment(
            milestone_id=world.milestone.id,
            employee_id=world.emp.id,
            start_date=date(2030, 6, 20),
            planned_end_date=date(2030, 6, 30),
        )
    )
    db.commit()
    h = login_headers(client, "emp")
    body = client.get(f"{API}/projects/{world.project.id}", headers=h).json()
    assert "estimated_budget" not in body and "created_by" not in body
    assert client.get(f"{API}/projects/{world.project.id}", headers=login_headers(client, "stranger")).status_code == 403


def test_manager_can_edit_own_but_not_reassign(client, world):
    h = login_headers(client, "mgr")
    assert client.patch(f"{API}/projects/{world.project.id}", json={"name": "Renamed"}, headers=h).status_code == 200
    r = client.patch(f"{API}/projects/{world.project.id}", json={"manager_id": world.other_manager.id}, headers=h)
    assert r.status_code == 403


def test_project_dates_cannot_exclude_milestones(client, world):
    h = login_headers(client, "adminuser")
    r = client.patch(f"{API}/projects/{world.project.id}", json={"estimated_end_date": "2030-07-01"}, headers=h)
    assert r.status_code == 409


def test_archive_restore_admin_only_and_read_only_when_archived(client, world):
    mh = login_headers(client, "mgr")
    ah = login_headers(client, "adminuser")
    assert client.post(f"{API}/projects/{world.project.id}/archive", headers=mh).status_code == 403
    assert client.post(f"{API}/projects/{world.project.id}/archive", headers=ah).status_code == 200
    r = client.patch(f"{API}/projects/{world.project.id}", json={"name": "x"}, headers=mh)
    assert r.status_code == 409
    r = client.post(
        f"{API}/milestones/{world.milestone.id}/assignments",
        json={"employee_id": world.emp.id, "start_date": "2030-06-20", "planned_end_date": "2030-06-25"},
        headers=mh,
    )
    assert r.status_code == 409
    assert client.post(f"{API}/projects/{world.project.id}/restore", headers=ah).status_code == 200
    assert client.patch(f"{API}/projects/{world.project.id}", json={"name": "ok"}, headers=mh).status_code == 200


def test_completing_project_ends_open_assignments_but_keeps_rows(client, world, db):
    mh = login_headers(client, "mgr")
    r = client.post(
        f"{API}/milestones/{world.milestone.id}/assignments",
        json={"employee_id": world.emp.id, "start_date": "2030-06-20", "planned_end_date": "2030-06-30"},
        headers=mh,
    )
    assert r.status_code == 201, r.text
    r = client.patch(f"{API}/projects/{world.project.id}/status", json={"status": "completed"}, headers=mh)
    assert r.status_code == 200, r.text
    rows = db.query(MilestoneAssignment).all()
    assert len(rows) == 1 and rows[0].ended_at is not None
    # Non-active projects cannot receive new work.
    r = client.post(
        f"{API}/milestones/{world.milestone.id}/assignments",
        json={"employee_id": world.emp2.id, "start_date": "2030-07-01", "planned_end_date": "2030-07-05"},
        headers=mh,
    )
    assert r.status_code == 409


def test_users_me_routing_not_parsed_as_id(client, world):
    h = login_headers(client, "emp")
    r = client.get(f"{API}/users/me", headers=h)
    assert r.status_code == 200 and r.json()["username"] == "emp"
    assert client.get(f"{API}/users/{world.stranger.id}", headers=h).status_code == 403
    admin = login_headers(client, "adminuser")
    assert client.get(f"{API}/users/{world.emp.id}", headers=admin).json()["username"] == "emp"

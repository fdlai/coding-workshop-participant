"""API endpoint coverage for error paths: 401/403/404/409/422 across CRUD resources.

Frozen "today" is 2030-06-12 (see the ``world`` fixture in conftest).
"""

from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from models.assignment import MilestoneAssignment
from models.audit_log import AuditLog
from models.user import User
from tests.conftest import PASSWORD, login_headers, make_user

API = "/api/v1"
MISSING = 999_999


def _assign(db, milestone, employee, start, end):
    row = MilestoneAssignment(
        milestone_id=milestone.id, employee_id=employee.id, start_date=start, planned_end_date=end
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# --- service health and auth ----------------------------------------------------------


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_users_me_alias_returns_current_user(client, world):
    response = client.get(f"{API}/users/me", headers=login_headers(client, "emp"))
    assert response.status_code == 200
    assert response.json()["username"] == "emp"
    assert "password_hash" not in response.json()


def test_change_password_success_replaces_old_password(client, world):
    headers = login_headers(client, "emp")
    response = client.post(
        f"{API}/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "BrandNewPass456!"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    old = client.post(f"{API}/auth/login", json={"username": "emp", "password": PASSWORD})
    assert old.status_code == 401
    new = client.post(f"{API}/auth/login", json={"username": "emp", "password": "BrandNewPass456!"})
    assert new.status_code == 200


def test_change_password_rejects_wrong_current_password(client, world):
    response = client.post(
        f"{API}/auth/change-password",
        json={"current_password": "WrongPassword9!", "new_password": "BrandNewPass456!"},
        headers=login_headers(client, "emp"),
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Current password is incorrect"


@pytest.mark.parametrize(
    "body",
    [
        {"current_password": PASSWORD, "new_password": "short"},
        {"current_password": PASSWORD},
        {},
    ],
)
def test_change_password_validation_errors(client, world, body):
    response = client.post(f"{API}/auth/change-password", json=body, headers=login_headers(client, "emp"))
    assert response.status_code == 422


def test_change_password_requires_authentication(client, setup_db):
    response = client.post(
        f"{API}/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "BrandNewPass456!"},
    )
    assert response.status_code == 401


def test_invalid_bearer_token_is_rejected(client, setup_db):
    response = client.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "body",
    [{"username": "ab", "password": PASSWORD}, {"username": "adminuser", "password": "short"}, {}],
)
def test_login_validation_errors(client, setup_db, body):
    assert client.post(f"{API}/auth/login", json=body).status_code == 422


# --- projects -------------------------------------------------------------------------


def test_list_project_milestones_for_owner_in_date_order(client, world):
    response = client.get(f"{API}/projects/{world.project.id}/milestones", headers=login_headers(client, "mgr"))
    assert response.status_code == 200
    assert [m["name"] for m in response.json()] == ["M1", "M2"]


def test_list_project_milestones_access_errors(client, world):
    url = f"{API}/projects/{world.project.id}/milestones"
    assert client.get(url, headers=login_headers(client, "mgr2")).status_code == 403
    assert client.get(url, headers=login_headers(client, "stranger")).status_code == 403
    assert client.get(url).status_code == 401
    missing = client.get(f"{API}/projects/{MISSING}/milestones", headers=login_headers(client, "adminuser"))
    assert missing.status_code == 404


@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("get", "", None),
        ("get", "/budget", None),
        ("get", "/timeline", None),
        ("patch", "", {"name": "Renamed"}),
        ("patch", "/status", {"status": "completed"}),
        ("post", "/archive", None),
        ("post", "/restore", None),
        (
            "post",
            "/milestones",
            {"name": "X", "start_date": "2030-07-01", "end_date": "2030-07-02"},
        ),
    ],
)
def test_project_endpoints_return_404_for_unknown_project(client, world, method, suffix, body):
    headers = login_headers(client, "adminuser")
    kwargs = {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    response = getattr(client, method)(f"{API}/projects/{MISSING}{suffix}", **kwargs)
    assert response.status_code == 404, response.text


def test_project_list_filters(client, world, db):
    h = login_headers(client, "adminuser")
    assert len(client.get(f"{API}/projects?status=active", headers=h).json()) == 1
    assert client.get(f"{API}/projects?status=completed", headers=h).json() == []
    assert client.get(f"{API}/projects?manager_id={world.other_manager.id}", headers=h).json() == []
    assert len(client.get(f"{API}/projects?manager_id={world.manager.id}", headers=h).json()) == 1
    world.project.is_archived = True
    db.commit()
    assert client.get(f"{API}/projects", headers=h).json() == []
    assert len(client.get(f"{API}/projects?include_archived=true", headers=h).json()) == 1


@pytest.mark.parametrize("query", ["status=bogus", "limit=0", "limit=201", "offset=-1"])
def test_project_list_rejects_invalid_query(client, world, query):
    assert client.get(f"{API}/projects?{query}", headers=login_headers(client, "adminuser")).status_code == 422


def test_project_update_requires_admin_or_owner(client, world):
    url = f"{API}/projects/{world.project.id}"
    assert client.patch(url, json={"name": "X"}, headers=login_headers(client, "emp")).status_code == 403
    assert client.patch(url, json={"name": "X"}, headers=login_headers(client, "mgr2")).status_code == 403
    assert client.patch(url, json={"name": "Renamed"}, headers=login_headers(client, "mgr")).status_code == 200


def test_manager_cannot_reassign_project_manager(client, world):
    response = client.patch(
        f"{API}/projects/{world.project.id}",
        json={"manager_id": world.other_manager.id},
        headers=login_headers(client, "mgr"),
    )
    assert response.status_code == 403


def test_project_update_without_changes_is_a_noop(client, world, db):
    response = client.patch(
        f"{API}/projects/{world.project.id}", json={"name": "Alpha"}, headers=login_headers(client, "mgr")
    )
    assert response.status_code == 200
    assert db.query(AuditLog).filter_by(action="project.update").count() == 0


def test_project_update_rejects_end_before_start(client, world):
    response = client.patch(
        f"{API}/projects/{world.project.id}",
        json={"estimated_end_date": "2029-12-31"},
        headers=login_headers(client, "adminuser"),
    )
    assert response.status_code == 422


def test_project_update_rejects_dates_that_exclude_milestones(client, world):
    response = client.patch(
        f"{API}/projects/{world.project.id}",
        json={"estimated_end_date": "2030-09-30"},
        headers=login_headers(client, "adminuser"),
    )
    assert response.status_code == 409
    assert "milestone" in response.json()["detail"]


def test_project_update_rejects_non_manager_as_new_manager(client, world, db):
    h = login_headers(client, "adminuser")
    url = f"{API}/projects/{world.project.id}"
    assert client.patch(url, json={"manager_id": world.emp.id}, headers=h).status_code == 422
    assert client.patch(url, json={"manager_id": MISSING}, headers=h).status_code == 422
    inactive = make_user(db, "idle_mgr", "manager", is_active=False)
    assert client.patch(url, json={"manager_id": inactive.id}, headers=h).status_code == 422


def test_project_manager_change_requires_coverage_of_open_assignments(client, world, db):
    _assign(db, world.milestone, world.emp, date(2030, 6, 15), date(2030, 6, 30))
    h = login_headers(client, "adminuser")
    url = f"{API}/projects/{world.project.id}"
    blocked = client.patch(url, json={"manager_id": world.other_manager.id}, headers=h)
    assert blocked.status_code == 409
    assert str(world.emp.id) in blocked.json()["detail"]


def test_project_manager_change_succeeds_without_open_assignments(client, world, db):
    h = login_headers(client, "adminuser")
    response = client.patch(
        f"{API}/projects/{world.project.id}", json={"manager_id": world.other_manager.id}, headers=h
    )
    assert response.status_code == 200, response.text
    assert response.json()["manager_id"] == world.other_manager.id
    audit = db.query(AuditLog).filter_by(action="project.update").one()
    assert audit.changes["before"]["manager_id"] == world.manager.id


def test_archive_and_restore_conflicts(client, world):
    h = login_headers(client, "adminuser")
    base = f"{API}/projects/{world.project.id}"
    assert client.post(f"{base}/restore", headers=h).status_code == 409
    assert client.post(f"{base}/archive", headers=h).status_code == 200
    assert client.post(f"{base}/archive", headers=h).status_code == 409
    # Archived projects are read-only.
    assert client.patch(base, json={"name": "X"}, headers=h).status_code == 409
    assert client.patch(f"{base}/status", json={"status": "completed"}, headers=h).status_code == 409
    assert client.post(f"{base}/restore", headers=h).status_code == 200


def test_archive_requires_admin(client, world):
    response = client.post(f"{API}/projects/{world.project.id}/archive", headers=login_headers(client, "mgr"))
    assert response.status_code == 403


def test_project_status_same_value_is_noop_and_invalid_value_rejected(client, world, db):
    h = login_headers(client, "mgr")
    url = f"{API}/projects/{world.project.id}/status"
    assert client.patch(url, json={"status": "active"}, headers=h).status_code == 200
    assert db.query(AuditLog).filter_by(action="project.status_change").count() == 0
    assert client.patch(url, json={"status": "paused"}, headers=h).status_code == 422
    assert client.patch(url, json={"status": "completed"}, headers=login_headers(client, "mgr2")).status_code == 403


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},
        {"estimated_budget": "-1"},
        {"manager_id": None},
        {"start_date": "not-a-date"},
    ],
)
def test_project_create_validation_errors(client, world, overrides):
    body = {
        "name": "New",
        "manager_id": world.manager.id,
        "start_date": "2030-01-01",
        "estimated_end_date": "2030-12-31",
        "estimated_budget": "1000.00",
    }
    body.update(overrides)
    assert client.post(f"{API}/projects", json=body, headers=login_headers(client, "adminuser")).status_code == 422


# --- milestones -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("get", "", None),
        ("patch", "", {"name": "X"}),
        ("delete", "", None),
        ("patch", "/status", {"status": "completed"}),
        ("get", "/assignments", None),
        ("post", "/assignments", {"employee_id": 1, "start_date": "2030-07-01", "planned_end_date": "2030-07-02"}),
    ],
)
def test_milestone_endpoints_return_404_for_unknown_milestone(client, world, method, suffix, body):
    kwargs = {"headers": login_headers(client, "adminuser")}
    if body is not None:
        kwargs["json"] = body
    response = getattr(client, method)(f"{API}/milestones/{MISSING}{suffix}", **kwargs)
    assert response.status_code == 404, response.text


def test_milestone_update_noop_and_date_validation(client, world, db):
    h = login_headers(client, "mgr")
    url = f"{API}/milestones/{world.milestone.id}"
    assert client.patch(url, json={"name": "M1"}, headers=h).status_code == 200
    assert db.query(AuditLog).filter_by(action="milestone.update").count() == 0
    # Outside the project window.
    assert client.patch(url, json={"end_date": "2031-01-15"}, headers=h).status_code == 422
    # Overlaps M2.
    assert client.patch(url, json={"end_date": "2030-09-15"}, headers=h).status_code == 409
    # Start after end.
    assert client.patch(url, json={"start_date": "2030-09-01", "end_date": "2030-08-01"}, headers=h).status_code == 422
    # Explicit nulls are rejected.
    assert client.patch(url, json={"name": None}, headers=h).status_code == 422
    ok = client.patch(url, json={"name": "Phase 1", "end_date": "2030-08-15"}, headers=h)
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "Phase 1"


def test_milestone_update_cannot_shrink_past_assignments(client, world, db):
    _assign(db, world.milestone, world.emp, date(2030, 8, 1), date(2030, 8, 30))
    response = client.patch(
        f"{API}/milestones/{world.milestone.id}", json={"end_date": "2030-07-31"}, headers=login_headers(client, "mgr")
    )
    assert response.status_code == 409


def test_completed_milestone_cannot_be_edited(client, world):
    h = login_headers(client, "mgr")
    url = f"{API}/milestones/{world.milestone.id}"
    assert client.patch(f"{url}/status", json={"status": "completed"}, headers=h).status_code == 200
    assert client.patch(url, json={"name": "Late edit"}, headers=h).status_code == 409


def test_milestone_mutations_forbidden_for_other_manager(client, world):
    h = login_headers(client, "mgr2")
    url = f"{API}/milestones/{world.milestone.id}"
    assert client.patch(url, json={"name": "X"}, headers=h).status_code == 403
    assert client.delete(url, headers=h).status_code == 403
    assert client.patch(f"{url}/status", json={"status": "completed"}, headers=h).status_code == 403


# --- assignments ----------------------------------------------------------------------


def test_assignment_endpoints_return_404_for_unknown_assignment(client, world):
    h = login_headers(client, "mgr")
    assert client.patch(f"{API}/assignments/{MISSING}", json={"planned_end_date": "2030-07-01"}, headers=h).status_code == 404
    assert client.post(f"{API}/assignments/{MISSING}/end", headers=h).status_code == 404
    transfer = client.post(
        f"{API}/assignments/{MISSING}/transfer", json={"target_milestone_id": world.milestone2.id}, headers=h
    )
    assert transfer.status_code == 404


def test_assignment_create_rejects_unknown_or_non_employee(client, world):
    h = login_headers(client, "mgr")
    url = f"{API}/milestones/{world.milestone.id}/assignments"
    for employee_id in (MISSING, world.other_manager.id):
        body = {"employee_id": employee_id, "start_date": "2030-07-01", "planned_end_date": "2030-07-10"}
        assert client.post(url, json=body, headers=h).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"employee_id": 0, "start_date": "2030-07-01", "planned_end_date": "2030-07-10"},
        {"employee_id": 1, "start_date": "2030-07-10", "planned_end_date": "2030-07-01"},
        {"employee_id": 1, "start_date": "2030-07-01"},
        {"employee_id": 1, "start_date": "2030-07-01", "planned_end_date": "2030-07-10", "extra": True},
    ],
)
def test_assignment_create_validation_errors(client, world, body):
    url = f"{API}/milestones/{world.milestone.id}/assignments"
    assert client.post(url, json=body, headers=login_headers(client, "mgr")).status_code == 422


def test_assignment_update_error_paths(client, world, db):
    h = login_headers(client, "mgr")
    started = _assign(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 20))
    future = _assign(db, world.milestone, world.emp2, date(2030, 7, 1), date(2030, 7, 10))

    url = f"{API}/assignments/{started.id}"
    # A started assignment's start date is immutable.
    assert client.patch(url, json={"start_date": "2030-06-11"}, headers=h).status_code == 422
    # End date before today.
    assert client.patch(url, json={"planned_end_date": "2030-06-11"}, headers=h).status_code == 422
    # Outside milestone window.
    assert client.patch(url, json={"planned_end_date": "2030-09-15"}, headers=h).status_code == 422
    # No change is a no-op.
    assert client.patch(url, json={"planned_end_date": "2030-06-20"}, headers=h).status_code == 200

    furl = f"{API}/assignments/{future.id}"
    # Moving a future assignment into the past.
    assert client.patch(furl, json={"start_date": "2030-06-01"}, headers=h).status_code == 422
    # Overlap with the employee's other assignment.
    _assign(db, world.milestone, world.emp2, date(2030, 7, 20), date(2030, 7, 25))
    assert client.patch(furl, json={"planned_end_date": "2030-07-22"}, headers=h).status_code == 409
    # Other managers cannot edit.
    assert client.patch(furl, json={"planned_end_date": "2030-07-12"}, headers=login_headers(client, "mgr2")).status_code == 403


def test_ended_and_finished_assignments_are_immutable(client, world, db):
    h = login_headers(client, "mgr")
    finished = _assign(db, world.milestone, world.emp, date(2030, 6, 3), date(2030, 6, 5))
    assert client.patch(f"{API}/assignments/{finished.id}", json={"planned_end_date": "2030-06-20"}, headers=h).status_code == 409
    assert client.post(f"{API}/assignments/{finished.id}/end", headers=h).status_code == 409

    active = _assign(db, world.milestone, world.emp2, date(2030, 6, 10), date(2030, 6, 30))
    assert client.post(f"{API}/assignments/{active.id}/end", headers=h).status_code == 200
    assert client.post(f"{API}/assignments/{active.id}/end", headers=h).status_code == 409
    assert client.patch(f"{API}/assignments/{active.id}", json={"planned_end_date": "2030-06-25"}, headers=h).status_code == 409
    transfer = client.post(
        f"{API}/assignments/{active.id}/transfer", json={"target_milestone_id": world.milestone2.id}, headers=h
    )
    assert transfer.status_code == 409


def test_transfer_error_paths(client, world, db):
    h = login_headers(client, "mgr")
    source = _assign(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 30))
    url = f"{API}/assignments/{source.id}/transfer"
    # Same milestone.
    assert client.post(url, json={"target_milestone_id": world.milestone.id}, headers=h).status_code == 422
    # Unknown destination.
    assert client.post(url, json={"target_milestone_id": MISSING}, headers=h).status_code == 404
    # Invalid payload.
    assert client.post(url, json={"target_milestone_id": 0}, headers=h).status_code == 422


def test_employee_schedule_access_rules(client, world, db):
    _assign(db, world.milestone, world.emp, date(2030, 6, 15), date(2030, 6, 30))
    assert client.get(f"{API}/employees/{MISSING}/schedule", headers=login_headers(client, "adminuser")).status_code == 404
    assert client.get(f"{API}/employees/{world.manager.id}/schedule", headers=login_headers(client, "adminuser")).status_code == 404
    assert client.get(f"{API}/employees/{world.emp.id}/schedule", headers=login_headers(client, "emp2")).status_code == 403
    assert client.get(f"{API}/employees/{world.emp.id}/schedule", headers=login_headers(client, "mgr2")).status_code == 403
    own = client.get(f"{API}/employees/{world.emp.id}/schedule", headers=login_headers(client, "emp"))
    assert own.status_code == 200 and len(own.json()) == 1
    windowed = client.get(
        f"{API}/employees/{world.emp.id}/schedule?start=2030-07-01&end=2030-07-31", headers=login_headers(client, "mgr")
    )
    assert windowed.status_code == 200 and windowed.json() == []
    inside = client.get(
        f"{API}/employees/{world.emp.id}/schedule?start=2030-06-20&end=2030-06-21", headers=login_headers(client, "mgr")
    )
    assert len(inside.json()) == 1


def test_availability_validation_and_scoping(client, world, db):
    _assign(db, world.milestone, world.emp, date(2030, 6, 15), date(2030, 6, 30))
    mgr = login_headers(client, "mgr")
    assert client.get(f"{API}/availability?start=2030-07-01&end=2030-06-01", headers=mgr).status_code == 422
    assert client.get(f"{API}/availability?start=2030-01-01&end=2032-01-01", headers=mgr).status_code == 422
    assert client.get(f"{API}/availability?start=2030-06-01", headers=mgr).status_code == 422
    assert (
        client.get(f"{API}/availability?start=2030-06-01&end=2030-06-30&manager_id={world.other_manager.id}", headers=mgr).status_code
        == 403
    )
    assert client.get(f"{API}/availability?start=2030-06-01&end=2030-06-30&project_id={MISSING}", headers=mgr).status_code == 404
    assert client.get(f"{API}/availability?start=2030-06-01&end=2030-06-30", headers=login_headers(client, "emp")).status_code == 403

    rows = client.get(f"{API}/availability?start=2030-06-01&end=2030-06-30", headers=mgr).json()
    by_name = {r["employee"]["username"]: r for r in rows}
    assert set(by_name) == {"emp", "emp2"}
    assert by_name["emp"]["is_available"] is False
    assert by_name["emp2"]["is_available"] is True

    by_project = client.get(
        f"{API}/availability?start=2030-06-01&end=2030-06-30&project_id={world.project.id}",
        headers=login_headers(client, "adminuser"),
    )
    assert {r["employee"]["username"] for r in by_project.json()} == {"emp", "emp2"}
    everyone = client.get(f"{API}/availability?start=2030-06-01&end=2030-06-30", headers=login_headers(client, "adminuser"))
    assert {r["employee"]["username"] for r in everyone.json()} == {"emp", "emp2", "stranger"}


# --- users ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("get", "", None),
        ("patch", "", {"first_name": "X"}),
        ("patch", "/role", {"role": "manager"}),
        ("patch", "/status", {"is_active": False}),
        ("post", "/reset-password", {"new_password": "AnotherPass123!"}),
    ],
)
def test_user_endpoints_return_404_for_unknown_user(client, setup_db, method, suffix, body):
    kwargs = {"headers": login_headers(client, "adminuser")}
    if body is not None:
        kwargs["json"] = body
    response = getattr(client, method)(f"{API}/users/{MISSING}{suffix}", **kwargs)
    assert response.status_code == 404, response.text


def test_user_list_filters_by_active_status(client, db):
    make_user(db, "sleeper", "employee", is_active=False)
    h = login_headers(client, "adminuser")
    inactive = client.get(f"{API}/users?is_active=false", headers=h).json()
    assert [u["username"] for u in inactive] == ["sleeper"]
    assert "sleeper" not in [u["username"] for u in client.get(f"{API}/users?is_active=true", headers=h).json()]


@pytest.mark.parametrize(
    "overrides",
    [
        {"username": "a b"},
        {"email": "not-an-email"},
        {"password": "short"},
        {"role": "superuser"},
        {"first_name": "   "},
        {"profile_picture_url": "ftp://example.com/x.png"},
    ],
)
def test_user_create_validation_errors(client, setup_db, overrides):
    body = {
        "username": "newbie",
        "email": "newbie@example.com",
        "first_name": "New",
        "last_name": "User",
        "password": "Password123!",
    }
    body.update(overrides)
    assert client.post(f"{API}/users", json=body, headers=login_headers(client, "adminuser")).status_code == 422


def test_user_create_maps_database_unique_violation_to_409(client, db, monkeypatch):
    """If a concurrent insert wins the race, the IntegrityError becomes a 409."""
    headers = login_headers(client, "adminuser")

    def fail_commit(self):
        raise IntegrityError("INSERT INTO users", {}, Exception("duplicate key value"))

    monkeypatch.setattr("sqlalchemy.orm.Session.commit", fail_commit)
    body = {
        "username": "fresh",
        "email": "fresh@example.com",
        "first_name": "Fresh",
        "last_name": "User",
        "password": "Password123!",
    }
    response = client.post(f"{API}/users", json=body, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"] == "Username or email is already in use"
    monkeypatch.undo()
    assert db.query(User).filter_by(username="fresh").count() == 0


def test_user_update_email_conflict_and_noop(client, db):
    make_user(db, "first", "employee", email="first@example.com")
    second = make_user(db, "second", "employee", email="second@example.com")
    h = login_headers(client, "adminuser")
    url = f"{API}/users/{second.id}"
    assert client.patch(url, json={"email": "FIRST@example.com"}, headers=h).status_code == 409
    assert client.patch(url, json={"first_name": second.first_name}, headers=h).status_code == 200
    assert db.query(AuditLog).filter_by(action="user.update").count() == 0


def test_self_profile_update_rejects_null_names(client, db):
    make_user(db, "selfie", "employee")
    h = login_headers(client, "selfie")
    assert client.patch(f"{API}/users/me", json={"first_name": None}, headers=h).status_code == 422
    ok = client.patch(f"{API}/users/me", json={"job_title": "Engineer"}, headers=h)
    assert ok.status_code == 200 and ok.json()["job_title"] == "Engineer"


def test_admin_cannot_change_own_role_or_deactivate_self(client, db):
    admin = db.query(User).filter_by(username="adminuser").one()
    h = login_headers(client, "adminuser")
    assert client.patch(f"{API}/users/{admin.id}/role", json={"role": "employee"}, headers=h).status_code == 400
    assert client.patch(f"{API}/users/{admin.id}/status", json={"is_active": False}, headers=h).status_code == 400


def test_role_change_noop_and_dependency_conflicts(client, world, db):
    h = login_headers(client, "adminuser")
    # Same role: no-op.
    assert client.patch(f"{API}/users/{world.stranger.id}/role", json={"role": "employee"}, headers=h).status_code == 200
    assert db.query(AuditLog).filter_by(action="user.role_change").count() == 0
    # Has manager relationships.
    assert client.patch(f"{API}/users/{world.emp.id}/role", json={"role": "manager"}, headers=h).status_code == 409
    # Manages a project (and has reports).
    assert client.patch(f"{API}/users/{world.manager.id}/role", json={"role": "employee"}, headers=h).status_code == 409
    # Owns a project but has no reports.
    from tests.conftest import make_project

    make_project(db, world.other_manager, world.admin, name="Beta")
    assert client.patch(f"{API}/users/{world.other_manager.id}/role", json={"role": "employee"}, headers=h).status_code == 409
    # Invalid role.
    assert client.patch(f"{API}/users/{world.stranger.id}/role", json={"role": "owner"}, headers=h).status_code == 422
    # Unblocked change succeeds.
    ok = client.patch(f"{API}/users/{world.stranger.id}/role", json={"role": "manager"}, headers=h)
    assert ok.status_code == 200 and ok.json()["role"] == "manager"


def test_role_change_blocked_by_active_assignment(client, world, db):
    loner = make_user(db, "loner", "employee")
    _assign(db, world.milestone, loner, date(2030, 6, 15), date(2030, 6, 30))
    response = client.patch(
        f"{API}/users/{loner.id}/role", json={"role": "manager"}, headers=login_headers(client, "adminuser")
    )
    assert response.status_code == 409
    assert "assignment" in response.json()["detail"]


def test_status_change_same_value_is_noop(client, world, db):
    h = login_headers(client, "adminuser")
    response = client.patch(f"{API}/users/{world.emp.id}/status", json={"is_active": True}, headers=h)
    assert response.status_code == 200
    assert db.query(AuditLog).filter_by(action="user.activate").count() == 0
    assert client.patch(f"{API}/users/{world.emp.id}/status", json={"is_active": "maybe"}, headers=h).status_code == 422


def test_reset_password_validation_and_permissions(client, world):
    url = f"{API}/users/{world.emp.id}/reset-password"
    assert client.post(url, json={"new_password": "short"}, headers=login_headers(client, "adminuser")).status_code == 422
    assert client.post(url, json={"new_password": "LongEnough123!"}, headers=login_headers(client, "mgr")).status_code == 403


def test_get_user_visibility_rules(client, world):
    # Unrelated manager cannot view an employee; unknown id is 404.
    assert client.get(f"{API}/users/{world.emp.id}", headers=login_headers(client, "mgr2")).status_code == 403
    assert client.get(f"{API}/users/{world.manager.id}", headers=login_headers(client, "stranger")).status_code == 403
    summary = client.get(f"{API}/users/{world.manager.id}", headers=login_headers(client, "emp"))
    assert summary.status_code == 200 and "email" not in summary.json()


# --- relationships and work terms -----------------------------------------------------


def _link(client, manager_id, employee_id, headers):
    return client.post(f"{API}/managers/{manager_id}/employees", json={"employee_id": employee_id}, headers=headers)


def test_relationship_error_paths(client, world, db):
    h = login_headers(client, "adminuser")
    assert _link(client, world.manager.id, world.manager.id, h).status_code == 400
    assert _link(client, MISSING, world.emp.id, h).status_code == 404
    assert _link(client, world.manager.id, MISSING, h).status_code == 404
    assert _link(client, world.manager.id, world.emp.id, h).status_code == 409
    idle = make_user(db, "idle", "employee", is_active=False)
    assert _link(client, world.manager.id, idle.id, h).status_code == 409
    assert _link(client, world.manager.id, world.stranger.id, login_headers(client, "mgr")).status_code == 403
    assert client.post(f"{API}/managers/{world.manager.id}/employees", json={}, headers=h).status_code == 422
    missing = client.delete(f"{API}/managers/{world.manager.id}/employees/{world.stranger.id}", headers=h)
    assert missing.status_code == 404
    assert client.get(f"{API}/managers/{MISSING}/employees", headers=h).status_code == 404
    assert client.get(f"{API}/employees/{MISSING}/managers", headers=h).status_code == 404


def test_relationship_database_unique_violation_maps_to_409(client, world, monkeypatch):
    """A race past the pre-check is caught by the composite primary key."""
    monkeypatch.setattr("services.relationship_service.is_managed_by", lambda db, e, m: False)
    response = _link(client, world.manager.id, world.emp.id, login_headers(client, "adminuser"))
    assert response.status_code == 409
    assert response.json()["detail"] == "Employee is already assigned to this manager"


def test_work_terms_error_paths(client, world):
    h = login_headers(client, "adminuser")
    assert client.get(f"{API}/employees/{MISSING}/work-terms", headers=h).status_code == 404
    assert client.get(f"{API}/employees/{world.manager.id}/work-terms", headers=h).status_code == 404
    url = f"{API}/employees/{world.emp.id}/work-terms"
    assert client.get(url, headers=login_headers(client, "mgr")).status_code == 403
    for bad in (
        {"hourly_rate": "-1", "weekly_hours": "40", "effective_from": "2030-07-01"},
        {"hourly_rate": "40", "weekly_hours": "200", "effective_from": "2030-07-01"},
        {"hourly_rate": "40", "weekly_hours": "40"},
    ):
        assert client.post(url, json=bad, headers=h).status_code == 422, bad
    duplicate = {"hourly_rate": "45.00", "weekly_hours": "40", "effective_from": "2030-01-01"}
    assert client.post(url, json=duplicate, headers=h).status_code == 409


def test_work_terms_database_unique_violation_maps_to_409(client, world, db, monkeypatch):
    """The (employee_id, effective_from) unique constraint backs up the duplicate pre-check."""
    from tests.conftest import make_terms

    make_terms(db, world.emp, rate="50.00", effective_from=date(2030, 7, 1))
    real_scalar = db.__class__.scalar
    calls = {"n": 0}

    def scalar_without_duplicate_check(self, statement, *args, **kwargs):
        text = str(statement)
        if "employee_work_terms" in text and "effective_from" in text and calls["n"] == 0:
            calls["n"] += 1
            return None
        return real_scalar(self, statement, *args, **kwargs)

    monkeypatch.setattr("sqlalchemy.orm.Session.scalar", scalar_without_duplicate_check)
    response = client.post(
        f"{API}/employees/{world.emp.id}/work-terms",
        json={"hourly_rate": "55.00", "weekly_hours": "40", "effective_from": "2030-07-01"},
        headers=login_headers(client, "adminuser"),
    )
    assert response.status_code == 409
    assert calls["n"] == 1

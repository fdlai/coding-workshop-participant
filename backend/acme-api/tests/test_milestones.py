"""Milestone date validation and completion workflow tests."""

from tests.conftest import login_headers

API = "/api/v1"


def body(start, end, name="X"):
    return {"name": name, "start_date": start, "end_date": end}


def test_create_within_project_and_adjacent_ok(client, world):
    h = login_headers(client, "mgr")
    url = f"{API}/projects/{world.project.id}/milestones"
    assert client.post(url, json=body("2030-11-01", "2030-11-30"), headers=h).status_code == 201
    # Adjacent (day after previous end) is fine.
    assert client.post(url, json=body("2030-12-01", "2030-12-31", "Y"), headers=h).status_code == 201


def test_overlap_inclusive_boundary_rejected(client, world):
    h = login_headers(client, "mgr")
    url = f"{API}/projects/{world.project.id}/milestones"
    # M2 ends 2030-10-31; starting on the same day overlaps.
    assert client.post(url, json=body("2030-10-31", "2030-11-15"), headers=h).status_code == 409


def test_outside_project_dates_and_inverted_rejected(client, world):
    h = login_headers(client, "mgr")
    url = f"{API}/projects/{world.project.id}/milestones"
    assert client.post(url, json=body("2029-12-01", "2029-12-31"), headers=h).status_code in (409, 422)
    assert client.post(url, json=body("2031-01-01", "2031-01-31"), headers=h).status_code in (409, 422)
    assert client.post(url, json=body("2030-11-10", "2030-11-01"), headers=h).status_code == 422


def test_unrelated_manager_and_employee_cannot_create(client, world):
    url = f"{API}/projects/{world.project.id}/milestones"
    for name in ("mgr2", "emp"):
        assert client.post(url, json=body("2030-11-01", "2030-11-30"), headers=login_headers(client, name)).status_code == 403


def test_update_cannot_overlap_sibling(client, world):
    h = login_headers(client, "mgr")
    r = client.patch(f"{API}/milestones/{world.milestone.id}", json={"end_date": "2030-09-05"}, headers=h)
    assert r.status_code == 409


def test_update_must_keep_assignments_inside(client, world):
    h = login_headers(client, "mgr")
    r = client.post(
        f"{API}/milestones/{world.milestone.id}/assignments",
        json={"employee_id": world.emp.id, "start_date": "2030-06-20", "planned_end_date": "2030-08-20"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    r = client.patch(f"{API}/milestones/{world.milestone.id}", json={"end_date": "2030-08-01"}, headers=h)
    assert r.status_code == 409


def test_completion_is_forward_only(client, world):
    h = login_headers(client, "mgr")
    url = f"{API}/milestones/{world.milestone.id}/status"
    r = client.patch(url, json={"status": "completed"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["completed_at"] is not None
    assert client.patch(url, json={"status": "pending"}, headers=h).status_code == 409
    assert client.patch(f"{API}/milestones/{world.milestone.id}", json={"name": "n"}, headers=h).status_code == 409


def test_completed_milestone_rejects_new_assignments(client, world):
    h = login_headers(client, "mgr")
    client.patch(f"{API}/milestones/{world.milestone.id}/status", json={"status": "completed"}, headers=h)
    r = client.post(
        f"{API}/milestones/{world.milestone.id}/assignments",
        json={"employee_id": world.emp.id, "start_date": "2030-06-20", "planned_end_date": "2030-06-25"},
        headers=h,
    )
    assert r.status_code == 409

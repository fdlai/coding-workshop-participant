"""Work-terms API: permissions, validation, append-only history, retroactivity, audit."""

from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from main import app
from models.assignment import MilestoneAssignment
from models.audit_log import AuditLog
from models.work_terms import EmployeeWorkTerms
from tests.conftest import link_employee, login_headers, make_terms, make_user

API = "/api/v1"


def post_terms(client, user, employee_id, rate="45.00", hours="40", effective="2030-07-01"):
    return client.post(
        f"{API}/employees/{employee_id}/work-terms",
        json={"hourly_rate": rate, "weekly_hours": hours, "effective_from": effective},
        headers=login_headers(client, user),
    )


def test_only_admin_can_create_or_list(client, world):
    for who in ("mgr", "emp", "mgr2"):
        assert post_terms(client, who, world.emp.id).status_code == 403
        r = client.get(f"{API}/employees/{world.emp.id}/work-terms", headers=login_headers(client, who))
        assert r.status_code == 403


def test_admin_creates_and_lists_newest_first_with_daily_cost(client, world, db):
    r = post_terms(client, "adminuser", world.emp.id)
    assert r.status_code == 201, r.text
    assert r.json()["daily_cost"] == "360.00"
    r = client.get(f"{API}/employees/{world.emp.id}/work-terms", headers=login_headers(client, "adminuser"))
    dates = [row["effective_from"] for row in r.json()]
    assert dates == ["2030-07-01", "2030-01-01"]


def test_creation_is_audited_in_same_transaction(client, world, db):
    post_terms(client, "adminuser", world.emp.id)
    entry = db.query(AuditLog).filter_by(action="work_terms.create").one()
    assert entry.actor_id == world.admin.id


def test_duplicate_effective_date_conflicts(client, world):
    assert post_terms(client, "adminuser", world.emp.id, effective="2030-01-01").status_code == 409
    assert post_terms(client, "adminuser", world.emp.id).status_code == 201
    assert post_terms(client, "adminuser", world.emp.id).status_code == 409


def test_validation_rejects_bad_values(client, world):
    assert post_terms(client, "adminuser", world.emp.id, rate="-1").status_code == 422
    assert post_terms(client, "adminuser", world.emp.id, hours="-5").status_code == 422
    assert post_terms(client, "adminuser", world.emp.id, hours="169").status_code == 422
    assert post_terms(client, "adminuser", world.emp.id, rate="abc").status_code == 422
    assert post_terms(client, "adminuser", world.emp.id, effective="1999-01-01").status_code == 422


def test_zero_hours_and_zero_rate_are_allowed(client, world):
    r = post_terms(client, "adminuser", world.emp.id, rate="0", hours="0")
    assert r.status_code == 201 and r.json()["daily_cost"] == "0.00"


def test_non_employee_or_missing_target_is_404(client, world):
    assert post_terms(client, "adminuser", world.manager.id).status_code == 404
    assert post_terms(client, "adminuser", 9999).status_code == 404


def test_existing_rows_are_never_modified(client, world, db):
    post_terms(client, "adminuser", world.emp.id)
    rows = db.query(EmployeeWorkTerms).filter_by(employee_id=world.emp.id).order_by(EmployeeWorkTerms.effective_from).all()
    assert [str(r.hourly_rate) for r in rows] == ["40.00", "45.00"]


def _worked_assignment(db, world):
    # Mon 06-03 .. Fri 06-07 is fully in the past relative to 2030-06-12.
    db.add(
        MilestoneAssignment(
            milestone_id=world.milestone.id,
            employee_id=world.emp.id,
            start_date=date(2030, 6, 3),
            planned_end_date=date(2030, 6, 7),
        )
    )
    db.commit()


def test_backdated_terms_that_rewrite_accrued_cost_are_rejected(client, world, db):
    _worked_assignment(db, world)
    r = post_terms(client, "adminuser", world.emp.id, effective="2030-06-05")
    assert r.status_code == 409
    assert "accrued" in r.json()["detail"]
    assert db.query(EmployeeWorkTerms).filter_by(employee_id=world.emp.id).count() == 1


def test_backdated_terms_after_last_worked_day_are_allowed(client, world, db):
    _worked_assignment(db, world)
    assert post_terms(client, "adminuser", world.emp.id, effective="2030-06-08").status_code == 201


def test_initial_backdated_terms_for_new_hire_allowed(client, world, db):
    newbie = make_user(db, "newbie", "employee")
    link_employee(db, newbie, world.manager)
    assert post_terms(client, "adminuser", newbie.id, effective="2030-01-15").status_code == 201


def test_today_and_future_effective_dates_allowed(client, world):
    assert post_terms(client, "adminuser", world.emp.id, effective="2030-06-12").status_code == 201
    assert post_terms(client, "adminuser", world.emp.id, effective="2031-01-01").status_code == 201


def test_rolls_back_when_audit_fails(client, world, db, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr("services.work_terms_service.record_audit", boom)
    safe = TestClient(app, raise_server_exceptions=False)
    r = post_terms(safe, "adminuser", world.emp.id)
    assert r.status_code == 500
    db.expire_all()
    assert db.query(EmployeeWorkTerms).filter_by(employee_id=world.emp.id).count() == 1
    assert db.query(AuditLog).filter_by(action="work_terms.create").count() == 0


def test_scheduling_requires_terms_effective_on_start(client, world, db):
    newbie = make_user(db, "newbie", "employee")
    link_employee(db, newbie, world.manager)
    body = {"employee_id": newbie.id, "start_date": "2030-06-20", "planned_end_date": "2030-06-30"}
    url = f"{API}/milestones/{world.milestone.id}/assignments"
    assert client.post(url, json=body, headers=login_headers(client, "mgr")).status_code == 409
    make_terms(db, newbie, effective_from=date(2030, 6, 20))
    assert client.post(url, json=body, headers=login_headers(client, "mgr")).status_code == 201
    # Terms that begin after the requested start are not enough.
    other = make_user(db, "late", "employee")
    link_employee(db, other, world.manager)
    make_terms(db, other, effective_from=date(2030, 6, 25))
    body["employee_id"] = other.id
    assert client.post(url, json=body, headers=login_headers(client, "mgr")).status_code == 409

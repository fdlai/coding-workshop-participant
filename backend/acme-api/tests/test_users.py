"""Tests for user administration, permissions, profile updates, and auditing."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
from models.audit_log import AuditLog
from models.user import EmployeeManager, User
from tests.conftest import PASSWORD, TestingSessionLocal, login_headers, make_user


NEW_USER = {
    "username": "New.Person",
    "email": "New.Person@Example.com",
    "first_name": "New",
    "last_name": "Person",
    "password": "StrongPass123!",
    "role": "employee",
}


def _admin_headers(client):
    return login_headers(client, "adminuser")


def test_admin_creates_user_and_audits_without_secrets(client, db):
    response = client.post("/api/v1/users", json=NEW_USER, headers=_admin_headers(client))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["username"] == "new.person"
    assert body["email"] == "new.person@example.com"
    assert "password" not in body and "password_hash" not in body

    logs = db.query(AuditLog).filter(AuditLog.action == "user.create").all()
    assert len(logs) == 1
    assert logs[0].entity_id == body["id"]
    assert "StrongPass123!" not in str(logs[0].changes)
    assert "password" not in str(logs[0].changes).lower()


def test_user_creation_is_atomic_with_audit(client, db):
    headers = _admin_headers(client)
    with patch("services.user_service.record_audit", side_effect=RuntimeError("boom")):
        failing = TestClient(app, raise_server_exceptions=False)
        response = failing.post("/api/v1/users", json=NEW_USER, headers=headers)

    assert response.status_code == 500
    db.expire_all()
    assert db.query(User).filter(User.username == "new.person").count() == 0


def test_non_admins_cannot_administer_users(client, db):
    manager = make_user(db, "mgr", "manager")
    employee = make_user(db, "emp", "employee")
    for username in ("mgr", "emp"):
        headers = login_headers(client, username)
        assert client.get("/api/v1/users", headers=headers).status_code == 403
        assert client.post("/api/v1/users", json=NEW_USER, headers=headers).status_code == 403
        target = employee.id if username == "mgr" else manager.id
        assert (
            client.patch(f"/api/v1/users/{target}", json={"job_title": "x"}, headers=headers).status_code
            == 403
        )
        assert (
            client.patch(f"/api/v1/users/{target}/role", json={"role": "admin"}, headers=headers).status_code
            == 403
        )
        assert (
            client.patch(f"/api/v1/users/{target}/status", json={"is_active": False}, headers=headers).status_code
            == 403
        )
        assert (
            client.post(
                f"/api/v1/users/{target}/reset-password",
                json={"new_password": "AnotherPass123!"},
                headers=headers,
            ).status_code
            == 403
        )


def test_unauthenticated_requests_are_rejected(client):
    assert client.get("/api/v1/users").status_code == 401
    assert client.post("/api/v1/users", json=NEW_USER).status_code == 401


def test_username_and_email_must_be_unique(client, db):
    headers = _admin_headers(client)
    assert client.post("/api/v1/users", json=NEW_USER, headers=headers).status_code == 201

    same_username = {**NEW_USER, "username": "NEW.PERSON", "email": "other@example.com"}
    assert client.post("/api/v1/users", json=same_username, headers=headers).status_code == 409

    same_email = {**NEW_USER, "username": "another.one", "email": "NEW.PERSON@example.com"}
    assert client.post("/api/v1/users", json=same_email, headers=headers).status_code == 409

    other = make_user(db, "other", "employee")
    response = client.patch(
        f"/api/v1/users/{other.id}", json={"email": "new.person@example.com"}, headers=headers
    )
    assert response.status_code == 409


def test_invalid_input_is_rejected(client):
    headers = _admin_headers(client)
    assert client.post("/api/v1/users", json={**NEW_USER, "role": "superuser"}, headers=headers).status_code == 422
    assert client.post("/api/v1/users", json={**NEW_USER, "username": "bad name!"}, headers=headers).status_code == 422
    assert client.post("/api/v1/users", json={**NEW_USER, "password": "short"}, headers=headers).status_code == 422
    assert (
        client.post(
            "/api/v1/users",
            json={**NEW_USER, "profile_picture_url": "javascript:alert(1)"},
            headers=headers,
        ).status_code
        == 422
    )


def test_admin_can_create_another_admin(client):
    response = client.post(
        "/api/v1/users", json={**NEW_USER, "role": "admin"}, headers=_admin_headers(client)
    )
    assert response.status_code == 201
    assert response.json()["role"] == "admin"


def test_admin_updates_profile_and_audits_before_after(client, db):
    target = make_user(db, "target", "employee")
    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"job_title": "Engineer", "first_name": "Renamed"},
        headers=_admin_headers(client),
    )
    assert response.status_code == 200
    assert response.json()["job_title"] == "Engineer"

    log = db.query(AuditLog).filter(AuditLog.action == "user.update").one()
    assert log.changes["after"] == {"job_title": "Engineer", "first_name": "Renamed"}
    assert log.changes["before"]["job_title"] is None


def test_role_change_is_audited_and_validated(client, db):
    target = make_user(db, "target", "employee")
    headers = _admin_headers(client)

    assert client.patch(f"/api/v1/users/{target.id}/role", json={"role": "bogus"}, headers=headers).status_code == 422
    response = client.patch(f"/api/v1/users/{target.id}/role", json={"role": "manager"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["role"] == "manager"

    log = db.query(AuditLog).filter(AuditLog.action == "user.role_change").one()
    assert log.changes == {"before": {"role": "employee"}, "after": {"role": "manager"}}


def test_role_change_blocked_while_relationships_exist(client, db):
    manager = make_user(db, "mgr", "manager")
    employee = make_user(db, "emp", "employee")
    db.add(EmployeeManager(employee_id=employee.id, manager_id=manager.id))
    db.commit()
    headers = _admin_headers(client)

    assert client.patch(f"/api/v1/users/{employee.id}/role", json={"role": "manager"}, headers=headers).status_code == 409
    assert client.patch(f"/api/v1/users/{manager.id}/role", json={"role": "employee"}, headers=headers).status_code == 409


def test_admin_cannot_demote_or_deactivate_self(client, db):
    admin = db.query(User).filter(User.username == "adminuser").one()
    headers = _admin_headers(client)
    assert client.patch(f"/api/v1/users/{admin.id}/role", json={"role": "employee"}, headers=headers).status_code == 400
    assert client.patch(f"/api/v1/users/{admin.id}/status", json={"is_active": False}, headers=headers).status_code == 400


def test_deactivation_blocks_login_and_existing_tokens(client, db):
    target = make_user(db, "target", "employee")
    target_headers = login_headers(client, "target")
    response = client.patch(
        f"/api/v1/users/{target.id}/status", json={"is_active": False}, headers=_admin_headers(client)
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    assert client.get("/api/v1/auth/me", headers=target_headers).status_code == 401
    login = client.post("/api/v1/auth/login", json={"username": "target", "password": PASSWORD})
    assert login.status_code == 401
    assert db.query(AuditLog).filter(AuditLog.action == "user.deactivate").count() == 1

    client.patch(f"/api/v1/users/{target.id}/status", json={"is_active": True}, headers=_admin_headers(client))
    assert db.query(AuditLog).filter(AuditLog.action == "user.activate").count() == 1
    assert client.get("/api/v1/auth/me", headers=target_headers).status_code == 200


def test_admin_password_reset(client, db):
    target = make_user(db, "target", "employee")
    response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        json={"new_password": "BrandNewPass123!"},
        headers=_admin_headers(client),
    )
    assert response.status_code == 204

    old = client.post("/api/v1/auth/login", json={"username": "target", "password": PASSWORD})
    new = client.post("/api/v1/auth/login", json={"username": "target", "password": "BrandNewPass123!"})
    assert old.status_code == 401
    assert new.status_code == 200
    log = db.query(AuditLog).filter(AuditLog.action == "user.password_reset").one()
    assert log.changes is None
    assert "BrandNewPass123!" not in (log.description or "")


def test_self_profile_update_only_permitted_fields(client, db):
    make_user(db, "emp", "employee", job_title="Dev")
    headers = login_headers(client, "emp")

    response = client.patch(
        "/api/v1/users/me",
        json={"first_name": "Em", "job_title": "Senior Dev", "profile_picture_url": "https://example.com/a.png"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["job_title"] == "Senior Dev"
    assert response.json()["first_name"] == "Em"

    for forbidden in ({"role": "admin"}, {"is_active": False}, {"email": "x@example.com"}, {"username": "z"}):
        assert client.patch("/api/v1/users/me", json=forbidden, headers=headers).status_code == 422
    assert client.patch("/api/v1/users/me", json={"first_name": None}, headers=headers).status_code == 422

    me = client.get("/api/v1/users/me", headers=headers).json()
    assert me["role"] == "employee" and me["is_active"] is True
    assert "password_hash" not in me


def test_user_visibility_rules(client, db):
    manager = make_user(db, "mgr", "manager")
    other_manager = make_user(db, "mgr2", "manager")
    employee = make_user(db, "emp", "employee")
    stranger = make_user(db, "stranger", "employee")
    db.add(EmployeeManager(employee_id=employee.id, manager_id=manager.id))
    db.commit()

    mgr_headers = login_headers(client, "mgr")
    summary = client.get(f"/api/v1/users/{employee.id}", headers=mgr_headers)
    assert summary.status_code == 200
    assert "email" not in summary.json() and "password_hash" not in summary.json()
    assert client.get(f"/api/v1/users/{stranger.id}", headers=mgr_headers).status_code == 403

    emp_headers = login_headers(client, "emp")
    assert client.get(f"/api/v1/users/{manager.id}", headers=emp_headers).status_code == 200
    assert client.get(f"/api/v1/users/{other_manager.id}", headers=emp_headers).status_code == 403
    assert client.get(f"/api/v1/users/{employee.id}", headers=emp_headers).json()["email"] == "emp@example.com"

    admin_headers = _admin_headers(client)
    assert client.get(f"/api/v1/users/{stranger.id}", headers=admin_headers).status_code == 200
    assert client.get("/api/v1/users/99999", headers=admin_headers).status_code == 404


def test_admin_lists_users_with_filters(client, db):
    make_user(db, "mgr", "manager")
    make_user(db, "emp", "employee")
    headers = _admin_headers(client)

    everyone = client.get("/api/v1/users", headers=headers).json()
    assert {u["username"] for u in everyone} == {"adminuser", "mgr", "emp"}
    assert all("password_hash" not in u for u in everyone)
    managers = client.get("/api/v1/users?role=manager", headers=headers).json()
    assert [u["username"] for u in managers] == ["mgr"]
    assert client.get("/api/v1/users?role=nope", headers=headers).status_code == 422
    assert [u["username"] for u in client.get("/api/v1/users?search=EMP", headers=headers).json()] == ["emp"]


def test_login_username_is_case_insensitive(client, db):
    make_user(db, "mixed", "employee")
    response = client.post("/api/v1/auth/login", json={"username": " MIXED ", "password": PASSWORD})
    assert response.status_code == 200


def test_sessions_are_isolated_to_test_database():
    session = TestingSessionLocal()
    assert session.bind.dialect.name == "sqlite"
    session.close()

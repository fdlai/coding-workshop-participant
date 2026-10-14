"""Tests for the incremental, idempotent demo seed utility."""

from models.audit_log import AuditLog
from models.user import EmployeeManager, User
from scripts.seed import EMPLOYEES, MANAGERS, seed_organization


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

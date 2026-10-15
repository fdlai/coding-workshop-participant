"""Tests for the db_seed maintenance action and its safeguards (SQLite only)."""

import pytest

import function
import maintenance
from models.audit_log import AuditLog
from models.user import User
from scripts.seed import EMPLOYEES, MANAGERS, SHOWCASE_EMPLOYEES, seed_organization

GOOD_PASSWORD = "Workshop-Demo-2026"
AURORA_HOST = "coding-workshop-rds-794d5d37.cluster-c7wy8oegepqp.us-east-2.rds.amazonaws.com"


@pytest.fixture
def aurora_env(monkeypatch):
    """Pretend to be the deployed Lambda so the handler's environment check passes."""
    monkeypatch.setenv("IS_LOCAL", "false")
    monkeypatch.setenv("POSTGRES_HOST", AURORA_HOST)
    monkeypatch.setenv("POSTGRES_NAME", "codingworkshop")
    monkeypatch.setattr(maintenance.settings, "POSTGRES_HOST", AURORA_HOST)
    monkeypatch.setattr(maintenance.settings, "POSTGRES_NAME", "codingworkshop")


def seed_event(**overrides):
    event = {
        "acme_maintenance_action": "db_seed",
        "confirm_target": f"codingworkshop@{AURORA_HOST}",
        "seed_demo_password": GOOD_PASSWORD,
    }
    event.update(overrides)
    return event


@pytest.fixture
def factory(db):
    """Session factory that reuses the test session without closing it."""

    class Reuse:
        def __enter__(self):
            return db

        def __exit__(self, *exc):
            return False

    return Reuse


def test_seed_is_idempotent_and_never_returns_secrets(aurora_env, factory, db):
    first = maintenance.run_seed(seed_event(), factory)
    second = maintenance.run_seed(seed_event(), factory)

    assert first["status"] == "seed_complete"
    assert first["created"]["users:manager"] == len(MANAGERS)
    assert first["created"]["users:employee"] == len(EMPLOYEES) + len(SHOWCASE_EMPLOYEES)
    assert second["created"] == {}
    assert second["skipped"]["users:employee"] == len(EMPLOYEES)
    assert first["totals"] == second["totals"]

    text = repr(first) + repr(second)
    hashes = [u.password_hash for u in db.query(User)]
    assert GOOD_PASSWORD not in text
    assert all(h not in text for h in hashes)
    assert "password" not in {k.lower() for k in first}


@pytest.mark.parametrize(
    "overrides",
    [
        {"confirm_target": "codingworkshop@somewhere-else"},
        {"confirm_target": None},
        {"seed_demo_password": "short1A"},
        {"seed_demo_password": "alllowercase1234"},
        {"seed_demo_password": "NoDigitsInThisOne"},
        {"seed_demo_password": None},
        {"surprise": "key"},
    ],
)
def test_invalid_payloads_are_rejected_before_any_write(aurora_env, factory, db, overrides):
    before = db.query(User).count()
    with pytest.raises(ValueError):
        maintenance.run_seed(seed_event(**overrides), factory)
    assert db.query(User).count() == before


def test_failure_mid_seed_rolls_back_everything(aurora_env, factory, db, monkeypatch):
    before_users = db.query(User).count()
    before_audit = db.query(AuditLog).count()

    def broken(session, password):
        seed_organization(session, password)
        raise RuntimeError("boom")

    monkeypatch.setattr(maintenance, "seed_all", broken)
    with pytest.raises(RuntimeError):
        maintenance.run_seed(seed_event(), factory)

    assert db.query(User).count() == before_users
    assert db.query(AuditLog).count() == before_audit


def test_handler_routes_direct_invocation_to_seed(aurora_env, monkeypatch):
    calls = []
    monkeypatch.setattr(maintenance, "run_seed", lambda event: calls.append(event) or {"ok": True})
    assert function.handler(seed_event(), None) == {"ok": True}
    assert len(calls) == 1


def test_handler_refuses_seed_on_wrong_database(monkeypatch):
    monkeypatch.setenv("IS_LOCAL", "false")
    monkeypatch.setenv("POSTGRES_HOST", "localhost")
    monkeypatch.setenv("POSTGRES_NAME", "acme_db")
    with pytest.raises(RuntimeError, match="Unexpected database environment"):
        function.handler(seed_event(), None)


@pytest.mark.parametrize("http_key", ["requestContext", "version", "rawPath", "headers"])
def test_http_shaped_events_never_reach_seed(aurora_env, monkeypatch, http_key):
    reached = []
    monkeypatch.setattr(maintenance, "run_seed", lambda event: reached.append(event))
    monkeypatch.setattr(function, "http_handler", lambda event, context: {"statusCode": 404})

    result = function.handler(seed_event(**{http_key: {}}), None)

    assert result == {"statusCode": 404}
    assert reached == []


def test_unknown_and_destructive_actions_are_not_maintenance_actions(aurora_env, monkeypatch):
    monkeypatch.setattr(function, "http_handler", lambda event, context: {"statusCode": 404})
    for action in ("db_reset", "db_drop"):
        assert function.handler({"acme_maintenance_action": action}, None) == {"statusCode": 404}

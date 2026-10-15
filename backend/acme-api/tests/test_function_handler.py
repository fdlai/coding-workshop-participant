"""Isolated unit tests for the Lambda entry point (``function.handler``) and other glue code.

No real database or AWS resources are touched: the HTTP path runs the FastAPI app through
Mangum against the in-memory test database, and the maintenance paths use fakes.
"""

import json
from types import SimpleNamespace

import pytest

import database
import function
import maintenance
from models.user import User
from scripts.seed import SeedReport
from tests.conftest import PASSWORD, TestingSessionLocal

AURORA_HOST = "coding-workshop-rds-794d5d37.cluster-c7wy8oegepqp.us-east-2.rds.amazonaws.com"


@pytest.fixture
def aurora_env(monkeypatch):
    """Pretend to be the deployed Lambda so the handler's environment check passes."""
    monkeypatch.setenv("IS_LOCAL", "false")
    monkeypatch.setenv("POSTGRES_HOST", AURORA_HOST)
    monkeypatch.setenv("POSTGRES_NAME", "codingworkshop")


def function_url_event(method: str, path: str, body: dict | None = None, headers: dict | None = None) -> dict:
    """Build a Lambda Function URL (payload v2.0) event."""
    all_headers = {"host": "example.lambda-url.us-east-2.on.aws", "content-type": "application/json"}
    all_headers.update(headers or {})
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": path,
        "rawQueryString": "",
        "headers": all_headers,
        "requestContext": {
            "accountId": "anonymous",
            "apiId": "example",
            "domainName": "example.lambda-url.us-east-2.on.aws",
            "domainPrefix": "example",
            "http": {
                "method": method,
                "path": path,
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
                "userAgent": "pytest",
            },
            "requestId": "req-1",
            "routeKey": "$default",
            "stage": "$default",
            "time": "12/Jun/2030:15:45:00 +0000",
            "timeEpoch": 1907675100000,
        },
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
    }


class LambdaContext:
    function_name = "acme-api"
    memory_limit_in_mb = 128
    invoked_function_arn = "arn:aws:lambda:us-east-2:000000000000:function:acme-api"
    aws_request_id = "req-1"


# --- HTTP events go to the FastAPI app via Mangum --------------------------------------


def test_http_event_reaches_fastapi_health_endpoint():
    response = function.handler(function_url_event("GET", "/api/acme-api/health"), LambdaContext())
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}


def test_http_event_login_uses_application_routes(setup_db):
    event = function_url_event(
        "POST", "/api/acme-api/api/v1/auth/login", {"username": "adminuser", "password": PASSWORD}
    )
    response = function.handler(event, LambdaContext())
    assert response["statusCode"] == 200, response["body"]
    assert "access_token" in json.loads(response["body"])


def test_http_event_for_unknown_route_is_404():
    response = function.handler(function_url_event("GET", "/api/acme-api/nope"), LambdaContext())
    assert response["statusCode"] == 404


def test_http_event_with_maintenance_key_is_still_http(aurora_env, monkeypatch):
    """A maintenance action smuggled into an HTTP request never runs maintenance code."""
    event = function_url_event("GET", "/api/acme-api/health")
    event["acme_maintenance_action"] = "db_status"
    monkeypatch.setattr(function, "engine", None)  # would explode if db_status ran
    response = function.handler(event, LambdaContext())
    assert response["statusCode"] == 200


@pytest.mark.parametrize("event", [[], "db_status", None, {"acme_maintenance_action": "db_drop"}])
def test_non_maintenance_events_are_delegated_to_mangum(monkeypatch, event):
    seen = []
    monkeypatch.setattr(function, "http_handler", lambda e, c: seen.append(e) or {"statusCode": 400})
    assert function.handler(event, None) == {"statusCode": 400}
    assert seen == [event]


# --- maintenance events ---------------------------------------------------------------


@pytest.mark.parametrize(
    "env",
    [
        {"IS_LOCAL": "true", "POSTGRES_HOST": AURORA_HOST, "POSTGRES_NAME": "codingworkshop"},
        {"IS_LOCAL": "false", "POSTGRES_HOST": "localhost", "POSTGRES_NAME": "codingworkshop"},
        {"IS_LOCAL": "false", "POSTGRES_HOST": AURORA_HOST, "POSTGRES_NAME": "acme_db"},
    ],
)
@pytest.mark.parametrize("action", ["db_status", "db_migrate", "db_seed"])
def test_maintenance_actions_refuse_unexpected_environment(monkeypatch, env, action):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(function, "engine", None)
    with pytest.raises(RuntimeError, match="Unexpected database environment"):
        function.handler({"acme_maintenance_action": action}, None)


def test_maintenance_requires_is_local_to_be_set(monkeypatch):
    monkeypatch.delenv("IS_LOCAL", raising=False)
    monkeypatch.setenv("POSTGRES_HOST", AURORA_HOST)
    monkeypatch.setenv("POSTGRES_NAME", "codingworkshop")
    with pytest.raises(RuntimeError):
        function.handler({"acme_maintenance_action": "db_status"}, None)


def test_db_migrate_upgrades_packaged_alembic_config_to_head(aurora_env, monkeypatch):
    import alembic.command

    calls = []
    monkeypatch.setattr(alembic.command, "upgrade", lambda config, target: calls.append((config, target)))

    result = function.handler({"acme_maintenance_action": "db_migrate"}, None)

    assert result == {"status": "migration_complete", "target": "head"}
    assert len(calls) == 1
    config, target = calls[0]
    assert target == "head"
    assert config.config_file_name == "/var/task/alembic.ini"
    assert config.get_main_option("script_location") == "/var/task/migrations"


class _FakeResult:
    def __init__(self, row=None, scalars=None):
        self._row = row
        self._scalars = scalars

    def one(self):
        return self._row

    def scalars(self):
        return SimpleNamespace(all=lambda: self._scalars)


class _FakeConnection:
    def __init__(self):
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if "current_database()" in sql:
            return _FakeResult(row=("codingworkshop", "public", "PostgreSQL 16.4"))
        return _FakeResult(scalars=["milestones", "projects", "users"])


def test_db_status_reports_database_and_tables_without_writing(aurora_env, monkeypatch):
    connection = _FakeConnection()
    monkeypatch.setattr(function, "engine", SimpleNamespace(connect=lambda: connection))

    result = function.handler({"acme_maintenance_action": "db_status"}, None)

    assert result == {
        "database": "codingworkshop",
        "schema": "public",
        "postgres_version": "PostgreSQL 16.4",
        "tables": ["milestones", "projects", "users"],
    }
    assert len(connection.statements) == 2
    assert all(sql.lstrip().upper().startswith("SELECT") for sql in connection.statements)


def test_db_seed_is_routed_to_maintenance(aurora_env, monkeypatch):
    monkeypatch.setattr(maintenance, "run_seed", lambda event: {"status": "seed_complete", "event": event})
    event = {"acme_maintenance_action": "db_seed"}
    assert function.handler(event, None) == {"status": "seed_complete", "event": event}


# --- maintenance.run_seed default session factory ---------------------------------------


def test_run_seed_defaults_to_application_session_factory(setup_db, monkeypatch):
    monkeypatch.setattr(maintenance.settings, "POSTGRES_HOST", "h")
    monkeypatch.setattr(maintenance.settings, "POSTGRES_NAME", "codingworkshop")
    monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal)
    report = SeedReport()
    report.add("users:manager", True)
    monkeypatch.setattr(maintenance, "seed_all", lambda db, password: report)

    result = maintenance.run_seed(
        {
            "acme_maintenance_action": "db_seed",
            "confirm_target": "codingworkshop@h",
            "seed_demo_password": "Workshop-Demo-2026",
        }
    )
    assert result["status"] == "seed_complete"
    assert result["created"] == {"users:manager": 1}
    assert result["totals"]["users"] == 1  # only the fixture admin exists


# --- database.get_db and bootstrap helpers ----------------------------------------------


def test_get_db_yields_and_closes_an_application_session(monkeypatch):
    closed = []

    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            closed.append(True)
            return False

    monkeypatch.setattr(database, "SessionLocal", FakeSession)
    generator = database.get_db()
    session = next(generator)
    assert isinstance(session, FakeSession)
    with pytest.raises(StopIteration):
        next(generator)
    assert closed == [True]


def test_application_engine_targets_configured_database_lazily():
    """Importing the app never connects; the URL is built from settings (not the test DB)."""
    assert database.database_url.drivername == "postgresql+psycopg"
    assert database.engine.url.database == database.settings.POSTGRES_NAME


def test_bootstrap_creates_first_admin(db):
    from services.bootstrap import ensure_initial_admin

    db.query(User).delete()
    db.commit()
    user = ensure_initial_admin(db, username="root", email="root@example.com", password="Password123!")
    assert user.role == "admin" and user.is_active
    assert user.password_hash != "Password123!"


def test_bootstrap_admin_script(monkeypatch, db, capsys):
    from scripts import bootstrap_admin

    monkeypatch.setattr(bootstrap_admin, "SessionLocal", TestingSessionLocal)
    monkeypatch.delenv("INITIAL_ADMIN_PASSWORD", raising=False)
    with pytest.raises(SystemExit, match="INITIAL_ADMIN_PASSWORD"):
        bootstrap_admin.main()

    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "Password123!")
    with pytest.raises(SystemExit, match="already exists"):
        bootstrap_admin.main()

    db.query(User).delete()
    db.commit()
    monkeypatch.setenv("INITIAL_ADMIN_USERNAME", "rootadmin")
    monkeypatch.setenv("INITIAL_ADMIN_EMAIL", "rootadmin@example.com")
    bootstrap_admin.main()
    assert "Created initial admin user: rootadmin" in capsys.readouterr().out

"""POST /auth/refresh: renewing a still-valid token within the maximum session length."""

from datetime import datetime, timedelta, timezone

from jose import jwt

from config import settings
from services.auth_service import create_access_token, get_jwt_secret
from tests.conftest import login_headers, make_user

REFRESH = "/api/v1/auth/refresh"


def claims(token: str) -> dict:
    return jwt.decode(token, get_jwt_secret(), algorithms=[settings.JWT_ALGORITHM])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def signed(payload: dict) -> str:
    return jwt.encode(payload, get_jwt_secret(), algorithm=settings.JWT_ALGORITHM)


def test_refresh_issues_a_new_working_token_that_keeps_the_sign_in_time(client):
    started = datetime.now(timezone.utc) - timedelta(days=2)
    old = create_access_token("adminuser", auth_time=started)

    response = client.post(REFRESH, headers=bearer(old))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    new = body["access_token"]
    assert claims(new)["sub"] == "adminuser"
    assert claims(new)["auth_time"] == int(started.timestamp())
    assert claims(new)["exp"] >= claims(old)["exp"]
    assert client.get("/api/v1/auth/me", headers=bearer(new)).json()["username"] == "adminuser"


def test_login_token_records_the_sign_in_time(client):
    before = int(datetime.now(timezone.utc).timestamp())
    token = login_headers(client, "adminuser")["Authorization"].split()[1]
    assert before - 1 <= claims(token)["auth_time"] <= before + 5


def test_refresh_requires_a_token(client):
    assert client.post(REFRESH).status_code == 401


def test_refresh_rejects_an_expired_token(client):
    expired = signed({"sub": "adminuser", "exp": datetime.now(timezone.utc) - timedelta(seconds=1)})
    response = client.post(REFRESH, headers=bearer(expired))
    assert response.status_code == 401


def test_refresh_rejects_a_tampered_token(client):
    token = create_access_token("adminuser")
    forged = jwt.encode(claims(token), "not-the-real-secret-0123456789abcdef", algorithm=settings.JWT_ALGORITHM)
    assert client.post(REFRESH, headers=bearer(forged)).status_code == 401


def test_refresh_rejects_an_inactive_user(client, db):
    make_user(db, "gone", "employee", is_active=False)
    response = client.post(REFRESH, headers=bearer(create_access_token("gone")))
    assert response.status_code == 401


def test_refresh_stops_after_the_maximum_session_length(client):
    started = datetime.now(timezone.utc) - timedelta(days=settings.MAX_SESSION_DAYS, minutes=1)
    response = client.post(REFRESH, headers=bearer(create_access_token("adminuser", auth_time=started)))
    assert response.status_code == 401
    assert response.json()["detail"] == "Session expired; please sign in again"


def test_refresh_accepts_tokens_issued_before_auth_time_existed(client):
    # Legacy tokens only have sub + exp; their session start is inferred from expiry.
    legacy = signed({
        "sub": "adminuser",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES - 60),
    })
    response = client.post(REFRESH, headers=bearer(legacy))
    assert response.status_code == 200, response.text
    inferred_start = claims(legacy)["exp"] - settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert claims(response.json()["access_token"])["auth_time"] == inferred_start

"""The TEST_DATABASE_URL guard must never let the suite run against a real database."""

import pytest

from tests.conftest import assert_safe_test_database_url


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://u:p@localhost:5432/acme_db",
        "postgresql+psycopg://u:p@localhost:5432/codingworkshop",
        "postgresql+psycopg://u:p@localhost:5432/acme_test_backup",
        "postgresql+psycopg://u:p@localhost:5432/test",
        "postgresql+psycopg://u:p@localhost:5432/",
        "sqlite:///acme_test",
    ],
)
def test_guard_rejects_non_test_databases(url):
    with pytest.raises(RuntimeError):
        assert_safe_test_database_url(url)


def test_guard_accepts_disposable_test_database():
    assert assert_safe_test_database_url("postgresql+psycopg://u:p@localhost:5432/acme_test") == "acme_test"

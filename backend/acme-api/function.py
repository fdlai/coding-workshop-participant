import os

from sqlalchemy import text
from mangum import Mangum

from database import engine
from main import app


http_handler = Mangum(app, api_gateway_base_path="/api/acme-api")


def handler(event, context):
    # Maintenance operations must be direct Lambda invocations,
    # never HTTP requests received through the public Function URL.
    if (
        isinstance(event, dict)
        and event.get("acme_maintenance_action") in ("db_status", "db_migrate")
        and "requestContext" not in event
        and "version" not in event
        and "rawPath" not in event
        and "headers" not in event
    ):
        expected_host = (
            "coding-workshop-rds-794d5d37"
            ".cluster-c7wy8oegepqp.us-east-2.rds.amazonaws.com"
        )

        if (
            os.environ.get("IS_LOCAL", "").lower() != "false"
            or os.environ.get("POSTGRES_HOST") != expected_host
            or os.environ.get("POSTGRES_NAME") != "codingworkshop"
        ):
            raise RuntimeError("Unexpected database environment")

        if event["acme_maintenance_action"] == "db_migrate":
            from alembic import command
            from alembic.config import Config

            config = Config("/var/task/alembic.ini")
            config.set_main_option("script_location", "/var/task/migrations")

            command.upgrade(config, "fc63aed03b16")

            return {
                "status": "migration_complete",
                "revision": "fc63aed03b16",
            }

        with engine.connect() as connection:
            result = connection.execute(
                text("SELECT current_database(), current_schema(), version()")
            ).one()

            tables = (
                connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema = current_schema() "
                        "ORDER BY table_name"
                    )
                )
                .scalars()
                .all()
            )

        return {
            "database": result[0],
            "schema": result[1],
            "postgres_version": result[2],
            "tables": list(tables),
        }

    return http_handler(event, context)

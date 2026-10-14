"""Audit-log listing and dashboard summaries (Phase 5 backend support).

Frozen "today" is Wed 2030-06-12. Both linked employees cost $320 per weekday.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

from models.assignment import MilestoneAssignment
from models.audit_log import AuditLog
from tests.conftest import login_headers, make_milestone, make_project

API = "/api/v1"


def add_audit(db, actor, action, entity_type, when, description="x"):
    db.add(
        AuditLog(
            actor_id=actor.id, action=action, entity_type=entity_type, entity_id=1,
            description=description, created_at=when,
        )
    )
    db.commit()


def add_assignment(db, milestone, employee, start, end):
    db.add(MilestoneAssignment(milestone_id=milestone.id, employee_id=employee.id, start_date=start, planned_end_date=end))
    db.commit()


# ---- audit logs -------------------------------------------------------------

def test_audit_logs_admin_only(client, world):
    url = f"{API}/audit-logs"
    assert client.get(url, headers=login_headers(client, "adminuser")).status_code == 200
    for who in ("mgr", "emp"):
        assert client.get(url, headers=login_headers(client, who)).status_code == 403
    assert client.get(url).status_code in (401, 403)


def test_audit_logs_pagination_newest_first_and_filters(client, world, db):
    for day in range(1, 6):
        add_audit(db, world.admin, "project.create" if day % 2 else "user.update",
                  "project" if day % 2 else "user", datetime(2030, 6, day, 12, tzinfo=timezone.utc))
    h = login_headers(client, "adminuser")
    page = client.get(f"{API}/audit-logs?limit=2", headers=h).json()
    assert page["total"] == 5 and len(page["items"]) == 2
    assert page["items"][0]["created_at"] > page["items"][1]["created_at"]
    assert page["items"][0]["actor"]["username"] == "adminuser"
    assert "password_hash" not in str(page)
    second = client.get(f"{API}/audit-logs?limit=2&offset=2", headers=h).json()
    assert {i["id"] for i in page["items"]}.isdisjoint({i["id"] for i in second["items"]})

    by_action = client.get(f"{API}/audit-logs?action=user.update", headers=h).json()
    assert by_action["total"] == 2
    by_entity = client.get(f"{API}/audit-logs?entity_type=project", headers=h).json()
    assert by_entity["total"] == 3
    ranged = client.get(f"{API}/audit-logs?since=2030-06-02&until=2030-06-03", headers=h).json()
    assert ranged["total"] == 2
    assert set(page["available_actions"]) == {"project.create", "user.update"}
    assert client.get(f"{API}/audit-logs?limit=1000", headers=h).status_code == 422


# ---- dashboards ---------------------------------------------------------------

def test_dashboards_are_role_scoped(client, world):
    for path, allowed in (("admin", "adminuser"), ("manager", "mgr"), ("employee", "emp")):
        for who in ("adminuser", "mgr", "emp"):
            r = client.get(f"{API}/dashboard/{path}", headers=login_headers(client, who))
            assert r.status_code == (200 if who == allowed else 403), (path, who)


def test_admin_dashboard_counts_health_and_activity(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))  # $2,560
    world.project.estimated_budget = Decimal("3000")  # 85% -> at risk
    db.commit()
    other = make_project(db, world.other_manager, world.admin, name="Beta", estimated_budget=Decimal("1000"))
    make_milestone(db, other, date(2030, 6, 1), date(2030, 6, 30))
    add_audit(db, world.admin, "project.create", "project", datetime(2030, 6, 12, tzinfo=timezone.utc))
    body = client.get(f"{API}/dashboard/admin", headers=login_headers(client, "adminuser")).json()
    assert body["active_projects"] == 2
    assert body["employees"] == 3 and body["managers"] == 2
    assert body["health_counts"] == {"on_track": 1, "at_risk": 1, "over_budget": 0}
    assert body["projects_at_risk"] == 1
    alpha = next(p for p in body["projects"] if p["name"] == "Alpha")
    assert Decimal(alpha["total_expected_cost"]) == 2560 and alpha["health"] == "at_risk"
    assert alpha["assigned_employee_count"] == 1 and alpha["milestones_total"] == 2
    assert alpha["manager"]["username"] == "mgr"
    assert body["recent_activity"][0]["action"] == "project.create"


def test_admin_dashboard_excludes_archived_and_finished_projects(client, world, db):
    make_project(db, world.manager, world.admin, name="Done", status="completed")
    make_project(db, world.manager, world.admin, name="Old", is_archived=True)
    body = client.get(f"{API}/dashboard/admin", headers=login_headers(client, "adminuser")).json()
    assert [p["name"] for p in body["projects"]] == ["Alpha"]


def test_manager_dashboard_scoped_to_own_team_and_projects(client, world, db):
    other = make_project(db, world.other_manager, world.admin, name="Beta")
    make_milestone(db, other, date(2030, 6, 1), date(2030, 6, 30), name="Other milestone")
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    body = client.get(f"{API}/dashboard/manager", headers=login_headers(client, "mgr")).json()
    assert [p["name"] for p in body["projects"]] == ["Alpha"]
    assert body["team_size"] == 2 and body["employees_scheduled_now"] == 1
    assert [u["username"] for u in body["unscheduled_team_members"]] == ["emp2"]
    names = [m["name"] for m in body["upcoming_milestones"]]
    assert names == ["M1", "M2"] and "Other milestone" not in names
    assert body["upcoming_milestones"][0]["days_remaining"] == (date(2030, 8, 31) - date(2030, 6, 12)).days


def test_employee_dashboard_has_assignments_and_no_budget_data(client, world, db):
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 10), date(2030, 6, 19))
    add_assignment(db, world.milestone, world.emp, date(2030, 6, 20), date(2030, 6, 25))
    r = client.get(f"{API}/dashboard/employee", headers=login_headers(client, "emp"))
    body = r.json()
    assert len(body["current_assignments"]) == 1 and len(body["upcoming_assignments"]) == 1
    assert body["current_assignments"][0]["project_name"] == "Alpha"
    assert [m["username"] for m in body["managers"]] == ["mgr"]
    text = r.text.lower()
    assert "budget" not in text and "cost" not in text

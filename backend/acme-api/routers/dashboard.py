"""Dashboard summary endpoints (one per role)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.dashboard import AdminDashboard, EmployeeDashboard, ManagerDashboard
from services import dashboard_service
from services.auth_service import require_roles


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/admin", response_model=AdminDashboard)
def get_admin_dashboard(
    _admin: User = Depends(require_roles("admin")), db: Session = Depends(get_db)
) -> AdminDashboard:
    """Organization-wide summary (administrators only)."""
    return dashboard_service.admin_dashboard(db)


@router.get("/manager", response_model=ManagerDashboard)
def get_manager_dashboard(
    manager: User = Depends(require_roles("manager")), db: Session = Depends(get_db)
) -> ManagerDashboard:
    """The calling manager's projects and team (managers only)."""
    return dashboard_service.manager_dashboard(db, manager)


@router.get("/employee", response_model=EmployeeDashboard)
def get_employee_dashboard(
    employee: User = Depends(require_roles("employee")), db: Session = Depends(get_db)
) -> EmployeeDashboard:
    """The calling employee's assignments (employees only)."""
    return dashboard_service.employee_dashboard(db, employee)

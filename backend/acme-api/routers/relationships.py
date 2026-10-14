"""Employee-manager relationship endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.relationship import EmployeeAssignRequest, RelationshipRemovalResult
from schemas.user import UserSummary
from services import relationship_service as rel
from services.auth_service import get_current_user, require_roles


router = APIRouter(tags=["relationships"])

require_admin = require_roles("admin")


@router.get("/managers/{manager_id}/employees", response_model=list[UserSummary])
def list_manager_employees(
    manager_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[User]:
    """List a manager's employees (administrators, or the manager themselves)."""
    if current_user.role != "admin" and not (
        current_user.role == "manager" and current_user.id == manager_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    rel.get_manager_or_404(db, manager_id)
    return rel.list_employees_of(db, manager_id)


@router.get("/employees/{employee_id}/managers", response_model=list[UserSummary])
def list_employee_managers(
    employee_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[User]:
    """List an employee's managers (administrators, or the employee themselves)."""
    if current_user.role != "admin" and not (
        current_user.role == "employee" and current_user.id == employee_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    rel.get_employee_or_404(db, employee_id)
    return rel.list_managers_of(db, employee_id)


@router.post(
    "/managers/{manager_id}/employees",
    response_model=UserSummary,
    status_code=status.HTTP_201_CREATED,
)
def assign_employee(
    manager_id: int,
    payload: EmployeeAssignRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    """Assign an employee to a manager (administrators only)."""
    return rel.assign_employee(db, admin, manager_id, payload.employee_id)


@router.delete(
    "/managers/{manager_id}/employees/{employee_id}",
    response_model=RelationshipRemovalResult,
)
def remove_employee(
    manager_id: int,
    employee_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RelationshipRemovalResult:
    """Remove an employee from a manager, ending affected assignments atomically."""
    ended = rel.remove_employee(db, admin, manager_id, employee_id)
    return RelationshipRemovalResult(
        manager_id=manager_id, employee_id=employee_id, ended_assignment_ids=ended
    )

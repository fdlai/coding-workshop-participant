"""Administrator-only compensation endpoints."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.work_terms import WorkTermsCreate, WorkTermsOut
from services import work_terms_service
from services.auth_service import require_roles


router = APIRouter(prefix="/employees", tags=["compensation"])

require_admin = require_roles("admin")


@router.get("/{employee_id}/work-terms", response_model=list[WorkTermsOut])
def list_work_terms(
    employee_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[WorkTermsOut]:
    """Return an employee's compensation history (administrators only)."""
    return work_terms_service.list_work_terms(db, employee_id)


@router.post(
    "/{employee_id}/work-terms", response_model=WorkTermsOut, status_code=status.HTTP_201_CREATED
)
def create_work_terms(
    employee_id: int,
    payload: WorkTermsCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> WorkTermsOut:
    """Append a new effective-dated compensation record (administrators only)."""
    return work_terms_service.create_work_terms(db, admin, employee_id, payload)

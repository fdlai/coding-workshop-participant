"""Project and project-scoped milestone endpoints."""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from database import get_db
from models.project import Project
from models.user import User
from schemas.milestone import MilestoneCreate, MilestoneOut
from schemas.project import (
    ProjectCreate,
    ProjectEmployeeOut,
    ProjectOut,
    ProjectStatus,
    ProjectStatusUpdate,
    ProjectUpdate,
)
from services import milestone_service, project_service
from services.access import ensure_can_view_project, get_project_or_404
from services.auth_service import get_current_user, require_roles


router = APIRouter(prefix="/projects", tags=["projects"])

require_admin = require_roles("admin")


def project_view(project: Project, actor: User) -> ProjectOut | ProjectEmployeeOut:
    """Return the role-appropriate project representation (employees never see budgets)."""
    if actor.role == "employee":
        return ProjectEmployeeOut.model_validate(project)
    return ProjectOut.model_validate(project)


@router.get("", response_model=list[ProjectOut] | list[ProjectEmployeeOut])
def list_projects(
    status_filter: ProjectStatus | None = Query(default=None, alias="status"),
    manager_id: int | None = None,
    include_archived: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProjectOut | ProjectEmployeeOut]:
    """List projects visible to the caller (role-filtered)."""
    projects = project_service.list_projects(
        db,
        current_user,
        status_filter=status_filter,
        manager_id=manager_id,
        include_archived=include_archived,
        limit=limit,
        offset=offset,
    )
    return [project_view(p, current_user) for p in projects]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Project:
    """Create a project (administrators only)."""
    return project_service.create_project(db, admin, payload)


@router.get("/{project_id}", response_model=ProjectOut | ProjectEmployeeOut)
def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut | ProjectEmployeeOut:
    """Return a project the caller is allowed to view."""
    project = get_project_or_404(db, project_id)
    ensure_can_view_project(db, current_user, project)
    return project_view(project, current_user)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    current_user: User = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
) -> Project:
    """Edit a project (admin, or the owning manager)."""
    return project_service.update_project(db, current_user, project_id, payload)


@router.patch("/{project_id}/status", response_model=ProjectOut)
def update_project_status(
    project_id: int,
    payload: ProjectStatusUpdate,
    current_user: User = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
) -> Project:
    """Change project status (admin, or the owning manager)."""
    project, _ = project_service.set_status(db, current_user, project_id, payload.status)
    return project


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(
    project_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Project:
    """Archive a project (administrators only)."""
    return project_service.set_archived(db, admin, project_id, True)


@router.post("/{project_id}/restore", response_model=ProjectOut)
def restore_project(
    project_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Project:
    """Restore an archived project (administrators only)."""
    return project_service.set_archived(db, admin, project_id, False)


@router.get("/{project_id}/milestones", response_model=list[MilestoneOut])
def list_project_milestones(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list:
    """List a project's milestones for any user who may view the project."""
    project = get_project_or_404(db, project_id)
    ensure_can_view_project(db, current_user, project)
    return milestone_service.list_milestones(db, project_id)


@router.post(
    "/{project_id}/milestones", response_model=MilestoneOut, status_code=status.HTTP_201_CREATED
)
def create_project_milestone(
    project_id: int,
    payload: MilestoneCreate,
    current_user: User = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
):
    """Create a milestone (admin, or the owning manager)."""
    return milestone_service.create_milestone(db, current_user, project_id, payload)

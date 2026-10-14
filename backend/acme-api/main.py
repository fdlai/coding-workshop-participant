from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers.assignments import router as assignments_router
from routers.auth import router as auth_router
from routers.milestones import router as milestones_router
from routers.projects import router as projects_router
from routers.relationships import router as relationships_router
from routers.users import router as users_router
from routers.work_terms import router as work_terms_router


app = FastAPI(title="ACME Resource Management API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Return the health status for the service."""
    return {"status": "ok"}


app.include_router(auth_router, prefix="/api/v1")
# auth_router must stay first so /users/me is matched before /users/{user_id}.
app.include_router(users_router, prefix="/api/v1")
app.include_router(relationships_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(milestones_router, prefix="/api/v1")
app.include_router(assignments_router, prefix="/api/v1")
app.include_router(work_terms_router, prefix="/api/v1")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers.auth import router as auth_router
from routers.relationships import router as relationships_router
from routers.users import router as users_router


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

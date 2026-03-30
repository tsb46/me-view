"""FastAPI application entrypoint for the me-view backend."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from me_view.api.health import router as health_router
from me_view.api.plots import router as plots_router
from me_view.api.sessions import router as sessions_router
from me_view.config import settings

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(sessions_router, prefix="/api")
app.include_router(plots_router, prefix="/api")

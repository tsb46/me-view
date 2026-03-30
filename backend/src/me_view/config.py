"""Application settings and filesystem locations for ephemeral session data."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """Configuration values shared across backend services."""

    app_name: str = "me-view"
    session_root: Path = Path(__file__).resolve().parents[3] / "backend" / ".data" / "sessions"


settings = Settings()

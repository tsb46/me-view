"""Shared response and request primitives used by API transport models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class SessionStatus(StrEnum):
    UPLOADING = "uploading"
    NEEDS_REVIEW = "needs_review"
    READY = "ready"
    ERROR = "error"
    EXPIRED = "expired"


class DatasetKind(StrEnum):
    MULTI_ECHO_BOLD = "multi_echo_bold"


class DatasetState(StrEnum):
    DRAFT = "draft"
    READY = "ready"
    INVALID = "invalid"


class IssueSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class ReviewActionType(StrEnum):
    CONFIRM_ECHO_ORDER = "confirm_echo_order"


class Issue(BaseModel):
    code: str
    severity: IssueSeverity
    message: str
    details: dict[str, object] | None = None


class ViewerDefaults(BaseModel):
    dataset_id: str
    layout: str = "single"
    active_echo_id: str | None = None
    active_timepoint: int = 0
    compare_echo_ids: list[str] = Field(default_factory=list)
    colormap: str | None = None
    crosshair: bool = True


class VoxelCoordinate(BaseModel):
    ijk: tuple[int, int, int]
    mm: tuple[float, float, float] | None = None


class PlotAxisMeta(BaseModel):
    key: str
    label: str
    unit: str | None = None


class TimestampedModel(BaseModel):
    created_at: datetime

"""Session, manifest, and plot transport models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from me_view.models.common import (
    DatasetKind,
    DatasetState,
    Issue,
    PlotAxisMeta,
    ReviewActionType,
    SessionStatus,
    ViewerDefaults,
    VoxelCoordinate,
)


class AssetCandidate(BaseModel):
    asset_id: str
    filename: str


class ReviewAction(BaseModel):
    action_type: ReviewActionType
    dataset_id: str
    message: str | None = None
    echo_candidates: list[AssetCandidate] = Field(default_factory=list)


class ReviewState(BaseModel):
    required_actions: list[ReviewAction] = Field(default_factory=list)


class EchoManifest(BaseModel):
    echo_id: str
    echo_index: int | None = None
    echo_time_ms: float | None = None
    display_name: str
    asset_id: str
    filename: str
    content_type: str | None = None
    frame_count: int
    volume_url: str
    issues: list[Issue] = Field(default_factory=list)


class SurfaceManifest(BaseModel):
    surface_id: str
    hemisphere: str | None = None
    kind: str
    mesh_url: str | None = None


class OverlayManifest(BaseModel):
    overlay_id: str
    kind: str
    source_url: str | None = None


class DatasetManifest(BaseModel):
    dataset_id: str
    label: str
    kind: DatasetKind = DatasetKind.MULTI_ECHO_BOLD
    state: DatasetState
    spatial_shape: tuple[int, int, int]
    timepoints: int
    voxel_size_mm: tuple[float, float, float]
    tr_ms: float | None = None
    affine: list[list[float]] | None = None
    echoes: list[EchoManifest] = Field(default_factory=list)
    surfaces: list[SurfaceManifest] = Field(default_factory=list)
    overlays: list[OverlayManifest] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_affine(self) -> DatasetManifest:
        if self.affine is not None and (
            len(self.affine) != 4 or any(len(row) != 4 for row in self.affine)
        ):
            raise ValueError("Affine matrices must be 4x4")
        return self


class SessionResponse(BaseModel):
    session_id: str
    status: SessionStatus
    created_at: datetime
    expires_at: datetime | None = None
    datasets: list[DatasetManifest] = Field(default_factory=list)
    review: ReviewState | None = None
    viewer_defaults: ViewerDefaults | None = None
    errors: list[Issue] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)


class CreateSessionMetadata(BaseModel):
    client_session_label: str | None = None
    allow_multiple_datasets: bool = False
    infer_echo_order: bool = True
    infer_echo_time_from_filename: bool = True


class FinalizeEchoDecision(BaseModel):
    asset_id: str
    echo_index: int
    echo_time_ms: float | None = None


class FinalizeDatasetDecision(BaseModel):
    dataset_id: str
    echo_order: list[FinalizeEchoDecision]

    @model_validator(mode="after")
    def validate_echo_indices(self) -> FinalizeDatasetDecision:
        indices = [decision.echo_index for decision in self.echo_order]
        if len(indices) != len(set(indices)):
            raise ValueError("Echo indices must be unique within a dataset finalization request")
        if sorted(indices) != list(range(1, len(indices) + 1)):
            raise ValueError(
                "Echo indices must form a contiguous sequence starting at 1 within a dataset finalization request"
            )
        return self


class ViewerDefaultsInput(BaseModel):
    dataset_id: str
    layout: str = "single"
    active_echo_id: str | None = None
    active_timepoint: int = 0
    compare_echo_ids: list[str] = Field(default_factory=list)
    colormap: str | None = None
    crosshair: bool = True


class FinalizeSessionRequest(BaseModel):
    datasets: list[FinalizeDatasetDecision]
    viewer_defaults: ViewerDefaultsInput


class EchoCurvePoint(BaseModel):
    echo_id: str
    echo_index: int | None = None
    echo_time_ms: float | None = None
    value: float | None = None
    is_active: bool


class EchoCurveResponse(BaseModel):
    session_id: str
    dataset_id: str
    dataset_label: str
    voxel: VoxelCoordinate
    selected_timepoint: int
    active_echo_id: str | None = None
    x_axis: PlotAxisMeta
    y_axis: PlotAxisMeta
    echoes: list[EchoCurvePoint] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)


class EchoSeriesMeta(BaseModel):
    echo_id: str
    echo_index: int | None = None
    echo_time_ms: float | None = None
    display_name: str | None = None


class TimeCoursePoint(BaseModel):
    timepoint: int
    time_ms: float | None = None
    value: float | None = None
    is_selected: bool = False


class TimeCourseResponse(BaseModel):
    session_id: str
    dataset_id: str
    dataset_label: str
    voxel: VoxelCoordinate
    echo: EchoSeriesMeta
    selected_timepoint: int | None = None
    x_axis: PlotAxisMeta
    y_axis: PlotAxisMeta
    tr_ms: float | None = None
    series: list[TimeCoursePoint] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)


class PlotContextResponse(BaseModel):
    session_id: str
    dataset_id: str
    voxel: VoxelCoordinate
    timepoint: int
    echo: EchoSeriesMeta
    value: float | None = None
    frame_count: int
    asset_id: str
    issues: list[Issue] = Field(default_factory=list)

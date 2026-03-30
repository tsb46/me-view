"""Session ingestion, manifest construction, and plot-oriented asset lookup."""

from __future__ import annotations

import json
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeVar, cast

import nibabel as nib
import numpy as np
from fastapi import HTTPException, UploadFile, status
from pydantic import BaseModel, ValidationError

from me_view.config import settings
from me_view.models.common import (
    DatasetState,
    Issue,
    IssueSeverity,
    PlotAxisMeta,
    ReviewActionType,
    SessionStatus,
    ViewerDefaults,
    VoxelCoordinate,
)
from me_view.models.session import (
    AssetCandidate,
    CreateSessionMetadata,
    DatasetManifest,
    EchoCurvePoint,
    EchoCurveResponse,
    EchoManifest,
    EchoSeriesMeta,
    FinalizeDatasetDecision,
    FinalizeSessionRequest,
    PlotContextResponse,
    ReviewAction,
    ReviewState,
    SessionResponse,
    TimeCoursePoint,
    TimeCourseResponse,
)

ECHO_PATTERN = re.compile(r"echo[-_]?0*(\d+)", re.IGNORECASE)
TIME_PATTERN = re.compile(r"te[-_]?([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
MODEL_T = TypeVar("MODEL_T", bound=BaseModel)


@dataclass
class SessionRecord:
    manifest: SessionResponse
    session_dir: Path
    asset_paths: dict[str, Path]


class SessionService:
    """Maintains ephemeral session manifests and resolves active assets for requests."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}
        settings.session_root.mkdir(parents=True, exist_ok=True)

    async def create_session(
        self, metadata_json: str | None, files: list[UploadFile]
    ) -> SessionResponse:
        if not files:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No files uploaded"
            )

        self._parse_metadata(metadata_json)
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        created_at = datetime.now(UTC)
        session_dir = settings.session_root / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        datasets_by_key: dict[str, list[dict[str, object]]] = {}
        asset_paths: dict[str, Path] = {}
        errors: list[Issue] = []

        for file in files:
            file_path = session_dir / file.filename
            with file_path.open("wb") as output_handle:
                shutil.copyfileobj(file.file, output_handle)

            if not self._is_nifti(file.filename):
                errors.append(
                    Issue(
                        code="UNSUPPORTED_FILE_TYPE",
                        severity=IssueSeverity.ERROR,
                        message=f"Unsupported file type: {file.filename}",
                    )
                )
                continue

            asset_id = f"asset_{uuid.uuid4().hex[:10]}"
            asset_paths[asset_id] = file_path
            dataset_key = self._dataset_key(file.filename)
            dataset_info = self._read_nifti_metadata(file_path)
            datasets_by_key.setdefault(dataset_key, []).append(
                {
                    "asset_id": asset_id,
                    "file_path": file_path,
                    "filename": file.filename,
                    "content_type": file.content_type,
                    **dataset_info,
                }
            )

        datasets: list[DatasetManifest] = []
        review_actions: list[ReviewAction] = []
        warnings: list[Issue] = []
        status_value = SessionStatus.READY

        for dataset_key, entries in datasets_by_key.items():
            dataset_manifest, dataset_review, dataset_warnings = self._build_dataset_manifest(
                session_id, dataset_key, entries
            )
            datasets.append(dataset_manifest)
            review_actions.extend(dataset_review)
            warnings.extend(dataset_warnings)

        if errors:
            status_value = SessionStatus.ERROR
        elif review_actions:
            status_value = SessionStatus.NEEDS_REVIEW

        viewer_defaults = self._default_viewer_defaults(datasets)
        manifest = SessionResponse(
            session_id=session_id,
            status=status_value,
            created_at=created_at,
            datasets=datasets,
            review=ReviewState(required_actions=review_actions) if review_actions else None,
            viewer_defaults=viewer_defaults if status_value == SessionStatus.READY else None,
            errors=errors,
            warnings=warnings,
        )
        self._sessions[session_id] = SessionRecord(
            manifest=manifest, session_dir=session_dir, asset_paths=asset_paths
        )
        return manifest

    def get_session(self, session_id: str) -> SessionResponse:
        return self._get_record(session_id).manifest

    def delete_session(self, session_id: str) -> None:
        record = self._get_record(session_id)
        shutil.rmtree(record.session_dir, ignore_errors=True)
        del self._sessions[session_id]

    def finalize_session(self, session_id: str, request: FinalizeSessionRequest) -> SessionResponse:
        record = self._get_record(session_id)
        dataset_map = {dataset.dataset_id: dataset for dataset in record.manifest.datasets}

        for decision in request.datasets:
            if decision.dataset_id not in dataset_map:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found in session"
                )
            self._apply_finalize_decision(session_id, dataset_map[decision.dataset_id], decision)

        record.manifest.status = SessionStatus.READY
        record.manifest.review = None
        record.manifest.viewer_defaults = ViewerDefaults(**request.viewer_defaults.model_dump())
        return record.manifest

    def asset_path(self, session_id: str, asset_id: str) -> Path:
        record = self._get_record(session_id)
        path = record.asset_paths.get(asset_id)
        if path is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
        return path

    def build_echo_curve(
        self,
        session_id: str,
        dataset_id: str,
        x: int,
        y: int,
        z: int,
        timepoint: int,
    ) -> EchoCurveResponse:
        dataset = self._get_dataset(session_id, dataset_id)
        self._ensure_ready(session_id, dataset)
        voxel = self._build_voxel_coordinate(dataset.affine, (x, y, z))

        points: list[EchoCurvePoint] = []
        record = self._get_record(session_id)
        for echo in dataset.echoes:
            dataobj = nib.load(str(self.asset_path(session_id, echo.asset_id))).dataobj
            self._validate_voxel(dataobj.shape, x, y, z, timepoint=timepoint)
            value = float(dataobj[x, y, z, timepoint])
            points.append(
                EchoCurvePoint(
                    echo_id=echo.echo_id,
                    echo_index=echo.echo_index,
                    echo_time_ms=echo.echo_time_ms,
                    value=value,
                    is_active=(
                        echo.echo_id == record.manifest.viewer_defaults.active_echo_id
                        if record.manifest.viewer_defaults
                        else False
                    ),
                )
            )

        active_echo_id = (
            self._get_record(session_id).manifest.viewer_defaults.active_echo_id
            if self._get_record(session_id).manifest.viewer_defaults
            else None
        )
        return EchoCurveResponse(
            session_id=session_id,
            dataset_id=dataset.dataset_id,
            dataset_label=dataset.label,
            voxel=voxel,
            selected_timepoint=timepoint,
            active_echo_id=active_echo_id,
            x_axis=PlotAxisMeta(key="echo_time_ms", label="Echo Time", unit="ms"),
            y_axis=PlotAxisMeta(key="value", label="Signal Intensity"),
            echoes=points,
        )

    def build_time_course(
        self,
        session_id: str,
        dataset_id: str,
        echo_id: str,
        x: int,
        y: int,
        z: int,
    ) -> TimeCourseResponse:
        dataset = self._get_dataset(session_id, dataset_id)
        self._ensure_ready(session_id, dataset)
        echo = self._get_echo(dataset, echo_id)
        dataobj = nib.load(str(self.asset_path(session_id, echo.asset_id))).dataobj
        self._validate_voxel(dataobj.shape, x, y, z)
        series = np.asarray(dataobj[x, y, z, :], dtype=np.float32)

        selected_timepoint = (
            self._get_record(session_id).manifest.viewer_defaults.active_timepoint
            if self._get_record(session_id).manifest.viewer_defaults
            else 0
        )
        tr_ms = dataset.tr_ms
        points = []
        for index, value in enumerate(series):
            points.append(
                TimeCoursePoint(
                    timepoint=index,
                    time_ms=(tr_ms * index) if tr_ms is not None else None,
                    value=float(value),
                    is_selected=index == selected_timepoint,
                )
            )

        return TimeCourseResponse(
            session_id=session_id,
            dataset_id=dataset.dataset_id,
            dataset_label=dataset.label,
            voxel=self._build_voxel_coordinate(dataset.affine, (x, y, z)),
            echo=EchoSeriesMeta(
                echo_id=echo.echo_id,
                echo_index=echo.echo_index,
                echo_time_ms=echo.echo_time_ms,
                display_name=echo.display_name,
            ),
            selected_timepoint=selected_timepoint,
            x_axis=PlotAxisMeta(key="time_ms", label="Time", unit="ms"),
            y_axis=PlotAxisMeta(key="value", label="Signal Intensity"),
            tr_ms=tr_ms,
            series=points,
        )

    def build_plot_context(
        self,
        session_id: str,
        dataset_id: str,
        echo_id: str,
        x: int,
        y: int,
        z: int,
        timepoint: int,
    ) -> PlotContextResponse:
        dataset = self._get_dataset(session_id, dataset_id)
        self._ensure_ready(session_id, dataset)
        echo = self._get_echo(dataset, echo_id)
        dataobj = nib.load(str(self.asset_path(session_id, echo.asset_id))).dataobj
        self._validate_voxel(dataobj.shape, x, y, z, timepoint=timepoint)
        value = float(dataobj[x, y, z, timepoint])
        return PlotContextResponse(
            session_id=session_id,
            dataset_id=dataset.dataset_id,
            voxel=self._build_voxel_coordinate(dataset.affine, (x, y, z)),
            timepoint=timepoint,
            echo=EchoSeriesMeta(
                echo_id=echo.echo_id,
                echo_index=echo.echo_index,
                echo_time_ms=echo.echo_time_ms,
                display_name=echo.display_name,
            ),
            value=value,
            frame_count=echo.frame_count,
            asset_id=echo.asset_id,
        )

    def _parse_metadata(self, metadata_json: str | None) -> CreateSessionMetadata:
        if not metadata_json:
            return CreateSessionMetadata()
        return self._parse_model(
            metadata_json,
            CreateSessionMetadata,
            "Invalid metadata JSON",
        )

    def _parse_model(self, payload_json: str, model_type: type[MODEL_T], detail: str) -> MODEL_T:
        try:
            return model_type(**json.loads(payload_json))
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail
            ) from exc
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=exc.errors(),
            ) from exc

    def _read_nifti_metadata(self, file_path: Path) -> dict[str, object]:
        image = nib.load(str(file_path))
        shape = image.shape
        if len(shape) < 4:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Expected a 4D NIfTI file: {file_path.name}",
            )
        header = image.header
        pixdim = tuple(float(value) for value in header.get_zooms()[:3])
        tr_ms = float(header.get_zooms()[3] * 1000) if len(header.get_zooms()) > 3 else None
        affine = image.affine.tolist()
        return {
            "shape": tuple(int(value) for value in shape[:3]),
            "timepoints": int(shape[3]),
            "voxel_size_mm": pixdim,
            "tr_ms": tr_ms,
            "affine": affine,
            "echo_index": self._infer_echo_index(file_path.name),
            "echo_time_ms": self._infer_echo_time(file_path.name),
        }

    def _build_dataset_manifest(
        self,
        session_id: str,
        dataset_key: str,
        entries: list[dict[str, object]],
    ) -> tuple[DatasetManifest, list[ReviewAction], list[Issue]]:
        first = entries[0]
        review_actions: list[ReviewAction] = []
        warnings: list[Issue] = []
        dataset_issues: list[Issue] = []

        spatial_shape = first["shape"]
        timepoints = int(cast(int, first["timepoints"]))
        for entry in entries[1:]:
            if entry["shape"] != spatial_shape:
                dataset_issues.append(
                    Issue(
                        code="SPATIAL_SHAPE_MISMATCH",
                        severity=IssueSeverity.ERROR,
                        message="Uploaded echoes must share spatial dimensions.",
                    )
                )
            if entry["timepoints"] != timepoints:
                dataset_issues.append(
                    Issue(
                        code="TIMEPOINT_MISMATCH",
                        severity=IssueSeverity.ERROR,
                        message="Uploaded echoes must share timepoint counts.",
                    )
                )

        entries_sorted = sorted(
            entries,
            key=lambda entry: (
                entry["echo_index"] is None,
                entry["echo_index"] or 0,
                str(entry["filename"]),
            ),
        )
        echo_order_issue = self._build_echo_order_issue(entries_sorted)
        unresolved = echo_order_issue is not None

        dataset_id = f"ds_{dataset_key}"
        echoes: list[EchoManifest] = []
        for position, entry in enumerate(entries_sorted, start=1):
            inferred_echo_index = entry["echo_index"] if entry["echo_index"] is not None else None
            echo_id = f"echo_{inferred_echo_index or position}"
            asset_id = str(entry["asset_id"])
            echoes.append(
                EchoManifest(
                    echo_id=echo_id,
                    echo_index=inferred_echo_index,
                    echo_time_ms=entry["echo_time_ms"],
                    display_name=f"Echo {inferred_echo_index or position}",
                    asset_id=asset_id,
                    filename=str(entry["filename"]),
                    content_type=entry["content_type"],
                    frame_count=int(cast(int, entry["timepoints"])),
                    volume_url=self._asset_url(session_id, dataset_id, asset_id),
                    issues=[echo_order_issue.model_copy()] if echo_order_issue is not None else [],
                )
            )

        state = (
            DatasetState.INVALID
            if any(issue.severity == IssueSeverity.ERROR for issue in dataset_issues)
            else DatasetState.DRAFT
            if unresolved
            else DatasetState.READY
        )
        if unresolved:
            review_message = (
                f"{echo_order_issue.message} Confirm echo order before viewing."
                if echo_order_issue is not None
                else "Confirm echo order before viewing."
            )
            review_actions.append(
                ReviewAction(
                    action_type=ReviewActionType.CONFIRM_ECHO_ORDER,
                    dataset_id=dataset_id,
                    message=review_message,
                    echo_candidates=[
                        AssetCandidate(
                            asset_id=str(entry["asset_id"]), filename=str(entry["filename"])
                        )
                        for entry in entries_sorted
                    ],
                )
            )
            warnings.append(
                Issue(
                    code="SESSION_NOT_FINALIZED",
                    severity=IssueSeverity.INFO,
                    message="Finalize the session before loading the viewer.",
                )
            )

        dataset = DatasetManifest(
            dataset_id=dataset_id,
            label=dataset_key,
            state=state,
            spatial_shape=spatial_shape,
            timepoints=timepoints,
            voxel_size_mm=first["voxel_size_mm"],
            tr_ms=first["tr_ms"],
            affine=first["affine"],
            echoes=echoes,
            issues=dataset_issues,
        )
        return dataset, review_actions, warnings

    def _apply_finalize_decision(
        self, session_id: str, dataset: DatasetManifest, decision: FinalizeDatasetDecision
    ) -> None:
        asset_to_decision = {entry.asset_id: entry for entry in decision.echo_order}
        for echo in dataset.echoes:
            finalize_echo = asset_to_decision.get(echo.asset_id)
            if finalize_echo is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Finalize request missing an uploaded echo asset",
                )
            echo.echo_index = finalize_echo.echo_index
            echo.echo_time_ms = finalize_echo.echo_time_ms
            echo.echo_id = f"echo_{finalize_echo.echo_index}"
            echo.display_name = f"Echo {finalize_echo.echo_index}"
            echo.issues = []
            echo.volume_url = self._asset_url(session_id, dataset.dataset_id, echo.asset_id)
        dataset.echoes.sort(key=lambda echo: echo.echo_index or 0)
        dataset.state = DatasetState.READY
        dataset.issues = [
            issue for issue in dataset.issues if issue.severity != IssueSeverity.WARNING
        ]

    def _get_echo(self, dataset: DatasetManifest, echo_id: str) -> EchoManifest:
        echo = next((entry for entry in dataset.echoes if entry.echo_id == echo_id), None)
        if echo is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Echo not found")
        return echo

    def _get_record(self, session_id: str) -> SessionRecord:
        record = self._sessions.get(session_id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return record

    def _get_dataset(self, session_id: str, dataset_id: str) -> DatasetManifest:
        manifest = self._get_record(session_id).manifest
        dataset = next(
            (candidate for candidate in manifest.datasets if candidate.dataset_id == dataset_id),
            None,
        )
        if dataset is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
        return dataset

    def _ensure_ready(self, session_id: str, dataset: DatasetManifest) -> None:
        manifest = self._get_record(session_id).manifest
        if manifest.status != SessionStatus.READY or dataset.state != DatasetState.READY:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Dataset is not ready for viewing"
            )

    def _default_viewer_defaults(self, datasets: list[DatasetManifest]) -> ViewerDefaults | None:
        if not datasets:
            return None
        dataset = datasets[0]
        active_echo = dataset.echoes[0].echo_id if dataset.echoes else None
        return ViewerDefaults(
            dataset_id=dataset.dataset_id,
            active_echo_id=active_echo,
            compare_echo_ids=[echo.echo_id for echo in dataset.echoes],
        )

    def _validate_voxel(
        self, shape: tuple[int, ...], x: int, y: int, z: int, timepoint: int | None = None
    ) -> None:
        spatial_shape = shape[:3]
        if not (
            0 <= x < spatial_shape[0] and 0 <= y < spatial_shape[1] and 0 <= z < spatial_shape[2]
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Voxel coordinates are out of bounds",
            )
        if timepoint is not None and (len(shape) < 4 or not (0 <= timepoint < shape[3])):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Timepoint is out of bounds",
            )

    def _build_voxel_coordinate(
        self, affine: list[list[float]] | None, ijk: tuple[int, int, int]
    ) -> VoxelCoordinate:
        mm = None
        if affine is not None:
            xyz = np.asarray(affine) @ np.asarray([ijk[0], ijk[1], ijk[2], 1.0])
            mm = (float(xyz[0]), float(xyz[1]), float(xyz[2]))
        return VoxelCoordinate(ijk=ijk, mm=mm)

    def _asset_url(self, session_id: str, dataset_id: str, asset_id: str) -> str:
        return f"/api/sessions/{session_id}/datasets/{dataset_id}/assets/{asset_id}"

    def _build_echo_order_issue(self, entries: list[dict[str, object]]) -> Issue | None:
        inferred_indices = [
            int(cast(int, entry["echo_index"]))
            for entry in entries
            if entry["echo_index"] is not None
        ]
        if len(inferred_indices) != len(entries):
            return Issue(
                code="ECHO_ORDER_UNRESOLVED",
                severity=IssueSeverity.WARNING,
                message="Echo order could not be inferred confidently from filenames.",
                details={"reason": "missing_echo_index", "inferred_indices": inferred_indices},
            )

        if len(inferred_indices) != len(set(inferred_indices)):
            return Issue(
                code="ECHO_ORDER_DUPLICATE",
                severity=IssueSeverity.WARNING,
                message="Echo filenames produced duplicate echo indices.",
                details={
                    "reason": "duplicate_indices",
                    "inferred_indices": sorted(inferred_indices),
                },
            )

        expected_indices = list(range(1, len(entries) + 1))
        if sorted(inferred_indices) != expected_indices:
            return Issue(
                code="ECHO_ORDER_NONCONTIGUOUS",
                severity=IssueSeverity.WARNING,
                message="Echo filenames produced non-contiguous echo indices.",
                details={
                    "reason": "non_contiguous_indices",
                    "expected_indices": expected_indices,
                    "inferred_indices": sorted(inferred_indices),
                },
            )

        return None

    def _dataset_key(self, filename: str) -> str:
        name = filename
        for suffix in (".nii.gz", ".nii"):
            if name.endswith(suffix):
                name = name[: -len(suffix)]
                break
        name = ECHO_PATTERN.sub("", name)
        return re.sub(r"[_-]+", "_", name).strip("_").lower() or "dataset"

    def _infer_echo_index(self, filename: str) -> int | None:
        match = ECHO_PATTERN.search(filename)
        return int(match.group(1)) if match else None

    def _infer_echo_time(self, filename: str) -> float | None:
        match = TIME_PATTERN.search(filename)
        return float(match.group(1)) if match else None

    def _is_nifti(self, filename: str) -> bool:
        lower = filename.lower()
        return lower.endswith(".nii") or lower.endswith(".nii.gz")


session_service = SessionService()

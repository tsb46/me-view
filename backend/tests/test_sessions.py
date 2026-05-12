from __future__ import annotations

from datetime import UTC, datetime

import nibabel as nib
import numpy as np
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from me_view.models.common import DatasetState, SessionStatus, ViewerDefaults
from me_view.models.session import (
    CreateSessionMetadata,
    DatasetManifest,
    EchoManifest,
    FinalizeDatasetDecision,
    SessionResponse,
)
from me_view.services.sessions import SessionRecord, SessionService


def make_entry(filename: str, asset_id: str, echo_index: int | None) -> dict[str, object]:
    return {
        "asset_id": asset_id,
        "file_path": None,
        "filename": filename,
        "content_type": "application/gzip",
        "shape": (64, 64, 32),
        "timepoints": 120,
        "voxel_size_mm": (2.0, 2.0, 2.0),
        "tr_ms": 1500.0,
        "affine": None,
        "echo_index": echo_index,
        "echo_time_ms": None,
    }


def write_test_nifti(path, values) -> None:
    image = nib.Nifti1Image(np.asarray(values, dtype=np.float32), np.eye(4))
    nib.save(image, str(path))


def make_ready_session(
    service: SessionService,
    tmp_path,
    first_echo_values=(1.0, 3.0),
    second_echo_values=(2.0, 12.0),
) -> tuple[str, str, str]:
    session_id = "sess_test"
    dataset_id = "ds_test"
    asset_a = "asset_a"
    asset_b = "asset_b"
    original_a = tmp_path / "echo-1.nii.gz"
    original_b = tmp_path / "echo-2.nii.gz"
    write_test_nifti(original_a, [[[[*first_echo_values]]]])
    write_test_nifti(original_b, [[[[*second_echo_values]]]])

    manifest = SessionResponse(
        session_id=session_id,
        status=SessionStatus.READY,
        created_at=datetime.now(UTC),
        datasets=[
            DatasetManifest(
                dataset_id=dataset_id,
                label="dataset",
                state=DatasetState.READY,
                spatial_shape=(1, 1, 1),
                timepoints=2,
                voxel_size_mm=(1.0, 1.0, 1.0),
                tr_ms=1500.0,
                affine=np.eye(4).tolist(),
                echoes=[
                    EchoManifest(
                        echo_id="echo_1",
                        echo_index=1,
                        echo_time_ms=12.5,
                        display_name="Echo 1",
                        asset_id=asset_a,
                        active_asset_id=asset_a,
                        filename=original_a.name,
                        frame_count=2,
                        volume_url=service._asset_url(session_id, dataset_id, asset_a),
                    ),
                    EchoManifest(
                        echo_id="echo_2",
                        echo_index=2,
                        echo_time_ms=35.0,
                        display_name="Echo 2",
                        asset_id=asset_b,
                        active_asset_id=asset_b,
                        filename=original_b.name,
                        frame_count=2,
                        volume_url=service._asset_url(session_id, dataset_id, asset_b),
                    ),
                ],
            )
        ],
        viewer_defaults=ViewerDefaults(
            dataset_id=dataset_id,
            active_echo_id="echo_1",
            compare_echo_ids=["echo_1", "echo_2"],
        ),
    )
    service._sessions[session_id] = SessionRecord(
        manifest=manifest,
        session_dir=tmp_path,
        asset_paths={
            asset_a: original_a,
            asset_b: original_b,
        },
    )
    return session_id, dataset_id, asset_a


def test_build_dataset_manifest_flags_duplicate_inferred_echo_indices() -> None:
    service = SessionService()
    entries = [
        make_entry("sub-01_echo-1_bold.nii.gz", "asset_a", 1),
        make_entry("sub-01_echo-1_repeat_bold.nii.gz", "asset_b", 1),
        make_entry("sub-01_echo-2_bold.nii.gz", "asset_c", 2),
    ]

    dataset, review_actions, warnings = service._build_dataset_manifest(
        "sess_test", "sub_01_bold", entries
    )

    assert dataset.state == DatasetState.DRAFT
    assert len(review_actions) == 1
    assert warnings
    assert review_actions[0].message == (
        "Echo filenames produced duplicate echo indices. Confirm echo order before viewing."
    )
    assert all(
        any(issue.code == "ECHO_ORDER_DUPLICATE" for issue in echo.issues)
        for echo in dataset.echoes
    )


def test_build_dataset_manifest_flags_skipped_inferred_echo_indices() -> None:
    service = SessionService()
    entries = [
        make_entry("sub-01_echo-1_bold.nii.gz", "asset_a", 1),
        make_entry("sub-01_echo-3_bold.nii.gz", "asset_b", 3),
    ]

    dataset, review_actions, warnings = service._build_dataset_manifest(
        "sess_test", "sub_01_bold", entries
    )

    assert dataset.state == DatasetState.DRAFT
    assert len(review_actions) == 1
    assert warnings
    assert review_actions[0].message == (
        "Echo filenames produced non-contiguous echo indices. Confirm echo order before viewing."
    )
    assert all(
        any(issue.code == "ECHO_ORDER_NONCONTIGUOUS" for issue in echo.issues)
        for echo in dataset.echoes
    )


def test_finalize_dataset_decision_rejects_skipped_echo_indices() -> None:
    with pytest.raises(ValidationError, match="contiguous sequence starting at 1"):
        FinalizeDatasetDecision(
            dataset_id="ds_test",
            echo_order=[
                {"asset_id": "asset_a", "echo_index": 1},
                {"asset_id": "asset_b", "echo_index": 3},
            ],
        )


def test_create_session_metadata_rejects_non_positive_time_values() -> None:
    with pytest.raises(ValidationError, match="Echo times must be greater than 0 milliseconds"):
        CreateSessionMetadata(echo_times_ms=[12.5, 0])

    with pytest.raises(ValidationError, match="TR must be greater than 0 milliseconds"):
        CreateSessionMetadata(tr_ms=0)


def test_apply_create_metadata_overrides_updates_tr_and_echo_times() -> None:
    service = SessionService()
    datasets_by_key = {
        "run_a": [
            make_entry("sub-01_task-rest_run-1_echo-1_bold.nii.gz", "asset_a", 1),
            make_entry("sub-01_task-rest_run-1_echo-2_bold.nii.gz", "asset_b", 2),
        ],
        "run_b": [
            make_entry("sub-01_task-rest_run-2_echo-1_bold.nii.gz", "asset_c", 1),
            make_entry("sub-01_task-rest_run-2_echo-2_bold.nii.gz", "asset_d", 2),
        ],
    }

    service._apply_create_metadata_overrides(
        CreateSessionMetadata(echo_times_ms=[13.2, 31.5], tr_ms=2000.0),
        datasets_by_key,
    )

    assert [entry["echo_time_ms"] for entry in datasets_by_key["run_a"]] == [13.2, 31.5]
    assert [entry["echo_time_ms"] for entry in datasets_by_key["run_b"]] == [13.2, 31.5]
    assert all(
        entry["tr_ms"] == 2000.0 for entries in datasets_by_key.values() for entry in entries
    )


def test_apply_create_metadata_overrides_maps_echo_times_by_resolved_echo_order() -> None:
    service = SessionService()
    datasets_by_key = {
        "run_a": [
            make_entry("sub-01_task-rest_run-1_echo-3_bold.nii.gz", "asset_c", 3),
            make_entry("sub-01_task-rest_run-1_echo-2_bold.nii.gz", "asset_b", 2),
            make_entry("sub-01_task-rest_run-1_echo-1_bold.nii.gz", "asset_a", 1),
        ]
    }

    service._apply_create_metadata_overrides(
        CreateSessionMetadata(echo_times_ms=[13.2, 31.5, 49.8]),
        datasets_by_key,
    )

    echo_times_by_asset = {
        entry["asset_id"]: entry["echo_time_ms"] for entry in datasets_by_key["run_a"]
    }

    assert echo_times_by_asset == {
        "asset_a": 13.2,
        "asset_b": 31.5,
        "asset_c": 49.8,
    }


def test_apply_create_metadata_overrides_rejects_mismatched_multi_dataset_echo_counts() -> None:
    service = SessionService()
    datasets_by_key = {
        "run_a": [
            make_entry("sub-01_task-rest_run-1_echo-1_bold.nii.gz", "asset_a", 1),
            make_entry("sub-01_task-rest_run-1_echo-2_bold.nii.gz", "asset_b", 2),
        ],
        "run_b": [
            make_entry("sub-01_task-rest_run-2_echo-1_bold.nii.gz", "asset_c", 1),
            make_entry("sub-01_task-rest_run-2_echo-2_bold.nii.gz", "asset_d", 2),
            make_entry("sub-01_task-rest_run-2_echo-3_bold.nii.gz", "asset_e", 3),
        ],
    }

    with pytest.raises(
        HTTPException, match="Manual echo times must match the echo count of every resolved dataset"
    ):
        service._apply_create_metadata_overrides(
            CreateSessionMetadata(echo_times_ms=[13.2, 31.5]),
            datasets_by_key,
        )


def test_plot_builders_read_from_original_assets(tmp_path) -> None:
    service = SessionService()
    session_id, dataset_id, _ = make_ready_session(service, tmp_path)

    original_curve = service.build_echo_curve(session_id, dataset_id, 0, 0, 0, 0)
    assert [point.value for point in original_curve.echoes] == [1.0, 2.0]
    original_time_course = service.build_time_course(session_id, dataset_id, "echo_1", 0, 0, 0)
    original_context = service.build_plot_context(session_id, dataset_id, "echo_1", 0, 0, 0, 1)

    assert [point.value for point in original_time_course.series] == [1.0, 3.0]
    assert original_context.value == 3.0
    assert (
        original_context.asset_id
        == service._get_record(session_id).manifest.datasets[0].echoes[0].asset_id
    )

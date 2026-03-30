from __future__ import annotations

import pytest
from pydantic import ValidationError

from me_view.models.common import DatasetState
from me_view.models.session import FinalizeDatasetDecision
from me_view.services.sessions import SessionService


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

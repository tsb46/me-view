"""Session-aware quantitative endpoints used by Plotly panels and inspector UI."""

from fastapi import APIRouter

from me_view.models.session import EchoCurveResponse, PlotContextResponse, TimeCourseResponse
from me_view.services.sessions import session_service

router = APIRouter(prefix="/sessions/{session_id}/datasets/{dataset_id}/plots", tags=["plots"])


@router.get("/echo-curve", response_model=EchoCurveResponse)
def echo_curve(
    session_id: str,
    dataset_id: str,
    x: int,
    y: int,
    z: int,
    timepoint: int,
) -> EchoCurveResponse:
    """Return one value per echo for the selected voxel and current timepoint."""

    return session_service.build_echo_curve(session_id, dataset_id, x, y, z, timepoint)


@router.get("/time-course", response_model=TimeCourseResponse)
def time_course(
    session_id: str,
    dataset_id: str,
    echo_id: str,
    x: int,
    y: int,
    z: int,
) -> TimeCourseResponse:
    """Return one value per frame for the selected voxel in the active echo."""

    return session_service.build_time_course(session_id, dataset_id, echo_id, x, y, z)


@router.get("/context", response_model=PlotContextResponse)
def plot_context(
    session_id: str,
    dataset_id: str,
    echo_id: str,
    x: int,
    y: int,
    z: int,
    timepoint: int,
) -> PlotContextResponse:
    """Return lightweight inspector metadata for the current voxel, echo, and frame."""

    return session_service.build_plot_context(session_id, dataset_id, echo_id, x, y, z, timepoint)

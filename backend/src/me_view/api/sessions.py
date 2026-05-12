"""Session creation, finalization, retrieval, and asset streaming endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, Response, UploadFile, status
from fastapi.responses import FileResponse

from me_view.models.session import (
    FinalizeSessionRequest,
    SessionResponse,
)
from me_view.services.sessions import session_service

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    metadata: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile], File()] = [],
) -> SessionResponse:
    """Create a new upload-backed session and infer dataset manifests from NIfTI files."""

    return await session_service.create_session(metadata, files)


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: str) -> SessionResponse:
    """Fetch the current manifest for a previously created session."""

    return session_service.get_session(session_id)


@router.post("/{session_id}/finalize", response_model=SessionResponse)
def finalize_session(session_id: str, request: FinalizeSessionRequest) -> SessionResponse:
    """Confirm dataset grouping and echo order for a draft session."""

    return session_service.finalize_session(session_id, request)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str) -> Response:
    """Delete an ephemeral session and its uploaded files."""

    session_service.delete_session(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{session_id}/datasets/{dataset_id}/assets/{asset_id}")
def get_asset(session_id: str, dataset_id: str, asset_id: str) -> FileResponse:
    """Serve an uploaded asset file back to the frontend and NiiVue."""

    asset_path = session_service.asset_path(session_id, asset_id)
    return FileResponse(asset_path, filename=asset_path.name)

# Backend

FastAPI service for session lifecycle management, NIfTI metadata extraction, active-asset resolution, and Plotly-oriented voxel endpoints.

## Toolchain

- Python 3.13
- `uv` for environment and dependency management

## Commands

```bash
uv sync
uv run uvicorn me_view.main:app --reload --app-dir src
```

## Responsibilities

- Create upload-backed sessions
- Infer and finalize multi-echo datasets
- Serve session asset files back to the frontend and NiiVue
- Expose quantitative endpoints for echo curves and time courses

## Key entry points

- `src/me_view/main.py`: FastAPI app
- `src/me_view/api/sessions.py`: session lifecycle and asset-serving routes
- `src/me_view/api/plots.py`: Plotly panel endpoints
- `src/me_view/services/sessions.py`: session creation, dataset manifest construction, and asset lookup

## Notes

- Sessions are ephemeral for now and survive page refresh as long as the backend process is alive.
- `uv` is the required dependency manager for this backend.

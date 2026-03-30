# me-view

Local web viewer for multi-echo fMRI datasets using a FastAPI backend, a React frontend, NiiVue for image rendering, and Plotly for quantitative voxel plots.

## MVP scope

- Upload one or more 4D NIfTI files representing separate echoes.
- Build a session manifest that groups echoes into datasets.
- View data in single-echo and synchronized compare layouts.
- Keep compare-view echoes aligned on crosshair position, timepoint, and shared colormap/display bounds by default.
- Show two quantitative panels:
  - echo curve at the selected voxel and current timepoint
  - time course at the selected voxel for the active echo
- Reserve room for reversible preprocessing through `niivue-niimath` session revisions.

Out of scope for this first implementation slice:

- GIFTI and surface rendering
- long-term persistent session storage
- ROI analysis and derived QC dashboards

## Required toolchain

- Backend: Python 3.13 managed with `uv`
- Frontend: React managed and built with `Vite`

These are required project choices, not interchangeable defaults.

## Repository structure

```text
.
├── backend/
├── docs/
└── frontend/
```

## Quickstart

### Workspace

```bash
npm install
npm run dev
```

This starts both the FastAPI backend and the Vite frontend together from the repository root.

### Backend

```bash
cd backend
uv sync
uv run uvicorn me_view.main:app --reload --app-dir src
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to the FastAPI backend on port `8000`.

## Data assumptions

- Each uploaded echo is expected to be a NIfTI volume, typically one 4D file per echo.
- Echoes in the same dataset should share spatial dimensions, affine alignment, and timepoint count.
- Echo ordering is inferred from filenames when possible and can be finalized explicitly through the session API.

## Documentation map

- [backend/README.md](backend/README.md)
- [frontend/README.md](frontend/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/api.md](docs/api.md)
- [docs/state-model.md](docs/state-model.md)
- [docs/preprocessing.md](docs/preprocessing.md)
- [docs/ui.md](docs/ui.md)

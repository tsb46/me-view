# Architecture

`me-view` is a local full-stack application with a FastAPI backend and a React frontend.

## Backend

- Manages ephemeral upload-backed sessions
- Parses NIfTI metadata with nibabel
- Builds session manifests and dataset groupings
- Serves active asset URLs to NiiVue
- Exposes quantitative voxel endpoints for Plotly panels

## Frontend

- Uses Vite to build and serve a React client
- Uses NiiVue for image rendering and synchronized voxel selection
- Uses Plotly to render echo curves and time courses
- Holds canonical UI state for dataset, voxel, timepoint, layout, and active echo
- Stores render preferences at the dataset level so colormap and display bounds stay aligned across echo viewers

## Data flow

1. User uploads one or more NIfTI files in the frontend.
2. Backend creates a session and infers datasets and echoes.
3. Frontend receives a session manifest and loads active asset URLs into NiiVue.
4. User selects a voxel and timepoint through NiiVue.
5. Frontend calls backend plot endpoints for quantitative values.

In compare layout, NiiVue viewers broadcast crosshair changes to each other. Timepoint selection and render preferences are synchronized through shared React state, so all rendered echoes stay aligned on frame, colormap, and display bounds.

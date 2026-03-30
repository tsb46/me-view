# Frontend

React application built with `Vite` for the me-view local multi-echo fMRI viewer.

## Toolchain

- React
- Vite
- NiiVue
- PlotlyJS

`Vite` is the required frontend build and dev tool for this project.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Responsibilities

- Upload files into backend-backed sessions
- Maintain canonical selection state for dataset, voxel, timepoint, and active echo
- Keep compare-view echo canvases synchronized on crosshair position
- Share timepoint and dataset-level render preferences across rendered echoes
- Drive NiiVue canvases for single-view and compare-view layouts
- Render Plotly echo-curve and time-course panels from backend data

## Key entry points

- `src/App.jsx`: top-level shell
- `src/state/app-state.jsx`: reducer and contexts
- `src/components/NiiVueCanvas.jsx`: NiiVue integration layer
- `src/components/PlotPanel.jsx`: Plotly query and render logic

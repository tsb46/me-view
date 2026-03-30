# API

## Session endpoints

- `POST /api/sessions`
- `GET /api/sessions/{session_id}`
- `POST /api/sessions/{session_id}/finalize`
- `DELETE /api/sessions/{session_id}`
- `GET /api/sessions/{session_id}/datasets/{dataset_id}/assets/{asset_id}`

## Plot endpoints

- `GET /api/sessions/{session_id}/datasets/{dataset_id}/plots/echo-curve`
- `GET /api/sessions/{session_id}/datasets/{dataset_id}/plots/time-course`
- `GET /api/sessions/{session_id}/datasets/{dataset_id}/plots/context`

All plot endpoints resolve against the dataset assets currently stored in the session manifest. That keeps Plotly values aligned with what NiiVue is rendering.

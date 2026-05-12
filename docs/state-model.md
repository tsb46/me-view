# State model

The frontend uses one app-level reducer with four logical slices:

- `session`
- `selection`
- `viewerUI`
- `plots`

NiiVue instances are kept outside reducer state in a viewer registry so React state stays serializable and predictable.

The reducer keeps voxel selection and selected timepoint in shared state, which makes those values available to every rendered echo viewer. Render preferences are also keyed by dataset rather than by echo, so colormap and display min/max stay synchronized across echoes within the active dataset.

## Render-bound invalidation

- `viewerUI.renderMetaByDatasetId` stores discovered min/max bounds per echo and active `volumeUrl`
- Bounds discoveries that arrive for an outdated `volumeUrl` are ignored so stale async loads cannot overwrite the active variant range

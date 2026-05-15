# UI

## Core layout

- Control bar across the top
- NiiVue workspace on the left
- Plotly panels on the right
- Inspector panel under the charts

## Rendering panel

- The Rendering section includes colormap, display range, time display, and crosshair controls
- Display min and max are discovered per rendered echo volume and stay synchronized within the active dataset

## Quantitative panels

- Echo curve: selected voxel at selected timepoint across all echoes
- Time course: selected voxel across time for the active echo

## Synchronization

- NiiVue drives voxel and timepoint selection
- React holds the canonical selection state
- In compare mode, echo viewers share the same crosshair position by default
- All rendered echo viewers share the same selected timepoint by default
- Colormap and display min/max are stored per dataset, so rendered echoes share the same render settings by default
- Plotly panels fetch quantitative values from backend plot endpoints

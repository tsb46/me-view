import { useAppState } from '../state/app-state'
import { formatDatasetEchoTimes, formatDisplayedTimepoint, normalizeTimeDisplayMode } from '../lib/time'

function hasVoxelSelection(value) {
  return value != null && typeof value.length === 'number' && value.length >= 3
}

export default function InspectorPanel() {
  const state = useAppState()
  const hasSelection = hasVoxelSelection(state.selection.selectedVoxelIJK)
  const context = hasSelection ? state.plots.context.data : null
  const dataset = state.session.datasets.find((entry) => entry.dataset_id === state.selection.selectedDatasetId) ?? null
  const timeDisplayMode = normalizeTimeDisplayMode(state.plots.chartPrefs.timeDisplayMode, dataset)
  const datasetEchoTimes = formatDatasetEchoTimes(dataset)

  return (
    <section className="panel inspector-panel">
      <p className="eyebrow">Inspector</p>
      <div className="inspector-grid">
        <div>
          <span className="label">Session status</span>
          <strong>{state.session.status}</strong>
        </div>
        <div>
          <span className="label">Selected voxel</span>
          <strong>
            {state.selection.selectedVoxelIJK ? state.selection.selectedVoxelIJK.join(', ') : 'Not selected'}
          </strong>
        </div>
        <div>
          <span className="label">Active echo</span>
          <strong>{state.selection.activeEchoId ?? 'None'}</strong>
        </div>
        <div>
          <span className="label">{timeDisplayMode === 'seconds' ? 'Time' : 'Timepoint'}</span>
          <strong>{formatDisplayedTimepoint(state.selection.selectedTimepoint, dataset, timeDisplayMode)}</strong>
        </div>
        <div>
          <span className="label">Current value</span>
          <strong>{context?.value != null ? context.value.toFixed(3) : 'Unavailable'}</strong>
        </div>
        <div>
          <span className="label">Asset</span>
          <strong>{context?.asset_id ?? 'Unavailable'}</strong>
        </div>
        {datasetEchoTimes ? (
          <div>
            <span className="label">Echo times</span>
            <strong>{datasetEchoTimes}</strong>
          </div>
        ) : null}
      </div>
    </section>
  )
}

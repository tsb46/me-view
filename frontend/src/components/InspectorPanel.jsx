import { useAppState } from '../state/app-state'

function hasVoxelSelection(value) {
  return value != null && typeof value.length === 'number' && value.length >= 3
}

export default function InspectorPanel() {
  const state = useAppState()
  const hasSelection = hasVoxelSelection(state.selection.selectedVoxelIJK)
  const context = hasSelection ? state.plots.context.data : null

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
          <span className="label">Timepoint</span>
          <strong>{state.selection.selectedTimepoint}</strong>
        </div>
        <div>
          <span className="label">Current value</span>
          <strong>{context?.value != null ? context.value.toFixed(3) : 'Unavailable'}</strong>
        </div>
        <div>
          <span className="label">Asset</span>
          <strong>{context?.asset_id ?? 'Unavailable'}</strong>
        </div>
      </div>
    </section>
  )
}

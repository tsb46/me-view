import { useAppState, useActiveDataset } from '../state/app-state'

function formatStatus(status) {
  return status.replaceAll('_', ' ')
}

function getReviewActionForDataset(session, datasetId) {
  if (!datasetId) {
    return null
  }

  return session.review?.required_actions?.find((action) => action.dataset_id === datasetId) ?? null
}

export default function SessionBanner() {
  const state = useAppState()
  const dataset = useActiveDataset()
  const activeReviewAction = getReviewActionForDataset(state.session, dataset?.dataset_id)

  if (!state.session.sessionId) {
    return null
  }

  const warningCount = state.session.datasets.reduce(
    (count, entry) => count + (entry.issues?.length ?? 0),
    state.session.warnings?.length ?? 0,
  )
  const errorCount = state.session.errors?.length ?? 0

  return (
    <section className={`panel session-banner session-banner-${state.session.status}`}>
      <div className="session-banner-main">
        <div>
          <p className="eyebrow">Session</p>
          <h2>{state.session.sessionId}</h2>
          <p>
            Status: <strong>{formatStatus(state.session.status)}</strong>
            {dataset ? ` · Active dataset: ${dataset.label}` : ''}
          </p>
        </div>
        <div className="session-banner-stats">
          <div>
            <span className="label">Datasets</span>
            <strong>{state.session.datasets.length}</strong>
          </div>
          <div>
            <span className="label">Warnings</span>
            <strong>{warningCount}</strong>
          </div>
          <div>
            <span className="label">Errors</span>
            <strong>{errorCount}</strong>
          </div>
        </div>
      </div>

      {state.session.status === 'needs_review' ? (
        <p className="session-banner-copy">
          {activeReviewAction?.message
            ?? 'Viewer loading is paused until echo ordering is confirmed in the review panel below.'}
        </p>
      ) : null}

      {state.session.status === 'ready' && dataset ? (
        <p className="session-banner-copy">
          Selected echo: <strong>{state.selection.activeEchoId ?? 'None'}</strong> · Timepoint:{' '}
          <strong>{state.selection.selectedTimepoint}</strong> · Voxel:{' '}
          <strong>
            {state.selection.selectedVoxelIJK ? state.selection.selectedVoxelIJK.join(', ') : 'Not selected'}
          </strong>
        </p>
      ) : null}

      {errorCount > 0 ? (
        <div className="session-banner-list error-text">
          {state.session.errors.map((issue) => (
            <p key={issue.code}>{issue.message}</p>
          ))}
        </div>
      ) : null}
    </section>
  )
}
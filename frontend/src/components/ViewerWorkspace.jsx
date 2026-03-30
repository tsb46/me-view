import { useEffect } from 'react'

import NiiVueCanvas from './NiiVueCanvas'
import { useAppState, useActiveDataset, useViewerRegistry } from '../state/app-state'

function getReviewActionForDataset(session, datasetId) {
  if (!datasetId) {
    return null
  }

  return session.review?.required_actions?.find((action) => action.dataset_id === datasetId) ?? null
}

export default function ViewerWorkspace() {
  const state = useAppState()
  const dataset = useActiveDataset()
  const registry = useViewerRegistry()
  const activeReviewAction = getReviewActionForDataset(state.session, dataset?.dataset_id)

  useEffect(() => {
    if (!state.session.sessionId || !dataset || state.session.status !== 'ready') {
      return
    }

    const viewers = registry.all()
    if (!viewers.length) {
      return
    }

    const shouldSync = state.selection.layoutMode === 'compare' && state.viewerUI.syncEnabled
    for (const [viewerId, entry] of viewers) {
      if (!entry?.nv) {
        continue
      }

      const others = shouldSync
        ? viewers.filter(([otherViewerId]) => otherViewerId !== viewerId).map(([, otherEntry]) => otherEntry.nv)
        : []

      entry.nv.broadcastTo(others, {
        crosshair: shouldSync,
        zoomPan: shouldSync,
        sliceType: shouldSync,
        '2d': false,
        '3d': false,
      })
    }
  }, [registry, state.selection.layoutMode, state.viewerUI.syncEnabled, dataset?.dataset_id])

  if (!state.session.sessionId || !dataset) {
    return (
      <section className="panel viewer-workspace empty-state">
        <p className="eyebrow">Viewer</p>
        <h2>No active session</h2>
        <p>Create a session to populate the NiiVue workspace.</p>
      </section>
    )
  }

  if (state.session.status !== 'ready') {
    return (
      <section className="panel viewer-workspace empty-state">
        <div>
          <p className="eyebrow">Viewer</p>
          <h2>Session not finalized</h2>
          <p>
            {activeReviewAction?.message
              ?? 'Confirm echo ordering in the review panel before loading the NiiVue workspace.'}
          </p>
        </div>
      </section>
    )
  }

  const echoes = state.selection.layoutMode === 'compare'
    ? dataset.echoes
    : dataset.echoes.filter((echo) => echo.echo_id === state.selection.activeEchoId)

  return (
    <section className="panel viewer-workspace">
      <div className={state.selection.layoutMode === 'compare' ? 'viewer-grid compare' : 'viewer-grid'}>
        {echoes.map((echo) => (
          <NiiVueCanvas
            key={echo.echo_id}
            viewerId={echo.echo_id}
            datasetId={dataset.dataset_id}
            label={echo.display_name}
            fileName={echo.filename}
            volumeUrl={echo.volume_url}
            currentFrame={state.selection.selectedTimepoint}
          />
        ))}
      </div>
    </section>
  )
}

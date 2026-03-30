import { useMemo, useState } from 'react'

import { finalizeSession } from '../lib/api'
import { useAppDispatch, useAppState } from '../state/app-state'

function buildInitialDraft(session) {
  const datasets = session.datasets ?? []
  const requiredActions = session.review?.required_actions ?? []

  return requiredActions.reduce((draft, action) => {
    const dataset = datasets.find((entry) => entry.dataset_id === action.dataset_id)
    if (!dataset) {
      return draft
    }

    const orderedEchoes = [...dataset.echoes].sort((left, right) => {
      const leftIndex = left.echo_index ?? Number.MAX_SAFE_INTEGER
      const rightIndex = right.echo_index ?? Number.MAX_SAFE_INTEGER
      return leftIndex - rightIndex || left.filename.localeCompare(right.filename)
    })

    draft[action.dataset_id] = orderedEchoes.map((echo, index) => ({
      assetId: echo.asset_id,
      filename: echo.filename,
      echoIndex: echo.echo_index ?? index + 1,
      echoTimeMs: echo.echo_time_ms ?? null,
    }))
    return draft
  }, {})
}

function getDraftIssues(rows) {
  const selectedIndices = rows.map((row) => row.echoIndex)
  if (selectedIndices.some((value) => !Number.isInteger(value) || value < 1 || value > rows.length)) {
    return 'Each echo must be assigned to a unique position in the dataset order.'
  }
  if (new Set(selectedIndices).size !== selectedIndices.length) {
    return 'Echo positions must be unique within each dataset.'
  }
  return null
}

export default function ReviewPanel() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [draftByDataset, setDraftByDataset] = useState(() => buildInitialDraft(state.session))
  const [submitError, setSubmitError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const requiredActions = state.session.review?.required_actions ?? []
  const draftIssues = useMemo(() => {
    return requiredActions.reduce((issues, action) => {
      const rows = draftByDataset[action.dataset_id] ?? []
      const message = getDraftIssues(rows)
      if (message) {
        issues[action.dataset_id] = message
      }
      return issues
    }, {})
  }, [draftByDataset, requiredActions])

  if (!state.session.sessionId || state.session.status !== 'needs_review' || !requiredActions.length) {
    return null
  }

  const hasIssues = Object.keys(draftIssues).length > 0

  async function handleFinalize(event) {
    event.preventDefault()
    if (hasIssues) {
      setSubmitError('Resolve duplicate or invalid echo positions before finalizing.')
      return
    }

    const firstDatasetId = state.session.datasets[0]?.dataset_id
    const firstDraft = firstDatasetId ? draftByDataset[firstDatasetId] ?? [] : []
    const sortedFirstDraft = [...firstDraft].sort((left, right) => left.echoIndex - right.echoIndex)

    const payload = {
      datasets: requiredActions.map((action) => ({
        dataset_id: action.dataset_id,
        echo_order: [...(draftByDataset[action.dataset_id] ?? [])]
          .sort((left, right) => left.echoIndex - right.echoIndex)
          .map((row) => ({
            asset_id: row.assetId,
            echo_index: row.echoIndex,
            echo_time_ms: row.echoTimeMs,
          })),
      })),
      viewer_defaults: {
        dataset_id: firstDatasetId,
        layout: 'single',
        active_echo_id: sortedFirstDraft[0] ? `echo_${sortedFirstDraft[0].echoIndex}` : null,
        active_timepoint: 0,
        compare_echo_ids: sortedFirstDraft.map((row) => `echo_${row.echoIndex}`),
        colormap: null,
        crosshair: true,
      },
    }

    setSubmitError(null)
    setIsSubmitting(true)
    dispatch({ type: 'session_load_started' })
    try {
      const session = await finalizeSession(state.session.sessionId, payload)
      dispatch({ type: 'session_loaded', payload: session })
    } catch (error) {
      dispatch({ type: 'session_failed', payload: error.message })
      setSubmitError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="panel review-panel">
      <div className="review-header">
        <div>
          <p className="eyebrow">Review Required</p>
          <h2>Confirm echo ordering before loading the viewer</h2>
          <p>
            The backend grouped your uploaded files into datasets, but at least one dataset still
            needs echo-order confirmation. Finalizing the session promotes it to a viewer-ready
            manifest.
          </p>
        </div>
        <div className="review-badge">
          <strong>{requiredActions.length}</strong>
          <span>dataset review task(s)</span>
        </div>
      </div>

      <form className="review-form" onSubmit={handleFinalize}>
        {requiredActions.map((action) => {
          const dataset = state.session.datasets.find((entry) => entry.dataset_id === action.dataset_id)
          const rows = draftByDataset[action.dataset_id] ?? []
          const datasetIssue = draftIssues[action.dataset_id]

          if (!dataset) {
            return null
          }

          return (
            <section key={action.dataset_id} className="dataset-review-card">
              <div className="dataset-review-head">
                <div>
                  <h3>{dataset.label}</h3>
                  <p>{action.message ?? 'Confirm the final order for each uploaded echo file.'}</p>
                </div>
                <div className="dataset-metadata">
                  <span>{dataset.timepoints} frame(s)</span>
                  <span>{dataset.spatial_shape.join(' × ')}</span>
                </div>
              </div>

              <div className="review-grid review-grid-header">
                <span>File</span>
                <span>Assigned echo</span>
                <span>Echo time</span>
              </div>

              {rows.map((row, rowIndex) => (
                <div key={row.assetId} className="review-grid">
                  <div>
                    <strong>{row.filename}</strong>
                  </div>
                  <label>
                    <span className="sr-only">Assigned echo index for {row.filename}</span>
                    <select
                      value={row.echoIndex}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value)
                        setDraftByDataset((current) => ({
                          ...current,
                          [action.dataset_id]: current[action.dataset_id].map((entry, entryIndex) =>
                            entryIndex === rowIndex ? { ...entry, echoIndex: nextValue } : entry,
                          ),
                        }))
                      }}
                    >
                      {rows.map((_, optionIndex) => (
                        <option key={optionIndex + 1} value={optionIndex + 1}>
                          Echo {optionIndex + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>{row.echoTimeMs != null ? `${row.echoTimeMs} ms` : 'Unknown'}</div>
                </div>
              ))}

              {datasetIssue ? <p className="error-text review-error">{datasetIssue}</p> : null}
            </section>
          )
        })}

        <div className="review-actions">
          {submitError ? <p className="error-text">{submitError}</p> : null}
          <button type="submit" disabled={isSubmitting || hasIssues}>
            {isSubmitting ? 'Finalizing…' : 'Finalize session'}
          </button>
        </div>
      </form>
    </section>
  )
}
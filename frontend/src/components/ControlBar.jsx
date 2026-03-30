import { useEffect, useRef } from 'react'

import { NVImage } from '@niivue/niivue'

import { NIIVUE_COLORMAPS } from '../lib/colormaps'
import { useAppDispatch, useAppState, useActiveDataset, useActiveRenderPreferences } from '../state/app-state'

function formatRangeValue(value) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  if (Math.abs(value) >= 1000 || Number.isInteger(value)) {
    return value.toFixed(0)
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(1)
  }

  return value.toFixed(3)
}

export default function ControlBar() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const dataset = useActiveDataset()
  const renderPrefs = useActiveRenderPreferences()
  const pendingLoadsRef = useRef(new Set())

  useEffect(() => {
    if (!dataset || state.session.status !== 'ready') {
      return
    }

    let ignore = false
    const discoveredBounds = state.viewerUI.renderMetaByDatasetId?.[dataset.dataset_id]?.echoBounds ?? {}
    const missingEchoes = dataset.echoes.filter((echo) => {
      const bounds = discoveredBounds[echo.echo_id]
      return !Number.isFinite(bounds?.min) || !Number.isFinite(bounds?.max)
    })

    if (!missingEchoes.length) {
      return
    }

    missingEchoes.forEach((echo) => {
      const requestKey = `${dataset.dataset_id}:${echo.echo_id}`
      if (pendingLoadsRef.current.has(requestKey)) {
        return
      }

      pendingLoadsRef.current.add(requestKey)
      NVImage.loadFromUrl({ url: echo.volume_url, name: echo.filename })
        .then((volume) => {
          if (ignore) {
            return
          }
          if (Number.isFinite(volume?.cal_min) && Number.isFinite(volume?.cal_max)) {
            dispatch({
              type: 'render_bounds_discovered',
              payload: {
                datasetId: dataset.dataset_id,
                echoId: echo.echo_id,
                min: volume.cal_min,
                max: volume.cal_max,
              },
            })
          }
        })
        .catch((error) => {
          console.error('[ControlBar] Failed to discover echo bounds', {
            datasetId: dataset.dataset_id,
            echoId: echo.echo_id,
            message: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          pendingLoadsRef.current.delete(requestKey)
        })
    })

    return () => {
      ignore = true
    }
  }, [dataset, dispatch, state.session.status, state.viewerUI.renderMetaByDatasetId])

  if (!state.session.sessionId || !dataset || state.session.status !== 'ready') {
    return null
  }

  const globalMin = renderPrefs?.globalMin
  const globalMax = renderPrefs?.globalMax
  const displayMin = renderPrefs?.displayMin ?? globalMin ?? 0
  const displayMax = renderPrefs?.displayMax ?? globalMax ?? 0
  const hasBounds = Number.isFinite(globalMin) && Number.isFinite(globalMax)

  return (
    <section className="panel control-bar">
      <label>
        Dataset
        <select
          value={state.selection.selectedDatasetId ?? ''}
          onChange={(event) => {
            const nextDataset = state.session.datasets.find((entry) => entry.dataset_id === event.target.value)
            dispatch({
              type: 'dataset_selected',
              payload: {
                datasetId: event.target.value,
                activeEchoId: nextDataset?.echoes?.[0]?.echo_id ?? null,
              },
            })
          }}
        >
          {state.session.datasets.map((entry) => (
            <option key={entry.dataset_id} value={entry.dataset_id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Active echo
        <select
          value={state.selection.activeEchoId ?? ''}
          onChange={(event) => dispatch({ type: 'echo_selected', payload: event.target.value })}
        >
          {dataset.echoes.map((echo) => (
            <option key={echo.echo_id} value={echo.echo_id}>
              {echo.display_name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Timepoint
        <input
          type="range"
          min="0"
          max={Math.max(0, dataset.timepoints - 1)}
          value={state.selection.selectedTimepoint}
          onChange={(event) => dispatch({ type: 'timepoint_selected', payload: Number(event.target.value) })}
        />
        <span>{state.selection.selectedTimepoint}</span>
      </label>

      <div className="layout-toggle">
        <button
          type="button"
          className={state.selection.layoutMode === 'single' ? 'active' : ''}
          onClick={() => dispatch({ type: 'layout_changed', payload: 'single' })}
        >
          Single
        </button>
        <button
          type="button"
          className={state.selection.layoutMode === 'compare' ? 'active' : ''}
          onClick={() => dispatch({ type: 'layout_changed', payload: 'compare' })}
        >
          Compare
        </button>
      </div>

      {state.selection.layoutMode === 'compare' ? (
        <label className="checkbox-toggle">
          <input
            type="checkbox"
            checked={state.viewerUI.syncEnabled}
            onChange={(event) => dispatch({ type: 'viewer_sync_toggled', payload: event.target.checked })}
          />
          <span>Sync compare viewers</span>
        </label>
      ) : null}

      <label>
        Colormap
        <select
          value={renderPrefs?.colormap ?? 'gray'}
          onChange={(event) => dispatch({
            type: 'render_colormap_changed',
            payload: { datasetId: dataset.dataset_id, colormap: event.target.value },
          })}
        >
          {NIIVUE_COLORMAPS.map((colormap) => (
            <option key={colormap} value={colormap}>
              {colormap}
            </option>
          ))}
        </select>
      </label>

      <label className="range-control">
        Min
        <input
          type="range"
          min={hasBounds ? globalMin : 0}
          max={hasBounds ? displayMax : 0}
          step="any"
          value={displayMin}
          disabled={!hasBounds}
          onChange={(event) => dispatch({
            type: 'render_min_changed',
            payload: { datasetId: dataset.dataset_id, value: Number(event.target.value) },
          })}
        />
        <span>{formatRangeValue(displayMin)}</span>
      </label>

      <label className="range-control">
        Max
        <input
          type="range"
          min={hasBounds ? displayMin : 0}
          max={hasBounds ? globalMax : 0}
          step="any"
          value={displayMax}
          disabled={!hasBounds}
          onChange={(event) => dispatch({
            type: 'render_max_changed',
            payload: { datasetId: dataset.dataset_id, value: Number(event.target.value) },
          })}
        />
        <span>{formatRangeValue(displayMax)}</span>
      </label>
    </section>
  )
}

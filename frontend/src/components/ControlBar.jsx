import { useEffect, useRef, useState } from 'react'

import { NVImage } from '@niivue/niivue'

import { NIIVUE_COLORMAPS } from '../lib/colormaps'
import { TIME_DISPLAY_MODE_SECONDS, TIME_DISPLAY_MODE_TIMEPOINTS, datasetSupportsSeconds } from '../lib/time'
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

function normalizeRangeInput(value) {
  if (!Number.isFinite(value)) {
    return ''
  }

  return String(value)
}

function isIncompleteNumericInput(value) {
  return value === '' || value === '-' || value === '+' || value === '.' || value === '-.' || value === '+.'
}

export default function ControlBar() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const dataset = useActiveDataset()
  const renderPrefs = useActiveRenderPreferences()
  const pendingLoadsRef = useRef(new Set())
  const [rangeInputs, setRangeInputs] = useState({ min: '', max: '' })

  useEffect(() => {
    if (!dataset || state.session.status !== 'ready') {
      return
    }

    let ignore = false
    const discoveredBounds = state.viewerUI.renderMetaByDatasetId?.[dataset.dataset_id]?.echoBounds ?? {}
    const missingEchoes = dataset.echoes.filter((echo) => {
      const bounds = discoveredBounds[echo.echo_id]
      return !Number.isFinite(bounds?.min) || !Number.isFinite(bounds?.max) || bounds?.volumeUrl !== echo.volume_url
    })

    if (!missingEchoes.length) {
      return
    }

    missingEchoes.forEach((echo) => {
      const requestKey = `${dataset.dataset_id}:${echo.echo_id}:${echo.volume_url}`
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
                volumeUrl: echo.volume_url,
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

  const globalMin = renderPrefs?.globalMin
  const globalMax = renderPrefs?.globalMax
  const displayMin = renderPrefs?.displayMin ?? globalMin ?? 0
  const displayMax = renderPrefs?.displayMax ?? globalMax ?? 0

  useEffect(() => {
    setRangeInputs({
      min: normalizeRangeInput(displayMin),
      max: normalizeRangeInput(displayMax),
    })
  }, [dataset?.dataset_id, displayMax, displayMin])

  if (!state.session.sessionId || !dataset || state.session.status !== 'ready') {
    return null
  }

  const hasBounds = Number.isFinite(globalMin) && Number.isFinite(globalMax)
  const canDisplaySeconds = datasetSupportsSeconds(dataset)
  const timeDisplayMode = state.plots.chartPrefs.timeDisplayMode

  function handleRangeTextChange(key, actionType) {
    return (event) => {
      const nextValue = event.target.value
      setRangeInputs((current) => ({ ...current, [key]: nextValue }))

      if (isIncompleteNumericInput(nextValue)) {
        return
      }

      const parsedValue = Number(nextValue)
      if (!Number.isFinite(parsedValue)) {
        return
      }

      dispatch({
        type: actionType,
        payload: { datasetId: dataset.dataset_id, value: parsedValue },
      })
    }
  }

  function handleRangeTextBlur(key, value) {
    return () => {
      setRangeInputs((current) => ({
        ...current,
        [key]: normalizeRangeInput(value),
      }))
    }
  }

  return (
    <div className="control-panels">
      <section className="panel control-panel control-panel-nav">
        <div className="control-panel-header">
          <div>
            <p className="eyebrow">Navigation</p>
            <h2>Dataset and echo views</h2>
          </div>
          <p>Choose the active dataset, switch echoes, and move between single and compare layouts.</p>
        </div>

        <div className="control-panel-fields">
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

          <div className="control-toggle-stack">
            <span className="control-label">Viewer layout</span>
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
          </div>

          {state.selection.layoutMode === 'compare' ? (
            <label className="checkbox-toggle checkbox-toggle-card">
              <input
                type="checkbox"
                checked={state.viewerUI.syncEnabled}
                onChange={(event) => dispatch({ type: 'viewer_sync_toggled', payload: event.target.checked })}
              />
              <span>Sync compare viewers</span>
            </label>
          ) : null}
        </div>
      </section>

      <section className="panel control-panel control-panel-render">
        <div className="control-panel-header">
          <div>
            <p className="eyebrow">Rendering</p>
            <h2>Colormap, time, and crosshair</h2>
          </div>
          <p>Adjust intensity mapping, displayed time units, and crosshair presentation without affecting the current voxel selection.</p>
        </div>

        <div className="control-panel-fields control-panel-fields-render">
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

          <label className="range-control range-control-precise">
            Min
            <div className="range-control-body">
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
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={rangeInputs.min}
                disabled={!hasBounds}
                onChange={handleRangeTextChange('min', 'render_min_changed')}
                onBlur={handleRangeTextBlur('min', displayMin)}
                aria-label="Minimum color range"
              />
            </div>
            <span>{formatRangeValue(displayMin)}</span>
          </label>

          <label className="range-control range-control-precise">
            Max
            <div className="range-control-body">
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
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={rangeInputs.max}
                disabled={!hasBounds}
                onChange={handleRangeTextChange('max', 'render_max_changed')}
                onBlur={handleRangeTextBlur('max', displayMax)}
                aria-label="Maximum color range"
              />
            </div>
            <span>{formatRangeValue(displayMax)}</span>
          </label>

          <div className="control-toggle-stack">
            <span className="control-label">Time display</span>
            <div className="layout-toggle">
              <button
                type="button"
                className={timeDisplayMode === TIME_DISPLAY_MODE_TIMEPOINTS ? 'active' : ''}
                onClick={() => dispatch({ type: 'time_display_mode_changed', payload: TIME_DISPLAY_MODE_TIMEPOINTS })}
              >
                Timepoints
              </button>
              <button
                type="button"
                className={timeDisplayMode === TIME_DISPLAY_MODE_SECONDS ? 'active' : ''}
                disabled={!canDisplaySeconds}
                onClick={() => dispatch({ type: 'time_display_mode_changed', payload: TIME_DISPLAY_MODE_SECONDS })}
              >
                Seconds
              </button>
            </div>
            <span className="control-hint">
              {canDisplaySeconds
                ? `TR ${formatRangeValue(dataset.tr_ms)} ms is available for this dataset.`
                : 'Seconds view is unavailable until TR metadata is provided.'}
            </span>
          </div>

          <label className="checkbox-toggle checkbox-toggle-card">
            <input
              type="checkbox"
              checked={state.viewerUI.showCrosshair}
              onChange={(event) => dispatch({ type: 'viewer_crosshair_toggled', payload: event.target.checked })}
            />
            <span>Show crosshair</span>
          </label>

          <label className="range-control">
            Crosshair width
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={state.viewerUI.crosshairWidth}
              onChange={(event) => dispatch({
                type: 'viewer_crosshair_width_changed',
                payload: Number(event.target.value),
              })}
            />
            <span>{formatRangeValue(state.viewerUI.crosshairWidth)}</span>
          </label>
        </div>
      </section>
    </div>
  )
}

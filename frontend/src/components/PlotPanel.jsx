import { useEffect, useRef, useState } from 'react'

import Plot from 'react-plotly.js'

import { fetchEchoCurve, fetchPlotContext, fetchTimeCourse } from '../lib/api'
import { getTimeAxisTitle, normalizeTimeDisplayMode, timepointToSeconds } from '../lib/time'
import { useAppDispatch, useAppState, useActiveDataset } from '../state/app-state'

const PLOT_BUFFER_MS = 100

function isPlotDebugEnabled() {
  return typeof window !== 'undefined' && window.__ME_VIEW_DEBUG_PLOTS__ === true
}

function debugPlot(event, payload) {
  if (!isPlotDebugEnabled()) {
    return
  }

  console.log(`[PlotPanel] ${event}`, payload)
}

function hasVoxelSelection(value) {
  return value != null && typeof value.length === 'number' && value.length >= 3
}

function getTimeSeriesXValue(point, dataset, timeDisplayMode) {
  if (normalizeTimeDisplayMode(timeDisplayMode, dataset) === 'seconds') {
    if (point.time_ms != null) {
      return point.time_ms / 1000
    }
    return timepointToSeconds(point.timepoint, dataset?.tr_ms) ?? point.timepoint
  }
  return point.timepoint
}

export default function PlotPanel() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const dataset = useActiveDataset()
  const sessionReady = state.session.status === 'ready'
  const sessionId = state.session.sessionId
  const voxel = state.selection.selectedVoxelIJK
  const datasetId = dataset?.dataset_id ?? null
  const activeEchoId = state.selection.activeEchoId
  const selectedTimepoint = state.selection.selectedTimepoint
  const [plotSelection, setPlotSelection] = useState(null)
  const echoCurveRequestKeyRef = useRef(null)
  const timeCourseRequestKeyRef = useRef(null)
  const contextRequestKeyRef = useRef(null)
  const echoCurve = state.plots.echoCurve.data
  const timeCourse = state.plots.timeCourse.data
  const echoCurveState = state.plots.echoCurve
  const timeCourseState = state.plots.timeCourse
  const timeDisplayMode = normalizeTimeDisplayMode(state.plots.chartPrefs.timeDisplayMode, dataset)
  const echoCurveUsesEchoTime = Boolean(echoCurve?.echoes?.length) && echoCurve.echoes.every((point) => point.echo_time_ms != null)
  const echoCurveXAxisTitle = echoCurveUsesEchoTime ? 'Echo Time (ms)' : 'Echo'
  const timeSeriesX = timeCourse?.series?.map((point) => getTimeSeriesXValue(point, dataset, timeDisplayMode)) ?? []
  const selectedTimeSeriesX = hasVoxelSelection(voxel)
    ? timeSeriesX[selectedTimepoint] ?? getTimeSeriesXValue({ timepoint: selectedTimepoint }, dataset, timeDisplayMode)
    : null

  useEffect(() => {
    if (!sessionId || !sessionReady || !datasetId || !voxel) {
      debugPlot('buffer:reset', {
        sessionId,
        sessionReady,
        datasetId,
        voxel,
      })
      setPlotSelection(null)
      return
    }

    const nextSelection = {
      sessionId,
      datasetId,
      voxel: voxel.slice(0, 3),
      activeEchoId,
      selectedTimepoint,
    }
    debugPlot('buffer:schedule', nextSelection)
    const timeoutId = window.setTimeout(() => {
      debugPlot('buffer:commit', nextSelection)
      setPlotSelection(nextSelection)
    }, PLOT_BUFFER_MS)

    return () => {
      debugPlot('buffer:clear', nextSelection)
      window.clearTimeout(timeoutId)
    }
  }, [activeEchoId, datasetId, selectedTimepoint, sessionId, sessionReady, voxel])

  useEffect(() => {
    debugPlot('state:plots', {
      selection: {
        voxel,
        activeEchoId,
        selectedTimepoint,
      },
      bufferedSelection: plotSelection,
      echoCurve: {
        status: echoCurveState.status,
        queryKey: echoCurveState.queryKey,
        hasData: Boolean(echoCurve),
        error: echoCurveState.error,
      },
      timeCourse: {
        status: timeCourseState.status,
        queryKey: timeCourseState.queryKey,
        hasData: Boolean(timeCourse),
        error: timeCourseState.error,
      },
      context: {
        status: state.plots.context.status,
        queryKey: state.plots.context.queryKey,
        hasData: Boolean(state.plots.context.data),
        error: state.plots.context.error,
      },
    })
  }, [activeEchoId, echoCurve, echoCurveState.error, echoCurveState.queryKey, echoCurveState.status, plotSelection, selectedTimepoint, state.plots.context.data, state.plots.context.error, state.plots.context.queryKey, state.plots.context.status, timeCourse, timeCourseState.error, timeCourseState.queryKey, timeCourseState.status, voxel])

  useEffect(() => {
    if (!plotSelection) {
      return
    }

    const controller = new AbortController()
    const echoCurveKey = `${plotSelection.sessionId}:${plotSelection.datasetId}:${plotSelection.voxel.join(':')}:${plotSelection.selectedTimepoint}`
    echoCurveRequestKeyRef.current = echoCurveKey
    debugPlot('echoCurve:request', {
      queryKey: echoCurveKey,
      plotSelection,
    })
    dispatch({ type: 'echo_curve_requested', payload: echoCurveKey })
    fetchEchoCurve({
      sessionId: plotSelection.sessionId,
      datasetId: plotSelection.datasetId,
      voxel: plotSelection.voxel,
      timepoint: plotSelection.selectedTimepoint,
      signal: controller.signal,
    })
      .then((payload) => {
        if (echoCurveRequestKeyRef.current !== echoCurveKey) {
          debugPlot('echoCurve:drop-stale-success', {
            queryKey: echoCurveKey,
            activeRequest: echoCurveRequestKeyRef.current,
          })
          return
        }
        debugPlot('echoCurve:success', {
          queryKey: echoCurveKey,
          points: payload?.echoes?.length ?? null,
          selectedTimepoint: payload?.selected_timepoint,
        })
        dispatch({ type: 'echo_curve_loaded', payload, queryKey: echoCurveKey })
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          debugPlot('echoCurve:aborted', { queryKey: echoCurveKey })
          return
        }
        if (echoCurveRequestKeyRef.current !== echoCurveKey) {
          debugPlot('echoCurve:drop-stale-error', {
            queryKey: echoCurveKey,
            activeRequest: echoCurveRequestKeyRef.current,
            message: error.message,
          })
          return
        }
        debugPlot('echoCurve:error', {
          queryKey: echoCurveKey,
          message: error.message,
        })
        dispatch({ type: 'plot_failed', plot: 'echoCurve', payload: error.message, queryKey: echoCurveKey })
      })

    return () => {
      debugPlot('echoCurve:cleanup', { queryKey: echoCurveKey })
      controller.abort()
    }
  }, [dispatch, plotSelection])

  useEffect(() => {
    if (!plotSelection?.activeEchoId) {
      return
    }

    const controller = new AbortController()
    const timeCourseKey = `${plotSelection.sessionId}:${plotSelection.datasetId}:${plotSelection.voxel.join(':')}:${plotSelection.activeEchoId}`
    timeCourseRequestKeyRef.current = timeCourseKey
    debugPlot('timeCourse:request', {
      queryKey: timeCourseKey,
      plotSelection,
    })
    dispatch({ type: 'time_course_requested', payload: timeCourseKey })
    fetchTimeCourse({
      sessionId: plotSelection.sessionId,
      datasetId: plotSelection.datasetId,
      voxel: plotSelection.voxel,
      echoId: plotSelection.activeEchoId,
      signal: controller.signal,
    })
      .then((payload) => {
        if (timeCourseRequestKeyRef.current !== timeCourseKey) {
          debugPlot('timeCourse:drop-stale-success', {
            queryKey: timeCourseKey,
            activeRequest: timeCourseRequestKeyRef.current,
          })
          return
        }
        debugPlot('timeCourse:success', {
          queryKey: timeCourseKey,
          points: payload?.series?.length ?? null,
          selectedTimepoint: payload?.selected_timepoint,
        })
        dispatch({ type: 'time_course_loaded', payload, queryKey: timeCourseKey })
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          debugPlot('timeCourse:aborted', { queryKey: timeCourseKey })
          return
        }
        if (timeCourseRequestKeyRef.current !== timeCourseKey) {
          debugPlot('timeCourse:drop-stale-error', {
            queryKey: timeCourseKey,
            activeRequest: timeCourseRequestKeyRef.current,
            message: error.message,
          })
          return
        }
        debugPlot('timeCourse:error', {
          queryKey: timeCourseKey,
          message: error.message,
        })
        dispatch({ type: 'plot_failed', plot: 'timeCourse', payload: error.message, queryKey: timeCourseKey })
      })

    return () => {
      debugPlot('timeCourse:cleanup', { queryKey: timeCourseKey })
      controller.abort()
    }
  }, [dispatch, plotSelection?.activeEchoId, plotSelection?.datasetId, plotSelection?.sessionId, plotSelection?.voxel])

  useEffect(() => {
    if (!plotSelection?.activeEchoId) {
      return
    }

    const controller = new AbortController()
    const contextKey = `${plotSelection.sessionId}:${plotSelection.datasetId}:${plotSelection.voxel.join(':')}:${plotSelection.activeEchoId}:${plotSelection.selectedTimepoint}`
    contextRequestKeyRef.current = contextKey
    debugPlot('context:request', {
      queryKey: contextKey,
      plotSelection,
    })
    dispatch({ type: 'context_requested', payload: contextKey })
    fetchPlotContext({
      sessionId: plotSelection.sessionId,
      datasetId: plotSelection.datasetId,
      voxel: plotSelection.voxel,
      echoId: plotSelection.activeEchoId,
      timepoint: plotSelection.selectedTimepoint,
      signal: controller.signal,
    })
      .then((payload) => {
        if (contextRequestKeyRef.current !== contextKey) {
          debugPlot('context:drop-stale-success', {
            queryKey: contextKey,
            activeRequest: contextRequestKeyRef.current,
          })
          return
        }
        debugPlot('context:success', {
          queryKey: contextKey,
          value: payload?.value,
          timepoint: payload?.timepoint,
          assetId: payload?.asset_id,
        })
        dispatch({ type: 'plot_context_loaded', payload, queryKey: contextKey })
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          debugPlot('context:aborted', { queryKey: contextKey })
          return
        }
        if (contextRequestKeyRef.current !== contextKey) {
          debugPlot('context:drop-stale-error', {
            queryKey: contextKey,
            activeRequest: contextRequestKeyRef.current,
            message: error.message,
          })
          return
        }
        debugPlot('context:error', {
          queryKey: contextKey,
          message: error.message,
        })
        dispatch({ type: 'plot_failed', plot: 'context', payload: error.message, queryKey: contextKey })
      })

    return () => {
      debugPlot('context:cleanup', { queryKey: contextKey })
      controller.abort()
    }
  }, [dispatch, plotSelection])

  function renderPlotStatus(plotState) {
    if (plotState.status === 'loading' && plotState.data) {
      return <span className="plot-status">Updating…</span>
    }
    if (plotState.status === 'error' && plotState.data && plotState.error) {
      return <span className="plot-status plot-status-error">Update failed</span>
    }
    return null
  }

  function renderPanelBody(kind) {
    if (state.session.status === 'needs_review') {
      return <p className="empty-copy">Finalize the session before requesting plot data.</p>
    }
    if (state.session.status !== 'ready') {
      return <p className="empty-copy">Create a valid session to activate quantitative plots.</p>
    }
    if (!voxel) {
      return <p className="empty-copy">Select a voxel in NiiVue to populate this panel.</p>
    }
    if (kind === 'time-course' && !state.selection.activeEchoId) {
      return <p className="empty-copy">Choose an active echo to render the time course.</p>
    }
    const plotState = kind === 'echo-curve' ? echoCurveState : timeCourseState
    if (plotState.status === 'error' && plotState.error) {
      return <p className="error-text">{plotState.error}</p>
    }
    if (plotState.status === 'loading') {
      return <p className="empty-copy">Loading plot data…</p>
    }
    return null
  }

  const canRenderEchoCurve = sessionReady && hasVoxelSelection(voxel) && Boolean(echoCurve)
  const canRenderTimeCourse = sessionReady && hasVoxelSelection(voxel) && Boolean(activeEchoId) && Boolean(timeCourse)

  return (
    <section className="panel plot-panel">
      <div className="plot-card">
        <div className="plot-card-head">
          <p className="eyebrow">Echo Curve</p>
          {renderPlotStatus(echoCurveState)}
        </div>
        {canRenderEchoCurve ? (
          <Plot
            data={[
              {
                type: 'scatter',
                mode: 'lines+markers',
                x: echoCurve.echoes.map((point) => (echoCurveUsesEchoTime ? point.echo_time_ms : point.echo_index)),
                y: echoCurve.echoes.map((point) => point.value),
                marker: {
                  color: echoCurve.echoes.map((point) => (point.echo_id === activeEchoId ? '#d44f2a' : '#1b6b73')),
                  size: 11,
                },
                line: { color: '#0f3b46', width: 3 },
              },
            ]}
            layout={{
              autosize: true,
              margin: { l: 48, r: 20, t: 24, b: 44 },
              paper_bgcolor: '#f3efe6',
              plot_bgcolor: '#fdf9f1',
              xaxis: { title: echoCurveXAxisTitle },
              yaxis: { title: 'Signal' },
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          renderPanelBody('echo-curve')
        )}
      </div>

      <div className="plot-card">
        <div className="plot-card-head">
          <p className="eyebrow">Time Course</p>
          {renderPlotStatus(timeCourseState)}
        </div>
        {canRenderTimeCourse ? (
          <Plot
            data={[
              {
                type: 'scattergl',
                mode: 'lines',
                x: timeSeriesX,
                y: timeCourse.series.map((point) => point.value),
                line: { color: '#1b6b73', width: 2 },
              },
            ]}
            layout={{
              autosize: true,
              margin: { l: 48, r: 20, t: 24, b: 44 },
              paper_bgcolor: '#f3efe6',
              plot_bgcolor: '#fdf9f1',
              xaxis: { title: getTimeAxisTitle(dataset, timeDisplayMode) },
              yaxis: { title: 'Signal' },
              shapes: selectedTimeSeriesX != null
                ? [
                    {
                      type: 'line',
                      x0: selectedTimeSeriesX,
                      x1: selectedTimeSeriesX,
                      y0: 0,
                      y1: 1,
                      yref: 'paper',
                      line: { color: '#d44f2a', width: 2, dash: 'dot' },
                    },
                  ]
                : [],
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          renderPanelBody('time-course')
        )}
      </div>
    </section>
  )
}

import { createContext, useContext, useMemo, useReducer, useRef } from 'react'

const DEFAULT_COLORMAP = 'gray'

function getDatasetRenderState(session, viewerUI, datasetId) {
  if (!datasetId) {
    return null
  }

  const echoIds = session.datasets.find((dataset) => dataset.dataset_id === datasetId)?.echoes.map((echo) => echo.echo_id) ?? []
  const discovered = viewerUI.renderMetaByDatasetId?.[datasetId]?.echoBounds ?? {}
  const values = echoIds
    .map((echoId) => discovered[echoId])
    .filter((bounds) => Number.isFinite(bounds?.min) && Number.isFinite(bounds?.max))

  const globalMin = values.length ? Math.min(...values.map((bounds) => bounds.min)) : null
  const globalMax = values.length ? Math.max(...values.map((bounds) => bounds.max)) : null
  const existing = viewerUI.renderPrefsByDatasetId?.[datasetId]
  const nextColormap = existing?.colormap ?? session.viewerDefaults?.colormap ?? DEFAULT_COLORMAP

  let displayMin = existing?.displayMin
  let displayMax = existing?.displayMax
  if (!Number.isFinite(displayMin)) {
    displayMin = globalMin
  }
  if (!Number.isFinite(displayMax)) {
    displayMax = globalMax
  }
  if (Number.isFinite(globalMin) && Number.isFinite(displayMin) && displayMin < globalMin) {
    displayMin = globalMin
  }
  if (Number.isFinite(globalMax) && Number.isFinite(displayMax) && displayMax > globalMax) {
    displayMax = globalMax
  }
  if (Number.isFinite(displayMin) && Number.isFinite(displayMax) && displayMin > displayMax) {
    displayMin = displayMax
  }
  if (Number.isFinite(displayMax) && Number.isFinite(displayMin) && displayMax < displayMin) {
    displayMax = displayMin
  }

  return {
    colormap: nextColormap,
    displayMin: Number.isFinite(displayMin) ? displayMin : null,
    displayMax: Number.isFinite(displayMax) ? displayMax : null,
    globalMin: Number.isFinite(globalMin) ? globalMin : null,
    globalMax: Number.isFinite(globalMax) ? globalMax : null,
  }
}

function withDatasetRenderState(state, datasetId, updater) {
  if (!datasetId) {
    return state.viewerUI
  }

  const currentPrefs = state.viewerUI.renderPrefsByDatasetId?.[datasetId] ?? null
  const nextPrefs = updater(currentPrefs)

  return {
    ...state.viewerUI,
    renderPrefsByDatasetId: {
      ...state.viewerUI.renderPrefsByDatasetId,
      [datasetId]: nextPrefs,
    },
  }
}

function clampRenderValue(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

const AppStateContext = createContext(null)
const AppDispatchContext = createContext(null)
const ViewerRegistryContext = createContext(null)

const initialState = {
  session: {
    sessionId: null,
    status: 'idle',
    datasets: [],
    review: null,
    viewerDefaults: null,
    isLoading: false,
    loadError: null,
  },
  selection: {
    selectedDatasetId: null,
    activeEchoId: null,
    selectedTimepoint: 0,
    selectedVoxelIJK: null,
    selectedVoxelMM: null,
    layoutMode: 'single',
    isPinnedSelection: false,
  },
  viewerUI: {
    syncEnabled: true,
    viewerStatusById: {},
    displayByViewerId: {},
    renderPrefsByDatasetId: {},
    renderMetaByDatasetId: {},
    compareOrder: [],
    showCrosshair: true,
    interpolationEnabled: true,
  },
  plots: {
    echoCurve: { status: 'idle', queryKey: null, data: null, error: null },
    timeCourse: { status: 'idle', queryKey: null, data: null, error: null },
    context: { status: 'idle', queryKey: null, data: null, error: null },
    chartPrefs: {
      echoXAxisMode: 'echo_time_ms',
      timeXAxisMode: 'time_ms',
    },
  },
}

function reducer(state, action) {
  switch (action.type) {
    case 'session_load_started':
      return {
        ...state,
        session: { ...state.session, isLoading: true, loadError: null },
      }
    case 'session_loaded': {
      const session = action.payload
      const selectedDatasetId = session.viewer_defaults?.dataset_id ?? session.datasets[0]?.dataset_id ?? null
      const nextViewerUI = {
        ...state.viewerUI,
        renderPrefsByDatasetId: selectedDatasetId
          ? {
              ...state.viewerUI.renderPrefsByDatasetId,
              [selectedDatasetId]: {
                colormap: session.viewer_defaults?.colormap ?? DEFAULT_COLORMAP,
                displayMin: null,
                displayMax: null,
              },
            }
          : state.viewerUI.renderPrefsByDatasetId,
      }
      return {
        ...state,
        session: {
          sessionId: session.session_id,
          status: session.status,
          datasets: session.datasets,
          review: session.review,
          viewerDefaults: session.viewer_defaults,
          isLoading: false,
          loadError: null,
        },
        viewerUI: nextViewerUI,
        selection: {
          ...state.selection,
          selectedDatasetId,
          activeEchoId: session.viewer_defaults?.active_echo_id ?? session.datasets[0]?.echoes?.[0]?.echo_id ?? null,
          selectedTimepoint: session.viewer_defaults?.active_timepoint ?? 0,
          layoutMode: session.viewer_defaults?.layout ?? 'single',
        },
      }
    }
    case 'session_refreshed': {
      const session = action.payload
      const nextDataset =
        session.datasets.find((dataset) => dataset.dataset_id === state.selection.selectedDatasetId) ??
        session.datasets[0] ??
        null
      const nextEchoId =
        nextDataset?.echoes.find((echo) => echo.echo_id === state.selection.activeEchoId)?.echo_id ??
        nextDataset?.echoes?.[0]?.echo_id ??
        null

      const nextViewerUI = {
        ...state.viewerUI,
        renderPrefsByDatasetId: {
          ...state.viewerUI.renderPrefsByDatasetId,
          ...(nextDataset?.dataset_id && !state.viewerUI.renderPrefsByDatasetId?.[nextDataset.dataset_id]
            ? {
                [nextDataset.dataset_id]: {
                  colormap: session.viewer_defaults?.colormap ?? DEFAULT_COLORMAP,
                  displayMin: null,
                  displayMax: null,
                },
              }
            : {}),
        },
      }

      return {
        ...state,
        session: {
          sessionId: session.session_id,
          status: session.status,
          datasets: session.datasets,
          review: session.review,
          viewerDefaults: session.viewer_defaults,
          isLoading: false,
          loadError: null,
        },
        viewerUI: nextViewerUI,
        selection: {
          ...state.selection,
          selectedDatasetId: nextDataset?.dataset_id ?? null,
          activeEchoId: nextEchoId,
        },
      }
    }
    case 'session_failed':
      return {
        ...state,
        session: { ...state.session, isLoading: false, loadError: action.payload, status: 'error' },
      }
    case 'dataset_selected':
      return {
        ...state,
        viewerUI: withDatasetRenderState(state, action.payload.datasetId, (existing) => ({
          colormap: existing?.colormap ?? state.session.viewerDefaults?.colormap ?? DEFAULT_COLORMAP,
          displayMin: existing?.displayMin ?? null,
          displayMax: existing?.displayMax ?? null,
        })),
        selection: {
          ...state.selection,
          selectedDatasetId: action.payload.datasetId,
          activeEchoId: action.payload.activeEchoId,
          selectedTimepoint: 0,
          selectedVoxelIJK: null,
          selectedVoxelMM: null,
          isPinnedSelection: false,
        },
      }
    case 'render_bounds_discovered': {
      const { datasetId, echoId, min, max } = action.payload
      if (!datasetId || !echoId || !Number.isFinite(min) || !Number.isFinite(max)) {
        return state
      }

      const nextMetaByDatasetId = {
        ...state.viewerUI.renderMetaByDatasetId,
        [datasetId]: {
          ...(state.viewerUI.renderMetaByDatasetId?.[datasetId] ?? {}),
          echoBounds: {
            ...(state.viewerUI.renderMetaByDatasetId?.[datasetId]?.echoBounds ?? {}),
            [echoId]: { min, max },
          },
        },
      }

      const intermediateState = {
        ...state,
        viewerUI: {
          ...state.viewerUI,
          renderMetaByDatasetId: nextMetaByDatasetId,
        },
      }
      const derived = getDatasetRenderState(intermediateState.session, intermediateState.viewerUI, datasetId)

      return {
        ...intermediateState,
        viewerUI: {
          ...intermediateState.viewerUI,
          renderPrefsByDatasetId: {
            ...intermediateState.viewerUI.renderPrefsByDatasetId,
            [datasetId]: {
              colormap: derived?.colormap ?? DEFAULT_COLORMAP,
              displayMin: derived?.displayMin ?? null,
              displayMax: derived?.displayMax ?? null,
            },
          },
        },
      }
    }
    case 'render_colormap_changed': {
      const datasetId = action.payload.datasetId ?? state.selection.selectedDatasetId
      if (!datasetId) {
        return state
      }
      return {
        ...state,
        viewerUI: withDatasetRenderState(state, datasetId, (existing) => ({
          colormap: action.payload.colormap,
          displayMin: existing?.displayMin ?? null,
          displayMax: existing?.displayMax ?? null,
        })),
      }
    }
    case 'render_min_changed': {
      const datasetId = action.payload.datasetId ?? state.selection.selectedDatasetId
      const derived = getDatasetRenderState(state.session, state.viewerUI, datasetId)
      if (!datasetId || !derived) {
        return state
      }

      const nextMin = clampRenderValue(action.payload.value, derived.displayMin)
      const boundedMin = Number.isFinite(derived.globalMin) ? Math.max(derived.globalMin, nextMin) : nextMin
      const cappedMin = Number.isFinite(derived.displayMax) ? Math.min(boundedMin, derived.displayMax) : boundedMin

      return {
        ...state,
        viewerUI: withDatasetRenderState(state, datasetId, (existing) => ({
          colormap: existing?.colormap ?? derived.colormap,
          displayMin: cappedMin,
          displayMax: existing?.displayMax ?? derived.displayMax,
        })),
      }
    }
    case 'render_max_changed': {
      const datasetId = action.payload.datasetId ?? state.selection.selectedDatasetId
      const derived = getDatasetRenderState(state.session, state.viewerUI, datasetId)
      if (!datasetId || !derived) {
        return state
      }

      const nextMax = clampRenderValue(action.payload.value, derived.displayMax)
      const boundedMax = Number.isFinite(derived.globalMax) ? Math.min(derived.globalMax, nextMax) : nextMax
      const flooredMax = Number.isFinite(derived.displayMin) ? Math.max(boundedMax, derived.displayMin) : boundedMax

      return {
        ...state,
        viewerUI: withDatasetRenderState(state, datasetId, (existing) => ({
          colormap: existing?.colormap ?? derived.colormap,
          displayMin: existing?.displayMin ?? derived.displayMin,
          displayMax: flooredMax,
        })),
      }
    }
    case 'echo_selected':
      return {
        ...state,
        selection: { ...state.selection, activeEchoId: action.payload },
      }
    case 'timepoint_selected':
      return {
        ...state,
        selection: { ...state.selection, selectedTimepoint: action.payload },
      }
    case 'voxel_selected':
      return {
        ...state,
        selection: {
          ...state.selection,
          selectedVoxelIJK: action.payload.ijk,
          selectedVoxelMM: action.payload.mm,
          isPinnedSelection: true,
        },
      }
    case 'layout_changed':
      return {
        ...state,
        selection: { ...state.selection, layoutMode: action.payload },
      }
    case 'viewer_sync_toggled':
      return {
        ...state,
        viewerUI: { ...state.viewerUI, syncEnabled: action.payload },
      }
    case 'viewer_ready':
      return {
        ...state,
        viewerUI: {
          ...state.viewerUI,
          viewerStatusById: {
            ...state.viewerUI.viewerStatusById,
            [action.payload]: { ready: true },
          },
        },
      }
    case 'echo_curve_requested':
      return {
        ...state,
        plots: {
          ...state.plots,
          echoCurve: {
            status: 'loading',
            queryKey: action.payload,
            data: state.plots.echoCurve.data,
            error: null,
          },
        },
      }
    case 'echo_curve_loaded':
      return {
        ...state,
        plots: {
          ...state.plots,
          echoCurve: { status: 'success', queryKey: action.queryKey, data: action.payload, error: null },
        },
      }
    case 'time_course_requested':
      return {
        ...state,
        plots: {
          ...state.plots,
          timeCourse: {
            status: 'loading',
            queryKey: action.payload,
            data: state.plots.timeCourse.data,
            error: null,
          },
        },
      }
    case 'time_course_loaded':
      return {
        ...state,
        plots: {
          ...state.plots,
          timeCourse: { status: 'success', queryKey: action.queryKey, data: action.payload, error: null },
        },
      }
    case 'context_requested':
      return {
        ...state,
        plots: {
          ...state.plots,
          context: {
            status: 'loading',
            queryKey: action.payload,
            data: state.plots.context.data,
            error: null,
          },
        },
      }
    case 'plot_context_loaded':
      return {
        ...state,
        plots: {
          ...state.plots,
          context: { status: 'success', queryKey: action.queryKey, data: action.payload, error: null },
        },
      }
    case 'plot_failed': {
      const currentPlotState = state.plots[action.plot]

      return {
        ...state,
        plots: {
          ...state.plots,
          [action.plot]: {
            status: 'error',
            queryKey: action.queryKey,
            data: currentPlotState.data,
            error: action.payload,
          },
        },
      }
    }
    default:
      return state
  }
}

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const registryRef = useRef(new Map())
  const viewerRegistry = useMemo(
    () => ({
      register(viewerId, viewer) {
        registryRef.current.set(viewerId, viewer)
      },
      unregister(viewerId) {
        registryRef.current.delete(viewerId)
      },
      get(viewerId) {
        return registryRef.current.get(viewerId)
      },
      all() {
        return Array.from(registryRef.current.entries())
      },
    }),
    [],
  )

  return (
    <ViewerRegistryContext.Provider value={viewerRegistry}>
      <AppDispatchContext.Provider value={dispatch}>
        <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider>
      </AppDispatchContext.Provider>
    </ViewerRegistryContext.Provider>
  )
}

export function useAppState() {
  const context = useContext(AppStateContext)
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider')
  }
  return context
}

export function useAppDispatch() {
  const context = useContext(AppDispatchContext)
  if (!context) {
    throw new Error('useAppDispatch must be used within AppStateProvider')
  }
  return context
}

export function useViewerRegistry() {
  const context = useContext(ViewerRegistryContext)
  if (!context) {
    throw new Error('useViewerRegistry must be used within AppStateProvider')
  }
  return context
}

export function useActiveDataset() {
  const state = useAppState()
  return state.session.datasets.find((dataset) => dataset.dataset_id === state.selection.selectedDatasetId) ?? null
}

export function useActiveRenderPreferences() {
  const state = useAppState()
  return getDatasetRenderState(state.session, state.viewerUI, state.selection.selectedDatasetId)
}

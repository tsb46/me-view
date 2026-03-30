import { useEffect, useRef, useState } from 'react'

import { Niivue } from '@niivue/niivue'

import { registerCustomColormaps } from '../lib/colormaps'
import { useActiveRenderPreferences, useAppDispatch, useAppState, useViewerRegistry } from '../state/app-state'

function isCoordinateTriplet(value) {
  return value != null && typeof value.length === 'number' && value.length >= 3
}

function toCoordinateArray(value, mapper = (entry) => entry) {
  if (!isCoordinateTriplet(value)) {
    return null
  }

  return Array.from(value).slice(0, 3).map(mapper)
}

function hasSameLocation(left, right) {
  if (!isCoordinateTriplet(left) || !isCoordinateTriplet(right)) {
    return false
  }

  return Array.from(left).slice(0, 3).every((value, index) => Math.abs(value - right[index]) < 0.001)
}

export default function NiiVueCanvas({ viewerId, datasetId, label, fileName, volumeUrl, currentFrame }) {
  const canvasRef = useRef(null)
  const nvRef = useRef(null)
  const loadAttemptRef = useRef(0)
  const state = useAppState()
  const dispatch = useAppDispatch()
  const registry = useViewerRegistry()
  const renderPrefs = useActiveRenderPreferences()
  const selectedVoxelMM = state.selection.selectedVoxelMM
  const [isViewerReady, setIsViewerReady] = useState(false)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function setup() {
      if (!canvasRef.current || nvRef.current) {
        return
      }
      console.log('[NiiVueCanvas] setup:start', { viewerId, label })
      setIsViewerReady(false)
      const nv = new Niivue({ isResizeCanvas: true })
      registerCustomColormaps(nv)
      await nv.attachToCanvas(canvasRef.current)
      console.log('[NiiVueCanvas] setup:attached', { viewerId, label })
      nv.onVolumeAddedFromUrl = (imageOptions, volume) => {
        console.log('[NiiVueCanvas] onVolumeAddedFromUrl', {
          viewerId,
          label,
          url: imageOptions?.url,
          requestedName: imageOptions?.name,
          loadedName: volume?.name,
          id: volume?.id,
          dims: volume?.dims,
          nFrame4D: volume?.nFrame4D,
        })
      }
      nv.onImageLoaded = (volume) => {
        console.log('[NiiVueCanvas] onImageLoaded', {
          viewerId,
          datasetId,
          label,
          name: volume?.name,
          id: volume?.id,
          dims: volume?.dims,
          nFrame4D: volume?.nFrame4D,
          calMin: volume?.cal_min,
          calMax: volume?.cal_max,
        })
        if (Number.isFinite(volume?.cal_min) && Number.isFinite(volume?.cal_max)) {
          dispatch({
            type: 'render_bounds_discovered',
            payload: {
              datasetId,
              echoId: viewerId,
              min: volume.cal_min,
              max: volume.cal_max,
            },
          })
        }
      }
      nv.onLocationChange = (location) => {
        if (ignore || !location?.vox) {
          return
        }
        dispatch({
          type: 'voxel_selected',
          payload: {
            ijk: toCoordinateArray(location.vox, (value) => Math.round(value)),
            mm: toCoordinateArray(location.mm),
          },
        })
      }
      nv.onFrameChange = (_, frameNumber) => {
        if (!ignore) {
          dispatch({ type: 'timepoint_selected', payload: frameNumber })
        }
      }
      nvRef.current = nv
      setIsViewerReady(true)
      registry.register(viewerId, { nv })
      dispatch({ type: 'viewer_ready', payload: viewerId })
    }

    setup()

    return () => {
      ignore = true
      setIsViewerReady(false)
      registry.unregister(viewerId)
      if (nvRef.current) {
        nvRef.current.cleanup()
        nvRef.current = null
      }
    }
  }, [datasetId, dispatch, label, registry, viewerId])

  useEffect(() => {
    async function loadVolume() {
      const nv = nvRef.current
      if (!isViewerReady || !nv || !volumeUrl) {
        return
      }
      const attempt = loadAttemptRef.current + 1
      loadAttemptRef.current = attempt
      const requestedName = fileName || label
      const startedAt = performance.now()
      const timeoutIds = [2000, 10000, 30000].map((delay) => window.setTimeout(() => {
        if (loadAttemptRef.current !== attempt) {
          return
        }
        console.warn('[NiiVueCanvas] loadVolume:pending', {
          viewerId,
          label,
          requestedName,
          volumeUrl,
          delayMs: delay,
          volumeCount: nv.volumes.length,
        })
      }, delay))
      const clearPendingLogs = () => {
        timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
      }

      console.groupCollapsed(`[NiiVueCanvas] load attempt ${attempt}: ${label}`)
      console.log('loadVolume:start', { viewerId, label, fileName, requestedName, volumeUrl })
      setLoadError(null)

      try {
        const headResponse = await fetch(volumeUrl, { method: 'HEAD' })
        console.log('loadVolume:head', {
          ok: headResponse.ok,
          status: headResponse.status,
          statusText: headResponse.statusText,
          contentLength: headResponse.headers.get('content-length'),
          contentType: headResponse.headers.get('content-type'),
          contentDisposition: headResponse.headers.get('content-disposition'),
          acceptRanges: headResponse.headers.get('accept-ranges'),
        })
      } catch (headError) {
        console.warn('loadVolume:headFailed', {
          viewerId,
          label,
          message: headError instanceof Error ? headError.message : String(headError),
        })
      }

      while (nv.volumes.length > 0) {
        nv.removeVolumeByIndex(0)
      }
      try {
        console.log('loadVolume:callingNiivue', { requestedName, existingVolumes: nv.volumes.length })
        await nv.loadVolumes([{ url: volumeUrl, name: requestedName }])
        console.log('loadVolume:resolved', {
          viewerId,
          label,
          requestedName,
          elapsedMs: Math.round(performance.now() - startedAt),
          volumeCount: nv.volumes.length,
          activeVolume: nv.volumes[0]
            ? {
                id: nv.volumes[0].id,
                name: nv.volumes[0].name,
                dims: nv.volumes[0].dims,
                nFrame4D: nv.volumes[0].nFrame4D,
              }
            : null,
        })
      } finally {
        clearPendingLogs()
      }
      console.groupEnd()
    }

    loadVolume().catch((error) => {
      loadAttemptRef.current += 1
      console.groupEnd()
      console.error('Failed to load volume into NiiVue', error)
      setLoadError(error.message)
    })
  }, [fileName, isViewerReady, label, volumeUrl, viewerId])

  useEffect(() => {
    const nv = nvRef.current
    if (!nv || !nv.volumes.length || !isCoordinateTriplet(selectedVoxelMM)) {
      return
    }

    const nextMM = Array.from(selectedVoxelMM).slice(0, 3)
    if (nextMM.some((value) => !Number.isFinite(value))) {
      return
    }

    const currentMM = nv.frac2mm(nv.scene.crosshairPos)
    if (hasSameLocation(currentMM, nextMM)) {
      return
    }

    nv.scene.crosshairPos = nv.mm2frac(nextMM)
    nv.drawScene()
  }, [selectedVoxelMM, volumeUrl])

  useEffect(() => {
    const nv = nvRef.current
    const activeVolume = nv?.volumes?.[0]
    if (!nv || !activeVolume?.id || !renderPrefs) {
      return
    }

    if (renderPrefs.colormap && activeVolume.colormap !== renderPrefs.colormap) {
      nv.setColormap(activeVolume.id, renderPrefs.colormap)
    }

    let shouldRefresh = false
    if (Number.isFinite(renderPrefs.displayMin) && activeVolume.cal_min !== renderPrefs.displayMin) {
      activeVolume.cal_min = renderPrefs.displayMin
      shouldRefresh = true
    }
    if (Number.isFinite(renderPrefs.displayMax) && activeVolume.cal_max !== renderPrefs.displayMax) {
      activeVolume.cal_max = renderPrefs.displayMax
      shouldRefresh = true
    }

    if (shouldRefresh) {
      nv.updateGLVolume()
      nv.drawScene()
    }
  }, [renderPrefs, volumeUrl])

  useEffect(() => {
    const nv = nvRef.current
    if (!nv || !nv.volumes.length || currentFrame == null) {
      return
    }

    const activeVolume = nv.volumes[0]
    const nextFrame = Number(currentFrame)
    if (!Number.isInteger(nextFrame) || !activeVolume?.id) {
      return
    }

    const existingFrame = nv.getFrame4D(activeVolume.id)
    if (existingFrame !== nextFrame) {
      nv.setFrame4D(activeVolume.id, nextFrame)
    }
  }, [currentFrame, volumeUrl])

  return (
    <div className="viewer-card">
      <header>
        <span className="eyebrow">Viewer</span>
        <h3>{label}</h3>
      </header>
      <div className="viewer-canvas-shell">
        <canvas ref={canvasRef} className="viewer-canvas" />
        {loadError ? (
          <div className="viewer-overlay viewer-overlay-error">
            <strong>Volume load failed</strong>
            <p>{loadError}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

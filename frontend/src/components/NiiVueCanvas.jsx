import { useEffect, useRef, useState } from 'react'

import { Niivue, SLICE_TYPE } from '@niivue/niivue'

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

const MIN_ZOOM_BOX_SIZE = 16
const MAX_BOX_ZOOM = 12
const ZOOM_BOX_PADDING = 1.08

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function isFiniteVector(value, length = 3) {
  return value != null && typeof value.length === 'number' && Array.from(value).slice(0, length).every((entry) => Number.isFinite(entry))
}

function getCanvasPoint(clientX, clientY, canvas) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1
  return {
    canvasX: clamp((clientX - rect.left) * scaleX, 0, canvas.width),
    canvasY: clamp((clientY - rect.top) * scaleY, 0, canvas.height),
    clientX: clamp(clientX - rect.left, 0, rect.width),
    clientY: clamp(clientY - rect.top, 0, rect.height),
    scaleX,
    scaleY,
  }
}

function getTileBounds(screenSlice) {
  const [left, top, width, height] = screenSlice.leftTopWidthHeight
  const right = left + width
  const bottom = top + height
  return {
    minX: Math.min(left, right),
    maxX: Math.max(left, right),
    minY: Math.min(top, bottom),
    maxY: Math.max(top, bottom),
    width: Math.abs(width),
    height: Math.abs(height),
  }
}

function swizzleForSlice(vector, axCorSag) {
  if (axCorSag === SLICE_TYPE.CORONAL) {
    return [vector[0], vector[2], vector[1]]
  }
  if (axCorSag === SLICE_TYPE.SAGITTAL) {
    return [vector[1], vector[2], vector[0]]
  }
  return [vector[0], vector[1], vector[2]]
}

function unswizzleForSlice(vector, axCorSag) {
  if (axCorSag === SLICE_TYPE.CORONAL) {
    return [vector[0], vector[2], vector[1]]
  }
  if (axCorSag === SLICE_TYPE.SAGITTAL) {
    return [vector[2], vector[0], vector[1]]
  }
  return [vector[0], vector[1], vector[2]]
}

function getDisplayBounds(screenSlice) {
  return {
    minX: Math.min(screenSlice.leftTopMM[0], screenSlice.leftTopMM[0] + screenSlice.fovMM[0]),
    maxX: Math.max(screenSlice.leftTopMM[0], screenSlice.leftTopMM[0] + screenSlice.fovMM[0]),
    minY: Math.min(screenSlice.leftTopMM[1], screenSlice.leftTopMM[1] + screenSlice.fovMM[1]),
    maxY: Math.max(screenSlice.leftTopMM[1], screenSlice.leftTopMM[1] + screenSlice.fovMM[1]),
  }
}

function getInteractiveTile(nv, point) {
  const tileIndex = nv.tileIndex(point.canvasX, point.canvasY)
  const screenSlice = nv.screenSlices?.[tileIndex]
  if (!screenSlice || screenSlice.axCorSag > SLICE_TYPE.SAGITTAL) {
    return null
  }

  const bounds = getTileBounds(screenSlice)
  if (point.canvasX < bounds.minX || point.canvasX > bounds.maxX || point.canvasY < bounds.minY || point.canvasY > bounds.maxY) {
    return null
  }

  return { tileIndex, screenSlice, bounds }
}

function clampPointToTile(point, bounds) {
  const canvasX = clamp(point.canvasX, bounds.minX, bounds.maxX)
  const canvasY = clamp(point.canvasY, bounds.minY, bounds.maxY)
  return {
    ...point,
    canvasX,
    canvasY,
    clientX: point.scaleX > 0 ? canvasX / point.scaleX : point.clientX,
    clientY: point.scaleY > 0 ? canvasY / point.scaleY : point.clientY,
  }
}

export default function NiiVueCanvas({ viewerId, datasetId, label, fileName, volumeUrl, currentFrame }) {
  const canvasRef = useRef(null)
  const shellRef = useRef(null)
  const nvRef = useRef(null)
  const currentFrameRef = useRef(currentFrame)
  const selectedVoxelMMRef = useRef(null)
  const defaultCrosshairColorRef = useRef([1, 0, 0, 1])
  const loadAttemptRef = useRef(0)
  const zoomGestureRef = useRef(null)
  const cleanupZoomListenersRef = useRef(null)
  const state = useAppState()
  const dispatch = useAppDispatch()
  const registry = useViewerRegistry()
  const renderPrefs = useActiveRenderPreferences()
  const selectedVoxelMM = state.selection.selectedVoxelMM
  const [isViewerReady, setIsViewerReady] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [zoomBox, setZoomBox] = useState(null)

  function clearZoomGesture() {
    if (cleanupZoomListenersRef.current) {
      cleanupZoomListenersRef.current()
      cleanupZoomListenersRef.current = null
    }
    zoomGestureRef.current = null
    setZoomBox(null)
  }

  function resetZoom() {
    const nv = nvRef.current
    if (!nv) {
      return
    }

    nv.setPan2Dxyzmm([0, 0, 0, 1])
  }

  function syncFrame(nv, requestedFrame) {
    const activeVolume = nv?.volumes?.[0]
    const nextFrame = Number(requestedFrame)
    if (!activeVolume?.id || !Number.isInteger(nextFrame)) {
      return
    }

    const maxFrame = Number.isFinite(activeVolume.nFrame4D) && activeVolume.nFrame4D > 0
      ? activeVolume.nFrame4D - 1
      : 0
    const boundedFrame = clamp(nextFrame, 0, maxFrame)
    const existingFrame = nv.getFrame4D(activeVolume.id)
    if (existingFrame !== boundedFrame) {
      nv.setFrame4D(activeVolume.id, boundedFrame)
    }
  }

  function syncCrosshair(nv, requestedVoxelMM) {
    if (!nv?.volumes?.length || !isCoordinateTriplet(requestedVoxelMM)) {
      return
    }

    const nextMM = Array.from(requestedVoxelMM).slice(0, 3)
    if (nextMM.some((value) => !Number.isFinite(value))) {
      return
    }

    const currentMM = nv.frac2mm(nv.scene.crosshairPos)
    if (hasSameLocation(currentMM, nextMM)) {
      return
    }

    nv.scene.crosshairPos = nv.mm2frac(nextMM)
    nv.drawScene()
  }

  function applyZoomSelection(gesture) {
    const nv = nvRef.current
    if (!nv) {
      return
    }

    const screenSlice = nv.screenSlices?.[gesture.tileIndex]
    if (!screenSlice) {
      return
    }

    const dragWidth = Math.abs(gesture.currentCanvas.canvasX - gesture.startCanvas.canvasX)
    const dragHeight = Math.abs(gesture.currentCanvas.canvasY - gesture.startCanvas.canvasY)
    if (dragWidth < MIN_ZOOM_BOX_SIZE || dragHeight < MIN_ZOOM_BOX_SIZE) {
      return
    }

    const startFrac = Array.from(nv.canvasPos2frac([gesture.startCanvas.canvasX, gesture.startCanvas.canvasY])).slice(0, 3)
    const endFrac = Array.from(nv.canvasPos2frac([gesture.currentCanvas.canvasX, gesture.currentCanvas.canvasY])).slice(0, 3)
    if (!isFiniteVector(startFrac) || !isFiniteVector(endFrac)) {
      return
    }

    const startMM = Array.from(nv.frac2mm(startFrac)).slice(0, 3)
    const endMM = Array.from(nv.frac2mm(endFrac)).slice(0, 3)
    if (!isFiniteVector(startMM) || !isFiniteVector(endMM)) {
      return
    }

    const startPlane = swizzleForSlice(startMM, screenSlice.axCorSag)
    const endPlane = swizzleForSlice(endMM, screenSlice.axCorSag)
    const selectionWidth = Math.abs(endPlane[0] - startPlane[0]) * ZOOM_BOX_PADDING
    const selectionHeight = Math.abs(endPlane[1] - startPlane[1]) * ZOOM_BOX_PADDING
    if (selectionWidth < 0.001 || selectionHeight < 0.001) {
      return
    }

    const currentZoom = Number(nv.scene?.pan2Dxyzmm?.[3]) > 0 ? Number(nv.scene.pan2Dxyzmm[3]) : 1
    const currentPanXYZ = Array.from(nv.scene?.pan2Dxyzmm ?? [0, 0, 0, 1]).slice(0, 3)
    const currentPanPlane = swizzleForSlice(currentPanXYZ, screenSlice.axCorSag)
    const displayBounds = getDisplayBounds(screenSlice)
    const baseWidth = displayBounds.maxX * currentZoom + currentPanPlane[0] - (displayBounds.minX * currentZoom + currentPanPlane[0])
    const baseHeight = displayBounds.maxY * currentZoom + currentPanPlane[1] - (displayBounds.minY * currentZoom + currentPanPlane[1])
    const tileBounds = getTileBounds(screenSlice)
    const tileAspect = tileBounds.width > 0 && tileBounds.height > 0 ? tileBounds.width / tileBounds.height : 1

    let targetWidth = selectionWidth
    let targetHeight = selectionHeight
    if (targetWidth / targetHeight < tileAspect) {
      targetWidth = targetHeight * tileAspect
    } else {
      targetHeight = targetWidth / tileAspect
    }

    const centerX = (startPlane[0] + endPlane[0]) / 2
    const centerY = (startPlane[1] + endPlane[1]) / 2
    const newZoom = clamp(Math.min(baseWidth / targetWidth, baseHeight / targetHeight), 1, MAX_BOX_ZOOM)
    const targetMinX = centerX - targetWidth / 2
    const targetMinY = centerY - targetHeight / 2
    const baseMinX = displayBounds.minX * currentZoom + currentPanPlane[0]
    const baseMinY = displayBounds.minY * currentZoom + currentPanPlane[1]
    const nextPanPlane = [
      baseMinX - newZoom * targetMinX,
      baseMinY - newZoom * targetMinY,
      currentPanPlane[2],
    ]

    nv.setPan2Dxyzmm([...unswizzleForSlice(nextPanPlane, screenSlice.axCorSag), newZoom])
  }

  function updateZoomGesture(pointerEvent) {
    const gesture = zoomGestureRef.current
    const canvas = canvasRef.current
    if (!gesture || !canvas) {
      return
    }

    const point = clampPointToTile(getCanvasPoint(pointerEvent.clientX, pointerEvent.clientY, canvas), gesture.bounds)
    gesture.currentCanvas = point
    setZoomBox({
      left: Math.min(gesture.startCanvas.clientX, point.clientX),
      top: Math.min(gesture.startCanvas.clientY, point.clientY),
      width: Math.abs(point.clientX - gesture.startCanvas.clientX),
      height: Math.abs(point.clientY - gesture.startCanvas.clientY),
    })
  }

  function finishZoomGesture(pointerEvent, shouldApply) {
    const gesture = zoomGestureRef.current
    if (!gesture) {
      return
    }

    if (pointerEvent) {
      updateZoomGesture(pointerEvent)
    }
    clearZoomGesture()
    if (shouldApply) {
      applyZoomSelection(gesture)
    }
  }

  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    selectedVoxelMMRef.current = selectedVoxelMM
  }, [selectedVoxelMM])

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
      if (isFiniteVector(nv.opts?.crosshairColor, 4)) {
        defaultCrosshairColorRef.current = Array.from(nv.opts.crosshairColor).slice(0, 4)
      }
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
              volumeUrl,
            },
          })
        }
      }
      nv.onLocationChange = (location) => {
        if (ignore || zoomGestureRef.current || !location?.vox) {
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
      clearZoomGesture()
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
        syncCrosshair(nv, selectedVoxelMMRef.current)
        syncFrame(nv, currentFrameRef.current)
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
    if (!nv || !isViewerReady) {
      return
    }

    const preferredWidth = Number.isFinite(state.viewerUI.crosshairWidth) ? state.viewerUI.crosshairWidth : 1
    const nextWidth = state.viewerUI.showCrosshair ? preferredWidth : 0
    const baseColor = defaultCrosshairColorRef.current
    const nextColor = state.viewerUI.showCrosshair
      ? baseColor
      : [baseColor[0], baseColor[1], baseColor[2], 0]

    nv.opts.show3Dcrosshair = state.viewerUI.showCrosshair
    nv.setCrosshairWidth(nextWidth)
    nv.setCrosshairColor(nextColor)
    nv.drawScene()
  }, [isViewerReady, state.viewerUI.crosshairWidth, state.viewerUI.showCrosshair, volumeUrl])

  useEffect(() => {
    const nv = nvRef.current
    if (!nv) {
      return
    }

    syncCrosshair(nv, selectedVoxelMM)
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

    syncFrame(nv, currentFrame)
  }, [currentFrame, volumeUrl])

  function handlePointerDownCapture(event) {
    if (event.button !== 0 || !event.shiftKey) {
      return
    }

    if (event.target instanceof HTMLElement && event.target.closest('.viewer-reset-button')) {
      return
    }

    const nv = nvRef.current
    const canvas = canvasRef.current
    if (!nv || !canvas || loadError) {
      return
    }

    const point = getCanvasPoint(event.clientX, event.clientY, canvas)
    const tile = getInteractiveTile(nv, point)
    if (!tile) {
      return
    }

    const startCanvas = clampPointToTile(point, tile.bounds)
    event.preventDefault()
    event.stopPropagation()
    zoomGestureRef.current = {
      bounds: tile.bounds,
      currentCanvas: startCanvas,
      pointerId: event.pointerId,
      startCanvas,
      tileIndex: tile.tileIndex,
    }
    setZoomBox({
      left: startCanvas.clientX,
      top: startCanvas.clientY,
      width: 0,
      height: 0,
    })

    const handlePointerMove = (pointerEvent) => {
      if (pointerEvent.pointerId !== zoomGestureRef.current?.pointerId) {
        return
      }
      pointerEvent.preventDefault()
      updateZoomGesture(pointerEvent)
    }

    const handlePointerUp = (pointerEvent) => {
      if (pointerEvent.pointerId !== zoomGestureRef.current?.pointerId) {
        return
      }
      pointerEvent.preventDefault()
      finishZoomGesture(pointerEvent, true)
    }

    const handlePointerCancel = (pointerEvent) => {
      if (pointerEvent.pointerId !== zoomGestureRef.current?.pointerId) {
        return
      }
      finishZoomGesture(pointerEvent, false)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handleWindowBlur)
    }

    const handleWindowBlur = () => {
      finishZoomGesture(null, false)
    }

    cleanupZoomListenersRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handleWindowBlur)
  }

  function handleDoubleClickCapture(event) {
    if (event.target instanceof HTMLElement && event.target.closest('.viewer-reset-button')) {
      return
    }

    if (!canvasRef.current || !nvRef.current || loadError) {
      return
    }

    const point = getCanvasPoint(event.clientX, event.clientY, canvasRef.current)
    if (!getInteractiveTile(nvRef.current, point)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    resetZoom()
  }

  return (
    <div className="viewer-card">
      <header>
        <span className="eyebrow">Viewer</span>
        <h3>{label}</h3>
      </header>
      <div
        ref={shellRef}
        className={`viewer-canvas-shell${zoomBox ? ' viewer-canvas-shell-zooming' : ''}`}
        onDoubleClickCapture={handleDoubleClickCapture}
        onPointerDownCapture={handlePointerDownCapture}
      >
        <canvas ref={canvasRef} className="viewer-canvas" />
        {zoomBox ? (
          <div
            className="viewer-zoom-box"
            style={{
              left: `${zoomBox.left}px`,
              top: `${zoomBox.top}px`,
              width: `${zoomBox.width}px`,
              height: `${zoomBox.height}px`,
            }}
          />
        ) : null}
        <button type="button" className="viewer-reset-button" onClick={resetZoom}>
          Reset view
        </button>
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

import { useEffect, useState } from 'react'

import { formatDisplayedTimepoint, timepointToSeconds } from '../lib/time'
import { useAppDispatch, useAppState, useActiveDataset } from '../state/app-state'

function getBubbleOffset(progress) {
  if (progress <= 8) {
    return '0%'
  }

  if (progress >= 92) {
    return '-100%'
  }

  return '-50%'
}

export default function TimeSliderPanel() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const dataset = useActiveDataset()
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) {
      return undefined
    }

    function stopDragging() {
      setIsDragging(false)
    }

    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [isDragging])

  if (!state.session.sessionId || !dataset || state.session.status !== 'ready') {
    return null
  }

  const maxTimepoint = Math.max(0, dataset.timepoints - 1)
  const selectedTimepoint = Math.min(state.selection.selectedTimepoint, maxTimepoint)
  const progress = maxTimepoint > 0 ? (selectedTimepoint / maxTimepoint) * 100 : 0
  const tooltipVisible = isHovered || isFocused || isDragging
  const timeDisplayMode = state.plots.chartPrefs.timeDisplayMode
  const selectedTimeLabel = formatDisplayedTimepoint(selectedTimepoint, dataset, timeDisplayMode)
  const maxTimeLabel = formatDisplayedTimepoint(maxTimepoint, dataset, timeDisplayMode)
  const selectedSeconds = timepointToSeconds(selectedTimepoint, dataset.tr_ms)

  return (
    <section className="panel time-slider-panel">
      <div className="time-slider-header">
        <div>
          <p className="eyebrow">Timeline</p>
          <h2>{timeDisplayMode === 'seconds' ? 'Time (s)' : 'Timepoint'}</h2>
        </div>
        <div className="time-slider-meta">
          <span>{timeDisplayMode === 'seconds' ? `Selected ${selectedTimeLabel}` : `Frame ${selectedTimepoint}`}</span>
          {selectedSeconds != null ? <span>{selectedTimepoint} tp</span> : null}
          <span>{maxTimepoint + 1} total volumes</span>
        </div>
      </div>

      <div className="time-slider-shell">
        {tooltipVisible ? (
          <div
            className="time-slider-bubble"
            style={{
              left: `${progress}%`,
              transform: `translate(${getBubbleOffset(progress)}, 0)`,
            }}
          >
            {timeDisplayMode === 'seconds' ? `Time ${selectedTimeLabel}` : `Timepoint ${selectedTimepoint}`}
          </div>
        ) : null}

        <input
          className="time-slider-input"
          type="range"
          min="0"
          max={maxTimepoint}
          value={selectedTimepoint}
          style={{ '--timepoint-progress': `${progress}%` }}
          onChange={(event) => dispatch({ type: 'timepoint_selected', payload: Number(event.target.value) })}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPointerDown={() => setIsDragging(true)}
        />

        <div className="time-slider-scale" aria-hidden="true">
          <span>{formatDisplayedTimepoint(0, dataset, timeDisplayMode)}</span>
          <span>{maxTimeLabel}</span>
        </div>
      </div>
    </section>
  )
}
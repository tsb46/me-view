export const TIME_DISPLAY_MODE_SECONDS = 'seconds'
export const TIME_DISPLAY_MODE_TIMEPOINTS = 'timepoints'

export function datasetSupportsSeconds(dataset) {
  return Number.isFinite(dataset?.tr_ms) && dataset.tr_ms > 0
}

export function getDefaultTimeDisplayMode(dataset) {
  return datasetSupportsSeconds(dataset) ? TIME_DISPLAY_MODE_SECONDS : TIME_DISPLAY_MODE_TIMEPOINTS
}

export function normalizeTimeDisplayMode(mode, dataset) {
  if (mode === TIME_DISPLAY_MODE_SECONDS) {
    return datasetSupportsSeconds(dataset) ? TIME_DISPLAY_MODE_SECONDS : TIME_DISPLAY_MODE_TIMEPOINTS
  }
  if (mode === TIME_DISPLAY_MODE_TIMEPOINTS) {
    return TIME_DISPLAY_MODE_TIMEPOINTS
  }
  return getDefaultTimeDisplayMode(dataset)
}

export function timepointToSeconds(timepoint, trMs) {
  if (!Number.isFinite(timepoint) || !Number.isFinite(trMs) || trMs <= 0) {
    return null
  }
  return (timepoint * trMs) / 1000
}

export function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return '--'
  }
  if (Math.abs(seconds) >= 100) {
    return seconds.toFixed(1)
  }
  if (Math.abs(seconds) >= 10) {
    return seconds.toFixed(2)
  }
  return seconds.toFixed(3)
}

export function formatEchoTimeMs(value) {
  if (!Number.isFinite(value)) {
    return 'Unknown'
  }
  if (Math.abs(value) >= 100) {
    return `${value.toFixed(1)} ms`
  }
  if (Math.abs(value) >= 10) {
    return `${value.toFixed(2)} ms`
  }
  return `${value.toFixed(3)} ms`
}

export function formatDatasetEchoTimes(dataset) {
  const echoes = dataset?.echoes ?? []
  if (!echoes.length || !echoes.some((echo) => Number.isFinite(echo?.echo_time_ms))) {
    return null
  }
  return echoes.map((echo) => formatEchoTimeMs(echo?.echo_time_ms)).join(', ')
}

export function formatDisplayedTimepoint(timepoint, dataset, mode, options = {}) {
  const { includeUnit = true } = options
  const normalizedMode = normalizeTimeDisplayMode(mode, dataset)
  if (normalizedMode === TIME_DISPLAY_MODE_SECONDS) {
    const seconds = timepointToSeconds(timepoint, dataset?.tr_ms)
    if (seconds == null) {
      return includeUnit ? `${timepoint} tp` : String(timepoint)
    }
    return includeUnit ? `${formatSeconds(seconds)} s` : formatSeconds(seconds)
  }
  return includeUnit ? `${timepoint} tp` : String(timepoint)
}

export function getTimeAxisTitle(dataset, mode) {
  return normalizeTimeDisplayMode(mode, dataset) === TIME_DISPLAY_MODE_SECONDS ? 'Time (s)' : 'Timepoint'
}

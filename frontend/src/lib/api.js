export async function createSession(files, metadata = {}) {
  const formData = new FormData()
  formData.append('metadata', JSON.stringify(metadata))
  for (const file of files) {
    formData.append('files', file)
  }

  const response = await fetch('/api/sessions', {
    method: 'POST',
    body: formData,
  })
  return handleJson(response)
}

export async function finalizeSession(sessionId, payload) {
  const response = await fetch(`/api/sessions/${sessionId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleJson(response)
}

export async function fetchEchoCurve({ sessionId, datasetId, voxel, timepoint, signal }) {
  const params = new URLSearchParams({
    x: String(voxel[0]),
    y: String(voxel[1]),
    z: String(voxel[2]),
    timepoint: String(timepoint),
  })
  const response = await fetch(`/api/sessions/${sessionId}/datasets/${datasetId}/plots/echo-curve?${params}`, { signal })
  return handleJson(response)
}

export async function fetchTimeCourse({ sessionId, datasetId, voxel, echoId, signal }) {
  const params = new URLSearchParams({
    x: String(voxel[0]),
    y: String(voxel[1]),
    z: String(voxel[2]),
    echo_id: echoId,
  })
  const response = await fetch(`/api/sessions/${sessionId}/datasets/${datasetId}/plots/time-course?${params}`, { signal })
  return handleJson(response)
}

export async function fetchPlotContext({ sessionId, datasetId, voxel, echoId, timepoint, signal }) {
  const params = new URLSearchParams({
    x: String(voxel[0]),
    y: String(voxel[1]),
    z: String(voxel[2]),
    echo_id: echoId,
    timepoint: String(timepoint),
  })
  const response = await fetch(`/api/sessions/${sessionId}/datasets/${datasetId}/plots/context?${params}`, { signal })
  return handleJson(response)
}

function formatValidationError(detail) {
  if (!detail || typeof detail !== 'object') {
    return null
  }

  const message = typeof detail.msg === 'string' ? detail.msg : null
  const location = Array.isArray(detail.loc) ? detail.loc.join(' > ') : null
  if (message && location) {
    return `${location}: ${message}`
  }
  return message
}

function formatStructuredDetail(detail, fallback) {
  if (!detail || typeof detail !== 'object') {
    return fallback
  }

  if (typeof detail.message === 'string') {
    const parts = [detail.message]
    if (Number.isFinite(detail.expected_echoes_per_dataset)) {
      const expectedCount = Number(detail.expected_echoes_per_dataset)
      parts.push(`Expected ${expectedCount} echo time${expectedCount === 1 ? '' : 's'} per dataset.`)
    }

    if (detail.dataset_echo_counts && typeof detail.dataset_echo_counts === 'object') {
      const datasetCounts = Object.entries(detail.dataset_echo_counts)
        .map(([datasetKey, count]) => `${datasetKey}: ${count}`)
        .join(', ')
      if (datasetCounts) {
        parts.push(`Resolved dataset echo counts: ${datasetCounts}.`)
      }
    }

    return parts.join(' ')
  }

  const stringValues = Object.values(detail).filter((value) => typeof value === 'string')
  return stringValues[0] ?? fallback
}

function formatErrorPayload(payload, fallback) {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  if (typeof payload.detail === 'string') {
    return payload.detail
  }

  if (Array.isArray(payload.detail)) {
    const messages = payload.detail.map(formatValidationError).filter(Boolean)
    return messages.join(' ') || fallback
  }

  if (payload.detail && typeof payload.detail === 'object') {
    return formatStructuredDetail(payload.detail, fallback)
  }

  if (typeof payload.message === 'string') {
    return payload.message
  }

  return fallback
}

async function handleJson(response) {
  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const payload = await response.json()
      detail = formatErrorPayload(payload, detail)
    } catch {
      detail = response.statusText || detail
    }
    throw new Error(detail)
  }
  return response.json()
}

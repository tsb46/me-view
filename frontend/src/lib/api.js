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

async function handleJson(response) {
  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const payload = await response.json()
      detail = typeof payload.detail === 'string' ? payload.detail : detail
    } catch {
      detail = response.statusText || detail
    }
    throw new Error(detail)
  }
  return response.json()
}

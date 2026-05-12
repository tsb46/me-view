import { useState } from 'react'

import { createSession } from '../lib/api'
import { useAppDispatch } from '../state/app-state'

function isSupportedNiftiFile(file) {
  const filename = file.name.toLowerCase()
  return filename.endsWith('.nii') || filename.endsWith('.nii.gz')
}

export default function UploadPanel() {
  const dispatch = useAppDispatch()
  const [files, setFiles] = useState([])
  const [echoTimesInput, setEchoTimesInput] = useState('')
  const [trInput, setTrInput] = useState('')
  const [error, setError] = useState(null)

  function buildMetadata() {
    const metadata = {}

    const trimmedEchoTimes = echoTimesInput.trim()
    if (trimmedEchoTimes) {
      const echoTimesMs = trimmedEchoTimes
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((value) => Number(value))

      if (!echoTimesMs.length || echoTimesMs.some((value) => !Number.isFinite(value) || value <= 0)) {
        throw new Error('Echo times must be a comma- or space-separated list of positive millisecond values.')
      }

      metadata.echo_times_ms = echoTimesMs
    }

    const trimmedTr = trInput.trim()
    if (trimmedTr) {
      const trMs = Number(trimmedTr)
      if (!Number.isFinite(trMs) || trMs <= 0) {
        throw new Error('TR must be a positive value in milliseconds.')
      }
      metadata.tr_ms = trMs
    }

    return metadata
  }

  async function handleUpload(event) {
    event.preventDefault()
    if (!files.length) {
      setError('Select one or more 4D NIfTI echo files to begin.')
      return
    }
    setError(null)
    dispatch({ type: 'session_load_started' })
    try {
      const session = await createSession(files, buildMetadata())
      dispatch({ type: 'session_loaded', payload: session })
    } catch (uploadError) {
      dispatch({ type: 'session_failed', payload: uploadError.message })
      setError(uploadError.message)
    }
  }

  function handleFileChange(event) {
    const selectedFiles = Array.from(event.target.files ?? [])
    const acceptedFiles = selectedFiles.filter(isSupportedNiftiFile)

    setFiles(acceptedFiles)

    if (selectedFiles.length !== acceptedFiles.length) {
      setError('Only .nii and .nii.gz files are supported.')
      return
    }

    setError(null)
  }

  return (
    <section className="panel upload-panel">
      <div>
        <p className="eyebrow">Session Upload</p>
        <h2>Load multi-echo NIfTI files</h2>
        <p>
          Select one or more 4D NIfTI files. The backend will group them into a draft session,
          infer echo order when possible, and expose a viewer-ready manifest.
        </p>
      </div>
      <form onSubmit={handleUpload} className="upload-form">
        <label className="upload-field upload-field-wide">
          <span>NIfTI echoes</span>
          <input
            type="file"
            accept=".nii,.nii.gz,.gz,application/gzip,application/x-gzip"
            multiple
            onChange={handleFileChange}
          />
        </label>
        <label className="upload-field">
          <span>Echo times (ms)</span>
          <textarea
            rows="2"
            value={echoTimesInput}
            onChange={(event) => setEchoTimesInput(event.target.value)}
            placeholder="12.5, 28.0, 43.5"
          />
          <small className="input-hint">
            Optional. Use one ordered list for echo positions. If multiple datasets are uploaded, the same list is applied to each dataset and every dataset must have the same echo count.
          </small>
        </label>
        <label className="upload-field">
          <span>TR (ms)</span>
          <input
            type="number"
            min="0"
            step="any"
            value={trInput}
            onChange={(event) => setTrInput(event.target.value)}
            placeholder="1500"
          />
          <small className="input-hint">
            Optional. When provided, the frontend defaults to seconds and allows toggling back to timepoints.
          </small>
        </label>
        <button type="submit">Create session</button>
      </form>
      {files.length ? <p>{files.length} file(s) selected.</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  )
}

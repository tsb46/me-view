import { useState } from 'react'

import { createSession } from '../lib/api'
import { useAppDispatch } from '../state/app-state'

export default function UploadPanel() {
  const dispatch = useAppDispatch()
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)

  async function handleUpload(event) {
    event.preventDefault()
    if (!files.length) {
      setError('Select one or more 4D NIfTI echo files to begin.')
      return
    }
    setError(null)
    dispatch({ type: 'session_load_started' })
    try {
      const session = await createSession(files)
      dispatch({ type: 'session_loaded', payload: session })
    } catch (uploadError) {
      dispatch({ type: 'session_failed', payload: uploadError.message })
      setError(uploadError.message)
    }
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
        <input
          type="file"
          accept=".nii,.nii.gz"
          multiple
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <button type="submit">Create session</button>
      </form>
      {files.length ? <p>{files.length} file(s) selected.</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  )
}

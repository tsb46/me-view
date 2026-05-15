import ControlBar from './components/ControlBar'
import InspectorPanel from './components/InspectorPanel'
import PlotPanel from './components/PlotPanel'
import ReviewPanel from './components/ReviewPanel'
import SessionBanner from './components/SessionBanner'
import TimeSliderPanel from './components/TimeSliderPanel'
import UploadPanel from './components/UploadPanel'
import ViewerWorkspace from './components/ViewerWorkspace'
import { AppStateProvider, useAppState } from './state/app-state'

function Workspace() {
  const state = useAppState()

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">me-view</p>
          <h1>Multi-echo fMRI viewer</h1>
          <p>
            A local NiiVue and Plotly workspace for synchronized spatial and quantitative
            inspection of multi-echo NIfTI datasets.
          </p>
        </div>
        <div className="hero-meta">
          <span>Backend: FastAPI + uv</span>
          <span>Frontend: React + Vite</span>
        </div>
      </header>

      {!state.session.sessionId ? <UploadPanel /> : null}
      <SessionBanner />
      <ReviewPanel />
      <ControlBar />

      <main className="main-grid">
        <ViewerWorkspace />
        <TimeSliderPanel />
        <section className="analytics-grid">
          <PlotPanel />
          <InspectorPanel />
        </section>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppStateProvider>
      <Workspace />
    </AppStateProvider>
  )
}

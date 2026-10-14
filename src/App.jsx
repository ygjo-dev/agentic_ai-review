import { useEffect, useMemo, useState } from 'react'
import review from 'virtual:review-source'
import ChangesView from './components/ChangesView.jsx'
import MermaidDiagram from './components/MermaidDiagram.jsx'
import { compareSnapshots } from './review/changes.js'

// The build decides what is shown: a baseline (Before only) or one develop update
// (Before = develop just before it, After = develop just after it). Nothing here picks another commit.
const { project, review: context, before, after } = review
// Local preview (`npm run review:dev`): Before = a develop ref, After = the agentic_ai working
// tree. Only the dev server sets it; import.meta.env.DEV drops this path from the build.
const local = import.meta.env.DEV && context.local ? context.local : null

function commitLine(snapshot) {
  if (snapshot.workingTree) return `working tree · ${snapshot.subject}`
  return `${snapshot.shortSha} · ${snapshot.subject}`
}

function badgeFor(entry) {
  if (entry.error) return { text: 'Error', kind: 'error' }
  if (!entry.before) return { text: 'New', kind: 'count' }
  if (!entry.after) return { text: 'Removed', kind: 'count' }
  if (entry.diff.count > 0) return { text: `${entry.diff.count} changes`, kind: 'count' }
  return { text: 'No change', kind: 'none' }
}

// Only the diagram lives in the URL (#id). A leftover query from older links is dropped.
function useDiagramHash() {
  const read = () => decodeURIComponent(window.location.hash.slice(1))
  const [diagramId, setDiagramId] = useState(read)
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    }
    const onHashChange = () => setDiagramId(read())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return diagramId
}

const entries = after
  ? compareSnapshots(before, after)
  : before.diagrams.map((diagram) => ({ id: diagram.id, title: diagram.title, summary: diagram.summary, after: diagram }))

// Diagrams fit their pane by default (scaled down, never up); "Actual size" shows them
// unscaled and lets the pane scroll.
function ScaleToggle({ actual, onChange }) {
  return (
    <div className="scale-toggle" role="group" aria-label="Diagram size">
      <button type="button" aria-pressed={!actual} onClick={() => onChange(false)}>
        Fit width
      </button>
      <button type="button" aria-pressed={actual} onClick={() => onChange(true)}>
        Actual size
      </button>
    </div>
  )
}

export default function App() {
  const diagramId = useDiagramHash()
  const selected = useMemo(() => entries.find((entry) => entry.id === diagramId) ?? entries[0], [diagramId])
  const [actual, setActual] = useState(false)

  useEffect(() => {
    if (selected && decodeURIComponent(window.location.hash.slice(1)) !== selected.id) {
      window.history.replaceState(null, '', `${window.location.pathname}#${encodeURIComponent(selected.id)}`)
    }
  }, [selected])

  return (
    <div className={`layout${actual ? ' scale-actual' : ''}`}>
      <header className="page-header">
        <div className="title-row">
          <h1>{project.title}</h1>
          <span className="page-kind">Architecture Review</span>
        </div>

        {after ? (
          <div className="review-context" data-testid="review-context" data-state="review">
            {import.meta.env.DEV && local ? (
              <div className="review-heading">
                <span className="review-state local" data-testid="local-preview">
                  LOCAL PREVIEW
                </span>
                <span className="review-caption">{context.branch} vs working tree</span>
              </div>
            ) : (
              <div className="review-heading">
                <span className="review-state">Review</span>
                <span className="review-caption">Latest {context.branch} update</span>
              </div>
            )}
            <span className="review-snapshot before">
              <span className="review-snapshot-label">Before</span> {context.branch} · {commitLine(before)}
            </span>
            <span className="review-snapshot after">
              <span className="review-snapshot-label">After</span> {local ? '' : `${context.branch} · `}
              {commitLine(after)}
            </span>
          </div>
        ) : (
          <div className="review-context" data-testid="review-context" data-state="baseline">
            <div className="review-heading">
              <span className="review-state">Baseline</span>
              <span className="review-none">No develop update to compare</span>
            </div>
            <span className="review-snapshot before">
              <span className="review-snapshot-label">Before</span> {context.branch} @ {commitLine(before)}
            </span>
          </div>
        )}
      </header>

      <nav className="diagram-tabs" aria-label="Diagrams">
        <ul>
          {entries.map((entry) => {
            const badge = after ? badgeFor(entry) : null
            const current = entry.id === selected?.id
            return (
              <li key={entry.id}>
                <a
                  href={`#${encodeURIComponent(entry.id)}`}
                  className={current ? 'selected' : undefined}
                  aria-current={current ? 'page' : undefined}
                >
                  <span className="nav-title">{entry.title}</span>
                  {badge && (
                    <span className={`nav-badge ${badge.kind}`} data-testid="change-badge">
                      {badge.text}
                    </span>
                  )}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>

      <main className="content">
        {!selected && <p className="diagram-status">No diagrams in the review manifest.</p>}

        {selected && !after && (
          <article>
            <div className="diagram-heading">
              <div>
                <h2>{selected.title}</h2>
                {selected.summary && <p className="summary">{selected.summary}</p>}
              </div>
              <ScaleToggle actual={actual} onChange={setActual} />
            </div>
            <p className="snapshot-tag">
              Before · {context.branch} @ {before.shortSha}
            </p>
            <div className={`diagram-canvas ${selected.after.presentation}`}>
              <MermaidDiagram source={selected.after.source} presentation={selected.after.presentation} />
            </div>
          </article>
        )}

        {selected && after && (
          <ChangesView
            entry={selected}
            from={before}
            to={after}
            fromLabel={context.branch}
            toLabel={local ? 'working tree' : context.branch}
            toolbar={<ScaleToggle actual={actual} onChange={setActual} />}
          />
        )}
      </main>
    </div>
  )
}

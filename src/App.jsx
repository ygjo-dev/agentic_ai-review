import { useEffect, useMemo, useState } from 'react'
import review from 'virtual:review-source'
import ChangesView from './components/ChangesView.jsx'
import CompareBasis from './components/CompareBasis.jsx'
import MermaidDiagram from './components/MermaidDiagram.jsx'
import { changeBadge, compareSnapshots } from './review/changes.js'
import { COMPARE_LABELS, DEFAULT_COMPARE, parseCompare } from './review/localCompare.js'

// The build decides what is shown: a baseline (Before only) or one develop update
// (Before = develop just before it, After = develop just after it). Nothing here picks another commit.
// Local preview (`npm run review:dev`) instead carries one pair per 비교 기준 (review.compare), each
// with After = the agentic_ai working tree. Only the dev server sets it; import.meta.env.DEV drops
// this path from the build.
const localPairs = import.meta.env.DEV && review.compare ? review.compare : null

function commitLine(snapshot) {
  if (snapshot.workingTree) return `working tree · ${snapshot.subject}`
  return `${snapshot.shortSha} · ${snapshot.subject}`
}

function entriesOf({ before, after }) {
  return after
    ? compareSnapshots(before, after)
    : before.diagrams.map((diagram) => ({ id: diagram.id, title: diagram.title, summary: diagram.summary, after: diagram }))
}

// The URL carries the diagram (#id) and, in the local preview only, a 비교 기준 other than the
// default (?compare=previous-commit). Any other query, and any query on the public site, is dropped.
const readHash = () => decodeURIComponent(window.location.hash.slice(1))
// Every local-only expression starts with import.meta.env.DEV so the build drops it.
const readCompare = () =>
  import.meta.env.DEV && localPairs ? parseCompare(new URLSearchParams(window.location.search).get('compare')) : null
const searchFor = (compare) => (import.meta.env.DEV && localPairs && compare !== DEFAULT_COMPARE ? `?compare=${compare}` : '')

function useReviewUrl() {
  const [diagramId, setDiagramId] = useState(readHash)
  const [compare, setCompare] = useState(readCompare)
  useEffect(() => {
    const onNavigate = () => {
      setDiagramId(readHash())
      setCompare(readCompare())
    }
    window.addEventListener('popstate', onNavigate)
    window.addEventListener('hashchange', onNavigate)
    return () => {
      window.removeEventListener('popstate', onNavigate)
      window.removeEventListener('hashchange', onNavigate)
    }
  }, [])
  return { diagramId, compare, setCompare }
}

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
  const { diagramId, compare, setCompare } = useReviewUrl()
  // A local 비교 기준 whose Before could not be read is { error } (the other one still works).
  const pair = localPairs ? localPairs[compare] : review
  const { review: context = {}, before, after } = pair
  const project = (pair.error ? Object.values(localPairs).find((other) => !other.error) : pair).project
  const local = import.meta.env.DEV && localPairs ? { ...context.local, compare } : null
  const beforeLabel = import.meta.env.DEV && local?.compare === 'previous-commit' ? '직전 커밋' : context.branch
  const entries = useMemo(() => (pair.error ? [] : entriesOf(pair)), [pair])
  const selected = useMemo(() => entries.find((entry) => entry.id === diagramId) ?? entries[0], [entries, diagramId])
  const [actual, setActual] = useState(false)

  useEffect(() => {
    const search = searchFor(compare)
    if (window.location.search !== search || (selected && readHash() !== selected.id)) {
      const hash = selected ? `#${encodeURIComponent(selected.id)}` : window.location.hash
      window.history.replaceState(null, '', `${window.location.pathname}${search}${hash}`)
    }
  }, [selected, compare])

  return (
    <div className={`layout${actual ? ' scale-actual' : ''}`}>
      <header className="page-header">
        <div className="title-row">
          <h1>{project.title}</h1>
          <span className="page-kind">Architecture Review</span>
        </div>

        {import.meta.env.DEV && local ? (
          <div className="review-context" data-testid="review-context" data-state={pair.error ? 'error' : 'review'}>
            <div className="review-heading">
              <span className="review-state local" data-testid="local-preview">
                LOCAL PREVIEW
              </span>
              <CompareBasis value={compare} onChange={setCompare} />
            </div>
            <span className="review-snapshot before" data-testid="before-line">
              <span className="review-snapshot-label">Before</span> {pair.error ? '읽을 수 없음' : `${beforeLabel} · ${commitLine(before)}`}
            </span>
            {after && (
              <span className="review-snapshot after" data-testid="after-line">
                <span className="review-snapshot-label">After</span> {commitLine(after)}
              </span>
            )}
          </div>
        ) : after ? (
          <div className="review-context" data-testid="review-context" data-state="review">
            <div className="review-heading">
              <span className="review-state">Review</span>
              <span className="review-caption">Latest {context.branch} update</span>
            </div>
            <span className="review-snapshot before">
              <span className="review-snapshot-label">Before</span> {context.branch} · {commitLine(before)}
            </span>
            <span className="review-snapshot after">
              <span className="review-snapshot-label">After</span> {context.branch} · {commitLine(after)}
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
            const badge = after ? changeBadge(entry) : null
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
        {import.meta.env.DEV && pair.error && (
          <div className="diagram-error" role="alert">
            <strong>{COMPARE_LABELS[compare]}으로 비교할 수 없습니다</strong>
            <pre>{pair.error}</pre>
          </div>
        )}
        {!selected && !pair.error && <p className="diagram-status">No diagrams in the review manifest.</p>}

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
            fromLabel={beforeLabel}
            toLabel={local ? 'working tree' : context.branch}
            toolbar={<ScaleToggle actual={actual} onChange={setActual} />}
          />
        )}
      </main>
    </div>
  )
}

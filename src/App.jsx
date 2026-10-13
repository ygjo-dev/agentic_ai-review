import { useEffect, useMemo, useState } from 'react'
import review from 'virtual:review-source'
import ChangesView from './components/ChangesView.jsx'
import MermaidDiagram from './components/MermaidDiagram.jsx'
import { compareVersions } from './review/changes.js'
import { readUrlState, urlFor } from './urlState.js'

const { project, versions } = review

function formatTime(timestamp) {
  // Committer-local time as recorded in git, independent of the viewer's zone.
  return timestamp.slice(0, 16).replace('T', ' ')
}

function versionLabel(version) {
  if (version.workingTree) return `Working tree · ${version.subject}`
  return `${formatTime(version.timestamp)} · ${version.shortSha} · ${version.subject}`
}

function shortName(version) {
  return version.workingTree ? 'working tree' : version.shortSha
}

// Reads the view from the URL and writes it back in canonical form (full SHAs,
// explicit compare), so the address bar is always a shareable link.
function useUrlState() {
  const [state, setState] = useState(() => readUrlState(versions))

  useEffect(() => {
    // Rewrite only: the first read (with its notices) is already in state, and a
    // second read here would see the canonical URL and drop those notices.
    window.history.replaceState(null, '', urlFor(readUrlState(versions)))
    const sync = () => {
      const next = readUrlState(versions)
      window.history.replaceState(null, '', urlFor(next))
      setState(next)
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [])

  const navigate = (change) => {
    window.history.pushState(null, '', urlFor({ ...state, ...change }))
    const next = readUrlState(versions)
    window.history.replaceState(null, '', urlFor(next))
    setState(next)
  }

  return [state, navigate]
}

function badgeFor(entry) {
  if (entry.error) return { text: 'Error', kind: 'error' }
  if (!entry.before) return { text: 'New', kind: 'count' }
  if (!entry.after) return { text: 'Removed', kind: 'count' }
  if (entry.diff.count > 0) return { text: String(entry.diff.count), kind: 'count' }
  return { text: 'No change', kind: 'none' }
}

export default function App() {
  const [{ version, mode, compare, older, diagramId, notices }, navigate] = useUrlState()

  const entries = useMemo(
    () =>
      mode === 'changes' && compare
        ? compareVersions(compare, version)
        : version.diagrams.map((diagram) => ({ id: diagram.id, title: diagram.title, summary: diagram.summary, after: diagram })),
    [mode, compare, version],
  )
  const selected = entries.find((entry) => entry.id === diagramId) ?? entries[0]

  // Keep the shown diagram in the hash too, so the address bar names it.
  useEffect(() => {
    if (selected && decodeURIComponent(window.location.hash.slice(1)) !== selected.id) {
      const { pathname, search } = window.location
      window.history.replaceState(null, '', `${pathname}${search}#${encodeURIComponent(selected.id)}`)
    }
  }, [selected])

  return (
    <div className="layout">
      <header className="page-header">
        <div className="title-row">
          <h1>{project.title}</h1>
          <span className="page-kind">Architecture Review</span>
        </div>

        <div className="controls">
          <label className="control">
            <span className="control-label">Version</span>
            <select
              value={version.sha}
              onChange={(event) =>
                navigate({ version: versions.find((v) => v.sha === event.target.value), compare: null })
              }
            >
              {versions.map((v, index) => (
                <option key={v.sha} value={v.sha}>
                  {versionLabel(v)}
                  {index === 0 ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="control" role="group" aria-label="View">
            <span className="control-label">View</span>
            <div className="segmented">
              {[
                ['full', 'Full'],
                ['changes', 'Changes'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => mode !== value && navigate({ mode: value, compare: null })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'changes' && compare && (
            <label className="control">
              <span className="control-label">Compare from</span>
              <select
                value={compare.sha}
                onChange={(event) => navigate({ compare: older.find((v) => v.sha === event.target.value) })}
              >
                {older.map((v) => (
                  <option key={v.sha} value={v.sha}>
                    {versionLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <p className="view-caption" data-testid="view-caption">
          {mode === 'full' && (
            <>
              <strong>Full architecture</strong> at {shortName(version)}
              {version.timestamp && ` · ${formatTime(version.timestamp)}`}
            </>
          )}
          {mode === 'changes' && compare && (
            <>
              <strong>Changes</strong> from {shortName(compare)} → {shortName(version)}
            </>
          )}
          {mode === 'changes' && !compare && <strong>Baseline version</strong>}
        </p>

        {notices.map((notice) => (
          <p key={notice} className="notice" role="status">
            {notice}
          </p>
        ))}
      </header>

      <nav className="diagram-nav" aria-label="Diagrams">
        <ul>
          {entries.map((entry) => {
            const badge = mode === 'changes' && compare ? badgeFor(entry) : null
            return (
              <li key={entry.id}>
                <a
                  href={`#${encodeURIComponent(entry.id)}`}
                  className={entry.id === selected?.id ? 'selected' : undefined}
                  aria-current={entry.id === selected?.id ? 'page' : undefined}
                >
                  <span className="nav-heading">
                    <span className="nav-title">{entry.title}</span>
                    {badge && (
                      <span className={`nav-badge ${badge.kind}`} data-testid="change-badge">
                        {badge.text}
                      </span>
                    )}
                  </span>
                  {entry.summary && <span className="nav-summary">{entry.summary}</span>}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>

      <main className="content">
        {!selected && <p className="diagram-status">No diagrams in the review manifest.</p>}

        {selected && mode === 'full' && (
          <article>
            <h2>{selected.title}</h2>
            {selected.summary && <p className="summary">{selected.summary}</p>}
            <div className="diagram-canvas">
              <MermaidDiagram source={selected.after.source} />
            </div>
          </article>
        )}

        {selected && mode === 'changes' && !compare && (
          <article>
            <h2>Baseline version</h2>
            <p className="no-change">이전 Review Version이 없습니다.</p>
          </article>
        )}

        {selected && mode === 'changes' && compare && <ChangesView entry={selected} />}
      </main>
    </div>
  )
}

import { useRef } from 'react'
import { displayName, STATUS_MARK } from '../review/changes.js'
import MermaidDiagram from './MermaidDiagram.jsx'

function Legend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <span className="legend-swatch added" aria-hidden="true">
          {STATUS_MARK.added}
        </span>
        Added <ins className="legend-line">added line</ins>
      </li>
      <li>
        <span className="legend-swatch removed" aria-hidden="true">
          {STATUS_MARK.removed}
        </span>
        Removed <del className="legend-line">removed line</del>
      </li>
      <li>
        <span className="legend-swatch unchanged" aria-hidden="true" />
        Unchanged
      </li>
    </ul>
  )
}

function nodeNamer(entry) {
  const nodes = new Map()
  for (const graph of [entry.before?.graph, entry.after?.graph]) {
    for (const node of graph?.nodes ?? []) nodes.set(node.id, node)
  }
  return (id) => (nodes.has(id) ? displayName(nodes.get(id)) : id)
}

function edgeText(edge, name) {
  const arrow = edge.arrow === 'bidirectional' ? '↔' : '→'
  const label = edge.label ? ` — ${edge.label.replace(/<br\s*\/?>/gi, ' ')}` : ''
  return `${name(edge.from)} ${arrow} ${name(edge.to)}${label} (${edge.style})`
}

function SummarySection({ title, status, items }) {
  return (
    <section className="change-section">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="change-none">None</p>
      ) : (
        <ul>
          {items.map((text) => (
            <li key={text} className={`change-item ${status}`}>
              <span className="change-mark" aria-hidden="true">
                {STATUS_MARK[status] ?? '~'}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ChangeSummary({ entry }) {
  const { diff } = entry
  const name = nodeNamer(entry)
  const node = (n) => `${displayName(n)} (${n.id})`
  const fields = (changes) => changes.map((c) => c.field).join(', ')
  return (
    <div className="change-summary" aria-label="Change summary">
      <SummarySection title="Added nodes" status="added" items={diff.addedNodes.map(node)} />
      <SummarySection title="Removed nodes" status="removed" items={diff.removedNodes.map(node)} />
      <SummarySection
        title="Changed nodes"
        status="changed"
        items={diff.changedNodes.map((c) => `${node(c.after)}: ${fields(c.changes)}`)}
      />
      <SummarySection title="Added edges" status="added" items={diff.addedEdges.map((e) => edgeText(e, name))} />
      <SummarySection title="Removed edges" status="removed" items={diff.removedEdges.map((e) => edgeText(e, name))} />
      <SummarySection
        title="Changed edges"
        status="changed"
        items={diff.changedEdges.map((c) => `${edgeText(c.after, name)}: ${fields(c.changes)}`)}
      />
    </div>
  )
}

function commitLine(snapshot) {
  if (snapshot.workingTree) return `working tree · ${snapshot.subject}`
  return `${snapshot.shortSha} · ${snapshot.subject}`
}

// Keeps the two panes at the same scroll ratio. A pane moved by the other pane
// records the position it was set to, so its own scroll event is not echoed back.
function useSyncedScroll() {
  const panes = useRef([null, null])
  const expected = useRef([null, null])

  const onScroll = (index) => () => {
    const source = panes.current[index]
    const target = panes.current[1 - index]
    if (!source || !target) return
    const echo = expected.current[index]
    if (echo && Math.abs(source.scrollTop - echo.top) < 2 && Math.abs(source.scrollLeft - echo.left) < 2) {
      expected.current[index] = null
      return
    }
    const ratio = (position, size, view) => (size > view ? position / (size - view) : 0)
    const top = ratio(source.scrollTop, source.scrollHeight, source.clientHeight) * Math.max(0, target.scrollHeight - target.clientHeight)
    const left = ratio(source.scrollLeft, source.scrollWidth, source.clientWidth) * Math.max(0, target.scrollWidth - target.clientWidth)
    expected.current[1 - index] = { top: Math.round(top), left: Math.round(left) }
    target.scrollTop = top
    target.scrollLeft = left
  }

  return { ref: (index) => (element) => (panes.current[index] = element), onScroll }
}

function Pane({ side, snapshot, label, source, presentation, sync, index }) {
  return (
    <section className={`compare-pane ${side}`} aria-label={side === 'before' ? 'Before' : 'After'}>
      <header className="compare-pane-header">
        <strong>
          {side === 'before' ? 'Before' : 'After'} · {label}
        </strong>
        <span className="compare-pane-version">{commitLine(snapshot)}</span>
      </header>
      <div
        className={`compare-pane-body ${presentation}`}
        ref={sync.ref(index)}
        onScroll={sync.onScroll(index)}
        data-testid={`pane-${side}`}
      >
        {source ? (
          <MermaidDiagram source={source} presentation={presentation} />
        ) : (
          <p className="compare-missing">Not present in this version.</p>
        )}
      </div>
    </section>
  )
}

export default function ChangesView({ entry, from, to, fromLabel, toLabel, toolbar }) {
  const sync = useSyncedScroll()
  const presentation = (entry.after ?? entry.before)?.presentation ?? 'default'
  return (
    <article>
      <div className="diagram-heading">
        <div>
          <h2>{entry.title}</h2>
          {entry.summary && <p className="summary">{entry.summary}</p>}
        </div>
        {toolbar}
      </div>

      {entry.error && (
        <div className="diagram-error" role="alert">
          <strong>Semantic diff unavailable</strong>
          <pre>{entry.error}</pre>
        </div>
      )}

      {!entry.error && (
        <>
          {entry.diff.count === 0 ? (
            <p className="no-change" data-testid="no-change">
              No architecture change in this review.
            </p>
          ) : (
            <Legend />
          )}
          {!entry.before && <p className="notice">New diagram in this review.</p>}
          {!entry.after && <p className="notice">Diagram removed in this review.</p>}
          {entry.metadataChanges.length > 0 && (
            <p className="metadata-note">Review metadata changed: {entry.metadataChanges.join(', ')}</p>
          )}
          <div className="compare-grid">
            <Pane side="before" index={0} snapshot={from} label={fromLabel} source={entry.panes.before} presentation={presentation} sync={sync} />
            <Pane side="after" index={1} snapshot={to} label={toLabel} source={entry.panes.after} presentation={presentation} sync={sync} />
          </div>
          {entry.diff.count > 0 && <ChangeSummary entry={entry} />}
        </>
      )}
    </article>
  )
}

import { displayName, STATUS_MARK } from '../review/changes.js'
import MermaidDiagram from './MermaidDiagram.jsx'

const LEGEND = [
  ['added', 'Added'],
  ['removed', 'Removed'],
  ['changed', 'Changed'],
  ['context', 'Context'],
]

function Legend() {
  return (
    <ul className="legend" aria-label="Legend">
      {LEGEND.map(([status, label]) => (
        <li key={status}>
          <span className={`legend-swatch ${status}`} aria-hidden="true">
            {STATUS_MARK[status]}
          </span>
          {label}
        </li>
      ))}
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

function fieldChanges(changes) {
  return changes.map(({ field, before, after }) => `${field} "${before}" → "${after}"`).join('; ')
}

function SummarySection({ title, status, items }) {
  return (
    <section className="change-section" data-testid={`summary-${title.toLowerCase().replace(' ', '-')}`}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="change-none">None</p>
      ) : (
        <ul>
          {items.map((text) => (
            <li key={text} className={`change-item ${status}`}>
              <span className="change-mark" aria-hidden="true">
                {STATUS_MARK[status]}
              </span>
              {text}
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
  const nodeText = (node) => `${displayName(node)} (${node.id})`
  return (
    <div className="change-summary" aria-label="Change summary">
      <SummarySection title="Added nodes" status="added" items={diff.addedNodes.map(nodeText)} />
      <SummarySection title="Removed nodes" status="removed" items={diff.removedNodes.map(nodeText)} />
      <SummarySection
        title="Changed nodes"
        status="changed"
        items={diff.changedNodes.map((c) => `${nodeText(c.after)}: ${fieldChanges(c.changes)}`)}
      />
      <SummarySection title="Added edges" status="added" items={diff.addedEdges.map((e) => edgeText(e, name))} />
      <SummarySection title="Removed edges" status="removed" items={diff.removedEdges.map((e) => edgeText(e, name))} />
      <SummarySection
        title="Changed edges"
        status="changed"
        items={diff.changedEdges.map((c) => `${edgeText(c.after, name)}: ${fieldChanges(c.changes)}`)}
      />
    </div>
  )
}

export default function ChangesView({ entry }) {
  return (
    <article>
      <h2>{entry.title}</h2>
      {entry.summary && <p className="summary">{entry.summary}</p>}

      {entry.error && (
        <div className="diagram-error" role="alert">
          <strong>Semantic diff unavailable</strong>
          <pre>{entry.error}</pre>
        </div>
      )}

      {!entry.error && entry.diff.count === 0 && (
        <p className="no-change" data-testid="no-change">
          No architecture change in this review version.
        </p>
      )}

      {!entry.error && entry.diff.count > 0 && (
        <>
          {!entry.before && <p className="notice">New diagram in this version.</p>}
          {!entry.after && <p className="notice">Diagram removed in this version.</p>}
          <Legend />
          <p className="changes-size" data-testid="changes-size">
            Changed-only view: {entry.size.nodes} of {entry.size.canonicalNodes} nodes ·{' '}
            {entry.size.edges} edges shown (full diagram has {entry.size.canonicalEdges})
          </p>
          <div className="diagram-canvas changes-canvas">
            <MermaidDiagram source={entry.mermaid} />
          </div>
          <ChangeSummary entry={entry} />
        </>
      )}

      {entry.metadataChanges.length > 0 && (
        <p className="metadata-note">Review metadata changed: {entry.metadataChanges.join(', ')}</p>
      )}
    </article>
  )
}

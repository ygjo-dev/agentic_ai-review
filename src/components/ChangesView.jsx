import { displayName, STATUS_MARK } from '../review/changes.js'
import MermaidDiagram from './MermaidDiagram.jsx'

const LEGEND = [
  ['added', 'Added'],
  ['removed', 'Removed'],
  ['unchanged', 'Unchanged'],
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

function SummarySection({ title, status, items }) {
  return (
    <section className="change-section" data-testid={`summary-${title.toLowerCase().replace(' ', '-')}`}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="change-none">None</p>
      ) : (
        <ul>
          {items.map(({ text, modified }) => (
            <li key={text} className={`change-item ${status}`}>
              <span className="change-mark" aria-hidden="true">
                {STATUS_MARK[status]}
              </span>
              <span>
                {text}
                {modified && <span className="change-modified"> · {modified}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// A modified node or edge is listed twice: its old form as removed, its new form as added.
function ChangeSummary({ entry }) {
  const { diff } = entry
  const name = nodeNamer(entry)
  const node = (n, modified) => ({ text: `${displayName(n)} (${n.id})`, modified })
  const edge = (e, modified) => ({ text: edgeText(e, name), modified })
  const fields = (changes) => changes.map((c) => c.field).join(', ')
  return (
    <div className="change-summary" aria-label="Change summary">
      <SummarySection
        title="Added nodes"
        status="added"
        items={[
          ...diff.addedNodes.map((n) => node(n)),
          ...diff.changedNodes.map((c) => node(c.after, `new ${fields(c.changes)}`)),
        ]}
      />
      <SummarySection
        title="Removed nodes"
        status="removed"
        items={[
          ...diff.removedNodes.map((n) => node(n)),
          ...diff.changedNodes.map((c) => node(c.before, `previous ${fields(c.changes)}`)),
        ]}
      />
      <SummarySection
        title="Added edges"
        status="added"
        items={[
          ...diff.addedEdges.map((e) => edge(e)),
          ...diff.changedEdges.map((c) => edge(c.after, `new ${fields(c.changes)}`)),
        ]}
      />
      <SummarySection
        title="Removed edges"
        status="removed"
        items={[
          ...diff.removedEdges.map((e) => edge(e)),
          ...diff.changedEdges.map((c) => edge(c.before, `previous ${fields(c.changes)}`)),
        ]}
      />
    </div>
  )
}

export default function ChangesView({ entry }) {
  const presentation = (entry.after ?? entry.before)?.presentation ?? 'default'
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
          <div className={`diagram-canvas ${presentation}`}>
            <MermaidDiagram source={entry.mermaid} presentation={presentation} />
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

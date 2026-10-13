// Semantic diff between two parsed flowcharts (see flowchart.js) and the small
// "changed-only" Mermaid diagram built around what changed. Pure module.
import { ARROW_SYNTAX, SHAPE_BRACKETS } from './flowchart.js'

const EMPTY_GRAPH = { direction: null, nodes: [], edges: [], subgraphs: [] }

export const STATUS_MARK = { added: '+', removed: '−', changed: '~', context: '' }

// Edge identity is the directed endpoint pair. When one pair carries several
// edges in either version, those edges are told apart by label and style; if
// that is still not unique the diff refuses instead of pairing them up wrongly.
function edgeKeys(before, after) {
  const pair = (edge) =>
    edge.arrow === 'bidirectional'
      ? [edge.from, edge.to].sort().join(' <-> ')
      : `${edge.from} -> ${edge.to}`
  const counts = new Map()
  for (const edge of [...before.edges, ...after.edges]) counts.set(pair(edge), 0)
  for (const graph of [before, after]) {
    const seen = new Map()
    for (const edge of graph.edges) seen.set(pair(edge), (seen.get(pair(edge)) ?? 0) + 1)
    for (const [key, n] of seen) counts.set(key, Math.max(counts.get(key), n))
  }
  const keyOf = (edge) =>
    counts.get(pair(edge)) > 1 ? `${pair(edge)} [${edge.style}] "${edge.label}"` : pair(edge)

  const index = (graph, name) => {
    const byKey = new Map()
    for (const edge of graph.edges) {
      const key = keyOf(edge)
      if (byKey.has(key)) {
        throw new Error(`ambiguous edge identity in the ${name} version: ${key} appears more than once`)
      }
      byKey.set(key, edge)
    }
    return byKey
  }
  return [index(before, 'compared'), index(after, 'selected')]
}

function nodeChanges(before, after) {
  const changes = []
  if (before.label !== after.label) changes.push({ field: 'label', before: before.label, after: after.label })
  if (before.shape !== after.shape) changes.push({ field: 'shape', before: before.shape, after: after.shape })
  return changes
}

function edgeChanges(before, after) {
  const changes = []
  for (const field of ['label', 'style', 'arrow']) {
    if (before[field] !== after[field]) changes.push({ field, before: before[field], after: after[field] })
  }
  return changes
}

// before / after: parsed graphs, or null when the diagram is absent in that version.
export function diffGraphs(before, after) {
  const from = before ?? EMPTY_GRAPH
  const to = after ?? EMPTY_GRAPH
  const beforeNodes = new Map(from.nodes.map((node) => [node.id, node]))
  const afterNodes = new Map(to.nodes.map((node) => [node.id, node]))
  const [beforeEdges, afterEdges] = edgeKeys(from, to)

  const diff = {
    addedNodes: to.nodes.filter((node) => !beforeNodes.has(node.id)),
    removedNodes: from.nodes.filter((node) => !afterNodes.has(node.id)),
    changedNodes: [],
    addedEdges: [],
    removedEdges: [],
    changedEdges: [],
  }
  for (const node of to.nodes) {
    const old = beforeNodes.get(node.id)
    const changes = old ? nodeChanges(old, node) : []
    if (changes.length) diff.changedNodes.push({ before: old, after: node, changes })
  }
  for (const [key, edge] of afterEdges) {
    const old = beforeEdges.get(key)
    if (!old) diff.addedEdges.push(edge)
    else {
      const changes = edgeChanges(old, edge)
      if (changes.length) diff.changedEdges.push({ before: old, after: edge, changes })
    }
  }
  for (const [key, edge] of beforeEdges) {
    if (!afterEdges.has(key)) diff.removedEdges.push(edge)
  }
  diff.count = Object.values(diff).reduce((sum, list) => sum + list.length, 0)
  return diff
}

// Changed elements, the endpoints of changed edges, the 1-hop neighbours of
// changed nodes, and the edges that run between those nodes. Nothing further.
export function changedOnlyGraph(before, after, diff) {
  const from = before ?? EMPTY_GRAPH
  const to = after ?? EMPTY_GRAPH
  const nodes = new Map() // id -> { node, status }
  const include = (id, status = 'context') => {
    const current = nodes.get(id)
    if (current && current.status !== 'context') return
    const node = to.nodes.find((n) => n.id === id) ?? from.nodes.find((n) => n.id === id)
    nodes.set(id, { node, status })
  }

  for (const node of diff.addedNodes) include(node.id, 'added')
  for (const node of diff.removedNodes) include(node.id, 'removed')
  for (const { after: node } of diff.changedNodes) include(node.id, 'changed')

  const neighbours = (graph, id) =>
    graph.edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []))
  for (const node of [...diff.addedNodes, ...diff.changedNodes.map((c) => c.after)]) {
    for (const id of neighbours(to, node.id)) include(id)
  }
  for (const node of diff.removedNodes) {
    for (const id of neighbours(from, node.id)) include(id)
  }

  const edges = []
  for (const edge of diff.addedEdges) edges.push({ edge, status: 'added' })
  for (const { after: edge } of diff.changedEdges) edges.push({ edge, status: 'changed' })
  for (const edge of diff.removedEdges) edges.push({ edge, status: 'removed' })
  for (const { edge } of edges) {
    include(edge.from)
    include(edge.to)
  }

  const changedEdges = new Set(
    [...diff.addedEdges, ...diff.changedEdges.map((c) => c.after)],
  )
  for (const edge of to.edges) {
    if (!changedEdges.has(edge) && nodes.has(edge.from) && nodes.has(edge.to)) {
      edges.push({ edge, status: 'context' })
    }
  }

  return { direction: to.direction ?? from.direction ?? 'LR', nodes: [...nodes.values()], edges }
}

const STYLE = {
  added: { node: 'fill:#e7f5ea,stroke:#1f7a35,stroke-width:3px,color:#123d1c', link: 'stroke:#1f7a35,stroke-width:3px' },
  removed: { node: 'fill:#fdecec,stroke:#b42318,stroke-width:3px,stroke-dasharray:6 4,color:#5c140e', link: 'stroke:#b42318,stroke-width:3px' },
  changed: { node: 'fill:#fff4dc,stroke:#a15c00,stroke-width:3px,color:#4a2a00', link: 'stroke:#a15c00,stroke-width:3px' },
  context: { node: 'fill:#f3f4f6,stroke:#9aa0a6,stroke-width:1px,color:#4b5563', link: 'stroke:#9aa0a6,stroke-width:1px' },
}

const marked = (status, text) => (STATUS_MARK[status] ? `${STATUS_MARK[status]} ${text}`.trim() : text)

// Viewer-only Mermaid: the canonical .mmd files never carry these styles.
export function changedOnlyMermaid(subgraph) {
  const lines = [`flowchart ${subgraph.direction}`]
  for (const { node, status } of subgraph.nodes) {
    const [open, close] = SHAPE_BRACKETS[node.shape]
    lines.push(`    ${node.id}${open}"${marked(status, node.label)}"${close}`)
  }
  subgraph.edges.forEach(({ edge, status }) => {
    const label = marked(status, edge.label)
    const arrow = ARROW_SYNTAX[`${edge.style}/${edge.arrow}`]
    lines.push(`    ${edge.from} ${arrow}${label ? `|"${label}"|` : ''} ${edge.to}`)
  })
  for (const [status, { node }] of Object.entries(STYLE)) {
    const ids = subgraph.nodes.filter((n) => n.status === status).map((n) => n.node.id)
    if (ids.length) lines.push(`    classDef ${status}Node ${node}`, `    class ${ids.join(',')} ${status}Node`)
  }
  subgraph.edges.forEach(({ status }, index) => lines.push(`    linkStyle ${index} ${STYLE[status].link}`))
  return lines.join('\n') + '\n'
}

// First line of a Mermaid label without markup, for text summaries.
export function displayName(node) {
  const text = node.label.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, '').trim()
  return text || node.id
}

const METADATA_FIELDS = ['title', 'summary', 'file', 'watch']

// One entry per diagram of either version (selected version's order first),
// with its semantic diff, changed-only Mermaid and size, or the reason it has none.
export function compareVersions(fromVersion, toVersion) {
  const beforeById = new Map(fromVersion.diagrams.map((diagram) => [diagram.id, diagram]))
  const afterIds = new Set(toVersion.diagrams.map((diagram) => diagram.id))
  const pairs = [
    ...toVersion.diagrams.map((after) => [beforeById.get(after.id) ?? null, after]),
    ...fromVersion.diagrams.filter((before) => !afterIds.has(before.id)).map((before) => [before, null]),
  ]

  return pairs.map(([before, after]) => {
    const shown = after ?? before
    const entry = { id: shown.id, title: shown.title, summary: shown.summary, before, after }
    entry.metadataChanges =
      before && after
        ? METADATA_FIELDS.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
        : []
    const graphError = before?.graphError ?? after?.graphError
    if (graphError) return { ...entry, error: graphError }
    try {
      const diff = diffGraphs(before?.graph ?? null, after?.graph ?? null)
      const subgraph = changedOnlyGraph(before?.graph ?? null, after?.graph ?? null, diff)
      return {
        ...entry,
        diff,
        mermaid: diff.count ? changedOnlyMermaid(subgraph) : null,
        size: {
          nodes: subgraph.nodes.length,
          edges: subgraph.edges.length,
          canonicalNodes: (after ?? before).graph.nodes.length,
          canonicalEdges: (after ?? before).graph.edges.length,
        },
      }
    } catch (error) {
      return { ...entry, error: `${shown.file}: ${error.message}` }
    }
  })
}

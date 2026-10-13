// Semantic diff between two parsed flowcharts (see flowchart.js) and the
// full-context Changes diagram that highlights it. Pure module.
import { ARROW_SYNTAX, SHAPE_BRACKETS } from './flowchart.js'

const EMPTY_GRAPH = { direction: null, nodes: [], edges: [], subgraphs: [] }

export const STATUS_MARK = { added: '+', removed: '−', unchanged: '' }

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

const DIFF_STYLE = {
  added: {
    node: 'fill:#e7f5ea,stroke:#1f7a35,stroke-width:3px,color:#123d1c',
    link: 'stroke:#1f7a35,stroke-width:3px',
  },
  removed: {
    node: 'fill:#fdecec,stroke:#b42318,stroke-width:3px,stroke-dasharray:6 4,color:#5c140e',
    link: 'stroke:#b42318,stroke-width:3px',
  },
}

const removedLabel = (label) => `${STATUS_MARK.removed} ${label}`.trim()

function nodeLine(id, node, label) {
  const [open, close] = SHAPE_BRACKETS[node.shape]
  return `${id}${open}"${label}"${close}`
}

function edgeLine(from, to, edge, label) {
  const arrow = ARROW_SYNTAX[`${edge.style}/${edge.arrow}`]
  return `${from} ${arrow}${label ? `|"${label}"|` : ''} ${to}`
}

// Viewer-only Mermaid for Changes: the selected (after) diagram's canonical text,
// untouched, so it lays out like Full; added elements only gain a style. What the
// compared (before) version had and the selected one lost is added on top in red:
// removed nodes and edges, and the old side of a modified node or edge (a modified
// element shows as removed old + added new). The .mmd sources never carry this.
export function diffMermaid(before, after, diff) {
  if (!after) {
    // The whole diagram was removed: show the compared version, all red.
    const graph = before.graph
    const lines = before.source.trimEnd().split('\n')
    lines.push(`    classDef diffRemoved ${DIFF_STYLE.removed.node}`)
    if (graph.nodes.length) lines.push(`    class ${graph.nodes.map((n) => n.id).join(',')} diffRemoved`)
    graph.edges.forEach((_, index) => lines.push(`    linkStyle ${index} ${DIFF_STYLE.removed.link}`))
    return lines.join('\n') + '\n'
  }

  const graph = after.graph
  const lines = after.source.trimEnd().split('\n')
  const insertAfter = new Map() // 1-based line number -> lines to add after it
  const insert = (lineNo, text) => insertAfter.set(lineNo, [...(insertAfter.get(lineNo) ?? []), text])
  const appended = []
  const links = [] // appended links, in emission order
  const usedIds = new Set([...graph.nodes.map((n) => n.id), ...graph.subgraphs.map((s) => s.id)])
  const subgraphEnd = new Map(graph.subgraphs.map((s) => [s.id, s.endLine]))

  // Removed nodes keep their id (it is free in the selected version) and go back
  // into their old subgraph when that still exists.
  const declare = (node, id, nearLine) => {
    const text = `    ${nodeLine(id, node, removedLabel(node.label))}`
    if (nearLine) insert(nearLine, text)
    else if (node.subgraph && subgraphEnd.has(node.subgraph)) insert(subgraphEnd.get(node.subgraph) - 1, text)
    else appended.push(text)
  }
  const removedIds = []
  for (const node of diff.removedNodes) {
    declare(node, node.id)
    removedIds.push(node.id)
  }
  // The old side of a modified node needs a viewer-only id next to the canonical one.
  for (const { before: old, after: current } of diff.changedNodes) {
    let id = `${current.id}__removed`
    while (usedIds.has(id)) id += '_'
    usedIds.add(id)
    declare(old, id, current.line)
    removedIds.push(id)
    links.push({ text: `${id} ~~~ ${current.id}`, status: 'invisible' })
  }
  for (const edge of [...diff.removedEdges, ...diff.changedEdges.map((c) => c.before)]) {
    links.push({ text: edgeLine(edge.from, edge.to, edge, removedLabel(edge.label)), status: 'removed' })
  }

  const out = []
  lines.forEach((line, index) => {
    out.push(line)
    out.push(...(insertAfter.get(index + 1) ?? []))
  })
  out.push(...appended, ...links.map((link) => `    ${link.text}`))

  const addedIds = [...diff.addedNodes.map((n) => n.id), ...diff.changedNodes.map((c) => c.after.id)]
  if (addedIds.length) out.push(`    classDef diffAdded ${DIFF_STYLE.added.node}`, `    class ${addedIds.join(',')} diffAdded`)
  if (removedIds.length) out.push(`    classDef diffRemoved ${DIFF_STYLE.removed.node}`, `    class ${removedIds.join(',')} diffRemoved`)
  // Canonical links keep their indexes; appended links follow them.
  const addedEdges = new Set([...diff.addedEdges, ...diff.changedEdges.map((c) => c.after)])
  graph.edges.forEach((edge, index) => {
    if (addedEdges.has(edge)) out.push(`    linkStyle ${index} ${DIFF_STYLE.added.link}`)
  })
  links.forEach((link, offset) => {
    if (link.status === 'removed') out.push(`    linkStyle ${graph.edges.length + offset} ${DIFF_STYLE.removed.link}`)
  })
  return out.join('\n') + '\n'
}

// First line of a Mermaid label without markup, for text summaries.
export function displayName(node) {
  const text = node.label.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, '').trim()
  return text || node.id
}

const METADATA_FIELDS = ['title', 'summary', 'file', 'watch']

// One entry per diagram of either version (selected version's order first),
// with its semantic diff and Changes Mermaid, or the reason it has none.
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
      return { ...entry, diff, mermaid: diff.count ? diffMermaid(before, after, diff) : null }
    } catch (error) {
      return { ...entry, error: `${shown.file}: ${error.message}` }
    }
  })
}

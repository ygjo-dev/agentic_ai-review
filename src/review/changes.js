// Semantic diff between two parsed flowcharts (see flowchart.js) and the
// Before / After diagrams that show it side by side. Pure module.
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
    link: 'stroke:#1f7a35,stroke-width:3px,color:#1f7a35',
  },
  removed: {
    node: 'fill:#fdecec,stroke:#b42318,stroke-width:3px,stroke-dasharray:6 4,color:#5c140e',
    link: 'stroke:#b42318,stroke-width:3px,color:#b42318',
  },
}

const LINE_BREAK = /<br\s*\/?>/i

// The text a reader sees on one label line: markup dropped, spaces folded.
export function visibleText(line) {
  return line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

// Line diff of two labels by visible text. A line whose exact visible text is on both
// sides is unchanged wherever it sits: moving a line is not changing it. Repeated lines
// match by count (min of the two sides); only the extra copies are removed / added.
// A longest common subsequence pairs the lines that kept their order first (so among
// repeated lines the right copy is marked), then each leftover removed line pairs with a
// leftover added line of the same text. Returns, per side, each label line in its own
// order with its status: 'same', 'removed' (before only) or 'added' (after only).
export function diffLabelLines(beforeLabel, afterLabel) {
  const a = beforeLabel.split(LINE_BREAK)
  const b = afterLabel.split(LINE_BREAK)
  const ka = a.map(visibleText)
  const kb = b.map(visibleText)
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const before = []
  const after = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) {
      before.push({ line: a[i++], status: 'same' })
      after.push({ line: b[j++], status: 'same' })
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      before.push({ line: a[i++], status: 'removed' })
    } else {
      after.push({ line: b[j++], status: 'added' })
    }
  }
  // Lines that only moved: same text left over on both sides.
  const removed = new Map()
  for (const entry of before) {
    if (entry.status !== 'removed') continue
    const key = visibleText(entry.line)
    removed.set(key, [...(removed.get(key) ?? []), entry])
  }
  for (const entry of after) {
    const match = entry.status === 'added' && removed.get(visibleText(entry.line))?.shift()
    if (match) {
      match.status = 'same'
      entry.status = 'same'
    }
  }
  return { before, after }
}

const LINE_TAG = { removed: 'del', added: 'ins' }

function markedLabel(lines) {
  return lines
    .map(({ line, status }) => (LINE_TAG[status] && line ? `<${LINE_TAG[status]}>${line}</${LINE_TAG[status]}>` : line))
    .join('<br/>')
}

// The canonical source line of one edge, with its label replaced.
function edgeLine(indent, edge, label) {
  const syntax = ARROW_SYNTAX[`${edge.style}/${edge.arrow}`]
  return `${indent}${edge.from} ${syntax}${label ? `|"${label}"|` : ''} ${edge.to}`
}

// An edge whose line style or direction changed is drawn differently, so it counts as
// removed + added like a node whose shape changed. A label-only change is not.
const STRUCTURAL_EDGE_FIELDS = new Set(['style', 'arrow'])

// Viewer-only Mermaid for one side of Changes: that version's canonical text,
// so it lays out like its Full view, plus styles for what changed on this side.
// side 'before': removed nodes and edges red; 'after': added ones green (path, arrowhead
// and label). A node whose shape changed, or an edge whose line style / direction changed,
// counts as removed + added. A node or edge whose label alone changed stays neutral: only
// its changed label lines are marked, <del> before / <ins> after.
// The .mmd sources never carry any of this.
export function sideMermaid(diagram, diff, side) {
  const removedSide = side === 'before'
  const style = removedSide ? DIFF_STYLE.removed : DIFF_STYLE.added
  const className = removedSide ? 'diffRemoved' : 'diffAdded'
  const graph = diagram.graph
  const lines = diagram.source.trimEnd().split('\n')

  const wholeNodes = removedSide ? [...diff.removedNodes] : [...diff.addedNodes]
  for (const change of diff.changedNodes) {
    const node = removedSide ? change.before : change.after
    if (change.changes.some((c) => c.field === 'shape')) {
      wholeNodes.push(node)
      continue
    }
    const index = node.line - 1
    const [open, close] = SHAPE_BRACKETS[node.shape]
    // An undeclared node (named only in an edge) has no label line to mark.
    if (!lines[index].trim().startsWith(`${node.id}${open}"`)) {
      wholeNodes.push(node)
      continue
    }
    const labels = diffLabelLines(change.before.label, change.after.label)
    const indent = lines[index].match(/^(\s*)/)[1]
    lines[index] = `${indent}${node.id}${open}"${markedLabel(removedSide ? labels.before : labels.after)}"${close}`
  }

  const styled = new Set(removedSide ? diff.removedEdges : diff.addedEdges)
  for (const change of diff.changedEdges) {
    const edge = removedSide ? change.before : change.after
    if (change.changes.some((c) => STRUCTURAL_EDGE_FIELDS.has(c.field))) {
      styled.add(edge)
      continue
    }
    if (!edge.label) continue
    const labels = diffLabelLines(change.before.label, change.after.label)
    const index = edge.line - 1
    const indent = lines[index].match(/^(\s*)/)[1]
    lines[index] = edgeLine(indent, edge, markedLabel(removedSide ? labels.before : labels.after))
  }
  if (wholeNodes.length) {
    lines.push(`    classDef ${className} ${style.node}`, `    class ${wholeNodes.map((n) => n.id).join(',')} ${className}`)
  }
  graph.edges.forEach((edge, index) => {
    if (styled.has(edge)) lines.push(`    linkStyle ${index} ${style.link}`)
  })
  return lines.join('\n') + '\n'
}

const METADATA_FIELDS = ['title', 'summary', 'file', 'watch', 'presentation']

// One entry per diagram of either snapshot (After order first),
// with its semantic diff and Before / After Mermaid, or the reason it has none.
export function compareSnapshots(fromVersion, toVersion) {
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
      return {
        ...entry,
        diff,
        panes: {
          before: before && sideMermaid(before, diff, 'before'),
          after: after && sideMermaid(after, diff, 'after'),
        },
      }
    } catch (error) {
      return { ...entry, error: `${shown.file}: ${error.message}` }
    }
  })
}

// The tab badge for one compareSnapshots entry.
export function changeBadge(entry) {
  if (entry.error) return { text: 'Error', kind: 'error' }
  if (!entry.before) return { text: 'New', kind: 'count' }
  if (!entry.after) return { text: 'Removed', kind: 'count' }
  if (entry.diff.count > 0) return { text: `${entry.diff.count} ${entry.diff.count === 1 ? 'change' : 'changes'}`, kind: 'count' }
  return { text: 'No change', kind: 'none' }
}

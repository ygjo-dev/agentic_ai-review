// Semantic model of the Mermaid flowchart subset that agentic_ai dev/review uses.
// Anything outside that subset is rejected with a line number instead of being
// guessed at, so a Changes diff is never built from a misread diagram.
// Pure module: the Vite plugin runs it at build time; no Node or DOM APIs.

const ID = '[A-Za-z_][A-Za-z0-9_]*'

// Node shapes in use, keyed by their opening bracket.
export const SHAPES = {
  '([': { shape: 'stadium', close: '])' },
  '[(': { shape: 'cylinder', close: ')]' },
  '[/': { shape: 'parallelogram', close: '/]' },
  '[': { shape: 'rectangle', close: ']' },
  '{': { shape: 'rhombus', close: '}' },
}
export const SHAPE_BRACKETS = Object.fromEntries(
  Object.entries(SHAPES).map(([open, { shape, close }]) => [shape, [open, close]]),
)

export const ARROWS = {
  '-->': { style: 'solid', arrow: 'directed' },
  '-.->': { style: 'dashed', arrow: 'directed' },
  '<-.->': { style: 'dashed', arrow: 'bidirectional' },
}
export const ARROW_SYNTAX = Object.fromEntries(
  Object.entries(ARROWS).map(([syntax, { style, arrow }]) => [`${style}/${arrow}`, syntax]),
)

const HEADER = /^flowchart\s+(LR|RL|TB|TD|BT)$/
const SUBGRAPH = new RegExp(`^subgraph\\s+(${ID})\\["([^"]*)"\\]$`)
const NODE = new RegExp(`^(${ID})(\\(\\[|\\[\\(|\\[/|\\[|\\{)"([^"]*)"(\\]\\)|\\)\\]|/\\]|\\]|\\})$`)
const EDGE = new RegExp(`^(${ID})\\s+(<-\\.->|-\\.->|-->)(?:\\|"([^"]*)"\\|)?\\s+(${ID})$`)

export class FlowchartError extends Error {}

export function parseFlowchart(source) {
  const nodes = new Map()
  const edges = []
  const subgraphs = new Map()
  const stack = []
  let direction = null

  const fail = (lineNo, message) => {
    throw new FlowchartError(`line ${lineNo}: ${message}`)
  }

  source.split('\n').forEach((raw, index) => {
    const lineNo = index + 1
    const line = raw.trim()
    if (line === '') return
    if (line.startsWith('%%{')) fail(lineNo, `unsupported Mermaid directive: ${line}`)
    if (line.startsWith('%%')) return

    if (direction === null) {
      const header = HEADER.exec(line)
      if (!header) fail(lineNo, `expected "flowchart <direction>", got: ${line}`)
      direction = header[1]
      return
    }

    let match
    if ((match = SUBGRAPH.exec(line))) {
      const [, id, label] = match
      if (subgraphs.has(id) || nodes.has(id)) fail(lineNo, `id "${id}" is declared twice`)
      subgraphs.set(id, { id, label, parent: stack.at(-1) ?? null, line: lineNo, endLine: null })
      stack.push(id)
    } else if (line === 'end') {
      if (stack.length === 0) fail(lineNo, '"end" without an open subgraph')
      subgraphs.get(stack.pop()).endLine = lineNo
    } else if ((match = NODE.exec(line))) {
      const [, id, open, label, close] = match
      const known = SHAPES[open]
      if (known.close !== close) fail(lineNo, `unsupported node shape ${open}…${close}: ${line}`)
      if (id === 'end') fail(lineNo, '"end" cannot be a node id')
      if (nodes.has(id) || subgraphs.has(id)) fail(lineNo, `id "${id}" is declared twice`)
      nodes.set(id, { id, label, shape: known.shape, subgraph: stack.at(-1) ?? null, line: lineNo })
    } else if ((match = EDGE.exec(line))) {
      const [, from, syntax, label = '', to] = match
      edges.push({ from, to, label, ...ARROWS[syntax], line: lineNo })
    } else {
      fail(lineNo, `unsupported Mermaid syntax: ${line}`)
    }
  })

  if (direction === null) throw new FlowchartError('empty diagram: no "flowchart" header')
  if (stack.length > 0) throw new FlowchartError(`subgraph "${stack.at(-1)}" is never closed`)

  for (const edge of edges) {
    for (const id of [edge.from, edge.to]) {
      if (subgraphs.has(id)) {
        throw new FlowchartError(`line ${edge.line}: edges to subgraph "${id}" are not supported`)
      }
      // Mermaid creates an undeclared endpoint as a plain box labelled with its id.
      if (!nodes.has(id)) nodes.set(id, { id, label: id, shape: 'rectangle', subgraph: null, line: edge.line })
    }
  }

  return {
    direction,
    nodes: [...nodes.values()],
    edges,
    subgraphs: [...subgraphs.values()],
  }
}

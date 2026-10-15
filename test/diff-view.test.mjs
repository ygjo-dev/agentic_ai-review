// Diff colour contract of the Before / After panes, and what the Changes view renders.
//   unchanged node / edge   neutral diagram theme on both sides
//   changed node / edge     neutral; only the changed label text is <del> (Before) / <ins> (After)
//   added node / edge       After only, whole object green (edge: path, arrowhead, label)
//   removed node / edge     Before only, whole object red
// Fixture: Before A -> B -> C, After A -> B -> D, B's label partly rewritten.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { changeBadge, compareSnapshots, diffGraphs, diffLabelLines, sideMermaid } from '../src/review/changes.js'
import { parseFlowchart } from '../src/review/flowchart.js'

const viewer = path.resolve(import.meta.dirname, '..')

const BEFORE = `flowchart TB
    A(["<b>01 A</b><br/>• keep"])
    B["<b>02 B</b><br/>• old text<br/>• same"]
    C["<b>03 C</b>"]
    X["<b>E X</b>"]

    A --> B
    B --> C
    A -.->|"old label"| X
    B --> X
    C -.->|"removed edge label"| X
`
const AFTER = `flowchart TB
    A(["<b>01 A</b><br/>• keep"])
    B["<b>02 B</b><br/>• new text<br/>• same"]
    D["<b>03 D</b>"]
    X["<b>E X</b>"]

    A --> B
    B --> D
    A -.->|"new label"| X
    B -.-> X
    D -.->|"added edge label"| X
`

const diagram = (source, extra = {}) => ({
  id: 'runtime_pipeline', title: 'Runtime Pipeline', summary: '', file: 'x.mmd', presentation: 'default',
  source, graph: parseFlowchart(source), ...extra,
})
const sides = () => {
  const from = diagram(BEFORE)
  const to = diagram(AFTER)
  const diff = diffGraphs(from.graph, to.graph)
  return { diff, before: sideMermaid(from, diff, 'before'), after: sideMermaid(to, diff, 'after') }
}
const classed = (mermaid, name) => {
  const line = mermaid.split('\n').find((l) => l.trim().startsWith('class ') && l.trim().endsWith(` ${name}`))
  return line ? line.trim().split(' ')[1].split(',') : []
}
const linkStyles = (mermaid) =>
  new Map(mermaid.split('\n').filter((l) => l.trim().startsWith('linkStyle ')).map((l) => {
    const [, index, style] = l.trim().split(' ')
    return [Number(index), style]
  }))
const edgeIndex = (source, from, to) => parseFlowchart(source).edges.findIndex((e) => e.from === from && e.to === to)
const nodeLine = (mermaid, id) => mermaid.split('\n').find((l) => l.trim().startsWith(`${id}[`) || l.trim().startsWith(`${id}(`))
const edgeLine = (mermaid, from, to) => mermaid.split('\n').find((l) => new RegExp(`^\\s*${from} \\S+.* ${to}$`).test(l))

test('the diff still counts every change (the badge)', () => {
  const { diff } = sides()
  assert.deepEqual(diff.addedNodes.map((n) => n.id), ['D'])
  assert.deepEqual(diff.removedNodes.map((n) => n.id), ['C'])
  assert.deepEqual(diff.changedNodes.map((c) => c.after.id), ['B'])
  assert.equal(diff.count, 9)
})

test('the badge counts in English: 1 change, 2 changes, No change', () => {
  const entry = (count) => ({ before: {}, after: {}, diff: { count } })
  assert.deepEqual(changeBadge(entry(1)), { text: '1 change', kind: 'count' })
  assert.deepEqual(changeBadge(entry(2)), { text: '2 changes', kind: 'count' })
  assert.deepEqual(changeBadge(entry(0)), { text: 'No change', kind: 'none' })
  assert.deepEqual(changeBadge({ ...entry(0), before: null }), { text: 'New', kind: 'count' })
  assert.deepEqual(changeBadge({ ...entry(0), after: null }), { text: 'Removed', kind: 'count' })
  assert.deepEqual(changeBadge({ error: 'x' }), { text: 'Error', kind: 'error' })
})

test('added node: whole green on After, absent on Before', () => {
  const { before, after } = sides()
  assert.deepEqual(classed(after, 'diffAdded'), ['D'])
  assert.match(after, /classDef diffAdded fill:#e7f5ea,stroke:#1f7a35/)
  assert.equal(nodeLine(before, 'D'), undefined)
})

test('removed node: whole red on Before, absent on After', () => {
  const { before, after } = sides()
  assert.deepEqual(classed(before, 'diffRemoved'), ['C'])
  assert.match(before, /classDef diffRemoved fill:#fdecec,stroke:#b42318/)
  assert.equal(nodeLine(after, 'C'), undefined)
})

test('changed node stays neutral; only its changed lines are del / ins', () => {
  const { before, after } = sides()
  for (const mermaid of [before, after]) {
    assert.ok(!classed(mermaid, 'diffAdded').includes('B') && !classed(mermaid, 'diffRemoved').includes('B'))
  }
  assert.match(nodeLine(before, 'B'), /<del>• old text<\/del><br\/>• same/)
  assert.doesNotMatch(nodeLine(before, 'B'), /<ins>/)
  assert.match(nodeLine(after, 'B'), /<ins>• new text<\/ins><br\/>• same/)
  assert.doesNotMatch(nodeLine(after, 'B'), /<del>/)
})

test('unchanged nodes carry no diff class or markup', () => {
  const { before, after } = sides()
  for (const mermaid of [before, after]) {
    for (const id of ['A', 'X']) {
      assert.ok(!classed(mermaid, 'diffAdded').includes(id) && !classed(mermaid, 'diffRemoved').includes(id))
      assert.doesNotMatch(nodeLine(mermaid, id), /<(ins|del)>/)
    }
  }
})

// Runtime 05 between develop ac9a0f6 and 0f20f17: one bullet rewritten, the owner line moved to
// the top. 「생성한 Workflow 전달」 and the owner are on both sides, only crossed in order.
const MOVED_BEFORE = '<b>05 KRRI_ASAP에 실행 요청</b><br/>• 사용자 도구 범위 확인<br/>• 생성한 Workflow 전달<br/><small>agentic_ai · POST /workflow/execute/stream</small>'
const MOVED_AFTER = '<b>05 KRRI_ASAP에 실행 요청</b><br/><small>agentic_ai · POST /workflow/execute/stream</small><br/>• MCP Tool 실행 권한 확인<br/>• 생성한 Workflow 전달'

test('a label line that only moved is unchanged; only the rewritten line is del / ins', () => {
  const { before, after } = diffLabelLines(MOVED_BEFORE, MOVED_AFTER)
  const marked = (lines, status) => lines.filter((l) => l.status === status).map((l) => l.line)
  assert.deepEqual(marked(before, 'removed'), ['• 사용자 도구 범위 확인'])
  assert.deepEqual(marked(after, 'added'), ['• MCP Tool 실행 권한 확인'])
  // Each side keeps its own line order.
  assert.deepEqual(before.map((l) => l.line), MOVED_BEFORE.split('<br/>'))
  assert.deepEqual(after.map((l) => l.line), MOVED_AFTER.split('<br/>'))

  const node = (label) => `flowchart TB\n    EXECUTION_REQUEST["${label}"]\n    X["<b>E X</b>"]\n    EXECUTION_REQUEST --> X\n`
  const from = diagram(node(MOVED_BEFORE))
  const to = diagram(node(MOVED_AFTER))
  const diff = diffGraphs(from.graph, to.graph)
  const b = nodeLine(sideMermaid(from, diff, 'before'), 'EXECUTION_REQUEST')
  const a = nodeLine(sideMermaid(to, diff, 'after'), 'EXECUTION_REQUEST')
  assert.match(b, /<del>• 사용자 도구 범위 확인<\/del>/)
  assert.match(a, /<ins>• MCP Tool 실행 권한 확인<\/ins>/)
  for (const [line, text] of [[b, '• 생성한 Workflow 전달'], [a, '• 생성한 Workflow 전달'], [b, 'POST /workflow/execute/stream'], [a, 'POST /workflow/execute/stream']]) {
    assert.ok(line.includes(text), text)
    assert.doesNotMatch(line, new RegExp(`<(del|ins)>[^<]*(<small>)?[^<]*${text.replace(/[/.]/g, '\\$&')}`), text)
  }
  assert.equal((b.match(/<del>/g) ?? []).length, 1)
  assert.equal((a.match(/<ins>/g) ?? []).length, 1)
  assert.equal(diff.changedNodes.length, 1)
})

test('repeated label lines match by count: only the extra occurrences are del / ins', () => {
  // Per side: how many lines are same / removed / added.
  const tally = (before, after) => {
    const r = diffLabelLines(before, after)
    const count = (lines) => lines.reduce((t, l) => ({ ...t, [l.status]: (t[l.status] ?? 0) + 1 }), {})
    return [count(r.before), count(r.after)]
  }
  assert.deepEqual(tally('same<br/>same', 'same'), [{ same: 1, removed: 1 }, { same: 1 }])
  assert.deepEqual(tally('same', 'same<br/>same'), [{ same: 1 }, { same: 1, added: 1 }])
  // Lines that swapped places are all unchanged.
  assert.deepEqual(tally('x<br/>y', 'y<br/>x'), [{ same: 2 }, { same: 2 }])
  // A moved line pairs with one occurrence only; the extra copy is still added.
  assert.deepEqual(tally('x<br/>y', 'y<br/>x<br/>x'), [{ same: 2 }, { same: 2, added: 1 }])
  assert.deepEqual(tally('x<br/>y<br/>x', 'y<br/>x'), [{ same: 2, removed: 1 }, { same: 2 }])
})

test('added edge: path, arrowhead and label green on After', () => {
  const { after } = sides()
  const styles = linkStyles(after)
  for (const [from, to] of [['B', 'D'], ['D', 'X']]) {
    assert.equal(styles.get(edgeIndex(AFTER, from, to)), 'stroke:#1f7a35,stroke-width:3px,color:#1f7a35', `${from}->${to}`)
  }
})

test('removed edge: path, arrowhead and label red on Before', () => {
  const { before } = sides()
  const styles = linkStyles(before)
  for (const [from, to] of [['B', 'C'], ['C', 'X']]) {
    assert.equal(styles.get(edgeIndex(BEFORE, from, to)), 'stroke:#b42318,stroke-width:3px,color:#b42318', `${from}->${to}`)
  }
})

test('edge whose label alone changed: neutral path, label text del / ins', () => {
  const { before, after } = sides()
  assert.ok(!linkStyles(before).has(edgeIndex(BEFORE, 'A', 'X')))
  assert.ok(!linkStyles(after).has(edgeIndex(AFTER, 'A', 'X')))
  assert.equal(edgeLine(before, 'A', 'X').trim(), 'A -.->|"<del>old label</del>"| X')
  assert.equal(edgeLine(after, 'A', 'X').trim(), 'A -.->|"<ins>new label</ins>"| X')
})

test('edge whose line style changed counts as removed + added', () => {
  const { before, after } = sides()
  assert.match(linkStyles(before).get(edgeIndex(BEFORE, 'B', 'X')), /stroke:#b42318/)
  assert.match(linkStyles(after).get(edgeIndex(AFTER, 'B', 'X')), /stroke:#1f7a35/)
})

test('unchanged edges are not styled', () => {
  const { before, after } = sides()
  assert.ok(!linkStyles(before).has(edgeIndex(BEFORE, 'A', 'B')))
  assert.ok(!linkStyles(after).has(edgeIndex(AFTER, 'A', 'B')))
})

// The stylesheet may give schema diagrams text roles only, never their own node look.
test('schema presentation does not override the node / edge theme', () => {
  const css = fs.readFileSync(path.join(viewer, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
  const schema = rules.filter((rule) => rule.selector.includes('.schema'))
  assert.ok(schema.length > 0)
  for (const { selector, body } of schema) {
    assert.doesNotMatch(selector, /\b(rect|path|polygon|g\.node|flowchart-link|edgePath|marker)\b/, selector)
    const props = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1])
    for (const prop of props) assert.ok(['text-align', 'color', 'text-decoration', 'letter-spacing'].includes(prop), `${selector} { ${prop} }`)
    if (props.includes('color')) assert.match(selector, /\.nodeLabel (code|u)$/, selector)
  }
})

// ChangesView rendered to static markup (Mermaid runs in an effect, so the panes show
// "Rendering…"): the developer inventory of added / removed / changed lists is gone.
let server
before(async () => {
  server = await createServer({ root: viewer, configFile: false, logLevel: 'error', appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null } })
})
after(async () => server?.close())

test('the Changes view renders no Added / Removed / Changed nodes / edges lists', async () => {
  const { default: ChangesView } = await server.ssrLoadModule('/src/components/ChangesView.jsx')
  const snapshot = (source) => ({ shortSha: 'abc1234', subject: 's', diagrams: [diagram(source)] })
  const [entry] = compareSnapshots(snapshot(BEFORE), snapshot(AFTER))
  assert.equal(entry.diff.count, 9)
  const html = renderToStaticMarkup(
    createElement(ChangesView, { entry, from: snapshot(BEFORE), to: snapshot(AFTER), fromLabel: 'develop', toLabel: 'working tree' }),
  )
  for (const heading of ['Added nodes', 'Removed nodes', 'Changed nodes', 'Added edges', 'Removed edges', 'Changed edges']) {
    assert.ok(!html.includes(heading), heading)
  }
  assert.doesNotMatch(html, />None</)
  assert.doesNotMatch(html, /change-(summary|section|none|item)/)
  assert.match(html, /data-testid="pane-before"/)
  assert.match(html, /data-testid="pane-after"/)
  assert.match(html, /class="legend"/)
  // The version line is cut with an ellipsis when long; the whole line stays readable on hover.
  assert.match(html, /<span class="compare-pane-version" title="abc1234 · s">abc1234 · s<\/span>/)
})

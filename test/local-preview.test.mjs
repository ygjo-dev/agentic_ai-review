// Local preview (`npm run review:dev`): After = the agentic_ai working tree on disk, Before =
// origin/develop (develop 기준, default) or HEAD (직전 커밋 기준). Checked on a throwaway
// fixture; never on a real checkout.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after as cleanup, before as setup, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build, createServer } from 'vite'
import { readLocalPreview, readReview } from '../plugins/reviewSource.js'
import { compareSnapshots } from '../src/review/changes.js'
import { COMPARE_MODES, parseCompare } from '../src/review/localCompare.js'

const viewer = path.resolve(import.meta.dirname, '..')
let tmp, work
const commits = {}
const run = (...args) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8' }).trim()
const diagram = () => path.join(work, 'dev/review/diagrams/main.mmd')

function writeReview(label) {
  fs.mkdirSync(path.join(work, 'dev/review/diagrams'), { recursive: true })
  fs.writeFileSync(path.join(work, 'dev/review/manifest.yaml'),
    'version: 1\nproject:\n  id: fx\n  title: fx\ndiagrams:\n  - id: main\n    title: Main\n    file: dev/review/diagrams/main.mmd\n')
  fs.writeFileSync(diagram(), `flowchart TB\n    N["<b>Title</b><br/>• ${label}"]\n`)
}

setup(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-local-'))
  const origin = path.join(tmp, 'origin.git')
  work = path.join(tmp, 'work')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', origin])
  execFileSync('git', ['clone', '-q', origin, work])
  run('config', 'user.name', 'fixture')
  run('config', 'user.email', 'fixture@example.invalid')
  run('checkout', '-q', '-b', 'develop')
  writeReview('one')
  run('add', '-A'); run('commit', '-qm', 'develop'); commits.develop = run('rev-parse', 'HEAD')
  run('push', '-q', 'origin', 'develop')
  run('checkout', '-q', '-b', 'feature/x')
  writeReview('two')
  run('add', '-A'); run('commit', '-qm', 'feature'); commits.feature = run('rev-parse', 'HEAD')
  writeReview('three')   // uncommitted, only on disk
})

cleanup(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('local preview: Before = origin/develop, After = the working tree on disk (uncommitted edits included)', () => {
  const { data } = readReview(work, { local: { beforeRef: 'origin/develop' } })
  assert.equal(data.before.sha, commits.develop)
  assert.ok(data.after.workingTree)
  assert.match(data.after.diagrams[0].source, /• three/)
  assert.doesNotMatch(data.after.diagrams[0].source, /• two/)
  assert.deepEqual(data.review, { state: 'review', branch: 'develop', local: { branch: 'feature/x', dirty: true, compare: 'develop' } })
  assert.equal(data.after.subject, 'feature/x · modified')
  const [entry] = compareSnapshots(data.before, data.after)
  assert.ok(entry.panes.before.includes('<del>• one</del>') && entry.panes.after.includes('<ins>• three</ins>'))
})

test('local preview keeps an After even when the working tree equals Before', () => {
  run('stash', '-q'); run('checkout', '-q', 'develop')
  try {
    const { data } = readReview(work, { local: { beforeRef: 'origin/develop' } })
    assert.ok(data.after.workingTree)
    assert.deepEqual(data.review.local, { branch: 'develop', dirty: false, compare: 'develop' })
    assert.equal(compareSnapshots(data.before, data.after)[0].diff.count, 0)
  } finally {
    run('checkout', '-q', 'feature/x'); run('stash', 'pop', '-q')
  }
})

const panes = (pair) => compareSnapshots(pair.before, pair.after)[0].panes
const local = (beforeRef = 'origin/develop') => readLocalPreview(work, { beforeRef }).data.compare

test('both comparisons share the working tree After; only Before differs', () => {
  const pairs = local()
  assert.deepEqual(Object.keys(pairs), COMPARE_MODES)
  const { develop, 'previous-commit': previous } = pairs
  assert.equal(develop.before.sha, commits.develop)
  assert.equal(previous.before.sha, commits.feature)
  assert.deepEqual(develop.after, previous.after)
  assert.ok(previous.after.workingTree)
  assert.deepEqual(previous.review, { state: 'review', branch: 'feature/x', local: { branch: 'feature/x', dirty: true, compare: 'previous-commit' } })
  // develop 기준: everything since develop (one → three). 직전 커밋 기준: only the uncommitted edit (two → three).
  assert.ok(panes(develop).before.includes('<del>• one</del>') && panes(develop).after.includes('<ins>• three</ins>'))
  assert.ok(panes(previous).before.includes('<del>• two</del>') && panes(previous).after.includes('<ins>• three</ins>'))
  assert.ok(!panes(previous).before.includes('one'))
})

test('직전 커밋 기준 right after a commit (clean working tree) is No change; develop 기준 still shows the branch', () => {
  run('stash', '-q')
  try {
    const { develop, 'previous-commit': previous } = local()
    assert.equal(previous.review.local.dirty, false)
    assert.equal(compareSnapshots(previous.before, previous.after)[0].diff.count, 0)
    assert.ok(panes(develop).before.includes('<del>• one</del>') && panes(develop).after.includes('<ins>• two</ins>'))
  } finally {
    run('stash', 'pop', '-q')
  }
})

test('on develop itself, 직전 커밋 기준 is still HEAD → working tree', () => {
  run('stash', '-q'); run('checkout', '-q', 'develop')
  try {
    writeReview('five')
    const { 'previous-commit': previous } = local()
    assert.equal(previous.before.sha, commits.develop)
    assert.equal(previous.review.local.branch, 'develop')
    assert.ok(panes(previous).before.includes('<del>• one</del>') && panes(previous).after.includes('<ins>• five</ins>'))
  } finally {
    run('checkout', '-q', '--', 'dev/review'); run('checkout', '-q', 'feature/x'); run('stash', 'pop', '-q')
  }
})

test('detached HEAD: 직전 커밋 기준 compares that commit, the After is labelled detached', () => {
  run('stash', '-q'); run('checkout', '-q', '--detach', commits.feature)
  try {
    writeReview('six')
    const { 'previous-commit': previous } = local()
    assert.equal(previous.before.sha, commits.feature)
    assert.equal(previous.review.local.branch, 'detached HEAD')
    assert.equal(previous.after.subject, 'detached HEAD · modified')
    assert.ok(panes(previous).before.includes('<del>• two</del>') && panes(previous).after.includes('<ins>• six</ins>'))
  } finally {
    run('checkout', '-q', '--', 'dev/review'); run('checkout', '-q', 'feature/x'); run('stash', 'pop', '-q')
  }
})

test('a develop ref that cannot be read fails develop 기준 only; 직전 커밋 기준 still works', () => {
  const pairs = local('origin/no-such-branch')
  assert.match(pairs.develop.error, /"origin\/no-such-branch" is not a commit/)
  assert.equal(pairs['previous-commit'].before.sha, commits.feature)
})

test('a broken working tree fails both comparisons, so it fails like before', () => {
  const manifest = path.join(work, 'dev/review/manifest.yaml')
  const saved = fs.readFileSync(manifest, 'utf8')
  fs.writeFileSync(manifest, 'diagrams: [\n')
  try {
    assert.throws(() => readLocalPreview(work, { beforeRef: 'origin/develop' }), /cannot parse/)
  } finally {
    fs.writeFileSync(manifest, saved)
  }
})

test('the compare mode is an enum: anything else is develop 기준', () => {
  assert.equal(parseCompare('develop'), 'develop')
  assert.equal(parseCompare('previous-commit'), 'previous-commit')
  for (const value of [null, undefined, '', 'HEAD', 'HEAD^', 'origin/develop', '../etc', 'Previous-Commit', 'toString', '__proto__']) {
    assert.equal(parseCompare(value), 'develop', String(value))
  }
})

test('the 비교 기준 control is a labelled select with the two comparisons', async () => {
  const server = await createServer({ root: viewer, configFile: false, logLevel: 'error', appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null } })
  try {
    const { default: CompareBasis } = await server.ssrLoadModule('/src/components/CompareBasis.jsx')
    const html = renderToStaticMarkup(createElement(CompareBasis, { value: 'previous-commit', onChange() {} }))
    assert.match(html, /^<label[^>]*>.*비교 기준.*<select[^>]*>.*<\/select><\/label>$/s)
    const options = [...html.matchAll(/<option value="([^"]+)"( selected="")?>([^<]+)<\/option>/g)].map((m) => [m[1], m[3], Boolean(m[2])])
    assert.deepEqual(options, [['develop', 'develop 기준', false], ['previous-commit', '직전 커밋 기준', true]])
  } finally {
    await server.close()
  }
})

test('without local preview there is no local context', () => {
  const { data } = readReview(work, { env: { REVIEW_BEFORE_SHA: commits.develop, REVIEW_AFTER_SHA: commits.feature, REVIEW_BRANCH: 'develop' } })
  assert.deepEqual(data.review, { state: 'review', branch: 'develop' })
})

test('a production build never reads the working tree or carries the local badge, even with REVIEW_LOCAL set', async () => {
  const outDir = path.join(tmp, 'dist')
  // `npm run build` is a fresh process (NODE_ENV production); an earlier dev server in this
  // process set NODE_ENV=development, which would turn this build into a dev build.
  const nodeEnv = process.env.NODE_ENV
  Object.assign(process.env, { AGENTIC_AI_REVIEW_SOURCE_ROOT: work, REVIEW_LOCAL: '1', REVIEW_BEFORE_REF: 'origin/develop', NODE_ENV: 'production' })
  try {
    await build({ root: viewer, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  } finally {
    for (const name of ['AGENTIC_AI_REVIEW_SOURCE_ROOT', 'REVIEW_LOCAL', 'REVIEW_BEFORE_REF']) delete process.env[name]
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
  }
  const js = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(outDir, 'assets', f), 'utf8')).join('\n')
  assert.ok(!js.includes('LOCAL PREVIEW'))
  for (const text of ['비교 기준', '직전 커밋', 'previous-commit', '?compare=']) assert.ok(!js.includes(text), `${text} leaked into the build`)
  assert.ok(!js.includes('• three'), 'uncommitted working tree content leaked into the build')
  assert.ok(js.includes('• two'), 'build shows the committed HEAD')
})

test('dev server: local preview serves both comparisons, a plain dev server only the one pair', async () => {
  const load = async (env) => {
    Object.assign(process.env, { AGENTIC_AI_REVIEW_SOURCE_ROOT: work, ...env })
    const server = await createServer({ root: viewer, logLevel: 'silent', server: { port: 0, hmr: false, watch: null } })
    try {
      return (await server.ssrLoadModule('virtual:review-source')).default
    } finally {
      await server.close()
      for (const name of ['AGENTIC_AI_REVIEW_SOURCE_ROOT', ...Object.keys(env)]) delete process.env[name]
    }
  }
  const localData = await load({ REVIEW_LOCAL: '1', REVIEW_BEFORE_REF: 'origin/develop' })
  assert.deepEqual(Object.keys(localData), ['compare'])
  assert.deepEqual([localData.compare.develop.before.sha, localData.compare['previous-commit'].before.sha], [commits.develop, commits.feature])
  const plainData = await load({})
  assert.deepEqual(Object.keys(plainData).sort(), ['after', 'before', 'project', 'review'])
  assert.equal(plainData.review.local, undefined)
})

test('dev server: a dev/review edit and a branch switch each reload the page', async () => {
  Object.assign(process.env, { AGENTIC_AI_REVIEW_SOURCE_ROOT: work, REVIEW_LOCAL: '1', REVIEW_BEFORE_REF: 'origin/develop' })
  const server = await createServer({ root: viewer, logLevel: 'silent', server: { port: 0 } })
  const reloads = []
  const send = server.ws.send.bind(server.ws)
  server.ws.send = (payload, ...rest) => {
    if (payload?.type === 'full-reload') reloads.push(Date.now())
    return send(payload, ...rest)
  }
  const waitForReload = async (count) => {
    for (let i = 0; i < 100 && reloads.length < count; i++) await new Promise((r) => setTimeout(r, 50))
    return reloads.length >= count
  }
  try {
    await new Promise((r) => setTimeout(r, 500))   // watcher ready
    fs.writeFileSync(diagram(), 'flowchart TB\n    N["<b>Title</b><br/>• four"]\n')
    assert.ok(await waitForReload(1), 'no reload after a dev/review edit')
    run('stash', '-q')
    assert.ok(await waitForReload(2), 'no reload after the working tree went back')
    await new Promise((r) => setTimeout(r, 300))
    const before = reloads.length
    run('checkout', '-q', '-b', 'feature/y')   // same content: only .git/HEAD changes
    assert.ok(await waitForReload(before + 1), 'no reload after a branch switch')
    run('checkout', '-q', 'feature/x'); run('stash', 'pop', '-q')
  } finally {
    await server.close()
    for (const name of ['AGENTIC_AI_REVIEW_SOURCE_ROOT', 'REVIEW_LOCAL', 'REVIEW_BEFORE_REF']) delete process.env[name]
  }
})

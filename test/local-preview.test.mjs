// Local preview (`npm run review:dev`): Before = origin/develop, After = the agentic_ai working
// tree on disk. Checked on a throwaway fixture; never on a real checkout.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after as cleanup, before as setup, test } from 'node:test'
import { build, createServer } from 'vite'
import { readReview } from '../plugins/reviewSource.js'
import { compareSnapshots } from '../src/review/changes.js'

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
  assert.deepEqual(data.review, { state: 'review', branch: 'develop', local: { branch: 'feature/x', dirty: true } })
  assert.equal(data.after.subject, 'feature/x · modified')
  const [entry] = compareSnapshots(data.before, data.after)
  assert.ok(entry.panes.before.includes('<del>• one</del>') && entry.panes.after.includes('<ins>• three</ins>'))
})

test('local preview keeps an After even when the working tree equals Before', () => {
  run('stash', '-q'); run('checkout', '-q', 'develop')
  try {
    const { data } = readReview(work, { local: { beforeRef: 'origin/develop' } })
    assert.ok(data.after.workingTree)
    assert.deepEqual(data.review.local, { branch: 'develop', dirty: false })
    assert.equal(compareSnapshots(data.before, data.after)[0].diff.count, 0)
  } finally {
    run('checkout', '-q', 'feature/x'); run('stash', 'pop', '-q')
  }
})

test('without local preview there is no local context', () => {
  const { data } = readReview(work, { env: { REVIEW_BEFORE_SHA: commits.develop, REVIEW_AFTER_SHA: commits.feature, REVIEW_BRANCH: 'develop' } })
  assert.deepEqual(data.review, { state: 'review', branch: 'develop' })
})

test('a production build never reads the working tree or carries the local badge, even with REVIEW_LOCAL set', async () => {
  const outDir = path.join(tmp, 'dist')
  Object.assign(process.env, { AGENTIC_AI_REVIEW_SOURCE_ROOT: work, REVIEW_LOCAL: '1', REVIEW_BEFORE_REF: 'origin/develop' })
  try {
    await build({ root: viewer, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  } finally {
    for (const name of ['AGENTIC_AI_REVIEW_SOURCE_ROOT', 'REVIEW_LOCAL', 'REVIEW_BEFORE_REF']) delete process.env[name]
  }
  const js = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(outDir, 'assets', f), 'utf8')).join('\n')
  assert.ok(!js.includes('LOCAL PREVIEW'))
  assert.ok(!js.includes('• three'), 'uncommitted working tree content leaked into the build')
  assert.ok(js.includes('• two'), 'build shows the committed HEAD')
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

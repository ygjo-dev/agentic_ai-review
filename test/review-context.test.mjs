// The Review Web shows one develop update: Before = develop just before it, After =
// develop just after it. Checked on a throwaway git fixture (origin + clone).
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after as cleanup, before as setup, test } from 'node:test'
import { readReview } from '../plugins/reviewSource.js'
import { resolveContext } from '../scripts/resolve-review-context.mjs'
import { compareSnapshots } from '../src/review/changes.js'

const viewer = path.resolve(import.meta.dirname, '..')
let tmp, work
const commits = {}
const run = (...args) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8' }).trim()

function writeReview(label) {
  fs.mkdirSync(path.join(work, 'dev/review/diagrams'), { recursive: true })
  fs.writeFileSync(path.join(work, 'dev/review/manifest.yaml'),
    'version: 1\nproject:\n  id: fx\n  title: fx\ndiagrams:\n  - id: main\n    title: Main\n    file: dev/review/diagrams/main.mmd\n')
  fs.writeFileSync(path.join(work, 'dev/review/diagrams/main.mmd'), `flowchart TB\n    N["<b>Title</b><br/>• ${label}"]\n`)
}

function commit(name, label) {
  if (label) writeReview(label)
  fs.writeFileSync(path.join(work, `${name}.txt`), `${name}\n`)
  run('add', '-A')
  run('commit', '-qm', name)
  commits[name] = run('rev-parse', 'HEAD')
  return commits[name]
}

const env = (c) => ({ REVIEW_BEFORE_SHA: c.beforeSha, REVIEW_AFTER_SHA: c.afterSha, REVIEW_BRANCH: c.branch })

setup(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-context-'))
  const origin = path.join(tmp, 'origin.git')
  work = path.join(tmp, 'work')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', origin])
  execFileSync('git', ['clone', '-q', origin, work])
  run('config', 'user.name', 'fixture')
  run('config', 'user.email', 'fixture@example.invalid')
  run('checkout', '-q', '-b', 'develop')
  commit('A', 'one')
  run('push', '-q', 'origin', 'develop')
  // A feature branch with its own commits, pushed but not on develop yet.
  run('checkout', '-q', '-b', 'feature/x')
  commit('F1')
  commit('F2')
  run('push', '-q', 'origin', 'feature/x')
  // develop is updated by a merge commit: Before = A, After = M (not the feature head F2).
  run('checkout', '-q', 'develop')
  run('merge', '-q', '--no-ff', '--no-edit', 'feature/x')
  commits.M = run('rev-parse', 'HEAD')
  // A second develop update that changes the diagram: Before = M, After = B.
  commit('B', 'two')
  run('push', '-q', 'origin', 'develop')
  run('fetch', '-q', 'origin')
})

cleanup(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('no pair given: baseline = develop HEAD, no After', () => {
  assert.deepEqual(resolveContext(work, {}), { beforeSha: commits.B, afterSha: '', branch: 'develop' })
})

test('develop update by merge: Before = develop before, After = the merge commit on develop', () => {
  const context = resolveContext(work, { beforeSha: commits.A, afterSha: commits.M })
  assert.deepEqual(context, { beforeSha: commits.A, afterSha: commits.M, branch: 'develop' })
  assert.notEqual(context.afterSha, commits.F2)
})

test('the review data is the two develop snapshots and nothing about branches or pull requests', () => {
  const { data } = readReview(work, { env: env(resolveContext(work, { beforeSha: commits.M, afterSha: commits.B })) })
  assert.deepEqual(Object.keys(data).sort(), ['after', 'before', 'project', 'review'])
  assert.deepEqual(data.review, { state: 'review', branch: 'develop' })
  assert.deepEqual([data.before.sha, data.after.sha], [commits.M, commits.B])
  const [entry] = compareSnapshots(data.before, data.after)
  assert.ok(entry.panes.before.includes('<del>• one</del>') && entry.panes.after.includes('<ins>• two</ins>'))
})

test('a develop update that leaves dev/review alone is a review with no architecture change', () => {
  const { data } = readReview(work, { env: env(resolveContext(work, { beforeSha: commits.A, afterSha: commits.M })) })
  assert.equal(data.review.state, 'review')
  assert.equal(compareSnapshots(data.before, data.after)[0].diff.count, 0)
})

test('a pair that is not two develop states is refused', () => {
  assert.throws(() => resolveContext(work, { beforeSha: commits.A }), /both the Before and the After/)
  assert.throws(() => resolveContext(work, { afterSha: commits.B }), /both the Before and the After/)
  assert.throws(() => resolveContext(work, { beforeSha: commits.B, afterSha: commits.B }), /same commit/)
  assert.throws(() => resolveContext(work, { beforeSha: 'develop', afterSha: commits.B }), /not a commit SHA/)
  run('checkout', '-q', '-b', 'feature/y', commits.B)
  const off = commit('Y')
  run('checkout', '-q', 'develop')
  assert.throws(() => resolveContext(work, { beforeSha: commits.B, afterSha: off }), /After [0-9a-f]{7} is not on develop/)
  assert.throws(() => resolveContext(work, { beforeSha: off, afterSha: commits.B }), /Before [0-9a-f]{7} is not on develop/)
})

test('the viewer labels both snapshots with the branch and has no PR, fork point or history wording', () => {
  for (const file of ['src/App.jsx', 'src/components/ChangesView.jsx', 'plugins/reviewSource.js']) {
    const text = fs.readFileSync(path.join(viewer, file), 'utf8')
    assert.doesNotMatch(text, /fork point|PR #|prNumber|headBranch|baseBranch|<select|Compare from/, file)
  }
  const app = fs.readFileSync(path.join(viewer, 'src/App.jsx'), 'utf8')
  assert.match(app, /fromLabel=\{context\.branch\}\s+toLabel=\{context\.branch\}/)
})

// develop rewritten by a force push (only inside this throwaway fixture): the old develop
// head is on no branch, so a fresh clone lacks it and the resolver fetches it by SHA.
test('a Before dropped by a develop rewrite is fetched by SHA with the token kept out of output', () => {
  const origin = path.join(tmp, 'rewrite.git')
  const writer = path.join(tmp, 'rewrite-writer')
  const fresh = path.join(tmp, 'rewrite-fresh')
  const at = (dir) => (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', origin])
  at(origin)('config', 'uploadpack.allowAnySHA1InWant', 'true')
  execFileSync('git', ['clone', '-q', origin, writer])
  const w = at(writer)
  w('config', 'user.name', 'fixture'); w('config', 'user.email', 'fixture@example.invalid'); w('checkout', '-q', '-b', 'develop')
  const save = work; work = writer
  const base = commit('R0', 'one'); const dropped = commit('R1', 'two')
  w('push', '-q', 'origin', 'develop')
  w('reset', '-q', '--hard', base)
  const rewritten = commit('R2', 'three')
  w('push', '-q', '--force', 'origin', 'develop')
  work = save
  execFileSync('git', ['clone', '-q', '--no-local', origin, fresh])
  assert.throws(() => at(fresh)('cat-file', '-e', `${dropped}^{commit}`))

  const token = 'fixture-token-value-not-real'
  const cli = (before, after) => spawnSync(process.execPath, [path.join(viewer, 'scripts/resolve-review-context.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ENV: '', GITHUB_ACTIONS: '', AGENTIC_AI_REVIEW_SOURCE_ROOT: fresh, AGENTIC_AI_READ_TOKEN: token, INPUT_BEFORE_SHA: before, INPUT_AFTER_SHA: after },
  })
  const ok = cli(dropped, rewritten)
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, new RegExp(`review: develop ${dropped.slice(0, 7)} -> ${rewritten.slice(0, 7)}`))
  assert.ok(!(ok.stdout + ok.stderr).includes(token))
  assert.ok(!(ok.stdout + ok.stderr).includes(Buffer.from(`x-access-token:${token}`).toString('base64')))
  assert.doesNotMatch(fs.readFileSync(path.join(fresh, '.git/config'), 'utf8'), /extraheader|AUTHORIZATION/i)
  const { data } = readReview(fresh, { env: { REVIEW_BEFORE_SHA: dropped, REVIEW_AFTER_SHA: rewritten, REVIEW_BRANCH: 'develop' } })
  assert.deepEqual([data.before.sha, data.after.sha], [dropped, rewritten])

  const missing = cli('0123456789abcdef0123456789abcdef01234567', rewritten)
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /Before 0123456 is not in the clone and could not be fetched/)
  assert.ok(!(missing.stdout + missing.stderr).includes(token))
  const afterGone = cli(base, dropped.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')))
  assert.notEqual(afterGone.status, 0)
  assert.match(afterGone.stderr, /is not a commit/)
})

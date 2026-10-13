// Reads Review Versions from the agentic_ai git history without touching its
// working tree: commits come from `git log -- dev/review`, files from
// `git show <sha>:<path>`. Runs on the Node side only (dev server / build).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

export const REVIEW_DIR = 'dev/review'

function fail(message) {
  throw new Error(`[review-history] ${message}`)
}

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (error.code === 'ENOENT') fail('git executable not found on PATH')
    const stderr = String(error.stderr ?? '').trim()
    throw new Error(`git ${args.join(' ')} (in ${root}): ${stderr || error.message}`, { cause: error })
  }
}

const LOG_FORMAT = '--format=%H%x1f%h%x1f%cI%x1f%s%x1e'

function parseLog(log) {
  return log
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, shortSha, timestamp, subject] = record.split('\x1f')
      return { sha, shortSha, timestamp, subject }
    })
}

export function checkRepository(root) {
  let toplevel
  try {
    toplevel = git(root, ['rev-parse', '--show-toplevel']).trim()
  } catch (error) {
    fail(`${root} is not a git checkout; Review Versions come from its history.\n${error.message}`)
  }
  if (fs.realpathSync(toplevel) !== fs.realpathSync(root)) {
    fail(`${root} is not a repository root (git toplevel is ${toplevel})`)
  }
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    fail(`${root} is a shallow clone, so Review history is incomplete. Fetch full history (actions/checkout fetch-depth: 0).`)
  }
}

// The manifest's history.start_commit, checked: a commit that HEAD descends from
// and that already has a Review manifest.
function startCommit(root, ref, manifest) {
  const at = `history.start_commit ${JSON.stringify(ref)}`
  let sha
  try {
    sha = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim()
  } catch {
    fail(`${at} is not a commit in ${root}`)
  }
  try {
    git(root, ['merge-base', '--is-ancestor', sha, 'HEAD'])
  } catch {
    fail(`${at} is not an ancestor of HEAD in ${root}`)
  }
  try {
    git(root, ['cat-file', '-e', `${sha}:${manifest}`])
  } catch {
    fail(`${at} has no ${manifest}`)
  }
  return parseLog(git(root, ['log', '-1', LOG_FORMAT, sha]))[0]
}

// Review commits, newest first: commits whose change set touches dev/review.
// With a start commit, history begins there: the start commit itself (even if it
// did not touch dev/review) and the Review commits after it. The Review commits
// before it are returned only as `before`, so links to them can say why they are gone.
export function listReviewCommits(root, { start = null, manifest } = {}) {
  checkRepository(root)
  if (!start) return { commits: parseLog(git(root, ['log', LOG_FORMAT, '--', REVIEW_DIR])), before: [] }

  const first = startCommit(root, start, manifest)
  const after = parseLog(git(root, ['log', LOG_FORMAT, `${first.sha}..HEAD`, '--', REVIEW_DIR]))
  const before = parseLog(git(root, ['log', LOG_FORMAT, first.sha, '--', REVIEW_DIR]))
    .filter((commit) => commit.sha !== first.sha)
    .map((commit) => commit.sha)
  return { commits: [...after, first], before }
}

export function showFile(root, commit, file) {
  try {
    return git(root, ['show', `${commit.sha}:${file}`])
  } catch (error) {
    fail(`cannot read ${file} at ${commit.shortSha} ("${commit.subject}"): ${error.message}`)
  }
}

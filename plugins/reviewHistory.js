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

// Review commits, newest first: commits whose change set touches dev/review.
export function listReviewCommits(root) {
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

  const log = git(root, ['log', '--format=%H%x1f%h%x1f%cI%x1f%s%x1e', '--', REVIEW_DIR])
  return log
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, shortSha, timestamp, subject] = record.split('\x1f')
      return { sha, shortSha, timestamp, subject }
    })
}

export function showFile(root, commit, file) {
  try {
    return git(root, ['show', `${commit.sha}:${file}`])
  } catch (error) {
    fail(`cannot read ${file} at ${commit.shortSha} ("${commit.subject}"): ${error.message}`)
  }
}

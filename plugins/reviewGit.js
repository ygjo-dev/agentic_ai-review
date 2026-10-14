// Git access for the Review Source: reads the two review snapshots (Before and
// After) by SHA with `git show <sha>:<path>`, never moving the agentic_ai working
// tree. Runs on the Node side only (dev server / build / CI scripts).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

export const REVIEW_DIR = 'dev/review'

function fail(message) {
  throw new Error(`[review-git] ${message}`)
}

// Arguments go to git as an argv array, never through a shell.
export function git(root, args) {
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

export function checkRepository(root) {
  let toplevel
  try {
    toplevel = git(root, ['rev-parse', '--show-toplevel']).trim()
  } catch (error) {
    fail(`${root} is not a git checkout; review snapshots come from its commits.\n${error.message}`)
  }
  if (fs.realpathSync(toplevel) !== fs.realpathSync(root)) {
    fail(`${root} is not a repository root (git toplevel is ${toplevel})`)
  }
}

// A commit named by SHA or ref, resolved to its full SHA and metadata.
export function commitInfo(root, ref) {
  if (typeof ref !== 'string' || !/^[0-9A-Za-z._/-]+$/.test(ref) || ref.startsWith('-')) {
    fail(`not a commit reference: ${JSON.stringify(ref)}`)
  }
  let sha
  try {
    sha = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim()
  } catch {
    fail(`${JSON.stringify(ref)} is not a commit in ${root}`)
  }
  const [shortSha, timestamp, subject] = git(root, ['log', '-1', '--format=%h%x1f%cI%x1f%s', sha]).trim().split('\x1f')
  return { sha, shortSha, timestamp, subject }
}

export function isAncestor(root, ancestor, descendant) {
  try {
    git(root, ['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch {
    return false
  }
}

export function showFile(root, commit, file) {
  try {
    return git(root, ['show', `${commit.sha}:${file}`])
  } catch (error) {
    fail(`cannot read ${file} at ${commit.shortSha} ("${commit.subject}"): ${error.message}`)
  }
}

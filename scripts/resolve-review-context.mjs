// Decides which review the Review Web shows and writes it as REVIEW_* for the build.
//
//   baseline  no review-ready pull request targets the base branch:
//             Before = base branch HEAD, no After
//   review    exactly one open, non-draft pull request targets the base branch:
//             Before = merge-base(base branch, PR head) = where the feature forked
//             After  = PR head
//
// With REVIEW_BASE_SHA given (a dispatch from agentic_ai's PR workflow) the given
// pair is checked against those rules instead of being looked up.
// v1 policy: one active review at a time; the feature branch does not merge or
// rebase the base branch during review. Both are reported as errors, not guessed.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { commitInfo, git, isAncestor, mergeBase } from '../plugins/reviewGit.js'

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function fail(message) {
  throw new Error(`[review-context] ${message}`)
}

export function activePullRequests(prs, baseBranch) {
  return prs.filter((pr) => pr.state === 'open' && !pr.draft && pr.base?.ref === baseBranch)
}

// The fork point must still be the feature branch's start: no merge commits since.
export function checkForkPolicy(root, baseSha, headSha) {
  const merges = git(root, ['rev-list', '--merges', `${baseSha}..${headSha}`]).trim()
  if (merges) {
    fail(`the feature branch has merge commits since its fork point ${baseSha.slice(0, 7)} (${merges.split('\n').map((s) => s.slice(0, 7)).join(', ')}); `
      + 'review v1 needs the branch to stay unmerged with the base branch during review')
  }
}

function checkBranch(name, value) {
  if (!BRANCH.test(value)) fail(`${name} is not a branch name: ${JSON.stringify(value)}`)
}

export function resolveFromPullRequests(root, prs, { baseBranch = 'develop', remote = 'origin' } = {}) {
  checkBranch('base branch', baseBranch)
  const develop = commitInfo(root, `${remote}/${baseBranch}`)
  const active = activePullRequests(prs, baseBranch)
  if (active.length > 1) {
    fail(`single active review policy: ${active.length} review-ready pull requests target ${baseBranch} (${active.map((pr) => `#${pr.number}`).join(', ')})`)
  }
  if (active.length === 0) return { baseSha: develop.sha, headSha: '', baseBranch, headBranch: '', prNumber: '' }
  const [pr] = active
  checkBranch('head branch', pr.head.ref)
  const head = commitInfo(root, pr.head.sha)
  const base = mergeBase(root, develop.sha, head.sha)
  checkForkPolicy(root, base, head.sha)
  return { baseSha: base, headSha: head.sha, baseBranch, headBranch: pr.head.ref, prNumber: String(pr.number) }
}

export function validateExplicit(root, input, { remote = 'origin' } = {}) {
  const baseBranch = input.baseBranch || 'develop'
  checkBranch('base branch', baseBranch)
  const develop = commitInfo(root, `${remote}/${baseBranch}`)
  const base = commitInfo(root, input.baseSha)
  if (!input.headSha) {
    if (input.headBranch || input.prNumber) fail('head branch / pull request given without a head SHA')
    if (!isAncestor(root, base.sha, develop.sha)) fail(`baseline ${base.shortSha} is not on ${baseBranch}`)
    return { baseSha: base.sha, headSha: '', baseBranch, headBranch: '', prNumber: '' }
  }
  if (!input.headBranch) fail('a review needs the head branch name')
  checkBranch('head branch', input.headBranch)
  if (input.prNumber && !/^[1-9][0-9]*$/.test(input.prNumber)) fail(`not a pull request number: ${JSON.stringify(input.prNumber)}`)
  const head = commitInfo(root, input.headSha)
  const fork = mergeBase(root, develop.sha, head.sha)
  if (fork !== base.sha) fail(`Before ${base.shortSha} is not the fork point of ${head.shortSha} from ${baseBranch} (that is ${fork.slice(0, 7)})`)
  checkForkPolicy(root, base.sha, head.sha)
  return { baseSha: base.sha, headSha: head.sha, baseBranch, headBranch: input.headBranch, prNumber: input.prNumber || '' }
}

async function openPullRequests(repo, baseBranch, token) {
  const url = `https://api.github.com/repos/${repo}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100`
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, { headers })
  if (!response.ok) fail(`GitHub API ${response.status} for ${url}`)
  return response.json()
}

async function main() {
  const env = process.env
  const root = env.AGENTIC_AI_REVIEW_SOURCE_ROOT
  const repo = env.AGENTIC_REPO || 'ygjo-dev/agentic_ai'
  if (!root) fail('AGENTIC_AI_REVIEW_SOURCE_ROOT is not set')
  const input = {
    baseSha: (env.INPUT_BASE_SHA || '').trim(),
    headSha: (env.INPUT_HEAD_SHA || '').trim(),
    baseBranch: (env.INPUT_BASE_BRANCH || '').trim(),
    headBranch: (env.INPUT_HEAD_BRANCH || '').trim(),
    prNumber: (env.INPUT_PR_NUMBER || '').trim(),
  }
  let context
  if (input.baseSha) {
    if (input.prNumber && /^[1-9][0-9]*$/.test(input.prNumber)) git(root, ['fetch', '--quiet', 'origin', `+refs/pull/${input.prNumber}/head:refs/remotes/origin/pr/${input.prNumber}`])
    context = validateExplicit(root, input)
  } else {
    const baseBranch = input.baseBranch || 'develop'
    const prs = await openPullRequests(repo, baseBranch, env.GITHUB_TOKEN)
    for (const pr of activePullRequests(prs, baseBranch)) {
      git(root, ['fetch', '--quiet', 'origin', `+refs/pull/${pr.number}/head:refs/remotes/origin/pr/${pr.number}`])
    }
    context = resolveFromPullRequests(root, prs, { baseBranch })
  }
  const lines = [
    `REVIEW_BASE_SHA=${context.baseSha}`,
    `REVIEW_HEAD_SHA=${context.headSha}`,
    `REVIEW_BASE_BRANCH=${context.baseBranch}`,
    `REVIEW_HEAD_BRANCH=${context.headBranch}`,
    `REVIEW_PR_NUMBER=${context.prNumber}`,
  ]
  console.log(context.headSha ? `review: ${context.headBranch} (#${context.prNumber}) ${context.baseSha.slice(0, 7)} -> ${context.headSha.slice(0, 7)}` : `baseline: ${context.baseBranch} @ ${context.baseSha.slice(0, 7)}`)
  if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, lines.join('\n') + '\n')
  else console.log(lines.join('\n'))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`)
    process.exit(1)
  })
}

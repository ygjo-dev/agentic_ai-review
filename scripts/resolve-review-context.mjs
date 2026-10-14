// Decides which pair the Review Web shows and writes it as REVIEW_* for the build.
//
//   review    Before = develop just before an update, After = develop just after it.
//             agentic_ai's Review Web workflow dispatches this pair on every develop push
//             (merge, squash, rebase or direct push), straight from the push event.
//   baseline  no pair given: Before = develop HEAD, no After.
//
// After must be on develop. Before is on develop too, unless a rewrite of develop (force
// push) dropped it: then it is on no branch at all and is fetched by SHA. A commit that
// still sits on another branch is never a develop state. Nothing here looks at pull requests.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { commitInfo, git, isAncestor } from '../plugins/reviewGit.js'

const SHA = /^[0-9a-f]{7,40}$/

function fail(message) {
  throw new Error(`[review-context] ${message}`)
}

export function resolveContext(root, { beforeSha = '', afterSha = '' } = {}, { branch = 'develop', remote = 'origin' } = {}) {
  const develop = commitInfo(root, `${remote}/${branch}`)
  if (!beforeSha && !afterSha) return { beforeSha: develop.sha, afterSha: '', branch }
  if (!beforeSha || !afterSha) fail('a review needs both the Before and the After commit')
  for (const [name, sha] of [['Before', beforeSha], ['After', afterSha]]) {
    if (!SHA.test(sha)) fail(`${name} is not a commit SHA: ${JSON.stringify(sha)}`)
  }
  const before = commitInfo(root, beforeSha)
  const after = commitInfo(root, afterSha)
  if (before.sha === after.sha) fail(`Before and After are the same commit ${before.shortSha}; there is no ${branch} update to review`)
  if (!isAncestor(root, after.sha, develop.sha)) fail(`After ${after.shortSha} is not on ${branch}`)
  if (!isAncestor(root, before.sha, develop.sha) && onSomeBranch(root, before.sha)) {
    fail(`Before ${before.shortSha} is not on ${branch} (it is on another branch)`)
  }
  return { beforeSha: before.sha, afterSha: after.sha, branch }
}

function onSomeBranch(root, sha) {
  return git(root, ['for-each-ref', '--contains', sha, '--format=%(refname)', 'refs/heads', 'refs/remotes']).trim() !== ''
}

// Before dropped from develop by a force push is in no branch, so a fresh clone lacks it.
// The source repository is private: the read token goes to this one git process as an
// extra header in its environment (never in argv, the URL or .git/config).
export function fetchBeforeIfMissing(root, sha, token = '') {
  if (!SHA.test(sha)) return
  try {
    git(root, ['cat-file', '-e', `${sha}^{commit}`])
    return
  } catch {
    // not in the clone: fetch it below
  }
  let env
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${basic}`)
    env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` }
  }
  try {
    git(root, ['fetch', '--quiet', 'origin', sha], { env })
  } catch {
    fail(`Before ${sha.slice(0, 7)} is not in the clone and could not be fetched from origin`)
  }
}

async function main() {
  const env = process.env
  const root = env.AGENTIC_AI_REVIEW_SOURCE_ROOT
  if (!root) fail('AGENTIC_AI_REVIEW_SOURCE_ROOT is not set')
  const input = { beforeSha: (env.INPUT_BEFORE_SHA || '').trim(), afterSha: (env.INPUT_AFTER_SHA || '').trim() }
  const branch = (env.INPUT_BRANCH || '').trim() || 'develop'
  fetchBeforeIfMissing(root, input.beforeSha, env.AGENTIC_AI_READ_TOKEN || '')
  const context = resolveContext(root, input, { branch })
  const lines = [
    `REVIEW_BEFORE_SHA=${context.beforeSha}`,
    `REVIEW_AFTER_SHA=${context.afterSha}`,
    `REVIEW_BRANCH=${context.branch}`,
  ]
  console.log(context.afterSha
    ? `review: ${context.branch} ${context.beforeSha.slice(0, 7)} -> ${context.afterSha.slice(0, 7)}`
    : `baseline: ${context.branch} @ ${context.beforeSha.slice(0, 7)}`)
  if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, lines.join('\n') + '\n')
  else console.log(lines.join('\n'))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`)
    process.exit(1)
  })
}

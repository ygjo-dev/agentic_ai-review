// Decides which pair the Review Web shows and writes it as REVIEW_* for the build.
//
//   review    Before = develop just before an update, After = develop just after it.
//             agentic_ai's Review Web workflow dispatches this pair on every develop push
//             (merge, squash, rebase or direct push), straight from the push event.
//   baseline  no pair given: Before = develop HEAD, no After.
//
// Both commits must be on develop. Nothing here looks at feature branches or pull requests.
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
  for (const [name, commit] of [['Before', before], ['After', after]]) {
    if (!isAncestor(root, commit.sha, develop.sha)) fail(`${name} ${commit.shortSha} is not on ${branch}`)
  }
  return { beforeSha: before.sha, afterSha: after.sha, branch }
}

// A commit dropped from every ref (e.g. by a force push) is not in a fresh clone.
function fetchIfMissing(root, sha) {
  if (!SHA.test(sha)) return
  try {
    git(root, ['cat-file', '-e', `${sha}^{commit}`])
  } catch {
    git(root, ['fetch', '--quiet', 'origin', sha])
  }
}

async function main() {
  const env = process.env
  const root = env.AGENTIC_AI_REVIEW_SOURCE_ROOT
  if (!root) fail('AGENTIC_AI_REVIEW_SOURCE_ROOT is not set')
  const input = { beforeSha: (env.INPUT_BEFORE_SHA || '').trim(), afterSha: (env.INPUT_AFTER_SHA || '').trim() }
  const branch = (env.INPUT_BRANCH || '').trim() || 'develop'
  fetchIfMissing(root, input.beforeSha)
  fetchIfMissing(root, input.afterSha)
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

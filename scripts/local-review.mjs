// Local preview: `npm run review:dev`. Vite dev server on 0.0.0.0 that compares
//   Before = REVIEW_BEFORE_REF (default origin/develop) of the agentic_ai checkout
//   After  = that checkout's working tree as it is on disk (committed + uncommitted)
// Viewer edits hot-reload; dev/review edits and branch switches reload the page.
// Development only: nothing here touches GitHub, secrets or the public Pages build.
//
//   AGENTIC_AI_REPO     agentic_ai checkout (default ../agentic_ai)
//   REVIEW_BEFORE_REF   Before ref (default origin/develop; `git fetch` to refresh it)
//   REVIEW_DEV_PORT     port (default 4797)
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { commitInfo, git } from '../plugins/reviewGit.js'

const viewerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.resolve(viewerRoot, process.env.AGENTIC_AI_REPO || '../agentic_ai')
const beforeRef = process.env.REVIEW_BEFORE_REF || 'origin/develop'
const port = Number(process.env.REVIEW_DEV_PORT || 4797)

process.env.AGENTIC_AI_REVIEW_SOURCE_ROOT = sourceRoot
process.env.REVIEW_LOCAL = '1'
process.env.REVIEW_BEFORE_REF = beforeRef

const before = commitInfo(sourceRoot, beforeRef)
const branch = git(sourceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()

const server = await createServer({ root: viewerRoot, server: { host: '0.0.0.0', port, strictPort: true } })
await server.listen()

// LAN addresses of real interfaces (container / VM bridges are not reachable from the LAN).
const lan = Object.entries(os.networkInterfaces())
  .filter(([name]) => !/^(docker|br-|veth|virbr)/.test(name))
  .flatMap(([, addresses]) => addresses)
  .filter((address) => address.family === 'IPv4' && !address.internal)
  .map((address) => address.address)
console.log(`\nReview local preview  (${sourceRoot})`)
console.log(`  Before  ${beforeRef} · ${before.shortSha}`)
console.log(`  After   working tree · ${branch}`)
console.log(`  Local   http://127.0.0.1:${port}/`)
for (const address of lan) console.log(`  LAN     http://${address}:${port}/`)
console.log('  Ctrl+C to stop\n')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.close()
    process.exit(0)
  })
}

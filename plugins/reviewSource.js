// Reads the Review Source of Truth (<agentic_ai>/dev/review) on the Node side
// and exposes it to the app as `virtual:review-source`. Nothing is copied into
// this repository; the data only ends up in dist/ as a build artifact.
//
// A review has at most two snapshots, both named by commit in the build's review
// context (REVIEW_* environment, see readReviewContext):
//   baseline  Before = the develop HEAD, no After
//   review    Before = the feature branch's fork point, After = its head
// The dev server without a context shows HEAD, plus uncommitted dev/review edits
// as After when there are any.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { FlowchartError, parseFlowchart } from '../src/review/flowchart.js'
import { REVIEW_DIR, checkRepository, commitInfo, git, isAncestor, showFile } from './reviewGit.js'

const VIRTUAL_ID = 'virtual:review-source'
const RESOLVED_ID = '\0' + VIRTUAL_ID
const MANIFEST = `${REVIEW_DIR}/manifest.yaml`


function fail(message) {
  throw new Error(`[review-source] ${message}`)
}

function requireString(diagram, index, key) {
  const value = diagram[key]
  if (typeof value !== 'string' || value.trim() === '') {
    const label = typeof diagram.id === 'string' ? `"${diagram.id}"` : `#${index}`
    fail(`diagrams[${index}] (${label}) has no "${key}"`)
  }
  return value
}

// How the viewer lays a diagram out. "schema" = field lists: left-aligned, wider labels.
const PRESENTATIONS = ['default', 'schema']

function readPresentation(diagram, index, where) {
  const value = diagram.presentation ?? 'default'
  if (!PRESENTATIONS.includes(value)) {
    fail(`${where}: diagrams[${index}].presentation must be one of ${PRESENTATIONS.join(', ')}`)
  }
  return value
}

// Validates one manifest and reads its diagrams. `where` names the manifest in
// errors; readDiagram(file) returns a diagram's text (file is repo-root relative).
function buildReview(manifestText, where, readDiagram) {
  let manifest
  try {
    manifest = parse(manifestText)
  } catch (error) {
    fail(`cannot parse ${where}: ${error.message}`)
  }
  if (manifest === null || typeof manifest !== 'object') {
    fail(`${where} is not a YAML mapping`)
  }
  if (!Array.isArray(manifest.diagrams)) {
    fail(`${where}: "diagrams" must be a list`)
  }

  const project = manifest.project ?? {}
  const diagrams = manifest.diagrams.map((diagram, index) => {
    if (diagram === null || typeof diagram !== 'object') {
      fail(`${where}: diagrams[${index}] is not a mapping`)
    }
    const id = requireString(diagram, index, 'id')
    const title = requireString(diagram, index, 'title')
    const file = requireString(diagram, index, 'file')
    return {
      id,
      title,
      summary: diagram.summary ?? '',
      file,
      watch: Array.isArray(diagram.watch) ? diagram.watch : [],
      presentation: readPresentation(diagram, index, where),
      source: readDiagram(file, id),
    }
  })

  const ids = new Set()
  for (const { id } of diagrams) {
    if (ids.has(id)) fail(`${where}: duplicate diagram id "${id}"`)
    ids.add(id)
  }

  return {
    project: { id: project.id ?? '', title: project.title ?? project.id ?? '' },
    diagrams,
  }
}

export function readReviewSource(sourceRoot) {
  const manifestPath = path.join(sourceRoot, MANIFEST)
  if (!fs.existsSync(manifestPath)) {
    fail(`manifest not found: ${manifestPath}`)
  }
  const files = [manifestPath]
  const data = buildReview(fs.readFileSync(manifestPath, 'utf8'), manifestPath, (file, id) => {
    // manifest file paths are relative to the agentic_ai repository root.
    const filePath = path.resolve(sourceRoot, file)
    if (!fs.existsSync(filePath)) {
      fail(`diagram "${id}": file not found: ${file} (${filePath})`)
    }
    files.push(filePath)
    return fs.readFileSync(filePath, 'utf8')
  })
  return { data, files }
}

// The semantic graph behind the Before / After diff. A diagram outside the supported
// Mermaid subset still renders but carries graphError instead.
function withGraphs(review, label, warnings) {
  return {
    ...review,
    diagrams: review.diagrams.map((diagram) => {
      try {
        return { ...diagram, graph: parseFlowchart(diagram.source), graphError: null }
      } catch (error) {
        if (!(error instanceof FlowchartError)) throw error
        const graphError = `${diagram.file} at ${label}: ${error.message}`
        warnings.push(graphError)
        return { ...diagram, graph: null, graphError }
      }
    }),
  }
}

// Branch names are shown, never executed; still only accept plain git ref names.
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

// The review context the build was asked for:
//   REVIEW_BASE_SHA     Before commit (default: HEAD of the source checkout)
//   REVIEW_HEAD_SHA     After commit; empty = baseline only
//   REVIEW_BASE_BRANCH  branch Before belongs to (default: the checkout's branch)
//   REVIEW_HEAD_BRANCH  feature branch of After
//   REVIEW_PR_NUMBER    pull request under review
export function readReviewContext(sourceRoot, env = process.env) {
  const value = (name) => (typeof env[name] === 'string' ? env[name].trim() : '')
  const baseRef = value('REVIEW_BASE_SHA') || 'HEAD'
  const headRef = value('REVIEW_HEAD_SHA')
  const baseBranch = value('REVIEW_BASE_BRANCH') || git(sourceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const headBranch = value('REVIEW_HEAD_BRANCH') || null
  const prText = value('REVIEW_PR_NUMBER')

  for (const [name, branch] of [['REVIEW_BASE_BRANCH', baseBranch], ['REVIEW_HEAD_BRANCH', headBranch]]) {
    if (branch !== null && !BRANCH.test(branch)) fail(`${name} is not a branch name: ${JSON.stringify(branch)}`)
  }
  if (prText && !/^[1-9][0-9]*$/.test(prText)) fail(`REVIEW_PR_NUMBER is not a pull request number: ${JSON.stringify(prText)}`)
  if (!headRef && (headBranch || prText)) fail('REVIEW_HEAD_BRANCH / REVIEW_PR_NUMBER given without REVIEW_HEAD_SHA')

  const base = commitInfo(sourceRoot, baseRef)
  const head = headRef ? commitInfo(sourceRoot, headRef) : null
  if (head && !isAncestor(sourceRoot, base.sha, head.sha)) {
    fail(`REVIEW_BASE_SHA ${base.shortSha} is not an ancestor of REVIEW_HEAD_SHA ${head.shortSha}; Before must be the fork point`)
  }
  return { base, head, baseBranch, headBranch, prNumber: prText ? Number(prText) : null }
}

function snapshotAt(sourceRoot, commit, warnings) {
  const review = buildReview(
    showFile(sourceRoot, commit, MANIFEST),
    `${MANIFEST} at ${commit.shortSha}`,
    (file) => showFile(sourceRoot, commit, file),
  )
  return { ...commit, workingTree: false, ...withGraphs(review, commit.shortSha, warnings) }
}

const plain = (review) => ({
  project: review.project,
  diagrams: review.diagrams.map(({ id, title, summary, file, watch, presentation, source }) => ({ id, title, summary, file, watch, presentation, source })),
})

// { project, review: {state, baseBranch, headBranch, prNumber}, before, after } —
// never more than these two snapshots.
export function readReview(sourceRoot, { includeWorkingTree = false, env = process.env } = {}) {
  checkRepository(sourceRoot)
  const warnings = []
  const context = readReviewContext(sourceRoot, env)
  const before = snapshotAt(sourceRoot, context.base, warnings)
  let after = context.head ? snapshotAt(sourceRoot, context.head, warnings) : null
  let headBranch = context.headBranch

  const files = []
  if (includeWorkingTree && !after) {
    const current = readReviewSource(sourceRoot)
    files.push(...current.files)
    if (JSON.stringify(plain(current.data)) !== JSON.stringify(plain(before))) {
      after = {
        sha: 'working-tree',
        shortSha: 'working tree',
        timestamp: null,
        subject: `Uncommitted ${REVIEW_DIR} changes`,
        workingTree: true,
        ...withGraphs(current.data, 'working tree', warnings),
      }
      headBranch = 'working tree'
    }
  }

  const review = {
    state: after ? 'review' : 'baseline',
    baseBranch: context.baseBranch,
    headBranch: after ? headBranch : null,
    prNumber: after ? context.prNumber : null,
  }
  return { data: { project: (after ?? before).project, review, before, after }, files, warnings }
}

export default function reviewSource({ sourceRoot }) {
  const reviewDir = path.join(sourceRoot, REVIEW_DIR)
  let serving = false

  return {
    name: 'review-source',

    configResolved(config) {
      serving = config.command === 'serve'
    },

    // Fail dev/build startup on a broken Review Source instead of at first request.
    buildStart() {
      readReview(sourceRoot, { includeWorkingTree: serving })
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id !== RESOLVED_ID) return
      const { data, files, warnings } = readReview(sourceRoot, { includeWorkingTree: serving })
      for (const warning of warnings) this.warn(`Changes unavailable for ${warning}`)
      for (const file of files) this.addWatchFile(file)
      return `export default ${JSON.stringify(data)}`
    },

    configureServer(server) {
      const invalidate = () => {
        const module = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (module) server.moduleGraph.invalidateModule(module)
      }
      // A page load re-reads the snapshots, so new commits show up on refresh.
      server.middlewares.use((req, res, next) => {
        if (req.headers.accept?.includes('text/html')) invalidate()
        next()
      })

      server.watcher.add(reviewDir)
      const onChange = (file) => {
        if (!path.resolve(file).startsWith(reviewDir + path.sep)) return
        invalidate()
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('change', onChange)
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)
    },
  }
}

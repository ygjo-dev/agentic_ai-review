// Reads the Review Source of Truth (<agentic_ai>/dev/review) on the Node side
// and exposes it to the app as `virtual:review-source`. Nothing is copied into
// this repository; the data only ends up in dist/ as a build artifact.
//
// A review has at most two snapshots of one branch (develop), both named by commit
// in the build's review context (REVIEW_* environment, see readReviewContext):
//   baseline  Before = the develop HEAD, no After
//   review    Before = develop just before an update, After = develop just after it
// The dev server without a context shows HEAD, plus uncommitted dev/review edits
// as After when there are any. Local preview (dev server only, `npm run review:dev`)
// compares the agentic_ai working tree as it is on disk with a ref (origin/develop) or HEAD.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { FlowchartError, parseFlowchart } from '../src/review/flowchart.js'
import { COMPARE_MODES } from '../src/review/localCompare.js'
import { REVIEW_DIR, checkRepository, commitInfo, git, showFile } from './reviewGit.js'

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
//   REVIEW_BEFORE_SHA  Before commit (default: HEAD of the source checkout)
//   REVIEW_AFTER_SHA   After commit; empty = baseline only
//   REVIEW_BRANCH      branch both snapshots belong to (default: the checkout's branch)
export function readReviewContext(sourceRoot, env = process.env) {
  const value = (name) => (typeof env[name] === 'string' ? env[name].trim() : '')
  const beforeRef = value('REVIEW_BEFORE_SHA') || 'HEAD'
  const afterRef = value('REVIEW_AFTER_SHA')
  const branch = value('REVIEW_BRANCH') || git(sourceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  if (!BRANCH.test(branch)) fail(`REVIEW_BRANCH is not a branch name: ${JSON.stringify(branch)}`)
  return { before: commitInfo(sourceRoot, beforeRef), after: afterRef ? commitInfo(sourceRoot, afterRef) : null, branch }
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

// Local preview: After = the working tree always, labelled with the checked-out branch and
// whether dev/review has uncommitted edits. Before = beforeRef (e.g. origin/develop) for
// compare "develop", HEAD for "previous-commit" (HEAD → working tree, not HEAD^ → HEAD).
function localContext(sourceRoot, { beforeRef, compare = 'develop' }) {
  if (!COMPARE_MODES.includes(compare)) fail(`unknown local compare mode: ${JSON.stringify(compare)}`)
  const head = git(sourceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const branch = head === 'HEAD' ? 'detached HEAD' : head
  const previous = compare === 'previous-commit'
  return {
    before: commitInfo(sourceRoot, previous ? 'HEAD' : beforeRef),
    after: null,
    branch: previous ? branch : beforeRef.replace(/^origin\//, ''),
    local: {
      branch,
      dirty: git(sourceRoot, ['status', '--porcelain', '--', REVIEW_DIR]).trim() !== '',
      compare,
    },
  }
}

// { project, review: {state, branch, local?}, before, after } — never more than these two snapshots.
// `local` ({beforeRef, compare}) is for the dev server only; the build never passes it.
export function readReview(sourceRoot, { includeWorkingTree = false, local = null, env = process.env } = {}) {
  checkRepository(sourceRoot)
  const warnings = []
  const context = local ? localContext(sourceRoot, local) : readReviewContext(sourceRoot, env)
  const before = snapshotAt(sourceRoot, context.before, warnings)
  let after = context.after ? snapshotAt(sourceRoot, context.after, warnings) : null

  const files = []
  if ((includeWorkingTree || local) && !after) {
    const current = readReviewSource(sourceRoot)
    files.push(...current.files)
    if (local || JSON.stringify(plain(current.data)) !== JSON.stringify(plain(before))) {
      after = {
        sha: 'working-tree',
        shortSha: 'working tree',
        timestamp: null,
        subject: context.local
          ? `${context.local.branch}${context.local.dirty ? ' · modified' : ''}`
          : `Uncommitted ${REVIEW_DIR} changes`,
        workingTree: true,
        ...withGraphs(current.data, 'working tree', warnings),
      }
    }
  }

  const review = { state: after ? 'review' : 'baseline', branch: context.branch }
  if (context.local) review.local = context.local
  return { data: { project: (after ?? before).project, review, before, after }, files, warnings }
}

// Local preview serves every comparison at once ({ compare: { develop, 'previous-commit' } }),
// so the page switches between them without a reload. A comparison whose Before cannot be
// read (no origin/develop yet) carries { error } and the other still works; when none can be
// read (e.g. a broken working tree) it fails as a single comparison would.
export function readLocalPreview(sourceRoot, { beforeRef }) {
  const compare = {}
  const files = new Set()
  const warnings = new Set()
  const errors = []
  for (const mode of COMPARE_MODES) {
    try {
      const result = readReview(sourceRoot, { local: { beforeRef, compare: mode } })
      compare[mode] = result.data
      result.files.forEach((file) => files.add(file))
      result.warnings.forEach((warning) => warnings.add(warning))
    } catch (error) {
      compare[mode] = { error: error.message }
      errors.push(error)
    }
  }
  if (errors.length === COMPARE_MODES.length) throw errors[0]
  return { data: { compare }, files: [...files], warnings: [...warnings] }
}

export default function reviewSource({ sourceRoot, local = null }) {
  const reviewDir = path.join(sourceRoot, REVIEW_DIR)
  const headFile = path.join(sourceRoot, '.git', 'HEAD')
  let serving = false
  // Local preview reads the working tree, so it never reaches a build.
  const read = () => (serving && local ? readLocalPreview(sourceRoot, local) : readReview(sourceRoot, { includeWorkingTree: serving }))

  return {
    name: 'review-source',

    configResolved(config) {
      serving = config.command === 'serve'
    },

    // Fail dev/build startup on a broken Review Source instead of at first request.
    buildStart() {
      read()
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id !== RESOLVED_ID) return
      const { data, files, warnings } = read()
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

      const reload = () => {
        invalidate()
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.add(reviewDir)
      const onChange = (file) => {
        if (path.resolve(file).startsWith(reviewDir + path.sep)) reload()
      }
      server.watcher.on('change', onChange)
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)

      // Local preview also follows a branch switch. Vite ignores .git, so watch that one
      // directory's entries (not recursive) and react to HEAD only; git renames it into place.
      if (local) {
        const gitDir = path.dirname(headFile)
        const head = fs.watch(gitDir, (event, name) => {
          if (name === 'HEAD') reload()
        })
        head.unref()
        server.httpServer?.once('close', () => head.close())
      }
    },
  }
}

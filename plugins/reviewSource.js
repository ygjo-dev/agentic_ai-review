// Reads the Review Source of Truth (<agentic_ai>/dev/review) on the Node side
// and exposes it to the app as `virtual:review-source`. Nothing is copied into
// this repository; the data only ends up in dist/ as a build artifact.
//
// Review Versions are the agentic_ai commits that touched dev/review, read from
// git history (see reviewHistory.js). The dev server adds an uncommitted
// "working tree" version on top when dev/review differs from the latest commit.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { FlowchartError, parseFlowchart } from '../src/review/flowchart.js'
import { REVIEW_DIR, listReviewCommits, showFile } from './reviewHistory.js'

const VIRTUAL_ID = 'virtual:review-source'
const RESOLVED_ID = '\0' + VIRTUAL_ID
const MANIFEST = `${REVIEW_DIR}/manifest.yaml`

export const WORKING_TREE = 'working-tree'

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

// The semantic graph behind Changes mode. A diagram outside the supported
// Mermaid subset keeps rendering in Full mode but carries graphError instead.
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

export function readReviewVersions(sourceRoot, { includeWorkingTree = false } = {}) {
  const warnings = []
  const versions = listReviewCommits(sourceRoot).map((commit) => {
    const review = buildReview(
      showFile(sourceRoot, commit, MANIFEST),
      `${MANIFEST} at ${commit.shortSha}`,
      (file) => showFile(sourceRoot, commit, file),
    )
    return { ...commit, workingTree: false, ...withGraphs(review, commit.shortSha, warnings) }
  })

  const files = []
  if (includeWorkingTree) {
    const current = readReviewSource(sourceRoot)
    files.push(...current.files)
    const latest = versions[0]
    const plain = (review) => ({
      project: review.project,
      diagrams: review.diagrams.map(({ id, title, summary, file, watch, source }) => ({ id, title, summary, file, watch, source })),
    })
    if (!latest || JSON.stringify(plain(current.data)) !== JSON.stringify(plain(latest))) {
      versions.unshift({
        sha: WORKING_TREE,
        shortSha: 'working tree',
        timestamp: null,
        subject: `Uncommitted ${REVIEW_DIR} changes`,
        workingTree: true,
        ...withGraphs(current.data, 'working tree', warnings),
      })
    }
  }

  if (versions.length === 0) {
    fail(`no Review Versions: no commit in ${sourceRoot} touches ${REVIEW_DIR}`)
  }
  return { data: { project: versions[0].project, versions }, files, warnings }
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
      readReviewVersions(sourceRoot, { includeWorkingTree: serving })
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id !== RESOLVED_ID) return
      const { data, files, warnings } = readReviewVersions(sourceRoot, { includeWorkingTree: serving })
      for (const warning of warnings) this.warn(`Changes unavailable for ${warning}`)
      for (const file of files) this.addWatchFile(file)
      return `export default ${JSON.stringify(data)}`
    },

    configureServer(server) {
      const invalidate = () => {
        const module = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (module) server.moduleGraph.invalidateModule(module)
      }
      // A page load re-reads git history, so new Review commits show up on refresh.
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

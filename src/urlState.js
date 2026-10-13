// The whole view lives in the URL so a link reproduces it after a reload:
//   ?version=<sha>[&compare=<sha>][&mode=changes]#<diagram id>
// Unknown values fall back to a default and say so in `notices`.

function findVersion(versions, value) {
  if (!value) return null
  const exact = versions.find((version) => version.sha === value)
  if (exact) return exact
  if (value.length < 4) return null
  const matches = versions.filter((version) => !version.workingTree && version.sha.startsWith(value))
  return matches.length === 1 ? matches[0] : null
}

export function readUrlState(versions) {
  const params = new URLSearchParams(window.location.search)
  const notices = []

  const requested = params.get('version')
  let version = findVersion(versions, requested)
  if (requested && !version) notices.push(`Review Version "${requested}" not found. Showing the latest version.`)
  version ??= versions[0]

  const requestedMode = params.get('mode')
  if (requestedMode && requestedMode !== 'full' && requestedMode !== 'changes') {
    notices.push(`Unknown view "${requestedMode}". Showing Full.`)
  }
  const mode = requestedMode === 'changes' ? 'changes' : 'full'

  // Only versions older than the selected one can be compared against.
  const older = versions.slice(versions.indexOf(version) + 1).filter((v) => !v.workingTree)
  let compare = null
  if (mode === 'changes') {
    const requestedCompare = params.get('compare')
    compare = requestedCompare ? findVersion(older, requestedCompare) : null
    if (requestedCompare && !compare) {
      notices.push(
        older.length
          ? `"${requestedCompare}" is not an earlier Review Version. Comparing with the previous version.`
          : `"${requestedCompare}" is not an earlier Review Version.`,
      )
    }
    compare ??= older[0] ?? null
  }

  const diagramId = decodeURIComponent(window.location.hash.slice(1))
  return { version, mode, compare, older, diagramId, notices }
}

export function urlFor({ version, mode, compare, diagramId }) {
  const params = new URLSearchParams({ version: version.sha })
  if (mode === 'changes') {
    if (compare) params.set('compare', compare.sha)
    params.set('mode', 'changes')
  }
  const hash = diagramId ? `#${encodeURIComponent(diagramId)}` : ''
  return `${window.location.pathname}?${params}${hash}`
}

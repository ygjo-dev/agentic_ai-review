import { useEffect, useState } from 'react'
import mermaid from '../mermaid.js'

let renderSeq = 0

// Per-diagram Mermaid settings, prepended at render time only. Schema diagrams are
// field lists, so their labels wrap later than the global 340px.
const DIRECTIVES = {
  schema: '%%{init: {"flowchart": {"wrappingWidth": 640}}}%%\n',
}

export default function MermaidDiagram({ source, presentation = 'default' }) {
  const rendered = (DIRECTIVES[presentation] ?? '') + source
  const [result, setResult] = useState({ source: null, svg: '', error: null })

  useEffect(() => {
    let cancelled = false
    // A fresh id per render call keeps concurrent / repeated renders from colliding.
    const id = `review-diagram-${++renderSeq}`

    mermaid
      .render(id, rendered)
      .then(({ svg }) => {
        if (!cancelled) setResult({ source: rendered, svg, error: null })
      })
      .catch((error) => {
        // Mermaid can leave its temporary error node in <body>.
        document.getElementById(`d${id}`)?.remove()
        if (!cancelled) setResult({ source: rendered, svg: '', error: error?.message ?? String(error) })
      })

    return () => {
      cancelled = true
    }
  }, [rendered])

  if (result.source !== rendered) {
    return <div className="diagram-status">Rendering…</div>
  }
  if (result.error) {
    return (
      <div className="diagram-error" role="alert">
        <strong>Mermaid render failed</strong>
        <pre>{result.error}</pre>
      </div>
    )
  }
  return <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
}

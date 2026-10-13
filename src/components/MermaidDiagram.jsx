import { useEffect, useState } from 'react'
import mermaid from '../mermaid.js'

let renderSeq = 0

export default function MermaidDiagram({ source }) {
  const [result, setResult] = useState({ source: null, svg: '', error: null })

  useEffect(() => {
    let cancelled = false
    // A fresh id per render call keeps concurrent / repeated renders from colliding.
    const id = `review-diagram-${++renderSeq}`

    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (!cancelled) setResult({ source, svg, error: null })
      })
      .catch((error) => {
        // Mermaid can leave its temporary error node in <body>.
        document.getElementById(`d${id}`)?.remove()
        if (!cancelled) setResult({ source, svg: '', error: error?.message ?? String(error) })
      })

    return () => {
      cancelled = true
    }
  }, [source])

  if (result.source !== source) {
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

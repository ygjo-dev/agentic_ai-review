import { useEffect, useState } from 'react'
import mermaid from '../mermaid.js'

let renderSeq = 0

// Per-diagram Mermaid settings, prepended at render time only. Schema diagrams are
// field lists, so their labels wrap later than the global 340px.
const DIRECTIVES = {
  schema: '%%{init: {"flowchart": {"wrappingWidth": 640}}}%%\n',
}

// Schema diagrams read like code: field names in <code>, IN / OUT marked. A field
// starts a line or follows "{" / ", " inside a one-line object. Only standard tags
// (sized the same where Mermaid measures them); colours are CSS.
const FIELD = /(^|<br\/>|"|\{|, )((?:<(?:ins|del)>)?)((?:&nbsp;)*)([A-Za-z_][\w.]*\??)(: )/g

function decorateSchema(source) {
  return source.replace(FIELD, '$1$2$3<code>$4</code>$5').replace(/<b>(IN|OUT)<\/b>/g, '<b><u>$1</u></b>')
}

const DECORATE = { schema: decorateSchema }

export default function MermaidDiagram({ source, presentation = 'default' }) {
  const rendered = (DIRECTIVES[presentation] ?? '') + (DECORATE[presentation] ?? ((text) => text))(source)
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
  // The natural width (viewBox) lets "Actual size" show the diagram unscaled.
  const width = Number(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(result.svg)?.[1])
  return (
    <div
      className="diagram-svg"
      style={width ? { '--natural-width': `${Math.ceil(width)}px` } : undefined}
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  )
}

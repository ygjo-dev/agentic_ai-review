import mermaid from 'mermaid'

// Initialized once for the whole application.
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  // Keep the natural diagram width; the canvas scrolls instead of shrinking text.
  flowchart: { useMaxWidth: false },
})

export default mermaid

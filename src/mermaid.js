import mermaid from 'mermaid'

// Initialized once for the whole application.
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  // Keep the natural diagram width; the canvas scrolls instead of shrinking text.
  // Labels wrap at 340px (default 200) so a bullet line stays on one line.
  flowchart: { useMaxWidth: false, wrappingWidth: 340 },
})

export default mermaid

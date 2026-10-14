import mermaid from 'mermaid'

// Initialized once for the whole application.
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  // The SVG fills its pane's width but never grows past its natural size (width 100%,
  // max-width natural). "Actual size" in the viewer lifts that cap; see MermaidDiagram.
  // Labels wrap at 340px (default 200) so a bullet line stays on one line.
  flowchart: { useMaxWidth: true, wrappingWidth: 340 },
})

export default mermaid

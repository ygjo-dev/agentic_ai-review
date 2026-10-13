import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import reviewSource from './plugins/reviewSource.js'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

// Review Source of Truth lives in the agentic_ai repository: the sibling checkout by
// default, or AGENTIC_AI_REVIEW_SOURCE_ROOT (CI checks agentic_ai out elsewhere).
const sourceRoot = path.resolve(
  projectRoot,
  process.env.AGENTIC_AI_REVIEW_SOURCE_ROOT || '../agentic_ai',
)

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs: dist/ works at a custom-domain root and under a
  // GitHub Pages project path alike. Selection lives in the hash, so no rewrites.
  base: './',
  plugins: [react(), reviewSource({ sourceRoot })],
})

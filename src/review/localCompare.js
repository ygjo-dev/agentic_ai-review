// Local preview (`npm run review:dev`) compares the agentic_ai working tree (After) with one of
// two Befores. Shared by the dev server plugin and the page; the public build never uses it.
//   develop          Before = the develop ref (origin/develop): everything the branch changes
//   previous-commit  Before = HEAD: only what changed since the last commit
// A closed list: the page's ?compare= never names a ref, a path or a command.
export const COMPARE_MODES = ['develop', 'previous-commit']
export const DEFAULT_COMPARE = 'develop'

export const COMPARE_LABELS = {
  develop: 'develop 기준',
  'previous-commit': '직전 커밋 기준',
}

export function parseCompare(value) {
  return COMPARE_MODES.includes(value) ? value : DEFAULT_COMPARE
}

import { COMPARE_LABELS, COMPARE_MODES, parseCompare } from '../review/localCompare.js'

// Local preview only: what the working tree (After) is compared with. Public never renders it.
export default function CompareBasis({ value, onChange }) {
  return (
    <label className="local-compare">
      <span className="local-compare-label">비교 기준</span>
      <select value={value} onChange={(event) => onChange(parseCompare(event.target.value))} data-testid="compare-mode">
        {COMPARE_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {COMPARE_LABELS[mode]}
          </option>
        ))}
      </select>
    </label>
  )
}

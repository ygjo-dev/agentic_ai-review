# agentic_ai-review

Web viewer that renders the agentic_ai architecture review diagrams with Mermaid.

The Review Source of Truth is the sibling repository's `../agentic_ai/dev/review/`
(`manifest.yaml` + the `.mmd` files it lists). This repo keeps no copy of it: a Vite
plugin reads it at dev/build time and serves it as `virtual:review-source`.
The source root defaults to the sibling `../agentic_ai`; set `AGENTIC_AI_REVIEW_SOURCE_ROOT`
to read another checkout.

The Review Web is not a history browser. It shows at most two snapshots of `dev/review`,
read by SHA with `git show` (the agentic_ai working tree never moves):

- baseline: Before = develop HEAD, no After ("No active review")
- review: Before = where the feature branch forked from develop
  (`merge-base(develop, PR head)`), After = the PR head, shown side by side with the semantic
  diff (changed label lines are marked inside an otherwise neutral node)

The build takes the context from `REVIEW_BASE_SHA`, `REVIEW_HEAD_SHA`, `REVIEW_BASE_BRANCH`,
`REVIEW_HEAD_BRANCH`, `REVIEW_PR_NUMBER`; `scripts/resolve-review-context.mjs` derives it in CI
from the one open, non-draft PR to develop (none = baseline, two = error). The URL only carries
the diagram (`#runtime_pipeline`). Without a context the dev server shows HEAD, plus uncommitted
`dev/review` edits as After. A diagram with `presentation: schema` renders as field lists.

Production is a public GitHub Pages site (https://agentic-ai-review.krri.re.kr/; the custom
domain is set in the repository's Settings > Pages): `.github/workflows/deploy-pages.yml` checks
out `ygjo-dev/agentic_ai` with full history in CI and publishes only the static `dist/`. agentic_ai's
`Review Web` workflow dispatches it when a PR to develop becomes ready, is updated, or is closed.

```sh
npm install
npm run dev     # edits under ../agentic_ai/dev/review reload the page
npm run build   # fails with a readable error if the Review Source is broken
```

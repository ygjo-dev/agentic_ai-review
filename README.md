# agentic_ai-review

Web viewer that renders the agentic_ai architecture review diagrams with Mermaid.

The Review Source of Truth is the sibling repository's `../agentic_ai/dev/review/`
(`manifest.yaml` + the `.mmd` files it lists). This repo keeps no copy of it: a Vite
plugin reads it at dev/build time and serves it as `virtual:review-source`.
The source root defaults to the sibling `../agentic_ai`; set `AGENTIC_AI_REVIEW_SOURCE_ROOT`
to read another checkout.

The Review Web is not a history browser. It shows at most two snapshots of `dev/review` on
develop, read by SHA with `git show` (the agentic_ai working tree never moves):

- review: Before = develop just before an update, After = develop just after it (a merge,
  squash, rebase or direct push), shown side by side with the semantic diff (changed label lines
  are marked inside an otherwise neutral node). The pair stays until the next develop update.
- baseline: Before = develop HEAD, no After, until the first develop update is reviewed

Feature branch pushes and pull request events do not change it. The build takes the pair from
`REVIEW_BEFORE_SHA`, `REVIEW_AFTER_SHA`, `REVIEW_BRANCH`; in CI `scripts/resolve-review-context.mjs`
checks that After is on develop and Before is either on develop or, after a force push dropped
it, on no branch at all (fetched by SHA); no pair = baseline. Runtime / Data are tabs; each diagram
fits its pane (scaled down, never up) and "Actual size" shows it unscaled. The URL only carries the
diagram (`#runtime_pipeline`; the local preview adds `?compare=previous-commit`). Without a context
the dev server shows HEAD, plus uncommitted `dev/review` edits as After. A diagram with
`presentation: schema` renders as field lists.

Production is a public GitHub Pages site (https://agentic-ai-review.krri.re.kr/; the custom
domain is set in the repository's Settings > Pages): `.github/workflows/deploy-pages.yml` checks
out the private `ygjo-dev/agentic_ai` with full history in CI using the `AGENTIC_AI_READ_TOKEN`
secret (fine-grained, that repository only, Contents read-only) and publishes only the static
`dist/` built from its `dev/review`. agentic_ai's
`Review Web` workflow dispatches it on every push to develop with the push event's before/after
commits. Only a dispatch deploys: a viewer push only builds, and is published by the next dispatch
(or by running the workflow by hand with the current pair). When `SLACK_WEBHOOK_URL` is set as an
Actions secret of this repository, the deploy job posts one message once a pair is live.

```sh
npm install
npm run dev     # edits under ../agentic_ai/dev/review reload the page
npm run review:dev   # local preview on 0.0.0.0:4797 (see below); prints Local / LAN URLs.
                     # AGENTIC_AI_REPO · REVIEW_BEFORE_REF · REVIEW_DEV_PORT override; dev only
npm test        # Before/After pair rules on a throwaway git fixture
npm run build   # fails with a readable error if the Review Source is broken
```

Local preview (`npm run review:dev`, never in the public build): After is always the agentic_ai
working tree as it is on disk (uncommitted `dev/review` included). 「비교 기준」 picks the Before:

- develop 기준 (default): Before = `origin/develop` (`git fetch` refreshes it). Everything the
  current work changes against develop, as the next develop review will show it.
- 직전 커밋 기준 (`?compare=previous-commit`): Before = the agentic_ai `HEAD`. Only what changed
  since the last commit (HEAD → working tree, not HEAD^ → HEAD), so right after a commit it is
  "No change".

The page switches between the two without a reload; Runtime / Data and Fit width keep the choice.
If one Before cannot be read (e.g. no `origin/develop` yet), that 비교 기준 shows the error and the
other still works.

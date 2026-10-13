# agentic_ai-review

Web viewer that renders the agentic_ai architecture review diagrams with Mermaid.

The Review Source of Truth is the sibling repository's `../agentic_ai/dev/review/`
(`manifest.yaml` + the `.mmd` files it lists). This repo keeps no copy of it: a Vite
plugin reads it at dev/build time and serves it as `virtual:review-source`.
The source root defaults to the sibling `../agentic_ai`; set `AGENTIC_AI_REVIEW_SOURCE_ROOT`
to read another checkout.

Review Versions are the agentic_ai commits that touch `dev/review` (`git log -- dev/review`),
read at dev/build time with `git show` so the agentic_ai working tree never moves. The viewer
shows one version in Full, or Before | After side by side with its semantic changes against an
earlier one (label lines that changed are marked inside an otherwise neutral node), and keeps the view in
the URL: `?version=<sha>&compare=<sha>&mode=changes#<diagram id>`. The dev server also offers
uncommitted `dev/review` edits as a "Working tree" version. An optional `history.start_commit`
in the current manifest starts Review history at that commit; earlier Review commits stay in git
but are not Review Versions. A diagram with `presentation: schema` renders as left-aligned field lists.

Production is a public GitHub Pages site (https://agentic-ai-review.krri.re.kr/; the custom
domain is set in the repository's Settings > Pages): `.github/workflows/deploy-pages.yml` checks
out `ygjo-dev/agentic_ai` `develop` with full history in CI and publishes only the static `dist/`.
Everything in the `dev/review` history becomes public.

```sh
npm install
npm run dev     # edits under ../agentic_ai/dev/review reload the page
npm run build   # fails with a readable error if the Review Source is broken
```

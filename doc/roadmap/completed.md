# Completed Tasks

Historical record of finished roadmap work. Each entry keeps its `cl` (commit)
for review. One section per shipped milestone or task batch, newest last.
Done task blocks stay in their area docs (the dependency graph stays whole);
this file holds prose summaries.

_Nothing completed yet — roadmap initialized 2026-10-05._

## Scaffold (OPS-001)

**Status 2026-10-05: COMPLETE: Vite + TS project builds (`npm run build` clean).**

**CL: `4b5aa49`**: package.json, tsconfig (strict), vite.config.ts
(`base: /graphics-engineer-demo/`), index.html, `src/main.ts`,
`src/render/shaders.ts` (spike path tracer), `.github/workflows/deploy.yml`
(written; unverified until first push, tracked under OPS-002).
Review it with: `git show 4b5aa49`

## Pages deploy (OPS-002)

**Status 2026-10-06: COMPLETE: workflow green, site serves HTTP 200.**

**CL: `628d265`**: deploy.yml unchanged; first run failed because Pages was not yet enabled, re-run after enabling succeeded. Project URL redirects to the account's custom domain (www.trungtuanle.com); the bare domain has a stray A record (not ours to fix in repo).

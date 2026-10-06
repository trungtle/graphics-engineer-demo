# Light Lab (graphics-engineer-demo)

Career-fair web app: interactive WebGL2 path tracer explaining the rendering
equation to high-school students. Vite + vanilla TypeScript, deployed to
GitHub Pages, offline-capable PWA. Targets: Intel MacBook + iPad (touch-first).

## Roadmap / task tracking

- Task tracker: [doc/ROADMAP.md](doc/ROADMAP.md) (rollup table + next actionable);
  tasks live as `<!--task-->` blocks in `doc/roadmap/*.md`.
- Status check: `python scripts/plans_lint.py` (validates blocks, lists next
  actionable tasks).
- When a task's status changes, update the area doc **and** the rollup table in
  ROADMAP.md in the same change so they never drift. Done tasks need `cl:`.
- Screenshots go in `doc/roadmap/img/<task-id>-<slug>.png`; before/after pairs
  for visual changes. Use the `?capture=` mode (RND-007) once it exists.
- Feature branches merge with `git merge --no-ff`. Review a merge with
  `git log <merge>^1..<merge>^2 --oneline` and `git diff <merge>^1 <merge>^2`.

## Rules

- The repo is public: no absolute local paths, personal data, or secrets in
  commits or docs.
- Never `git push` without explicit permission for that specific push.
- No runtime requests to external hosts (no CDNs, analytics) — must run offline.

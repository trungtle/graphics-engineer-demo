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

## Stations

Three screens switched by a bottom tab bar (`src/stations.ts`): Light Lab (the path-tracer demo, default; a model picker swaps the balls for triangle meshes: `src/mesh.ts`, `src/bvh.ts`, shader `meshHit`) and Mirrors (game logic in `src/optics.ts` + `src/levels.ts`; drawn as a path-traced 3D optical bench by `src/bench.ts` and the shader's `benchScene`; touch and overlay in `src/ui/bench.ts`), and Water (a 2D FLIP fluid: `src/fluid.ts`, drawn on its own 2D canvas by `src/ui/fluid.ts`, no GL). Decades and 16 ms were removed from the app on 2026-10-23 at the user's request; their code (`src/ui/decades.ts`, `src/budget.ts`, `src/ui/budget.ts`, `src/shading.ts`) is still in the repo but not wired in. Light Lab and Mirrors share **one GL canvas**: `#viewport` is moved into the active station's `.viewport-slot`; the render loop skips frames while it is hidden. Attract (idle) mode was removed on 2026-10-27 at the user's request; `src/idle.ts` is kept but not wired in. Any new control must pass the six-viewport overflow check (see doc/roadmap/ui.md).

## Rules

- The repo is public: no absolute local paths, personal data, or secrets in
  commits or docs.
- Never `git push` without explicit permission for that specific push.
- No runtime requests to external hosts (no CDNs, analytics) — must run offline.

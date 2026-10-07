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

**CL: `628d265`**: deploy.yml unchanged; first run failed because Pages was not yet enabled, re-run after enabling succeeded. Project URL redirects to the account's custom domain; the bare domain had a stray DNS record (outside this repo).

## Scene, materials, bounces (RND-003, RND-004)

**Status 2026-10-06: COMPLETE on desktop GPU; iPad/Intel Mac perf unmeasured.**

**CL: `aa9aa52`**: `src/scene.ts` (scene state), shader now uniform-driven (3 spheres, light pos/size/color, bounce cap), 5 materials (diffuse, mirror, glass, rough metal, emissive). Dev hooks: `window.lightlab`, keys 0-8 bounces, q/w/e cycle material.
Review it with: `git show aa9aa52`

## CPU picker / path recorder (RND-006)

**Status 2026-10-06: COMPLETE: 7/7 tests pass; GPU parity 280/280 pixels.**

**CL: `2f21e9c`**: `src/render/cpu.ts`, `src/render/cpu.test.ts`, vitest dev dependency, tap in main.ts shows picked surface in the HUD (`s` now toggles render scale).
Review it with: `git show 2f21e9c`

## Layout + design tokens (UI-001)

**Status 2026-10-06: COMPLETE: 6 viewports measured, no scroll/overflow.**

**CL: `16ea687`**: index.html panel/stage/careers skeleton, src/style.css tokens + responsive grid, equation header with per-term colors, HUD behind ?debug.
Review it with: `git show 16ea687`

## First controls (INT-001, INT-002)

**Status 2026-10-06: COMPLETE on desktop; real-finger iPad test pending.**

**CL: `c818460`**: `src/ui/controls.ts` (slider, counters, restart, toast), tap detection in main.ts (<10px, <300ms), portrait layout fix (title and equation share a row). Note: a stale dev-server transform once hid new imports; restarting `npm run dev` fixed it.
Review it with: `git show c818460`

## Equation panel + live highlighting (UI-002, UI-003)

**Status 2026-10-06: COMPLETE on desktop; sizing target relaxed (see UI-002).**

**CL: `e675cc5`**: `src/ui/equation.ts`, term buttons + caption in index.html, styles, controls call `onTerm`; main.ts highlights f_r / L_e on material change.
Review it with: `git show e675cc5`

## Be a photon (INT-004)

**Status 2026-10-06: COMPLETE on desktop; real-finger iPad test pending.**

**CL: `1f297d4`**: `src/ui/photon.ts`, `cos` in cpu.ts PathSegment, toast duration param, photon button + overlay styles, 2 new tests (9 total). Key finding: ~6% of random paths reach the lamp; surfaced to students as the reason images start noisy.
Review it with: `git show 1f297d4`

## Lamp controls + orbit camera (INT-003, INT-005)

**Status 2026-10-06: COMPLETE on desktop; real-finger iPad test pending.**

**CL: `bb4b091`**: scene.ts (camera, light helpers, colors), cpu.ts (Camera, makeCamera, rayDir, ceilingPoint; all picking/projection now takes the camera), shader camera + light-radiance uniforms, main.ts pointer state machine (lamp drag / orbit / tap / double-tap), lamp swatches + size slider, compact layout media queries, 13 tests.
Review it with: `git show bb4b091`

## Photon mode rework (INT-004 follow-up)

**Status 2026-10-06: COMPLETE (user feedback applied).**

**CL: `713d1e8`**: dimming uniform in DISPLAY_FRAG, glow rendering in photon.ts, classify/pathColor/toDisplay + tests, readPixel from the float accumulation target (guarded when nothing accumulated), slower pacing, result-only caption.
Review it with: `git show 713d1e8`

## All-samples view and photon first-person view (INT-006, INT-007)

**Status 2026-10-06: COMPLETE on desktop; iPad/Intel perf pending.**

**CL: `694c5c5`**: photon.ts (many-path mode, pose/viewRect), main.ts (tracePass refactor, second inset pass, inset display with scissor), shaders (inside camera, FOV, blend, display offset), cpu.ts `cameraLookAlong`, CSS for tools/inset, 4 new tests (23 total).
Review it with: `git show 694c5c5`

## Attract mode (UI-004)

**Status 2026-10-06: COMPLETE on desktop; 2 h soak and real-finger wake test pending (BOOTH-002).**

**CL: `9cec387`**: `src/idle.ts`, `resetScene` in scene.ts (+test, 24 tests total), `idleCaption` and toast suppression in controls.ts, rays-since-load counter and `?idle=` wiring in main.ts, big-caption styles.
Review it with: `git show 9cec387`

## Careers strip (UI-005); UI-006 dropped

**Status 2026-10-06: COMPLETE.**

**CL: `ce8ed8b`**: `src/ui/careers.ts`, strip styles, idle captions; UI-006 (presenter panel) removed from the roadmap at the user's request.
Review it with: `git show ce8ed8b`

## Text removal (user request)

**Status 2026-10-06: COMPLETE.**

**CL: `5fdee61`**: deleted careers.ts and the strip, tagline, equation caption (equation.ts now highlight-only), slider captions, lamp hint, default and descriptive toasts; layout grids lose the careers row. 24 tests pass; six viewports re-measured clean.
Review it with: `git show 5fdee61`

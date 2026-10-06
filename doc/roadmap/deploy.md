# Deploy & Booth — Roadmap

Project scaffolding, GitHub Pages deployment, offline/PWA support, and the
on-site hardening pass for the career fair. The repo is
`graphics-engineer-demo` (public, required for free GitHub Pages), served at
`https://<user>.github.io/graphics-engineer-demo/`.

## Decisions

- **Stack** (2026-10-05): Vite + vanilla TypeScript, no UI framework.
  Vite `base: '/graphics-engineer-demo/'`.
- **Deploy** (2026-10-05): GitHub Actions builds on push to `main` and
  publishes with `actions/deploy-pages`. Publishing (git push) only happens
  when the user explicitly asks.
- **Offline is mandatory** (2026-10-05): booth Wi-Fi can't be trusted. The app
  is a PWA with a service worker that precaches everything; on iPad it's
  launched from the Home Screen under Guided Access; on the Mac, full-screen
  browser (local `npm run preview` as a backup).
- **No analytics, no external requests** (2026-10-05): nothing leaves the
  device; no fonts or scripts from CDNs at runtime (self-host fonts if any).

## Tasks

<!--task
id: OPS-001
status: done
epic: scaffold
deps: []
cl: 4b5aa49
-->
### OPS-001 — Scaffold Vite + TypeScript project

`npm create vite` (vanilla-ts), strict tsconfig, ESLint optional, `src/`
layout (`render/`, `ui/`, `scene/`, `main.ts`), shader files imported as
strings (`?raw`). Add `.gitignore` (node_modules, dist).

Verify: `npm run build` succeeds; `npm run dev` shows a page.

<!--task
id: OPS-002
status: doing
epic: deploy
deps: [OPS-001]
cl:
-->
### OPS-002 — GitHub Pages workflow

`.github/workflows/deploy.yml`: checkout → setup-node → `npm ci` →
`npm run build` → upload-pages-artifact → deploy-pages. Enable Pages
(source: GitHub Actions) in repo settings — the user does that step.

Verify: after the user pushes, the Pages URL loads the app; workflow green.

<!--task
id: OPS-003
status: todo
epic: offline
deps: [OPS-002]
cl:
-->
### OPS-003 — PWA manifest + service worker (offline)

Web manifest (name "Light Lab", icons, `display: fullscreen`/`standalone`,
landscape preferred), service worker precaching the built assets
(vite-plugin-pwa or a ~40-line hand-written SW). Versioned cache so updates
apply on next launch.

Verify: load once, enable airplane mode, relaunch from iPad Home Screen and
Mac browser — app fully works.

<!--task
id: BOOTH-001
status: todo
epic: hardening
deps: [UI-004, OPS-003]
cl:
-->
### BOOTH-001 — Robustness: WebGL context loss, errors, wake lock

Handle `webglcontextlost`/`restored` (rebuild everything, no blank screen),
global error handler that reloads into default state, Screen Wake Lock API
where supported (iPad: also set Auto-Lock to Never in settings — note in the
booth checklist), disable pinch-zoom / text selection / long-press callouts.

Verify: force context loss via `WEBGL_lose_context` → app recovers in < 2 s.

<!--task
id: BOOTH-002
status: todo
epic: hardening
deps: [BOOTH-001]
cl:
-->
### BOOTH-002 — Device test pass + soak test

On both the Intel MacBook and the iPad: run through every control, photon
mode, idle mode enter/exit, portrait/landscape (iPad), offline launch. Soak:
leave in idle mode 2 h — check memory stays flat and thermals don't throttle
fps below 20 (lower the quality cap if so).

Verify: checklist results + fps/memory numbers recorded in completed.md.

<!--task
id: BOOTH-003
status: todo
epic: hardening
deps: [BOOTH-002]
cl:
-->
### BOOTH-003 — Booth setup checklist

`doc/BOOTH.md`: iPad Guided Access steps, Auto-Lock off, Add to Home Screen,
Mac full-screen + caffeinate/Amphetamine, charger, backup URL / local preview
command, presenter-panel gesture, 30-second talk track per control.

Verify: a dry run following only the checklist gets both devices running.

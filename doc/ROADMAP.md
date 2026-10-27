# Light Lab — Roadmap

An interactive web app for high-school students at a career fair, with four
stations on one tab bar: **Light Lab** (a live WebGL2 path tracer, the rendering
equation lighting up beside it, photon mode, attract mode), **Decades** (the same
scene from flat 1993 colors to path-traced global illumination), **16 ms** (spend
a frame-time budget on effects) and **Mirrors** (a laser puzzle on a path-traced 3D optical bench). Hosted on
GitHub Pages, works offline (planned, OPS-003). Targets: Intel MacBook + iPad.
Booth is staffed (presenter narrates); clean, bright visual style; English; no
explanatory text on screen, only readouts.

This is the roadmap index. Tasks do not live in this file — each is a structured
`<!--task ... -->` block living in one of the linked area docs under `roadmap/`.
Run `python scripts/plans_lint.py` to validate all task headers and print the
next actionable tasks (todo tasks whose deps are all done).

## Phases

| Phase | Goal | Tasks |
|---|---|---|
| 0 — Spike | Prove a WebGL2 path tracer runs well on iPad + Intel Mac | OPS-001, OPS-002, RND-001 |
| 1 — Core renderer | Accumulation, materials, bounces, adaptive scale, picking, capture | RND-002..007 |
| 2 — Interactions | Bounces/samples, materials, light, photon mode, camera | INT-001..005 |
| 3 — Equation & idle | Layout, live equation, idle mode (careers strip removed, presenter panel dropped) | UI-001..004 |
| 4 — Ship | PWA/offline | OPS-003 |
| 5 — Booth hardening | Robustness, device soak test, setup checklist | BOOTH-001..003 |
| 6 — Stations | Tab bar + Decades slider, 16 ms challenge, Mirrors puzzle | STN-001..007 |
| 7 — Meshes | Stanford bunny and dragon plus three characters (Spot, Bob, Blub) in Light Lab | MSH-001..005 |
| Stretch | Match-the-target game | INT-S1 |

## Task block schema

```
<!--task
id: AREA-001
status: todo|doing|blocked|done
epic: <slug>
deps: [ID, ID]
cl: <commit hash, required when status: done>
blocked_by: <text, required when status: blocked>
-->
### AREA-001 — Title

Body: what / why / scope.
Verify: how to confirm it's actually done (a command, a measurement, a screenshot).
```

Invariants (enforced by `scripts/plans_lint.py`): ids unique and matching
`^[A-Z]+-[A-Z0-9]+$`; `done` requires a non-empty `cl`; `blocked` requires
`blocked_by`; every `deps` entry must reference an id that exists somewhere
in the roadmap.

## Status rollup

| Area | Doc | Active (todo) | Done | Notes |
|------|-----|----------------|------|-------|
| Renderer | [renderer.md](roadmap/renderer.md) | 4 | 5 | Scene/materials/bounces + CPU picker done (RND-003/004/006); light sampling with MIS (RND-008, ~25x fewer samples for the same noise) and an edge-aware denoiser (RND-009) done; RND-001 still needs iPad + Intel Mac numbers |
| Interaction | [interaction.md](roadmap/interaction.md) | 1 | 8 | All v1 interactions done (INT-001..007, incl. All-samples view and photon first-person view); INT-008 pixel pick with material bar and BRDF lobe; only stretch INT-S1 remains |
| UI, Equation & Idle | [ui.md](roadmap/ui.md) | 0 | 5 | All done (UI-001..005); careers strip (UI-005) later removed and presenter panel (UI-006) dropped by user: no explanatory text, presenter explains onsite. Debug HUD only with ?debug |
| Deploy & Booth | [deploy.md](roadmap/deploy.md) | 4 | 2 | OPS-001/002 done; live on GitHub Pages (project URL redirects to the account's custom domain); offline PWA mandatory |
| Stations | [stations.md](roadmap/stations.md) | 0 | 9 | Chosen 2026-10-15: shell + tab bar (STN-001) feature shading/era presets (STN-002) Decades (STN-003), 16 ms challenge (STN-004) optics engine (STN-005), Mirrors puzzle (STN-006) and cross-station pass (STN-007) done: all of Phase 6 built; Decades and 16 ms share a feature-flag shader; Mirrors is a path-traced 3D optical bench (STN-008) driven by the 2D optics engine; attract mode stays Light Lab only. 2026-10-23: Decades and 16 ms tabs removed at the user's request (code kept, unwired); Water tab added (STN-009, 2D FLIP fluid) |
| Meshes | [mesh.md](roadmap/mesh.md) | 0 | 5 | Six models in Light Lab: balls, Stanford bunny and dragon, and Keenan Crane's Spot, Bob and Blub with baked texture colors (CC0); BVH + shader walk + CPU picking; iPad speed unmeasured (RND-005 advised) |

Completed history: [completed.md](roadmap/completed.md)

## Next actionable

**RND-001 (iPad spike)**: open the live Pages URL on the
iPad and Intel MacBook, and record the HUD numbers in renderer.md. The spike is the single biggest risk:
if iPad Safari can't render to float targets or the shader is too slow on an
Iris iGPU, renderer decisions change before any UI is built on top.

## Recent merges

_None yet._

Per-commit review: `git show <CL>`. For a merge commit `<merge>`, the branch's
full diff is `git diff <merge>^1 <merge>^2` and its commits are
`git log <merge>^1..<merge>^2 --oneline`.

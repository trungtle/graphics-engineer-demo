# Light Lab — Roadmap

An interactive, single-screen web app for high-school students at a career
fair: a live WebGL2 path tracer (Cornell box) that students poke at with touch
controls while the **rendering equation** beside it lights up the term they're
affecting. Idle/attract mode catches passers-by. Hosted on GitHub Pages,
works offline. Targets: Intel MacBook + iPad. Booth is staffed (presenter
narrates); clean, bright visual style; English.

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
| 3 — Equation & idle | Layout, live equation, idle mode, careers (presenter panel dropped) | UI-001..005 |
| 4 — Ship | PWA/offline | OPS-003 |
| 5 — Booth hardening | Robustness, device soak test, setup checklist | BOOTH-001..003 |
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
| Renderer | [renderer.md](roadmap/renderer.md) | 4 | 3 | Scene/materials/bounces + CPU picker done (RND-003/004/006); cpu.ts must mirror shaders.ts on desktop GPU; RND-001 still needs iPad + Intel Mac numbers (float-buffer format pending) |
| Interaction | [interaction.md](roadmap/interaction.md) | 1 | 7 | All v1 interactions done (INT-001..007, incl. All-samples view and photon first-person view); only stretch INT-S1 remains |
| UI, Equation & Idle | [ui.md](roadmap/ui.md) | 0 | 5 | All done (UI-001..005); presenter panel UI-006 dropped by user. Debug HUD only with ?debug |
| Deploy & Booth | [deploy.md](roadmap/deploy.md) | 4 | 2 | OPS-001/002 done; live at www.trungtuanle.com/graphics-engineer-demo/ (account custom domain redirect); offline PWA mandatory |

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

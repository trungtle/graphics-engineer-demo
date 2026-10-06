# Renderer — Roadmap

Nothing built yet. The renderer is a progressive path tracer in a single WebGL2
fragment shader: analytic scene (spheres + axis-aligned boxes + a quad area
light) in a Cornell box, one sample per pixel per frame accumulated into a
float texture, displayed with tonemapping. It must stay interactive (~30 fps of
accumulation passes) on an **Intel MacBook (Iris iGPU)** and an **iPad
(Safari)** — those two are the only target devices and the weaker one sets the
budget.

Phase 0 (RND-001) is a feasibility spike on the iPad *before* building UI on
top: if float render targets or shader loop costs are a problem there, the
architecture changes (half-float, lower bounce cap, lower render scale).

## Decisions

- **Raw WebGL2, no three.js** (2026-10-05): the path tracer is one fullscreen
  fragment shader; a scene-graph library adds weight without helping.
- **Analytic scene only** (2026-10-05): spheres, boxes, one rectangular area
  light. No meshes/BVH — keeps the shader small and fast on iGPUs, and the
  Cornell box is the canonical teaching scene.
- **Scene as uniforms** (2026-10-05): object transforms/materials live in a
  small uniform array so the UI can change them without recompiling shaders.
  Any change resets accumulation.
- **Max bounces = 8** (2026-10-05), slider 0–8. "0 bounces" means only directly
  visible emitters are shown.
- **Materials** (2026-10-05): diffuse (Lambert), mirror, glass (dielectric with
  Fresnel), rough metal, emissive. These map 1:1 to what students can tap.
- **Float buffer fallback** — pending RND-001 result: prefer RGBA32F
  (`EXT_color_buffer_float`); fall back to RGBA16F if unsupported on iPad.

## Tasks

<!--task
id: RND-001
status: doing
epic: spike
deps: [OPS-001]
cl:
-->
### RND-001 — Phase 0 spike: minimal WebGL2 path tracer on iPad + Intel Mac

Smallest possible path tracer (Cornell box, diffuse only, 4 bounces,
ping-pong accumulation) deployed to GitHub Pages and opened on both target
devices. Record: WebGL2 availability, `EXT_color_buffer_float` /
`EXT_color_buffer_half_float` support, ms per accumulation pass at full and
half resolution. Write findings into this doc's Decisions section.

Verify: numbers for both devices recorded in Decisions; a screenshot of the
converged image from each device in `img/rnd-001-ipad.png` and
`img/rnd-001-mac.png`.

<!--task
id: RND-002
status: todo
epic: core
deps: [RND-001]
cl:
-->
### RND-002 — Accumulation pipeline + tonemapping + sample counter

Ping-pong float targets, running-average accumulation, reset on any scene
change, ACES-ish tonemap + sRGB on display. Expose `samples` and
`raysTraced` (estimated: pixels × samples × average path length) to the UI.

Verify: still camera converges with no visible fireflies at 1k spp; changing
any uniform resets the counter to 0.

<!--task
id: RND-003
status: done
epic: core
deps: [RND-002]
cl: aa9aa52
-->
### RND-003 — Scene description + material set

Uniform-driven scene: Cornell box walls (red/green/white), 2–3 objects, one
area light. Implement diffuse, mirror, glass, rough metal and emissive BRDFs.
Light position, size and color come from uniforms.

Verify: one screenshot per material on the same object in `img/rnd-003-*.png`;
glass shows refraction + caustic hint; mirror reflects the colored walls.

<!--task
id: RND-004
status: done
epic: core
deps: [RND-003]
cl: aa9aa52
-->
### RND-004 — Bounce limit uniform (0–8)

Bounce count is a uniform so the slider works without recompiling. Russian
roulette only past the user-set cap's minimum of 3 so low-bounce views stay
exact.

Result: verified in-browser (RTX 4070 Ti): 8 bounces shows red/green bleed, mirror reflects walls, emissive sphere glows. Screenshot files deferred to RND-007 capture mode.

Verify (original): before/after pair `img/rnd-004-bounces-1.png` / `-bounces-8.png`
showing red/green color bleeding on the floor and ceiling at 8 bounces.

<!--task
id: RND-005
status: todo
epic: perf
deps: [RND-002]
cl:
-->
### RND-005 — Adaptive render scale

Measure GPU frame time (`EXT_disjoint_timer_query_webgl2` where available,
else rAF delta) and scale internal resolution between 0.35× and 1× to hold
~30 fps. Image upscaled to the canvas with linear filtering.

Verify: on the Intel Mac and iPad, frame rate stays ≥ 28 fps while orbiting;
chosen scale logged in the presenter panel.

<!--task
id: RND-006
status: done
epic: core
deps: [RND-003]
cl: 2f21e9c
-->
### RND-006 — CPU-side ray picker / path recorder

A TypeScript mirror of the shader's intersection code so the app can (a) find
which object a tap hits (material cycling, lamp dragging) and (b) record one
full light path from a tapped pixel for "Be a photon". Uses a seeded RNG so a
replayed path is deterministic. Must match the GPU scene exactly.

Result: `src/render/cpu.ts` (cameraRay, project, intersect, pick, recordPath, mulberry32) + 7 vitest tests (`npm test`). Parity with GPU checked: 280 sampled pixels, picker's left/right/lamp classification matched rendered colors, 0 mismatches. Normative: **any change to camera, room or materials in shaders.ts must be mirrored in cpu.ts.**

Verify (original): unit test — tapping the center of each object returns that object's
id; a recorded path's first hit equals the picked object.

<!--task
id: RND-007
status: todo
epic: tooling
deps: [RND-002]
cl:
-->
### RND-007 — Deterministic capture mode

`?capture=<preset>&spp=<n>` URL mode: fixed camera/scene preset, fixed seed,
renders exactly n samples, then exposes the canvas as a downloadable PNG (and
`window.__captureDone = true` for headless automation). Enables before/after
images and pixel-diff checks for the rest of the roadmap.

Verify: two captures of the same preset at the same spp are byte-identical on
the same machine.

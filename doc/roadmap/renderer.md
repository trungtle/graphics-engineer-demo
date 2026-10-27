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

Result: verified in-browser (desktop discrete GPU): 8 bounces shows red/green bleed, mirror reflects walls, emissive sphere glows. Screenshot files deferred to RND-007 capture mode.

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

<!--task
id: RND-008
status: done
epic: sampling
deps: [RND-003]
cl: 2c0cfc0
-->
### RND-008 — Light sampling with MIS

Requested 2026-10-27. Matte bounces already sampled cosine-weighted directions. Now each matte bounce also sends a shadow ray to a random point on a random ceiling lamp (next-event estimation). The two strategies are combined with the power heuristic, so a lamp found by a bounce is weighted against having been sampled directly. Glowing balls and walls are not light-sampled and keep weight 1. The shadow ray goes through the same single `scene()` call as the path (the loop alternates path rays and shadow rays, 18 iterations at most), so the shader still compiles quickly. Off for the Mirrors bench, which has no ceiling lamps. `?nee=0` or the n key turns it off for comparison.

Measured (desktop, 354x383, default scene): mean brightness after 3,000 samples is 0.34952 on and 0.34951 off, so it is unbiased. Error against a 3,000-sample reference at about 26 samples: 0.046 on vs 0.241 off, about 5x lower, the quality of roughly 25x more samples. Both run at the 240 fps display cap on the desktop GPU; the cost per sample on iPad is not measured yet. Photon mode and the all-samples view still show plain random-bounce paths (cpu.ts is unchanged): that is the idea being taught, and the GPU picture just gets there faster.

<!--task
id: RND-009
status: done
epic: denoise
deps: [RND-008]
cl: 044d08f
-->
### RND-009 — Denoiser

An edge-aware a-trous filter, a simple SVGF without the temporal part (`DENOISE_FRAG`).
- **Extra data:** the trace pass also writes, accumulated like the color, the normal and path distance of the first matte surface each pixel sees, looking through mirrors and glass, so reflections keep their edges. It also writes that surface's albedo and the second moment of the demodulated lighting.
- **Filter:** four passes with gaps of 1, 2, 4 and 8 pixels smooth the lighting divided by albedo, so textures stay sharp. They stop at edges in normal, distance and brightness.
- **Brightness tolerance:** 2x the pixel's noise, averaged over its 3x3 neighbors so that a pixel whose few samples all came out dark is still smoothed.
- **Fade-out:** the filter hands over to the raw picture between 8 and 96 samples, so the final image is exactly the path tracer's.
- **Toggle:** `?denoise=0` or the d key.

First version tuning (2026-10-27): five passes with a 4x brightness tolerance were too blurry; the user noticed. Measured after tuning (error against a 4,000-sample reference): 4 spp 0.026 vs raw 0.051, 16 spp 0.014 vs 0.026, 64 spp 0.010 vs 0.013, identical from 128 spp. At 2-3 spp the filter has more error than raw, though it looks smoother. The shader now compiles fresh in 1.16 s on the desktop (texture lookup and three outputs); check the iPad.

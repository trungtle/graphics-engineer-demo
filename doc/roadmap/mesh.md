# Meshes (Stanford bunny and dragon) — Roadmap

Requested 2026-10-16: Light Lab and Decades should be able to show the **Stanford bunny** and the **Stanford dragon** instead of the three balls. This is the first triangle-mesh work in the project: everything so far is analytic spheres.

## Facts (checked 2026-10-16)

- Source: the Stanford 3D Scanning Repository, https://graphics.stanford.edu/data/3Dscanrep/.
- Terms, from that page: please acknowledge the source; you may mirror or redistribute the models for free; not for commercial use without the lab's permission. The dragon also asks that it is not animated, morphed, put through Boolean operations or used to simulate destruction (the bunny is exempt). Our use (a free educational booth demo) fits; the credit goes in the README and these docs, not on screen (no explanatory text rule).
- Downloads: `bunny.tar.gz` (4.9 MB; includes the full 69,451-triangle reconstruction and lower-resolution versions) and `dragon_recon.tar.gz` (11 MB; includes lower-resolution versions of the dragon). Lower resolutions are used directly, no decimator needed.

## Decisions

- **Not downloaded or committed yet** (2026-10-16): needs the user's explicit yes (file names, source and sizes above). Only the small converted result goes into the repo, not the tarballs.
- **One BVH, built once in TypeScript** (2026-10-16): the same structure is uploaded to the GPU as float textures and walked by the CPU picker and photon recorder, so taps and photon paths hit exactly what is drawn (same rule as `cpu.ts` mirroring `shaders.ts`).
- **Mesh replaces the balls** (2026-10-16): a model picker (Balls, Bunny, Dragon) in Light Lab and Decades; with a mesh selected the scene has one model standing on the floor, tap-to-change-material still works on it.
- **Cost warning** (2026-10-16): triangle traversal in a fragment shader is much slower than three spheres, especially on an Intel iGPU and iPad, and the era feature mode shoots several extra rays (shadow, reflection, 6 for ambient occlusion). Adaptive render scale (RND-005) is a prerequisite for shipping this.

## Tasks

<!--task
id: MSH-001
status: done
epic: assets
deps: []
cl: 37274e7
-->
### MSH-001 — Get and convert the models

After the user approves the download: fetch the two tarballs into the scratchpad, take one resolution of each, scale and center them, compute smooth normals, quantize positions and normals, write compact binary files under `public/models/` (target under 1 MB each), keep the originals out of the repo. Add the required acknowledgement to the README and these docs.

Result (2026-10-16, user approved the download and chose the light versions): downloaded `bunny.tar.gz` (4,894,286 bytes) and `dragon_recon.tar.gz` (11,197,764 bytes) from graphics.stanford.edu into the scratchpad (not committed). Both tarballs contain ready-made lower resolutions as ASCII PLY, so no decimator was needed. Used `bun_zipper_res2` (8,171 vertices, 16,301 triangles) and `dragon_vrip_res4` (5,205 vertices, 11,102 triangles; the res3 version has 47,794). `scripts/convert-mesh.mjs` normalizes (largest dimension 1, centered on x and z, base at y = 0) and stores 16-bit quantized positions and 16-bit indices: `public/models/bunny.bin` 146,868 bytes, `dragon.bin` 97,878 bytes. `src/mesh.ts` loads them and computes smooth normals; `src/mesh.test.ts` (11 tests, 84 total) reads the real files. The bunny data has a few isolated vertices no triangle uses (harmless, tested to be under 1%). README credits Stanford as their terms ask. Bounding boxes: bunny 1.000 x 0.986 x 0.776, dragon 1.000 x 0.708 x 0.448. Higher resolutions can be made by rerunning the converter on res3 (dragon) or the 69,451-triangle bunny (needs 32-bit indices).

Verify (original): converted files load in a unit test (triangle count, bounding box, normals unit length); file sizes recorded here; credit present in README.

<!--task
id: MSH-002
status: todo
epic: bvh
deps: [MSH-001]
cl:
-->
### MSH-002 — BVH builder and GPU upload

TypeScript BVH build (median or binned SAH), flattened to arrays; upload nodes and triangles (positions and normals) as float textures; uniforms for the model transform. Unit tests: every triangle is in exactly one leaf, ray queries against the BVH agree with brute force on random rays.

Verify: tests pass; build time for the largest model recorded.

<!--task
id: MSH-003
status: todo
epic: shader
deps: [MSH-002]
cl:
-->
### MSH-003 — Shader traversal (path tracer and feature mode)

Stack-based BVH traversal in `shaders.ts` with ray-triangle intersection and interpolated normals, used by the path tracer and by the era feature shading (primary, shadow, reflection and ambient-occlusion rays). The sphere scene stays available.

Verify: a bunny render converges to a clean image; screenshot per era; frame time at several render scales recorded for desktop (iPad and Intel Mac numbers pending BOOTH-002).

<!--task
id: MSH-004
status: todo
epic: cpu
deps: [MSH-002]
cl:
-->
### MSH-004 — CPU picking and photon paths on the mesh

Mirror the traversal in `cpu.ts` so taps pick the mesh (material cycling) and photon mode and all-samples paths bounce off it exactly like the GPU. Include the mesh in `pick`, `recordPath`, `intersect`.

Verify: unit tests (first hit of a path equals the picked mesh; a CPU path and a shader-style trace agree on a sample of pixels, like the 280-pixel parity check before).

<!--task
id: MSH-005
status: todo
epic: ui
deps: [MSH-003, MSH-004, RND-005]
cl:
-->
### MSH-005 — Model picker in Light Lab and Decades

A three-way picker (Balls, Bunny, Dragon) in both stations, no text beyond the names; switching restarts accumulation; works with orbit, lamp drag, photon mode and attract mode (attract resets to Balls). Six-viewport overflow check with the picker.

Verify: overflow check clean; switching models 50 times keeps memory flat; each model works in photon mode and in each era.

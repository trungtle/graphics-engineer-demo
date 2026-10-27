# Meshes (Stanford bunny and dragon) — Roadmap

Requested 2026-10-16: Light Lab and Decades should be able to show the **Stanford bunny** and the **Stanford dragon** instead of the three balls. This is the first triangle-mesh work in the project: everything so far is analytic spheres.

## Facts (checked 2026-10-16)

- Source: the Stanford 3D Scanning Repository, https://graphics.stanford.edu/data/3Dscanrep/.
- Terms, from that page: please acknowledge the source; you may mirror or redistribute the models for free; not for commercial use without the lab's permission. The dragon also asks that it is not animated, morphed, put through Boolean operations or used to simulate destruction (the bunny is exempt). Our use (a free educational booth demo) fits; the credit goes in the README and these docs, not on screen (no explanatory text rule).
- Downloads: `bunny.tar.gz` (4.9 MB; includes the full 69,451-triangle reconstruction and lower-resolution versions) and `dragon_recon.tar.gz` (11 MB; includes lower-resolution versions of the dragon). Lower resolutions are used directly, no decimator needed.

## Decisions

- **Real textures instead of baked colors** (2026-10-27, user: the characters looked blurry): one color per vertex (2,930 for Spot) cannot hold the texture's detail. The converter (`--uv`) now writes `MSH3`: per-corner texture coordinates (16-bit over -0.25..1.25, since Spot's go slightly outside 0..1). The BVH keeps them in the six spare w's of each triangle's texels. The shader samples the original PNG (`public/models/<name>.png`, the full 1024 or 2048 pixel textures, 79-285 KB) with `textureLod`, and the CPU picker samples the same pixels (`sampleTexture`), so taps and photon paths see the same colors. Mesh files are now 123-298 KB.

- **Characters added** (2026-10-23, user asked for "something fun with characters" and approved the download): Spot (cow), Bob (rubber-duck float) and Blub (fish) from Keenan Crane's 3D Model Repository, CC0 (public domain, checked on the repository page and in the README inside each zip). Used the triangulated OBJs as they come (Spot 5,856 triangles, Bob 10,688, Blub 14,208). The converter bakes each texture into one sRGB color per vertex (bilinear samples averaged over a vertex's corners, in linear light) and writes the `MSH2` format (MSH1 plus 3 bytes per vertex). The BVH packs each corner's color into the spare w of its normal texel, and the shader and `intersectBvh` interpolate it and use it as the albedo (the tapped material still applies: a glass or gold cow works). Files: spot.bin 61,542 bytes, bob.bin 112,260, blub.bin 149,238. Placement: Spot and Bob turned toward the camera, Blub floats 0.25 above the floor. The picker is two rows of three in landscape and one row of six in portrait; six-viewport check clean (portrait rows changed to 57/43, and 55/45 under 1100 px tall).
- **Decades and 16 ms removed** (2026-10-23, user): the model picker now only has to live in Light Lab, which closes the Decades part of MSH-005.

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
status: done
epic: bvh
deps: [MSH-001]
cl: 3ff4195
-->
### MSH-002 — BVH builder and GPU upload

TypeScript BVH build (median or binned SAH), flattened to arrays; upload nodes and triangles (positions and normals) as float textures; uniforms for the model transform. Unit tests: every triangle is in exactly one leaf, ray queries against the BVH agree with brute force on random rays.

Verify: tests pass; build time for the largest model recorded.

Result (2026-10-16): `src/bvh.ts`, binned SAH (12 bins, leaves of up to 4 triangles), median splits near the depth limit so the tree never exceeds the shader's 32-entry stack. The model is placed in world space before the build (`MODEL_PLACEMENT` in mesh.ts: bunny scale 1.15 turned 0.5 rad toward the camera, dragon scale 1.6, both standing on the floor), so the shader needs no transform. Nodes are 2 texels, triangles 6 texels (v0, two edges, three normals) in 2048-wide RGBA32F textures. `src/bvh.test.ts` (12 tests): every triangle in exactly one leaf, children inside parents, depth within the stack, 300 random rays per model match brute force, max distance respected. Bunny plus dragon load and build in under 0.1 s in the browser.

<!--task
id: MSH-003
status: done
epic: shader
deps: [MSH-002]
cl: 3ff4195
-->
### MSH-003 — Shader traversal (path tracer and feature mode)

Stack-based BVH traversal in `shaders.ts` with ray-triangle intersection and interpolated normals, used by the path tracer and by the era feature shading (primary, shadow, reflection and ambient-occlusion rays). The sphere scene stays available.

Verify: a bunny render converges to a clean image; screenshot per era; frame time at several render scales recorded for desktop (iPad and Intel Mac numbers pending BOOTH-002).

Result (2026-10-16): `meshHit` in shaders.ts, a stack walk visiting the nearer child first, Moller-Trumbore triangles, interpolated normals that fall back to the flat normal when they disagree with the real surface about which side the ray is on (stops light leaking at silhouettes). It sits inside `scene()`, so the path tracer and the era feature shading both use it. The mesh wears object 0's color and material, so tap-to-change-material works unchanged. Desktop (RTX 4070 Ti, 717x621, 4 bounces): GPU 1.7 ms bunny, 1.8 ms dragon, 120 fps. Bunny in diffuse and glass and the dragon in gold metal converge cleanly. Era screenshots and iPad and Intel numbers are still to do.

<!--task
id: MSH-004
status: done
epic: cpu
deps: [MSH-002]
cl: 3ff4195
-->
### MSH-004 — CPU picking and photon paths on the mesh

Mirror the traversal in `cpu.ts` so taps pick the mesh (material cycling) and photon mode and all-samples paths bounce off it exactly like the GPU. Include the mesh in `pick`, `recordPath`, `intersect`.

Verify: unit tests (first hit of a path equals the picked mesh; a CPU path and a shader-style trace agree on a sample of pixels, like the 280-pixel parity check before).

Result (2026-10-16): `intersectBvh` in bvh.ts is a line-for-line copy of the shader walk; `cpu.ts intersect` uses it in place of the spheres when a model is shown (object 0), so `pick`, `recordPath` and photon mode follow the mesh. Checked in the browser: a tap on the dragon picks object 0. The parity test is covered by the brute-force agreement test; there is no separate pixel-parity check yet.

<!--task
id: MSH-005
status: done
epic: ui
deps: [MSH-003, MSH-004]
cl: b0fd583
-->
### MSH-005 — Model picker in Light Lab and Decades

A three-way picker (Balls, Bunny, Dragon) in both stations, no text beyond the names; switching restarts accumulation; works with orbit, lamp drag, photon mode and attract mode (attract resets to Balls). Six-viewport overflow check with the picker.

Verify: overflow check clean; switching models 50 times keeps memory flat; each model works in photon mode and in each era.

Progress (2026-10-16, user asked for Light Lab): a Balls / Bunny / Dragon picker in the Light Lab panel. The picker turns on as soon as it is pressed, and the model loads on first use and stays cached. Old textures are freed on each switch. Attract mode and entering Decades or 16 ms reset the scene to the balls (`resetScene`), so Decades does not have a picker yet. The panel has no overflow at 1024x768. Done (2026-10-23): six models (Balls, Bunny, Dragon, Spot, Bob, Blub); Decades no longer exists, so Light Lab is the only place for the picker; six-viewport check clean. Not checked yet: iPad speed. RND-005 (adaptive render scale) is still advised before showing it on the iPad, but it no longer blocks this task.

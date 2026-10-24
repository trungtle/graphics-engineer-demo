# Stations (Phase 6) — Roadmap

More demos beyond the path-traced Light Lab, chosen by the user on 2026-10-15 from a brainstorm: **Decades slider**, **16 ms challenge**, **Mirrors puzzle**. Each is a "station" the student switches to with a tab. Light Lab (everything built so far) stays station one.

The first two stations share one renderer: the GL path tracer gains a set of on/off **shading features** (lighting model, shadows, reflections, ambient occlusion, global illumination). The Decades slider is a series of presets of those features (1990s flat colours up to path-traced global illumination); the 16 ms challenge lets the student turn features on one by one against a frame-time budget. The Mirrors puzzle is separate: a 2D canvas optics game that needs no WebGL.

## Decisions

- **Water station added** (2026-10-23, user: "a new tab, running fluid simulation in a tank"): a 2D FLIP simulation on the CPU drawn on a 2D canvas (no GL). It runs on any device and needs no second GL context. Interactions: drag to stir with a ball, a tilt slider (the tank turns on screen and the water stays level), Splash, Reset. Views: Water, Particles, Grid. No explanatory text; readouts only.

- **Decades and 16 ms tabs removed** (2026-10-23, user): the app now has two stations, Light Lab and Mirrors. STN-002..004 stay recorded as done; their code is unwired but kept in the repo (delete it only if the user asks).

- **Mirrors is now a 3D optical bench** (2026-10-16, user: "full 3D version", `3708ed4`): the puzzle is drawn by the path tracer as a real tabletop: perforated steel optical table, chrome mirror slabs, glass prisms, hazard-striped walls, a steel laser with a glowing lens, a target puck, a large soft light overhead. The game logic stays the exact 2D engine (`optics.ts`, `levels.ts`); `src/bench.ts` turns the puzzle state into convex solids (planes), emissive beam cylinders and target pucks for the shader (`u_bench`), and `src/ui/bench.ts` handles touch by casting the finger ray onto the table plane, plus a 2D overlay for the turn handle, the selection outline and a soft beam glow. While a piece is dragged, frames are blended instead of restarted so the picture does not flash noisy; on release it converges cleanly. The old 2D canvas view (`ui/mirrors.ts`) is removed.
- **One complex level, one target, one thick rainbow ray** (2026-10-16, user): a single puzzle using two prisms (one turns the beam by total internal reflection, the other spreads it), four mirrors and two walls. White light is three beams with slightly different glass bend (1.45 / 1.5 / 1.55, widened on request for a stronger rainbow; still above 1.414 so every color reflects totally inside the first prism), so after the second prism it becomes one band of red, green and blue rather than three separate beams. The beam is drawn as a thin line (radius 0.016) and the camera looks almost straight down; the overhead light panel sits well above the camera. The one target needs the whole ray (all three colors). Test-checked: unsolved at start, solvable, tolerant to 1 unit in any diagonal direction, every piece needed.
- **Render resolution** (2026-10-16): the path tracer now renders at CSS-pixel resolution by default (scale = 1 / devicePixelRatio, override with `?scale=`), 2-4x fewer pixels on retina screens and iPads; overlays stay sharp.

- **Mirrors puzzle redesign** (2026-10-16, user feedback, `8b16600`): the pieces were hard to tell apart (mirror, beam and target were all thin white-gray). Now: laser = steel body with a glowing lens; beam = one gold laser with bloom and a flare at each turn (dispersion into a rainbow dropped for readability); mirror = chrome bar with a highlight streak and shadow; prism = bevelled glass with a glare strip; target = red-and-white bullseye with a slow attention ring, turning green with a check mark when lit; walls = steel with hazard stripes. No text labels. Pieces that are part of the puzzle are locked and show a padlock.
- **Ramp** (2026-10-16, user feedback: high-school students, introduce the prism at level 1): six levels. 1 Meet the pieces (locked prism turns the beam, the player places one mirror), 2 Glass and mirror (both free, with a wall), 3 Two turns, 4 Over the wall, 5 Prism relay (two prisms), 6 Zigzag (four mirrors, two walls). Every level is test-checked: unsolved at the start, solvable, tolerant to about 1 unit of sloppiness.
- **Reset** (2026-10-16, user feedback): a Start over button returns to level 1 with no progress; Reset restarts the current level; attract mode resets the puzzle to level 1 for the next student (`Station.onReset`, `stations.resetAll()`).

- **Switching** (2026-10-15, user): a bottom tab bar, always visible, one tab per station. The bar is hidden while only one station is registered.
- **Frame cost in the 16 ms challenge** (2026-10-15, user): a *modeled* cost table on a fictional console, identical on every device (for example shadows +3 ms, reflections +5 ms, global illumination +8 ms). Not measured GPU time, and presented as game-style numbers. Over budget makes the picture visibly stutter.
- **Attract mode** (2026-10-15, user): unchanged. When it starts it switches to the Light Lab tab and plays the existing show; no per-station idle loops.
- **One GL context, one canvas** (2026-10-15): stations that need the path tracer take the shared `#viewport` element (canvas, overlay) into their own slot instead of creating more contexts (iPad memory). The render loop pauses while the canvas is hidden.
- **Same text rule as before** (2026-10-06): no explanatory text; readouts only (year label, milliseconds, fps, level number).

## Tasks

<!--task
id: STN-001
status: done
epic: shell
deps: []
cl: c95a608
-->
### STN-001 — Station shell: tab bar, registry, shared viewport

`.station` containers inside `#app`, a bottom `#tabs` bar built from a registry (`src/stations.ts`), `show(id)` swaps visibility, moves the shared `#viewport` into the active station's slot, and calls enter/leave hooks. Layout rules move from `#app` to `.station`. The render loop skips frames while the canvas is hidden. Attract mode switches to Light Lab when it starts. Bar hidden with one station.

Result: `src/stations.ts` (registry, tab bar, viewport re-parenting, enter/leave hooks), `.station` containers and `#tabs` in index.html, layout rules moved from `#app` to `.station`, render loop skips frames while the canvas is hidden, attract mode calls `stations.show('light')` on start. Tab bar hidden with one station and then leaves no gap (canvas 905x779 at 1440x900, identical to before). Verified with a dummy second station registered from the console: tabs appear, canvas moves slot to slot, back to Light Lab restores it, attract mode switches to Light; no scroll or panel overflow at 1440x900, 1180x820, 1024x768, 820x1180, 768x1024 with the tab bar showing (tab bar is 48 px). Dev hook: `window.lightlab.stations`.

Verify (original): registering a second station from the console shows the tabs, switching moves the canvas with no resize glitch, Light Lab behaves exactly as before, six-viewport overflow check still clean with the tab bar showing.

<!--task
id: STN-002
status: done
epic: shading
deps: [STN-001]
cl: dc68f11
-->
### STN-002 — Shading features in the shader (presets)

Add feature flags to the trace shader: lighting model (flat, Lambert point light, Phong), hard shadows, reflections, ambient occlusion (cheap), and global illumination (the existing path tracer). Non-GI modes are deterministic and do not accumulate (blend weight 1, no noise). A preset table maps era steps to flag sets. Picking and photon mode keep working in GI mode.

Result: shader uniforms `u_mode/u_model/u_shadows/u_reflect/u_ao/u_aa` (feature mode = a point light at the lamp, hard shadow ray, one reflection bounce on mirror/metal/glass, 6-ray fake ambient occlusion, 4-sample anti-aliasing; deterministic, replaces the picture every frame, blend weight 1), `src/shading.ts` (Shading type, ERAS presets 1993/1997/2004/2012/Today, `includes`) + 3 tests (27 total), main.ts `shading` state with `lightlab.setShading`. The Today preset is the unchanged path tracer. Screenshots: [1993](img/stn-002-1993-flat.jpg) [1997](img/stn-002-1997-lit.jpg) [2004](img/stn-002-2004-shadows.jpg) [2012](img/stn-002-2012-reflections.jpg). Lamp size only changes the picture in the Today era (point light before that), which is itself the lesson.

Verify (original): one screenshot per preset in `img/stn-002-*.jpg`; each preset renders identically across frames (no noise) except GI; unit test for the preset table (monotonic: each step only adds features).

<!--task
id: STN-003
status: done
epic: decades
deps: [STN-002]
cl: b0f39f5
-->
### STN-003 — Decades station

A big slider with year stops (1993, 1997, 2004, 2012, today) driving the presets, over the same scene. Orbit, lamp drag and tap-to-change-material still work. Readouts only: the year and a one-line era name.

Result: `src/ui/decades.ts` + `#st-decades` in index.html. Slider with five stops, big year readout and era name, years under the ticks. Entering resets the scene and starts at 1993; leaving to Light Lab restores the path tracer and resyncs its controls. Orbit, lamp drag and tap-to-change-material work in this station. Photon controls are hidden outside Light Lab (CSS on the shared viewport). `.station.compact` gives the picture the rest of the screen in portrait. Measured at 1440x900, 1180x820, 1024x768, 820x1180, 768x1024 with the tab bar: no scroll or overflow. Screenshot: [portrait](img/stn-003-decades-portrait.jpg). Real-finger iPad test pending (BOOTH-002).

Verify (original): dragging the slider changes the look at each stop; six-viewport overflow check; works with a finger on iPad (BOOTH-002).

<!--task
id: STN-004
status: done
epic: budget
deps: [STN-002]
cl: 884e825
-->
### STN-004 — The 16 ms challenge

Feature cards (lighting, shadows, reflections, ambient occlusion, global illumination, anti-aliasing) with modeled millisecond costs, a budget bar against 16.6 ms (60 fps), and a fps readout. Turning features on makes the picture prettier (a visible score); going over budget makes the picture stutter at the implied frame rate. Goal: the prettiest frame that still fits.

Result: `src/budget.ts` (pure rules, 9 tests: costs, dependencies, ray-traced lighting replacing the raster tricks, vsync snapping to 60/30/20 fps, brute-force best score per tier) + `src/ui/budget.ts` + `#st-budget`. Cost table (ms on Today's console, base 3.0): lighting 2, shine 1 (needs lighting), shadows 3.5 (needs lighting), reflections 4, ambient occlusion 2.5, smooth edges 1.5, ray-traced lighting 16 (replaces the rest). Console tiers Old x1.8, Today x1, Future x0.5. Points: 10/5/15/15/10/10, ray-traced 75. Designed outcome (verified): Today: not everything fits, the best is 60 points at 16.5 ms (everything except shine) and adding shine drops to 30 fps; Future: ray-traced lighting fits at 9.5 ms for 75; Old: even ray tracing alone is 34 ms (20 fps). UI: ms readout + budget bar with the 16.7 ms mark, fps pill (red when over), effect cards with live costs, tier selector, prettiness vs best (star when you hit the best at 60 fps), motion-test ball that only updates at the console's frame rate. Stutter is shown in the motion test, not the main picture, so ray-traced noise is not mistaken for judder. Layout: 3-column cards in portrait, tighter spacing on short landscape; no overflow at the five measured viewports. Screenshot: [over budget](img/stn-004-16ms-over-budget.jpg).

Verify (original): cost table unit-tested (sum, over-budget flag, best-possible score); stutter visibly starts above budget; six-viewport overflow check.

<!--task
id: STN-005
status: done
epic: mirrors
deps: []
cl: 2eba7a4
-->
### STN-005 — Optics engine (pure 2D)

Pure functions, no DOM: ray vs mirror segment (law of reflection), ray vs glass block or prism (Snell's law, total internal reflection), ray vs target, bounded bounce count, light path output as polylines. Fully unit-tested.

Result: `src/optics.ts` (reflect, refract with total internal reflection, criticalAngle, glass(polygon, auto counter-clockwise), traceBeam over mirrors, blockers, glass polygons and circular targets with a segment limit) + 11 tests (47 total): reflection angle, Snell's law through a slab and parallel exit, TIR beyond 41.8 degrees, a right-angle prism turning a beam 90 degrees, clockwise glass reordered, bounds/blocker/segment-limit endings, blocked target. Verify (original): tests for reflection angle, refraction angle and critical angle, a path that hits the target, a path that escapes.

<!--task
id: STN-006
status: done
epic: mirrors
deps: [STN-001, STN-005]
cl: dad77f4
-->
### STN-006 — Mirrors puzzle station

2D canvas game: a laser, a target, draggable and rotatable mirrors and glass prisms, about 6 levels, a win state when the beam reaches the target. Touch-first (big handles, no hover). The beam is drawn glowing, tinted like the lamp.

Result: `src/levels.ts` (5 levels: Bounce, Two turns, Over the wall, Glass corner, Glass and mirror; mirror and right-angle prism pieces; three beams with slightly different glass bend so white light can spread into colors) + `src/levels.test.ts` (20 tests, 67 total: every level not solved at the start, solvable with its listed solution, solution tolerant to about 1 unit of sloppiness, solution angles on the 15 degree snap) + `src/ui/mirrors.ts` (2D canvas: dark arena, glowing additive beams, laser, ringed targets that glow green when lit, selectable pieces, drag to move with half-unit snap, rotate handle with 15 degree snap, 22 px grab padding, progress dots, Reset, Next/Again). Verified with synthetic pointer drags: all five levels solved by moving and turning pieces (prism levels included); the dots fill and the last button becomes Again. No overflow or scroll at the six viewports with the tab bar. Screenshot: [level 5](img/stn-006-mirrors-level5.jpg). Real-finger iPad test pending (BOOTH-002).

Verify (original): every level is solvable (tested by solving each with the engine); drag and rotate work with synthetic pointer events; six-viewport overflow check.

<!--task
id: STN-007
status: done
epic: polish
deps: [STN-003, STN-004, STN-006]
cl: bc962f1
-->
### STN-007 — Cross-station polish and device pass

All stations at all six viewports, tab bar behaviour in attract mode, memory stays flat when switching stations repeatedly, docs and screenshots updated. Real-finger iPad pass tracked in BOOTH-002.

Result: switched stations 100 times (60 ms apart): JS heap 4.6 MB to 4.9 MB, 0 console errors or rejections; afterwards the Decades slider, the 16 ms cost readout, the Mirrors canvas and Light Lab (canvas back in its own slot, controls in sync) all work; starting attract mode while on Mirrors switches to Light Lab. Overflow and scroll checked at 1440x900, 1180x820, 1024x768, 820x1180 and 768x1024 for every station with the tab bar showing. Not done here (BOOTH-002): real-finger iPad pass, GPU cost of the feature shading (4x anti-aliasing, 6-ray ambient occlusion, shadow rays) on the Intel MacBook and iPad, 2 h soak.

Verify (original): switch stations 100 times with flat heap; no console errors; overflow check clean.

<!--task
id: STN-008
status: done
epic: mirrors
deps: [STN-006]
cl: 3708ed4
-->
### STN-008 — Mirrors as a path-traced 3D optical bench

See Decisions. `src/bench.ts` (+ `src/bench.test.ts`, 12 tests: coordinates, shader limits, solids per piece, plane orientation, the laser hitting the first prism at the right distance, white then colored beam segments joining up, target lit only when solved, camera framing the whole board at three aspect ratios, camera below the overhead light), shader `benchScene` (convex solids by planes, beam cylinders, target pucks, matte steel table with holes, studio environment), `main.ts` bench uniforms and blend-while-dragging, `src/ui/bench.ts` (touch on the table plane, turn handle, outline, beam glow). Verified in the browser: the full puzzle solved with real drag gestures on the table (all six pieces moved and turned) and the target lit; 240 fps and 5,000+ samples in about 20 s on the desktop GPU; no overflow at 1440x900, 1180x820, 1024x768, 820x1180, 768x1024. Screenshot: [solved bench](img/stn-008-bench-solved.jpg). iPad and Intel MacBook speed unmeasured (BOOTH-002).

Verify: as above.

<!--task
id: STN-009
status: done
epic: water
deps: [STN-001]
cl: ffd385f
-->
### STN-009 — Water: FLIP fluid in a tank

`src/fluid.ts` (`Flip`): particles plus a 72x45 staggered grid; each step moves the particles, separates them with a spatial hash, handles the walls and the stirring ball, transfers velocities to the grid, then runs 50 Gauss-Seidel pressure iterations with drift compensation, and transfers back with a FLIP ratio of 0.9. The tank starts as a dam break of 2,640 particles. Tests: 7 in `src/fluid.test.ts` (dam breaks and stays in the tank, nothing lost or blown up, volume kept within 15-25% after 10 s of sloshing, tilt moves the water to the low side, the ball pushes water away, splash, reset). The step takes 1.5 ms on the desktop CPU. `src/ui/fluid.ts` draws the water by splatting the particles into a 288x180 density image, thresholded smoothly and shaded deeper-darker with pale foam where the water is fast. The Particles view colors particles by speed; the Grid view shows the cells the solver treats as water. Ball speed is capped at 5 m/s so a flick splashes instead of exploding. The simulation runs only while the tab is shown, and attract mode resets it.

Verified (2026-10-23) on a stand-alone check page: in the browser pane, WebGL2 was unavailable after a GPU hang, so the full app could not start there. Verified there: stirring, tilt to 20 degrees, Splash, the Particles view, about 58 steps/s, and the panel fits at 1024x768 and 768x1024. Still to check: the tab inside the full app, iPad speed (BOOTH-002).

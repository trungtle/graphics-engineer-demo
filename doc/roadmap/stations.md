# Stations (Phase 6) — Roadmap

More demos beyond the path-traced Light Lab, chosen by the user on 2026-10-15 from a brainstorm: **Decades slider**, **16 ms challenge**, **Mirrors puzzle**. Each is a "station" the student switches to with a tab. Light Lab (everything built so far) stays station one.

The first two stations share one renderer: the GL path tracer gains a set of on/off **shading features** (lighting model, shadows, reflections, ambient occlusion, global illumination). The Decades slider is a series of presets of those features (1990s flat colours up to path-traced global illumination); the 16 ms challenge lets the student turn features on one by one against a frame-time budget. The Mirrors puzzle is separate: a 2D canvas optics game that needs no WebGL.

## Decisions

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
status: todo
epic: shading
deps: [STN-001]
cl:
-->
### STN-002 — Shading features in the shader (presets)

Add feature flags to the trace shader: lighting model (flat, Lambert point light, Phong), hard shadows, reflections, ambient occlusion (cheap), and global illumination (the existing path tracer). Non-GI modes are deterministic and do not accumulate (blend weight 1, no noise). A preset table maps era steps to flag sets. Picking and photon mode keep working in GI mode.

Verify: one screenshot per preset in `img/stn-002-*.jpg`; each preset renders identically across frames (no noise) except GI; unit test for the preset table (monotonic: each step only adds features).

<!--task
id: STN-003
status: todo
epic: decades
deps: [STN-002]
cl:
-->
### STN-003 — Decades station

A big slider with year stops (1993, 1997, 2004, 2012, today) driving the presets, over the same scene. Orbit, lamp drag and tap-to-change-material still work. Readouts only: the year and a one-line era name.

Verify: dragging the slider changes the look at each stop; six-viewport overflow check; works with a finger on iPad (BOOTH-002).

<!--task
id: STN-004
status: todo
epic: budget
deps: [STN-002]
cl:
-->
### STN-004 — The 16 ms challenge

Feature cards (lighting, shadows, reflections, ambient occlusion, global illumination, anti-aliasing) with modeled millisecond costs, a budget bar against 16.6 ms (60 fps), and a fps readout. Turning features on makes the picture prettier (a visible score); going over budget makes the picture stutter at the implied frame rate. Goal: the prettiest frame that still fits.

Verify: cost table unit-tested (sum, over-budget flag, best-possible score); stutter visibly starts above budget; six-viewport overflow check.

<!--task
id: STN-005
status: todo
epic: mirrors
deps: []
cl:
-->
### STN-005 — Optics engine (pure 2D)

Pure functions, no DOM: ray vs mirror segment (law of reflection), ray vs glass block or prism (Snell's law, total internal reflection), ray vs target, bounded bounce count, light path output as polylines. Fully unit-tested.

Verify: tests for reflection angle, refraction angle and critical angle, a path that hits the target, a path that escapes.

<!--task
id: STN-006
status: todo
epic: mirrors
deps: [STN-001, STN-005]
cl:
-->
### STN-006 — Mirrors puzzle station

2D canvas game: a laser, a target, draggable and rotatable mirrors and glass prisms, about 6 levels, a win state when the beam reaches the target. Touch-first (big handles, no hover). The beam is drawn glowing, tinted like the lamp.

Verify: every level is solvable (tested by solving each with the engine); drag and rotate work with synthetic pointer events; six-viewport overflow check.

<!--task
id: STN-007
status: todo
epic: polish
deps: [STN-003, STN-004, STN-006]
cl:
-->
### STN-007 — Cross-station polish and device pass

All stations at all six viewports, tab bar behaviour in attract mode, memory stays flat when switching stations repeatedly, docs and screenshots updated. Real-finger iPad pass tracked in BOOTH-002.

Verify: switch stations 100 times with flat heap; no console errors; overflow check clean.

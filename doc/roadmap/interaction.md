# Interaction — Roadmap

The sandbox controls students actually touch. Everything is **touch-first**:
the strictest device is an iPad, so no hover states, tap targets ≥ 48 px, and
every gesture also works with a mouse on the MacBook. The booth is staffed, so
controls are props for a conversation — short labels, no paragraphs.

Each control is tied to a term of the rendering equation; when a student uses
it, the panel lights up that term (see [ui.md](ui.md), UI-003).

| Control | Equation term |
|---|---|
| Light color / size / position, emissive material | `L_e` |
| Material cycling | `f_r` |
| Bounces slider | `L_i` (recursion) |
| Samples / noise reset | `∫ … dω` (Monte Carlo) |
| Light at a slant (photon mode annotation) | `cos θ` |

## Decisions

- **Instructional toasts removed** (2026-10-06, user: presenter explains onsite): no text on material taps, lamp taps, view reset or photon-mode toggles; only photon and all-samples results appear in the caption bar. See ui.md.

- **Photon mode presentation** (2026-10-06, user feedback): the render is dimmed (display-shader exposure 0.22, eased in/out, so it costs nothing) so the photon reads as a glowing light; the photon and trail are additive glows tinted by the lamp color and the surfaces hit, and each hit lights up its spot. Pace is 0.75 s travel + 0.3 s dwell per segment (constants at the top of `src/ui/photon.ts`). No per-bounce text: the caption bar shows only 'Photon on its way' during flight and, at the end, 'Hit light' / 'Hit object' / 'Miss', the color this photon brings back and the pixel's color in the picture (3x3 average read from the float accumulation buffer, not the dimmed canvas), plus the found-the-lamp tally. 'Hit object' also covers running out of bounces on a surface.

- **Lamp power is constant as it resizes** (2026-10-06): radiance scales with (0.3/half)^2, so a bigger lamp gives softer shadows without getting brighter. Size range 0.12-0.42 half-width; lamp always clamped fully on the ceiling.
- **Camera is an orbit camera** (2026-10-06): yaw within +-0.5 rad, pitch -0.2..0.3, distance fixed. Shader gets camPos/right/up/fwd uniforms; cpu.ts `makeCamera` mirrors it. Orbit drag works on anything that is not the lamp; double-tap on the background resets (not in photon mode).

- **Explanations never overlay the render** (2026-10-06): all captions (material names, photon steps, hints) go in the caption bar directly under the picture (`#explain`, fixed height so the render does not resize). Controls call `ui.toast(title, text, ms)`, which now writes there and reverts to a hint afterwards.

- **Sandbox + hints, not a guided story** (2026-10-05): every control
  available at once; no Next buttons.
- **v1 interactions** (2026-10-05): bounces + samples, materials + light,
  Be a photon. Match-the-target game is a stretch goal (INT-S1).
- **Tap an object = cycle its material** (2026-10-05): no separate material
  picker; the object itself is the button.

## Tasks

<!--task
id: INT-001
status: done
epic: controls
deps: [RND-004, UI-001]
cl: c818460
-->
### INT-001 — Bounces slider + samples readout

Big slider 0–8 with labelled stops ("only the lamp", "direct light",
"light bounces around"). Live samples count and "N billion rays traced"
counter, plus a **Restart** button that resets accumulation so the presenter
can show the noise clearing on demand.

Result: `src/ui/controls.ts` + styles. Slider (0-8, 40px thumb), live samples/rays counters, Restart. Keyboard 0-8 still works and syncs the slider. Screenshot: [8 bounces](img/int-001-bounces-8-landscape.jpg). Real-finger test on iPad still pending (BOOTH-002).

Verify (original): dragging to 0/1/8 visibly changes the image within one frame; counter
resets on restart; works with finger on iPad.

<!--task
id: INT-002
status: done
epic: controls
deps: [RND-006, UI-001]
cl: c818460
-->
### INT-002 — Tap object to cycle material

Tap an object in the render: it cycles diffuse → mirror → glass → metal →
glowing. Short toast names the material ("Glass — light bends through it").
Distinguish tap from drag (movement < 10 px, < 300 ms).

Result: tapping an object cycles its material and shows a toast. Decision: tapping a wall or background does nothing. Tested with synthetic pointer events: tap cycles, 30px drag and 500ms press do not, wall tap does not. iPad real-finger test pending (BOOTH-002).

Verify (original): each object cycles through all 5 materials on iPad and Mac; tapping a
wall does nothing (or cycles wall color — decide in implementation and record
it here).

<!--task
id: INT-003
status: done
epic: controls
deps: [RND-006, UI-001]
cl: bb4b091
-->
### INT-003 — Light controls: drag lamp, color, size

Drag the lamp along the ceiling with a finger; swatch row for color (warm
white, cool white, red, blue, purple); size slider (small = hard shadows, big
= soft shadows).

Result: lamp drag moves along the ceiling (grab offset kept, ceilingPoint ray-plane math), 5 color swatches, size slider (caption: small = sharp shadows, big = soft). All light `L_e`. Screenshot: [orbit + purple big lamp](img/int-003-orbit-purple-big-lamp.jpg). Shadow-softness before/after pair not captured (needs RND-007).

Verify (original): before/after `img/int-003-small-light.png` / `-big-light.png` showing
shadow softness change.

<!--task
id: INT-004
status: done
epic: photon
deps: [RND-006, UI-001]
cl: 1f297d4
-->
### INT-004 — "Be a photon" mode

Toggle photon mode, tap a pixel: the recorded path animates as a glowing line
overlay (2D canvas over the render, projecting 3D hit points), one bounce at
a time (~600 ms per segment), each bounce labelled with what happened
("hit red wall → picks up red", "reached the lamp!"). Paths that escape or
die are shown too. Tap again for a new random path from the same pixel.

Result: `src/ui/photon.ts` (overlay canvas, glowing animated path; superseded per-bounce captions and per-step equation highlights by the end-of-path result, see Decisions; the equation lights L_e for a hit on the lamp and the integral otherwise) + `cos` and `albedo` fields on PathSegment. 19 tests in total. Toggle button top-right of the picture; in photon mode taps do not change materials; any scene change clears the path and the tally. Screenshot: [img/int-004-photon-path.jpg](img/int-004-photon-path.jpg). Overlay is drawn in CSS pixels from the 3D hit points every frame, so it stays aligned at any render scale or window size.

**Finding (corrects the original criterion):** only ~5-7% of random paths reach the lamp (measured over 2000 seeds at several pixels, 2-8 bounces), not 'the common case'. Kept honest (no fake light shortcut): failed paths explain that most photons never find the lamp, which is why the picture starts noisy, and a running tally ('N of M photons found the lamp') is shown. A test asserts the 2-30% band.

Verify (original, partly superseded): path endpoints land on the visible surfaces in the image (no misalignment at any render scale); the 'reaches the light is common' part was wrong, see finding.

<!--task
id: INT-005
status: done
epic: camera
deps: [RND-002]
cl: bb4b091
-->
### INT-005 — Camera orbit (drag on empty space) + reset

One-finger drag on the background orbits the camera within a limited arc
(the Cornell box has an open front — keep the camera in front of it).
Double-tap resets the view. Used by idle mode too (UI-004).

Result: orbit via drag, clamped, double-tap reset; 4 new tests (orbit consistency of pick/project, ceilingPoint inverse, lamp pick). Synthetic-event check: drag turns camera, huge drag clamps at limits, lamp drag does not move camera, tap on lamp does not move it, double-tap resets. Drag sensitivity 0.004 rad/px (125 px to the yaw limit).

Verify (original): cannot orbit to a view behind the walls; double-tap restores default.

<!--task
id: INT-S1
status: todo
epic: stretch
deps: [INT-001, INT-002, INT-003]
cl:
-->
### INT-S1 — Stretch: Match-the-target challenge

60-second game: show a target thumbnail, student adjusts material/light/
bounces to match. Score by perceptual diff of a low-res capture. Not in v1.

Verify: a matching configuration scores ≥ 90%; random configuration < 50%.

<!--task
id: INT-006
status: done
epic: photon
deps: [INT-004]
cl: 694c5c5
-->
### INT-006 — Photon mode: "All samples" view

Toggle in photon mode (top-left pill). Tap a pixel and 128 of its sample paths are traced at once and revealed over about 5.5 s: dead ends pile up as faint thin lines, the few that find the lamp glow in the lamp's color, the selected pixel is ringed. The caption keeps a running count and the running average color of the revealed paths, and at the end shows it next to the real pixel color from the picture and how many samples the renderer has taken there (e.g. '2 of 128 found the lamp (2%). Their average (113, 131, 94). Pixel in the picture (7,044 samples): (181, 183, 152)'). Color accumulation (user feedback, `82fe42c`): every path starts as the lamp's hue and takes on the tint of each surface it bounces off, segment by segment (dead ends faint, lamp-finders glowing); the selected pixel is drawn as an accumulator disc that fills with the running average color of the revealed paths, inside a ring showing the real pixel color it should converge to. Lights the integral term. Logic (`samplePaths`, `summarize`) is pure and tested, including that more samples vary less (Monte Carlo converges).

Verify: tests pass (23 total); live run shows the fan of paths, running caption and final caption. Screenshot: [img/int-006-all-samples.jpg](img/int-006-all-samples.jpg). 128 is a constant (`SAMPLES` in photon.ts), not all of the thousands the renderer took: the caption says how many the renderer took.

<!--task
id: INT-007
status: done
epic: photon
deps: [INT-004]
cl: 694c5c5
-->
### INT-007 — Photon's first-person view

While a single photon flies, a small inset (top-right under the Photon button, 4:3, labelled "Photon's view", toggle pill top-left) shows the box as the photon would see it, at full brightness while the main view is dimmed. Camera = the photon's position along the path, looking along its direction of travel, turning toward the next leg during each hit's dwell. Implemented as a second path-trace pass (shader uniforms `u_inside`, `u_th`, `u_blend`; display `u_off`) into a 160x120 target with 10 sample passes per frame and a short history blend (0.07) to keep noise down while moving; the display pass draws it into the inset rectangle with a scissor. The main-view path overlay is clipped so it never draws over the inset. Off in All-samples mode. Costs nothing when no photon is flying.

Verify: inset appears only during a photon flight and shows what the photon is looking at (e.g. the red wall close up). Screenshot: [img/int-007-photon-first-person.jpg](img/int-007-photon-first-person.jpg). Perf on iPad/Intel Mac still to be measured in BOOTH-002.


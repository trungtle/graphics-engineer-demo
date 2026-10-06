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
status: todo
epic: controls
deps: [RND-006, UI-001]
cl:
-->
### INT-003 — Light controls: drag lamp, color, size

Drag the lamp along the ceiling with a finger; swatch row for color (warm
white, cool white, red, blue, purple); size slider (small = hard shadows, big
= soft shadows).

Verify: before/after `img/int-003-small-light.png` / `-big-light.png` showing
shadow softness change.

<!--task
id: INT-004
status: todo
epic: photon
deps: [RND-006, UI-001]
cl:
-->
### INT-004 — "Be a photon" mode

Toggle photon mode, tap a pixel: the recorded path animates as a glowing line
overlay (2D canvas over the render, projecting 3D hit points), one bounce at
a time (~600 ms per segment), each bounce labelled with what happened
("hit red wall → picks up red", "reached the lamp!"). Paths that escape or
die are shown too. Tap again for a new random path from the same pixel.

Verify: path endpoints land on the visible surfaces in the image (no
misalignment at any render scale); path reaching the light is the common
case when tapping near the light.

<!--task
id: INT-005
status: todo
epic: camera
deps: [RND-002]
cl:
-->
### INT-005 — Camera orbit (drag on empty space) + reset

One-finger drag on the background orbits the camera within a limited arc
(the Cornell box has an open front — keep the camera in front of it).
Double-tap resets the view. Used by idle mode too (UI-004).

Verify: cannot orbit to a view behind the walls; double-tap restores default.

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

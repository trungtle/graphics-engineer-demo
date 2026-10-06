# UI, Equation & Idle Mode — Roadmap

The one-screen layout, the live rendering equation, idle/attract mode and the
careers strip. Visual style is **clean and bright**: light background, neutral
gray chrome, one saturated accent per equation term, generous whitespace,
large readable type from a couple of meters away. English only.

## Decisions

- **UI-006 hidden presenter panel dropped** (2026-10-06, user decision: not needed). Hooks that remain: `?debug` shows the device readout, `?idle=<seconds>` sets the attract-mode timeout (0 disables), `window.lightlab.idle.setTimeoutSeconds()`.

- **Attract mode design** (2026-10-06): `src/idle.ts`. Starts after 45 s of no input (`?idle=<seconds>` overrides, 0 disables; `window.lightlab.idle.setTimeoutSeconds` for the presenter panel to call). Big captions go in the caption bar under the picture (not over the render, per the explanations rule), with a pulsing 'Touch to play' tag. Show loop (~85 s): 1 stepped orbit (move, pause so the noise clears, repeat) with 'Every pixel here is a simulated ray of light'; 2 bounces 0 to 8 with the slider moving; 3 one ball becomes mirror, glass, glowing, matte; 4 lamp recolor/resize/move; 5 photon mode with two first-person photon flights; 6 'Movies spend hours on ONE frame', 'Your laptop just traced N billion rays' (rays since attract mode started), 'Tap to play'. Normal toasts are suppressed while idle. The scene is reset to defaults on entry and exit.
- **The waking input is swallowed** (2026-10-06): the pointerdown/keydown that ends attract mode, and its pointerup/click, never reach the app, so the first touch cannot change a material or press a button. Mouse jitter under 6 px does not wake it.

- **Compact layout rules** (2026-10-06): the controls card must fit at all six reference viewports with the longest term explanation open. Achieved by: no tick row under sliders, one-line captions, 36px-wide swatches (48px tall), tighter spacing in short landscape (max-height 860) and short portrait (max-height 1100) via media queries, portrait split 52/48. Any new control must re-run the six-viewport overflow check.

- **Layout** (2026-10-05): landscape = render left (~65%), panel right;
  portrait (iPad) = render top, panel below. Single screen, no scrolling, no
  routes.
- **Theme** (2026-10-05): clean and bright, not dark sci-fi. Each equation term
  gets its own accent color, reused on the controls that drive it.
- **Equation shown** (2026-10-05):
  `L_o = L_e + ∫ f_r · L_i · cos θ dω`, each term with a one-line plain-English
  caption. Rendered with HTML/CSS (or inline SVG) — no MathJax/KaTeX
  dependency unless typography needs it.
- **Idle timeout default 45 s** (2026-10-05), adjustable in the presenter panel.
- **Presenter panel** (2026-10-05): opened by triple-tap in the top-left corner
  (no visible button so students don't find it).

## Tasks

<!--task
id: UI-001
status: done
epic: layout
deps: [OPS-001]
cl: 16ea687
-->
### UI-001 — Responsive one-screen layout + design tokens

CSS grid layout for landscape/portrait, design tokens (colors per equation
term, type scale, spacing), touch target sizes. No page scroll at iPad
(1024×768 / 1180×820) or MacBook (1440×900, 1280×800) viewports.

Result: `index.html` + `src/style.css` (tokens: surface, per-term accents, type scale, spacing, 48px tap). Landscape grid 65/35; portrait stacks stage/panel/careers. Measured at 1440x900, 1280x800, 1180x820, 1024x768, 820x1180, 768x1024: no page scroll, panel not overflowing, equation on one line (sized via container query). Screenshots: [landscape](img/ui-001-landscape-1440x900.jpg), [portrait](img/ui-001-portrait-820x1180.jpg). Debug readout now hidden unless `?debug`.

Verify (original): screenshot at each listed viewport, both orientations on iPad, in
`img/ui-001-*.png`; no scrollbars.

<!--task
id: UI-002
status: done
epic: equation
deps: [UI-001]
cl: e675cc5
-->
### UI-002 — Rendering equation panel

The equation with color-coded terms and captions:
- `L_o` — the light you see from this spot
- `L_e` — light the surface gives off itself (lamps glow)
- `∫ … dω` — add up light from every direction (so we pick random ones → noise)
- `f_r` — the material: how it scatters light
- `L_i` — light arriving from elsewhere… which is this same equation again!
- `cos θ` — light hitting at a slant is spread thinner

Tap a term to expand a 1–2 sentence explanation.

Result: `src/ui/equation.ts`, buttons in index.html. Tap a term: it lights and its caption + 1-2 sentence explanation show for 9 s (screenshot: [img/ui-002-term-highlight.jpg](img/ui-002-term-highlight.jpg)). Sizing deviation from the original target: equation is sized to its card, so 32 px at 1440x900 landscape (36 px on iPad portrait), captions 16 px; the 40/18 px targets were not reachable in one row at a 35% panel. Revisit if the booth screen is viewed from far away (could widen the panel).

Verify (original): readable from ~1.5 m on the MacBook screen (body ≥ 18 px, equation
≥ 40 px); all terms tappable on iPad.

<!--task
id: UI-003
status: done
epic: equation
deps: [UI-002, INT-001, INT-002, INT-003]
cl: e675cc5
-->
### UI-003 — Live term highlighting

When a control is used, its term pulses/glows in its accent color for ~2 s
(mapping table in [interaction.md](interaction.md)). Photon mode highlights
terms per bounce as the path animates (INT-004).

Result: wired via `initControls({onTerm})` and `eq.highlight()`. Measured: slider lights L_i, Restart lights the integral, tapping an object lights f_r (L_e when it becomes glowing); all clear after 2.5 s (tap-selected terms after 9 s). Photon-mode per-bounce highlighting is done in INT-004; lamp controls call highlight('le') (done in INT-003).

Verify (original): each control lights exactly its term; no term stays lit after 3 s of
inactivity.

<!--task
id: UI-004
status: done
epic: idle
deps: [INT-005, UI-002]
cl: 9cec387
-->
### UI-004 — Idle / attract mode

After the idle timeout: reset scene to default, start a slow scripted orbit
(each small move restarts accumulation so the noise → clean effect keeps
repeating), cycle scripted "moments" (bounces 0→8, glass sphere, colored
light), and show big rotating captions over the render:
"Every pixel is a simulated ray of light", "Movies spend hours on ONE frame",
"Your laptop just traced 2 billion rays", "Tap to play". Any touch/mouse/key
exits immediately into a clean default scene.

Result: verified with `?idle=4`: starts by itself after the timeout; the show loops through all six moments in order (yaw sweep 0 → 0.35 → -0.4 → 0.2 → 0, bounces 0..8 then 4, ball mirror/glass/matte, lamp colors, photon mode + first-person view, facts); a tap on a ball while idle wakes without cycling it (materials stay default, next tap cycles), a key press wakes without acting, 2-4 px jitter does not wake, a real move does; JS heap flat at 8-9 MB over a 40 s run. Screenshot: [img/ui-004-attract-orbit.jpg](img/ui-004-attract-orbit.jpg). The 2-hour memory soak still belongs to BOOTH-002.

Verify (original): leave untouched 45 s → attract mode starts; a single tap exits and the
scene is reset; runs 2 h without memory growth (checked in BOOTH-002).

<!--task
id: UI-005
status: done
epic: careers
deps: [UI-001]
cl: ce8ed8b
-->
### UI-005 — Careers strip

Compact strip at the bottom: "Graphics programmers build this for…" with
icons for games, movies/VFX, AR/VR, cars & simulation, medical imaging, GPU
companies; plus "The math you're learning now — vectors, trig, probability —
is the job." Also shown as one of the idle captions.

Result: `src/ui/careers.ts`. One 60 px strip: label 'Graphics programmers work on' (hidden under 900 px wide), 7 icon chips (games, movies and VFX, AR and VR, cars and simulators, medical imaging, GPU companies, the math) and one line of text for the selected chip, rotating every 4.5 s; tapping a chip pins it for 15 s. The math line is the seventh chip. Idle mode also shows 'Graphics programmers build this for games, movies, AR and VR, cars and medicine' and 'The math you're learning now is the job' as captions. Measured at all six viewports: no scroll, no overflow, text at most 2 lines. Screenshot: [img/ui-005-careers-strip.jpg](img/ui-005-careers-strip.jpg).

Verify (original): fits without scrolling in all UI-001 viewports.

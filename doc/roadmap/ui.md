# UI, Equation & Idle Mode — Roadmap

The one-screen layout, the live rendering equation, idle/attract mode and the
careers strip. Visual style is **clean and bright**: light background, neutral
gray chrome, one saturated accent per equation term, generous whitespace,
large readable type from a couple of meters away. English only.

## Decisions

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
status: todo
epic: layout
deps: [OPS-001]
cl:
-->
### UI-001 — Responsive one-screen layout + design tokens

CSS grid layout for landscape/portrait, design tokens (colors per equation
term, type scale, spacing), touch target sizes. No page scroll at iPad
(1024×768 / 1180×820) or MacBook (1440×900, 1280×800) viewports.

Verify: screenshot at each listed viewport, both orientations on iPad, in
`img/ui-001-*.png`; no scrollbars.

<!--task
id: UI-002
status: todo
epic: equation
deps: [UI-001]
cl:
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

Verify: readable from ~1.5 m on the MacBook screen (body ≥ 18 px, equation
≥ 40 px); all terms tappable on iPad.

<!--task
id: UI-003
status: todo
epic: equation
deps: [UI-002, INT-001, INT-002, INT-003]
cl:
-->
### UI-003 — Live term highlighting

When a control is used, its term pulses/glows in its accent color for ~2 s
(mapping table in [interaction.md](interaction.md)). Photon mode highlights
terms per bounce as the path animates (INT-004).

Verify: each control lights exactly its term; no term stays lit after 3 s of
inactivity.

<!--task
id: UI-004
status: todo
epic: idle
deps: [INT-005, UI-002]
cl:
-->
### UI-004 — Idle / attract mode

After the idle timeout: reset scene to default, start a slow scripted orbit
(each small move restarts accumulation so the noise → clean effect keeps
repeating), cycle scripted "moments" (bounces 0→8, glass sphere, colored
light), and show big rotating captions over the render:
"Every pixel is a simulated ray of light", "Movies spend hours on ONE frame",
"Your laptop just traced 2 billion rays", "Tap to play". Any touch/mouse/key
exits immediately into a clean default scene.

Verify: leave untouched 45 s → attract mode starts; a single tap exits and the
scene is reset; runs 2 h without memory growth (checked in BOOTH-002).

<!--task
id: UI-005
status: todo
epic: careers
deps: [UI-001]
cl:
-->
### UI-005 — Careers strip

Compact strip at the bottom: "Graphics programmers build this for…" with
icons for games, movies/VFX, AR/VR, cars & simulation, medical imaging, GPU
companies; plus "The math you're learning now — vectors, trig, probability —
is the job." Also shown as one of the idle captions.

Verify: fits without scrolling in all UI-001 viewports.

<!--task
id: UI-006
status: todo
epic: presenter
deps: [UI-001, RND-005]
cl:
-->
### UI-006 — Hidden presenter panel

Triple-tap top-left corner: idle timeout, quality cap (render scale max),
force idle now, reset everything, fps/scale/GPU info readout.

Verify: triple-tap opens it on iPad and Mac; settings persist across reload
(localStorage, guarded with try/catch).

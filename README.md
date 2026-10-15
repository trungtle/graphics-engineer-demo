# Light Lab

An interactive demo for high-school students at a career fair: how a computer paints with light. It runs in the browser (WebGL2, no server) and is hosted on GitHub Pages.

Four stations on one tab bar:

- **Light Lab**: a live path tracer. Change bounces, materials and the lamp, follow a single photon, trace all of a pixel's sample paths.
- **Decades**: the same scene from flat 1993 colors up to path-traced global illumination.
- **16 ms**: spend a frame-time budget on effects and stay at 60 fps.
- **Mirrors**: a laser puzzle with mirrors and glass prisms.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173/graphics-engineer-demo/
npm test         # unit tests
npm run build    # production build into dist/
```

The task tracker is in [doc/ROADMAP.md](doc/ROADMAP.md); `python scripts/plans_lint.py` checks it.

## Credits

The Stanford bunny and the Stanford dragon are from the [Stanford 3D Scanning Repository](https://graphics.stanford.edu/data/3Dscanrep/), Stanford Computer Graphics Laboratory. They are used here for free, non-commercial, educational purposes under the repository's terms (acknowledge the source; free redistribution; no commercial use without permission). The dragon is not animated, morphed or otherwise altered beyond resizing it and storing it in a compact file (`scripts/convert-mesh.mjs`), as the repository asks. The models in `public/models/` are reduced-resolution versions from that repository (`bun_zipper_res2` and `dragon_vrip_res4`).

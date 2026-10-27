# Light Lab

An interactive demo for high-school students at a career fair: how a computer paints with light. It runs in the browser (WebGL2, no server) and is hosted on GitHub Pages.

Four stations on one tab bar:

- **Light Lab**: a live path tracer. Change bounces, materials and the lamp, swap the balls for the Stanford bunny, the Stanford dragon or one of three characters (Spot, Bob, Blub), light it with one, two or three lamps, follow a single photon, trace all of a pixel's sample paths.
- **MIS**: Eric Veach's classic scene of glossy plates and round lamps, rendered with BSDF sampling, light sampling and multiple importance sampling side by side.
- **Water**: a FLIP fluid simulation in a tank (the particles-plus-grid method used for film water). Stir it, tilt it, splash it, and look at its particles and grid.
- **Mirrors**: a laser puzzle on a path-traced 3D optical bench: mirrors, glass prisms, and white light that glass spreads into a rainbow.

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

Spot, Bob and Blub are by Keenan Crane, from his [3D Model Repository](https://www.cs.cmu.edu/~kmcrane/Projects/ModelRepository/), released into the public domain (CC0). Their meshes are converted by `scripts/convert-mesh.mjs` (`spot.bin`, `bob.bin`, `blub.bin`) and their texture images are included unchanged (`spot.png`, `bob.png`, `blub.png`).

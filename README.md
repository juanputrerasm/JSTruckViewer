# JS Truck Viewer

A simple, pure browser javascript 3D viewer for **Monster Truck Madness 2** trucks. Drop in a `.POD` file from your MTM2 install (or point it at a CORS-enabled URL) and the viewer decodes the truck mesh, textures, and wheel placement entirely client-side — no server, no build step.

---

## Stack

| Layer | Technology |
|---|---|
| 3D rendering | [Three.js](https://threejs.org/) v0.169 (via CDN import map) |
| Controls | Three.js `OrbitControls` |
| Asset storage | [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (Origin Private File System) |
| Heavy parsing | [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) |
| Module system | Native ES modules (no bundler required) |
| Styling | Vanilla CSS |

---

## Getting started

OPFS and module workers require a proper HTTP origin — `file://` won't work. Serve the folder locally:

```bash
python3 -m http.server 8080
```

Then open:

```
http://localhost:8080/
```

Load a truck by clicking **Open from disk** and selecting any `.POD` file from your stock MTM2 install or downloaded add-on/mod, or paste a CORS-enabled URL into the URL field.

---

## Features

- Load `.POD` files from local disk or remote URL
- Multi-truck POD support — pick any truck from a dropdown when a POD contains multiple `TRUCK/*.TRK` manifests
- OPFS-backed per-session extraction (no files leak between sessions)
- `TRUCK/*.TRK` manifest parsing (truck name, model references, wheel anchors, scrape points)
- Static BIN mesh decoding — `BLOCK_MRGL_MAGNIFY` and `ANIMATED_BIN` formats
- `RAW` + `ACT` texture decoding with fallback palette support
- Full truck assembly: body, dual axle bars, four independently positioned wheels, scrape-point markers
- Viewer controls: texture toggle, wireframe toggle, wheel visibility, axle bar visibility, camera reset

---

## Project structure

```
index.html
styles.css
src/
  main.js              — entry point
  viewer-app.js        — UI controller
  viewer-scene.js      — Three.js scene, camera, part groups
  api.js               — staged POD loading orchestration
  worker-client.js     — promise wrapper around the Web Worker
  shared/
    opfs.js            — OPFS read/write helpers
    path-utils.js      — archive path normalization
  worker/
    truck-worker.js    — worker message handler
    pod-format.js      — POD archive indexing and entry extraction
    trk-parser.js      — TRK manifest text parser
    bin-decoder.js     — BIN mesh decoder (vertices, polygons, UVs)
    texture-decoder.js — RAW/ACT texture decoder → RGBA
    binary-reader.js   — low-level typed binary reader
```

---

## Known limitations

- No truck lighting, audio playback, or physics damage.
- Wheel variant selection is heuristic — when a prefix matches multiple BIN files (e.g. `RED8`, `RED10`, `RED16`) the highest-numbered (highest-poly) variant is used for all four wheel positions.
- Must be served over `http://localhost` or HTTPS; `file://` is not supported.

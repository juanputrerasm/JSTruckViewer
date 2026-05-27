# JS Truck Viewer

A simple, pure browser javascript 3D viewer for **Monster Truck Madness 2** (MTM2) trucks. Drop in a POD or ZIP file from your local storage, or point it at a CORS-enabled URL, and the viewer decodes the truck mesh, textures, and wheel placement entirely client-side.

---

## Stack

| Layer | Technology |
|---|---|
| 3D rendering | [Three.js](https://threejs.org/) v0.169 (via CDN import map) |
| Controls | Three.js `OrbitControls` |
| Asset storage | [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (Origin Private File System) |
| Heavy parsing | [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) |
| Module system | Native ES modules (no bundler required) |
| ZIP extraction | [fflate](https://www.npmjs.com/package/fflate) v0.8.2 (MIT) |
| Styling | Vanilla CSS |

---

## Getting started

OPFS and module workers require a proper HTTP origin, `file://` won't work. Serve the folder locally:

```bash
python3 -m http.server 8080
```

Then open:

```
http://localhost:8080/
```

Live deployment on GitHub Pages:

https://juanputrerasm.github.io/JSTruckViewer/

Load a truck by clicking **Open POD/ZIP from disk** and selecting a `.POD` file or a `.ZIP` that contains one or more POD files, or paste a CORS-enabled URL into the URL field. When a ZIP is loaded, the viewer extracts the first `.POD` entry and continues with the normal truck manifest rules.

---

## Features

- Load `.POD` files from local disk or remote URL
- Load `.ZIP` files from local disk or remote URL by extracting the first `.POD` entry
- Multi-truck POD support, pick any truck from a dropdown when a POD contains multiple `TRUCK/*.TRK` manifests
- OPFS-backed per-session extraction (no files leak between sessions)
- `TRUCK/*.TRK` manifest parsing (truck name, model references, wheel anchors, scrape points)
- Static BIN mesh decoding, `BLOCK_MRGL_MAGNIFY` and `ANIMATED_BIN` formats
- `RAW` + `ACT` texture decoding with fallback palette support
- Full truck assembly: body, dual axle bars, four independently positioned wheels, scrape-point markers
- Viewer controls: texture toggle, wireframe toggle, wheel visibility, axle bar visibility, camera reset

---

## Project structure

```
index.html
styles.css
src/
  main.js              - entry point
  viewer-app.js        - UI controller
  viewer-scene.js      - Three.js scene, camera, part groups
  api.js               - staged POD loading orchestration
  worker-client.js     - promise wrapper around the Web Worker
  shared/
    opfs.js            - OPFS read/write helpers
    path-utils.js      - archive path normalization
  worker/
    truck-worker.js    - worker message handler
    pod-format.js      - POD archive indexing and entry extraction
    trk-parser.js      - TRK manifest text parser
    bin-decoder.js     - BIN mesh decoder (vertices, polygons, UVs)
    texture-decoder.js - RAW/ACT texture decoder to RGBA
    binary-reader.js   - low-level typed binary reader
```

---

## Loading From URLs

The viewer can load archives from the page itself, or from query parameters. This makes it easy to host `JSTruckViewer` on a site and point it at a truck archive in another folder on the same domain.

Examples:

- Root-relative path on the same domain: `/JSTruckViewer/?file=/resources/trucks/truck.zip`
- Relative path from the viewer folder: `/JSTruckViewer/?file=../archives/truck.pod`
- Full URL: `/JSTruckViewer/?url=https://example.com/resources/trucks/truck.zip`

Notes:

- `?file=` and `?url=` are both supported.
- Relative URLs are resolved from the viewer page location.
- Root-relative URLs that start with `/` are usually the clearest choice for webmasters.
- Remote loading still uses browser `fetch()`, so cross-origin URLs must allow CORS.

When a ZIP is loaded, the viewer extracts the first `.POD` entry in the archive, stages it in OPFS, and then loads truck manifests from that staged POD.

---

## Known limitations

- No truck lighting, audio playback, or physics damage.
- Wheel variant selection is heuristic, when a prefix matches multiple BIN files (for example `RED8`, `RED10`, `RED16`) the highest-numbered, highest-poly variant is used for all four wheel positions.
- Must be served over `http://localhost` or HTTPS; `file://` is not supported.

---

## License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).

The project also uses the following third-party dependency:

- `fflate` - MIT License

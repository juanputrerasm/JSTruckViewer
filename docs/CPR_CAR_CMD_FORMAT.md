# CART Precision Racing CAR and CMD formats

This document describes the stock vehicle files in CART Precision Racing's `RACECAR.POD`.
The archive is POD1 and stores manifests under `VEHICLE/`, models under `MODELS/`, and
textures and palettes under `ART/`.

## CAR manifests

A `.CAR` is a line-oriented vehicle manifest related to the MTM1 `.TRK` format. Its body
model can be a high-detail `.CMD` or a `.BIN`. `tireModelName` is followed by four model
names in left-front, right-front, left-rear, right-rear order.

```text
truckName
Pac West Car
truckModelName
pacwest.cmd
tireModelName
fs16lf.bin
fs16rf.bin
fs16lr.bin
fs16rr.bin
```

The remainder contains the four wheel anchors, 12 scrape points, instrument cluster, three
sound names, helmet model and position, and pace-car fields. Six stock files spell the first
label `gtruckName`; readers need to accept both spellings.

## CMD high-detail models

A `.CMD` is a plain-text multipart model. The header names its low-detail BIN, the Z offset
that aligns that BIN with the detailed model, and one RAW material used by its parts.

```text
name
PacWest/Gugelman
lowDetailName
pacwestl.bin
lowDetailCenterZ
-123
material
PACWEST1.RAW
```

Part blocks continue until end of file:

```text
partName
RWING
vertexCount
32
faceCount
12
center
0,594,-1671
angle
0,0,0
vertexList
...
normalList
...
faceList
...
```

Every stock face is mapped type 41 (`0x29`) and has this layout:

```text
41,cornerCount
planeNormalX,planeNormalY,planeNormalZ,planeDistance
vertexIndex,u,v
...
```

Stock faces are triangles or quads. Positions and centers use 1/256-foot units, normals use
signed 16.16 components, and UVs use the BIN scale `0xff0000`. CMD coordinates are x=lateral,
y=up, z=forward. A local vertex becomes truck-space feet as follows:

```text
(vertex + part.center + [0, 0, lowDetailCenterZ]) / 256
```

The renderer then maps truck space to Three.js as `(x, y, -z)`. All stock part angles are
zero, so the units and order for non-zero rotations remain unknown.

The 28 stock CMDs each contain 30 named components. Some components share coincident faces;
the viewer deliberately preserves the part boundaries and does not deduplicate them because
they are likely significant to CPR's damage system.

CMD also contains two wing packages. The unsuffixed `LFWING`, `RFWING`, and `RWING` parts are
the larger road/street-course package; `LFWING1`, `RFWING1`, and `RWING1` are the lower
speedway/oval alternatives. The game selects a package from race setup state. Because the
standalone viewer has no track or setup context, it defaults to the unsuffixed road-course
parts. Its CPR-only wing selector can instead show the numbered speedway parts and the
speedway-only `SPDFIN`; the two packages are never drawn together.

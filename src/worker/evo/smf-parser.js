/*
  .SMF models for JSTruckViewer, in the same model shape the .BIN decoder produces so the scene
  needs no separate SMF path.

  Parsing is OpenPhotex's (parseSmf returns the model in Evo's own axes, as written). This
  adapter reshapes frame 0 into the viewer's model space:

    Evo is Y-up and in feet; this viewer's model space is Z-up and also in feet, the same space
    the .BIN decoder emits and the space the TRK's own anchors are read into. So the mapping is
    a straight axis swap: model (x, y, z) = Evo (x, z, y).

    That swap flips handedness, which is exactly what the scene wants: it draws truck meshes
    with THREE.BackSide because .BIN geometry is wound inward, so leaving the SMF winding
    untouched puts these faces on the same side. Normals are negated for the same reason -
    THREE.BackSide compiles FLIP_SIDED, which negates the vertex normal, so a normal handed
    over pointing inward comes out of the shader pointing outward.

    Evo's V runs top-down and the scene uploads its textures with flipY, so V is inverted here
    exactly as the .BIN path inverts its own.
*/
import { isSmfModel, parseSmf, smfTextureReference } from "../../vendor/openphotex/index.js";

export { isSmfModel };

export function decodeSmfModel(bytes, modelName) {
  const smf = parseSmf(bytes, modelName);
  const model = {
    name: modelName,
    format: "SMF",
    smfVersion: smf.fileVersion,
    lodEnabled: smf.lodEnabled,
    lodSwitchHeight: smf.lodSwitchHeight,
    vertexCount: 0,
    polygonCount: 0,
    vertices: [],
    meshes: [],
    textureNames: [],
    warnings: smf.warnings,
  };
  const textureNames = new Set();
  for (const group of smf.groups) {
    const { positions: p, normals: n, uvs: t } = group.frames[0];
    const faces = group.indices;
    const positions = new Float32Array(faces.length * 3);
    const normals = new Float32Array(faces.length * 3);
    const uvs = new Float32Array(faces.length * 2);
    for (let c = 0; c < faces.length; c++) {
      const v = faces[c];
      positions[c * 3] = p[v * 3];
      positions[c * 3 + 1] = p[v * 3 + 2];
      positions[c * 3 + 2] = p[v * 3 + 1];
      normals[c * 3] = -n[v * 3];
      normals[c * 3 + 1] = -n[v * 3 + 2];
      normals[c * 3 + 2] = -n[v * 3 + 1];
      uvs[c * 2] = t[v * 2];
      uvs[c * 2 + 1] = 1 - t[v * 2 + 1];
    }
    const textureName = smfTextureReference(group.material.textureName) ?? "";
    if (textureName) textureNames.add(textureName);
    // Kept flat across groups: the only consumer is the assembly's bounding-box helper, which
    // is shared with the .BIN path and does not care which group a vertex came from.
    for (let v = 0; v < group.vertexCount; v++) {
      model.vertices.push({ x: p[v * 3], y: p[v * 3 + 2], z: p[v * 3 + 1] });
    }
    model.vertexCount += group.vertexCount;
    const emitted = faces.length / 3;
    model.polygonCount += emitted;
    if (!group.visible || emitted === 0) continue;
    const [specular, specularLevel, shininess] = group.material.scalars;
    model.meshes.push({
      groupName: group.name,
      textureName,
      bumpTextureName: smfTextureReference(group.material.bumpTextureName) ?? "",
      positions,
      normals,
      uvs,
      color: 0xffffff,
      /*
        Only glass and light lenses carry the transparent flag - across both stock archives it
        never appears on a Body group - and the coverage behind it is a real 8-bit plane, the
        texture's .OPA companion or the second sample of its TIFF. So these ask the scene to
        blend rather than to alpha-test the way an MTM colour-keyed mesh does.
      */
      transparent: group.material.transparent,
      blend: group.material.transparent,
      reflective: group.material.reflective,
      solid: false,
      material: null,
      material2: null,
      lighting: { specular, specularLevel, shininess },
      objectVersion: group.objectVersion,
      frameCount: group.frameCount,
    });
  }
  model.textureNames = [...textureNames];
  return model;
}

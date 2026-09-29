import { applyOpacityPlane, decodeActPalette, decodeRawTexture, rawTextureSide } from "../../vendor/openphotex/index.js";
import { decodeTiffTexture, isTiff } from "./tiff-decoder.js";

/*
  4x4 Evolution texture decoding: indexed .RAW plus a same-stem .ACT palette and an optional
  .OPA opacity plane (Evo 1), or a .TIF (Evo 2).

  This does not reuse the viewer's decodeRawTexture, because two of that reader's rules are
  MTM rules that are wrong here:

    - MTM has no alpha anywhere, so transparency is a colour key: a texel whose palette entry
      is pure black is cut, everything else is opaque. Evo instead ships a real 8-bit opacity
      plane beside the texture, and Evo 2 puts a second sample inside the TIFF. Treating
      either as a binary key would harden every soft glass and light edge into a stencil.

    - MTM resolves one palette per track, with ART/METALCR2.ACT as the shared fallback. Evo
      resolves one per texture: all 149 .RAW textures in the stock Evo 1 TRUCK.POD have their
      own same-stem .ACT, and there is no archive-wide palette to fall back on.

  Evo .RAW images are square and unheadered, so the side comes from the byte count. The stock
  truck art uses four sizes - 64, 128, 256 and 512 - two of which the MTM reader rejects
  outright. An .OPA is one byte per pixel and is applied only when it has exactly as many
  bytes as the image has pixels, since a mismatch means the pairing was wrong rather than
  that the plane needs resampling.

  Decoded textures are tagged sourceFormat "EVO" so the scene keeps the alpha channel as
  authored instead of re-deriving it with the MTM colour key.
*/

/** Side length of a square 8-bit image with this many bytes, or 0 if there is none. */
export function evoRawSide(byteLength) {
  return rawTextureSide(byteLength, "evo");
}

/**
 * Decodes one Evo texture to RGBA.
 *
 * `sourceBytes` is either an indexed .RAW or a .TIF; `actBytes` is the .RAW's palette and
 * `opaBytes` its optional opacity plane. RAW/ACT/OPA decoding is OpenPhotex's; the TIFF path
 * stays here until TIFF is extracted too.
 */
export function decodeEvoTexture(sourceBytes, actBytes, opaBytes, textureName) {
  if (isTiff(sourceBytes)) {
    return applyOpacityPlane(decodeTiffTexture(sourceBytes, textureName), opaBytes);
  }

  const side = evoRawSide(sourceBytes?.length ?? 0);
  if (!side) throw new Error(`${textureName}: unsupported RAW size ${sourceBytes?.length ?? 0} bytes`);

  const palette = decodeActPalette(actBytes);
  if (!palette) throw new Error(`${textureName}: no usable .ACT palette`);

  const { width, height, rgba } = decodeRawTexture(sourceBytes, palette, { family: "evo" });
  return applyOpacityPlane({ name: textureName, width, height, rgba, sourceFormat: "EVO", hasAlpha: false }, opaBytes);
}

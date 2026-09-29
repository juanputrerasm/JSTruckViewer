/*
  Classic (MTM) .RAW textures.

  Decoding is OpenPhotex's (src/vendor/openphotex): the texture sizes the games use, the .ACT
  bit-depth rule and palette mapping. What stays here is the truck viewer's own behaviour: the
  METALCR2 fallback when no palette is found, and its colour-key plane.
*/
import { decodeActPalette, decodeRawTexture as decodeRaw } from "../vendor/openphotex/index.js";
import { METALCR2_PALETTE } from "../shared/metalcr2-palette.js";

export { decodeActPalette };

export function decodeRawTexture(rawBytes, actBytes, textureName) {
  let decoded;
  try {
    // Last resort when neither a same-name .ACT nor an archived METALCR2.ACT was found.
    decoded = decodeRaw(rawBytes, decodeActPalette(actBytes) ?? METALCR2_PALETTE);
  } catch {
    throw new Error(`Unsupported RAW size for ${textureName}: ${rawBytes.length} bytes`);
  }
  const { width, height, rgba } = decoded;
  /*
    MTM uses palette entry zero as its transparent colour key. Keep exact-black aliases
    transparent too: custom ACTs sometimes duplicate black elsewhere in the table. The scene
    applies this plane only to cutout materials.
  */
  const colorKeyAlpha = new Uint8Array(width * height);
  for (let i = 0; i < rawBytes.length; i += 1) {
    const o = i * 4;
    colorKeyAlpha[i] = rawBytes[i] === 0 || (rgba[o] === 0 && rgba[o + 1] === 0 && rgba[o + 2] === 0) ? 0 : 255;
  }
  return { name: textureName, width, height, rgba, colorKeyAlpha, sourceFormat: "RAW" };
}

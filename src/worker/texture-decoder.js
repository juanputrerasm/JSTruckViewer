import { METALCR2_PALETTE } from "../shared/metalcr2-palette.js";

const LEGACY_PALETTE_SIZE = 256 * 3;

export function decodeRawTexture(rawBytes, actBytes, textureName) {
  const palette = normalizePalette(actBytes);
  const width = rawBytes.length === 4096 ? 64 : rawBytes.length === 65536 ? 256 : 0;
  const height = width;
  if (!width) {
    throw new Error(`Unsupported RAW size for ${textureName}: ${rawBytes.length} bytes`);
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rawBytes.length; i += 1) {
    const colorIndex = rawBytes[i] * 3;
    const out = i * 4;
    rgba[out] = palette[colorIndex];
    rgba[out + 1] = palette[colorIndex + 1];
    rgba[out + 2] = palette[colorIndex + 2];
    rgba[out + 3] = 255;
  }
  return { name: textureName, width, height, rgba, sourceFormat: "RAW" };
}

// Last resort when neither a same-name .ACT nor an archived METALCR2.ACT was found.
function normalizePalette(bytes) {
  if (bytes && bytes.length >= LEGACY_PALETTE_SIZE) {
    return bytes.slice(0, LEGACY_PALETTE_SIZE);
  }
  return METALCR2_PALETTE.slice();
}

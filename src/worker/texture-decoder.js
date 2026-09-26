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
  const colorKeyAlpha = new Uint8Array(width * height);
  for (let i = 0; i < rawBytes.length; i += 1) {
    const colorIndex = rawBytes[i] * 3;
    const out = i * 4;
    const r = palette[colorIndex];
    const g = palette[colorIndex + 1];
    const b = palette[colorIndex + 2];
    rgba[out] = r;
    rgba[out + 1] = g;
    rgba[out + 2] = b;
    rgba[out + 3] = 255;
    // MTM uses palette entry zero as its transparent colour key. Keep exact-black aliases
    // transparent too: custom ACTs sometimes duplicate black elsewhere in the table.
    colorKeyAlpha[i] = rawBytes[i] === 0 || (r === 0 && g === 0 && b === 0) ? 0 : 255;
  }
  return { name: textureName, width, height, rgba, colorKeyAlpha, sourceFormat: "RAW" };
}

/*
  Reads a 256-entry .ACT into 8-bit RGB, or null when the bytes are not a usable palette.

  Adobe colour tables are 8-bit, but the .ACT files beside the MTM and Evo textures are
  routinely VGA-era 6-bit tables saved without rescaling. Nothing in the file distinguishes
  the two, so a table whose every component fits in 6 bits is treated as 6-bit and expanded;
  a genuine 8-bit table that happens to be that dark would only be scaled by 255/63, which is
  the same relationship, so the guess cannot wash out a real palette.
*/
export function decodeActPalette(actBytes) {
  if (!actBytes || actBytes.length < LEGACY_PALETTE_SIZE) return null;
  const raw = actBytes.subarray
    ? actBytes.subarray(0, LEGACY_PALETTE_SIZE)
    : actBytes.slice(0, LEGACY_PALETTE_SIZE);
  for (let i = 0; i < LEGACY_PALETTE_SIZE; i += 1) {
    if (raw[i] > 63) return raw.slice();
  }
  const expanded = new Uint8Array(LEGACY_PALETTE_SIZE);
  for (let i = 0; i < LEGACY_PALETTE_SIZE; i += 1) {
    expanded[i] = Math.round((raw[i] * 255 + 31) / 63);
  }
  return expanded;
}

// Last resort when neither a same-name .ACT nor an archived METALCR2.ACT was found.
function normalizePalette(bytes) {
  if (bytes && bytes.length >= LEGACY_PALETTE_SIZE) {
    return bytes.slice(0, LEGACY_PALETTE_SIZE);
  }
  return METALCR2_PALETTE.slice();
}

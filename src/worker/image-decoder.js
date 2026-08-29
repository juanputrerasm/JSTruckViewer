export async function decodeTrueColorTexture(bytes, name, format) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const kind = String(format ?? extensionOf(name)).toUpperCase();
  if (kind === "TGA") return decodeTga(source, name);
  if (kind !== "PNG") throw new Error(`Unsupported HD texture format: ${kind || "unknown"}`);
  if (!isPng(source)) throw new Error(`Invalid PNG ${name}: file signature does not match its extension`);
  return decodeBrowserImage(source, name, "image/png", "PNG");
}

async function decodeBrowserImage(bytes, name, mimeType, sourceFormat) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new Error(`${sourceFormat} decoding is not available in this browser worker`);
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not create image decode canvas");
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { name, width: bitmap.width, height: bitmap.height, rgba, sourceFormat };
  } finally {
    bitmap.close();
  }
}

export function decodeTga(bytes, name = "texture.tga") {
  if (bytes.length < 18) throw new Error(`Invalid TGA ${name}: header is truncated`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bitsPerPixel = bytes[16];
  const descriptor = bytes[17];
  if (colorMapType !== 0 || (imageType !== 2 && imageType !== 10)) {
    throw new Error(`Unsupported TGA ${name}: expected uncompressed or RLE true-color data`);
  }
  if (!width || !height || (bitsPerPixel !== 24 && bitsPerPixel !== 32)) {
    throw new Error(`Unsupported TGA ${name}: expected 24- or 32-bit pixels`);
  }
  const bytesPerPixel = bitsPerPixel / 8;
  let offset = 18 + idLength;
  const pixelCount = width * height;
  const decoded = new Uint8ClampedArray(pixelCount * 4);
  let pixel = 0;
  const readPixel = () => {
    if (offset + bytesPerPixel > bytes.length) throw new Error(`Invalid TGA ${name}: pixel data is truncated`);
    const b = bytes[offset++], g = bytes[offset++], r = bytes[offset++];
    const a = bytesPerPixel === 4 ? bytes[offset++] : 255;
    return [r, g, b, a];
  };
  const writePixel = (rgba) => {
    if (pixel >= pixelCount) throw new Error(`Invalid TGA ${name}: too many pixels`);
    decoded.set(rgba, pixel * 4);
    pixel++;
  };
  if (imageType === 2) {
    while (pixel < pixelCount) writePixel(readPixel());
  } else {
    while (pixel < pixelCount) {
      if (offset >= bytes.length) throw new Error(`Invalid TGA ${name}: RLE packet is truncated`);
      const packet = bytes[offset++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        const rgba = readPixel();
        for (let i = 0; i < count; i++) writePixel(rgba);
      } else {
        for (let i = 0; i < count; i++) writePixel(readPixel());
      }
    }
  }
  const topOrigin = !!(descriptor & 0x20);
  const rightOrigin = !!(descriptor & 0x10);
  const rgba = topOrigin && !rightOrigin ? decoded : reorient(decoded, width, height, topOrigin, rightOrigin);
  return { name, width, height, rgba, sourceFormat: "TGA" };
}

function reorient(source, width, height, topOrigin, rightOrigin) {
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const targetX = rightOrigin ? width - 1 - x : x;
      const targetY = topOrigin ? y : height - 1 - y;
      const sourceOffset = (y * width + x) * 4;
      output.set(source.subarray(sourceOffset, sourceOffset + 4), (targetY * width + targetX) * 4);
    }
  }
  return output;
}

function extensionOf(name) {
  const match = String(name ?? "").match(/\.([^.\\/]+)$/);
  return match?.[1] ?? "";
}

function isPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

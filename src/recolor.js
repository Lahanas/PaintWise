// Wall color preview: pick a wall in a photo by tapping it, then repaint it.
// Pure functions on ImageData-like objects ({ data, width, height }) so they can be tested in Node.

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Invalid color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Distance in YCbCr space. Brightness counts for less than hue, because the same
// wall is lighter near a window and darker in a corner but keeps its color.
function colorDistance(d, i, r, g, b) {
  const dr = d[i] - r;
  const dg = d[i + 1] - g;
  const db = d[i + 2] - b;
  const dy = 0.299 * dr + 0.587 * dg + 0.114 * db;
  const dcb = -0.1687 * dr - 0.3313 * dg + 0.5 * db;
  const dcr = 0.5 * dr - 0.4187 * dg - 0.0813 * db;
  return Math.sqrt(0.35 * dy * dy + dcb * dcb + dcr * dcr);
}

/**
 * Flood-select the region around (x, y) whose color is close to the tapped pixel.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @param {number} tolerance 0–100, higher grabs more
 * @param {Uint8Array} [mask] existing selection to add to
 * @returns {{mask: Uint8Array, added: number}}
 */
export function floodSelect(img, x, y, tolerance = 30, mask = new Uint8Array(img.width * img.height)) {
  const { data, width, height } = img;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return { mask, added: 0 };

  const seed = (y * width + x) * 4;
  const [sr, sg, sb] = [data[seed], data[seed + 1], data[seed + 2]];
  const maxFromSeed = 6 + tolerance * 1.1;
  // Also stop at sharp edges between neighbours (door frames, furniture outlines).
  const maxStep = 4 + tolerance * 0.35;

  const visited = new Uint8Array(width * height);
  const stack = [y * width + x];
  visited[y * width + x] = 1;
  let added = 0;

  while (stack.length) {
    const p = stack.pop();
    if (!mask[p]) {
      mask[p] = 1;
      added++;
    }
    const px = p % width;
    const py = (p - px) / width;
    const pi = p * 4;
    const neighbours = [
      px > 0 ? p - 1 : -1,
      px < width - 1 ? p + 1 : -1,
      py > 0 ? p - width : -1,
      py < height - 1 ? p + width : -1,
    ];
    for (const q of neighbours) {
      if (q < 0 || visited[q]) continue;
      const qi = q * 4;
      if (colorDistance(data, qi, sr, sg, sb) > maxFromSeed) continue;
      if (colorDistance(data, qi, data[pi], data[pi + 1], data[pi + 2]) > maxStep) continue;
      visited[q] = 1;
      stack.push(q);
    }
  }
  return { mask, added };
}

/**
 * Paint the selected pixels with `hex`, keeping the original light and shadows.
 * Writes into `out` (same size as `src`) and returns it.
 */
export function recolor(src, mask, hex, out = { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height }) {
  const [tr, tg, tb] = hexToRgb(hex);
  const d = src.data;
  const o = out.data;
  o.set(d);

  // Average brightness of the selected wall, so each pixel can keep its relative shading.
  let sum = 0;
  let count = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) {
      const i = p * 4;
      sum += luma(d[i], d[i + 1], d[i + 2]);
      count++;
    }
  }
  if (!count) return out;
  const avg = Math.max(1, sum / count);

  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const shade = Math.min(1.6, luma(d[i], d[i + 1], d[i + 2]) / avg);
    o[i] = tr * shade;
    o[i + 1] = tg * shade;
    o[i + 2] = tb * shade;
  }
  return out;
}

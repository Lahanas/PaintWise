// Measures a wall from a segmentation mask: a grid of class labels that the wall model
// produces for a photo (0 = other, 1 = wall, 2 = door, 3 = window).
//
// The photo has no sense of scale on its own, so we need one thing of known size:
//   - a door (standard doors are about 2.03 m / 80 in tall), or
//   - the ceiling height, typed in by the user.
// Everything else is pixel counting. It assumes the photo is taken roughly straight on.

export const CLASSES = { other: 0, wall: 1, door: 2, window: 3 };
export const STANDARD_DOOR_HEIGHT = 2.03; // metres (80 in)

/**
 * Resize a label grid with nearest-neighbour sampling (labels can't be blended).
 * The model works on a square image, so this also restores the photo's shape.
 * @param {ArrayLike<number>} labels
 * @param {number} w @param {number} h @param {number} outW @param {number} outH
 */
export function resizeLabels(labels, w, h, outW, outH) {
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / outH));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / outW));
      out[y * outW + x] = labels[sy * w + sx];
    }
  }
  return out;
}

/**
 * Connected regions (4-neighbour) of pixels whose label passes `test`.
 * Returns each region's pixel indices and bounding box, largest first.
 * @param {ArrayLike<number>} labels @param {number} w @param {number} h
 * @param {(label: number) => boolean} test
 * @param {Uint8Array} [allowed] optional mask: only pixels where allowed[i] is 1
 */
export function regions(labels, w, h, test, allowed) {
  const seen = new Uint8Array(w * h);
  const found = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !test(labels[start]) || (allowed && !allowed[start])) continue;
    const pixels = [];
    let minX = w, minY = h, maxX = -1, maxY = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      pixels.push(i);
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (n >= 0 && !seen[n] && test(labels[n]) && (!allowed || allowed[n])) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    found.push({ pixels, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } });
  }
  return found.sort((a, b) => b.pixels.length - a.pixels.length);
}

/**
 * Measure one wall.
 * @param {ArrayLike<number>} labels label grid with square pixels (see resizeLabels)
 * @param {number} w @param {number} h
 * @param {{ tap?: {x: number, y: number}, reference?: {kind: 'door'|'ceiling', height: number}, minOpening?: number }} [options]
 *   tap: a point on the wall to measure (grid coordinates); without it, the biggest wall is used.
 *   reference: what gives the scale, in metres. Defaults to a standard door.
 *   minOpening: ignore doors/windows smaller than this share of the wall (model noise).
 */
export function measureWall(labels, w, h, options = {}) {
  const { tap, reference = { kind: 'door', height: STANDARD_DOOR_HEIGHT }, minOpening = 0.01 } = options;
  const onWall = (c) => c === CLASSES.wall || c === CLASSES.door || c === CLASSES.window;

  // 1. The wall: wall pixels plus the doors and windows set into it.
  const all = regions(labels, w, h, onWall);
  if (!all.length) return { ok: false, reason: 'no-wall' };
  let wall = all[0];
  if (tap) {
    const i = Math.round(tap.y) * w + Math.round(tap.x);
    wall = all.find((r) => r.pixels.includes(i)) || wall;
  }
  const inWall = new Uint8Array(w * h);
  wall.pixels.forEach((i) => { inWall[i] = 1; });

  // 2. Doors and windows inside it, ignoring specks.
  const minPixels = wall.pixels.length * minOpening;
  const doors = regions(labels, w, h, (c) => c === CLASSES.door, inWall).filter((r) => r.pixels.length >= minPixels);
  const windows = regions(labels, w, h, (c) => c === CLASSES.window, inWall).filter((r) => r.pixels.length >= minPixels);

  // 3. Height of the wall in each column it covers. The median is robust to a sofa or a
  //    lamp hiding the bottom of a few columns.
  const columnHeights = new Map();
  for (const i of wall.pixels) {
    const x = i % w;
    columnHeights.set(x, (columnHeights.get(x) || 0) + 1);
  }
  const heights = [...columnHeights.values()].sort((a, b) => a - b);
  const wallHeightPx = heights[Math.floor(heights.length / 2)];
  const wallWidthPx = columnHeights.size;

  // 4. Scale: metres per grid pixel.
  let metresPerPixel;
  if (reference.kind === 'ceiling') {
    metresPerPixel = reference.height / wallHeightPx;
  } else {
    if (!doors.length) return { ok: false, reason: 'no-door' };
    const tallest = Math.max(...doors.map((d) => d.box.height));
    metresPerPixel = reference.height / tallest;
  }

  const area = (n) => n * metresPerPixel * metresPerPixel;
  const doorArea = area(doors.reduce((n, d) => n + d.pixels.length, 0));
  const windowArea = area(windows.reduce((n, d) => n + d.pixels.length, 0));
  // Walls are treated as rectangles (like everywhere else in PaintWise), so furniture
  // hiding the bottom of the wall doesn't shrink the area to paint.
  const grossArea = wallWidthPx * wallHeightPx * metresPerPixel * metresPerPixel;
  return {
    ok: true,
    width: wallWidthPx * metresPerPixel,
    height: wallHeightPx * metresPerPixel,
    grossArea,
    doorArea,
    windowArea,
    netArea: Math.max(0, grossArea - doorArea - windowArea),
    doors: doors.length,
    windows: windows.length,
    metresPerPixel,
    wallPixels: wall.pixels,
  };
}

const FT_PER_M = 3.28084;

/**
 * Add a measured wall (in metres) to the job: it goes into a "From photos" room with
 * custom walls, which is created the first time. Returns the new list of rooms.
 * @param {Array<any>} rooms
 * @param {{width: number, height: number, doors: number, windows: number}} wall
 * @param {'metric'|'imperial'} system
 */
export function addMeasuredWall(rooms, wall, system) {
  const f = system === 'imperial' ? FT_PER_M : 1;
  const round = (v) => Math.round(v * f * 100) / 100;
  const next = rooms.map((r) => ({ ...r }));
  let room = next.find((r) => r.fromPhotos);
  if (!room) {
    room = { name: 'From photos', fromPhotos: true, mode: 'walls', walls: [], doors: 0, windows: 0, includeCeiling: false };
    next.push(room);
  }
  room.walls = [...(room.walls || []), { width: round(wall.width), height: round(wall.height) }];
  room.doors = (Number(room.doors) || 0) + wall.doors;
  room.windows = (Number(room.windows) || 0) + wall.windows;
  return next;
}

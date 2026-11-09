// Runs the wall model (models/wall-seg.onnx) in the browser with ONNX Runtime Web.
// The model takes a 384 × 384 RGB photo and returns a class for every pixel
// (0 = other, 1 = wall, 2 = door, 3 = window). Nothing is uploaded: it all runs on the device.

export const MODEL_URL = 'models/wall-seg.onnx';
export const MODEL_SIZE = 384;
const ORT_VERSION = '1.20.1';
export const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

let sessionPromise = null;

/** Whether this site ships the model (it is optional, so the feature hides without it). */
export async function modelAvailable() {
  try {
    const res = await fetch(MODEL_URL, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Load ONNX Runtime and the model once; later calls reuse them. */
function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import(/* @vite-ignore */ `${ORT_BASE}ort.wasm.min.mjs`);
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = 1; // threads need special server headers; one is fast enough
      const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
      return { ort, session };
    })().catch((err) => {
      sessionPromise = null; // let the user try again (for example after a network error)
      throw err;
    });
  }
  return sessionPromise;
}

/**
 * Turn RGBA pixels (as in ImageData) into the model's input: three planes (R, G, B)
 * of values from 0 to 1.
 * @param {Uint8ClampedArray | Uint8Array} rgba
 * @param {number} pixels number of pixels
 */
export function toPlanes(rgba, pixels) {
  const out = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    out[i] = rgba[i * 4] / 255;
    out[pixels + i] = rgba[i * 4 + 1] / 255;
    out[2 * pixels + i] = rgba[i * 4 + 2] / 255;
  }
  return out;
}

/**
 * Label every pixel of a photo.
 * @param {ImageData} image
 * @returns {Promise<{labels: Uint8Array, size: number, ms: number}>} a MODEL_SIZE × MODEL_SIZE grid
 */
export async function segment(image) {
  const { ort, session } = await loadSession();
  const square = document.createElement('canvas');
  square.width = square.height = MODEL_SIZE;
  const sctx = /** @type {CanvasRenderingContext2D} */ (square.getContext('2d', { willReadFrequently: true }));
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  /** @type {CanvasRenderingContext2D} */ (source.getContext('2d')).putImageData(image, 0, 0);
  sctx.drawImage(source, 0, 0, MODEL_SIZE, MODEL_SIZE); // squash to a square, like in training
  const { data } = sctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
  const input = new ort.Tensor('float32', toPlanes(data, MODEL_SIZE * MODEL_SIZE), [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const start = performance.now();
  const output = await session.run({ image: input });
  return { labels: new Uint8Array(output.labels.data), size: MODEL_SIZE, ms: performance.now() - start };
}

// Saving several projects in the browser, and sharing a project as a link.
// A shared link carries the whole project in the URL (#p=...), so no server or account is needed.

const LIST_KEY = 'wpe:projects';

// ---------- share links ----------

function toBase64Url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Turn a project into a short URL-safe string. "z" = compressed, "j" = plain JSON. */
export async function encodeProject(project) {
  const json = new TextEncoder().encode(JSON.stringify(project));
  if (canCompress()) return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
  return 'j' + toBase64Url(json);
}

/** Read a project back from encodeProject's output. Returns null if the link is broken. */
export async function decodeProject(code) {
  try {
    const kind = code[0];
    let bytes = fromBase64Url(code.slice(1));
    if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (kind !== 'j') return null;
    const project = JSON.parse(new TextDecoder().decode(bytes));
    return isProject(project) ? project : null;
  } catch {
    return null;
  }
}

export function isProject(p) {
  return !!p && typeof p === 'object' && Array.isArray(p.rooms) && (p.system === 'metric' || p.system === 'imperial');
}

// ---------- saved projects ----------

function readList(storage) {
  try {
    const list = JSON.parse(storage.getItem(LIST_KEY));
    return Array.isArray(list) ? list.filter((p) => p && p.id && isProject(p.state)) : [];
  } catch {
    return [];
  }
}

function writeList(storage, list) {
  try { storage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** All saved projects, most recently updated first. */
export function listProjects(storage = globalThis.localStorage) {
  return readList(storage).sort((a, b) => b.updated - a.updated);
}

/** Save a project. Pass an id to overwrite it, or none to create a new one. Returns the saved entry. */
export function saveProject(name, state, id, storage = globalThis.localStorage) {
  const list = readList(storage);
  const entry = {
    id: id || newId(),
    name: (name || '').trim() || 'Untitled project',
    updated: Date.now(),
    state: JSON.parse(JSON.stringify(state)),
  };
  const i = list.findIndex((p) => p.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  writeList(storage, list);
  return entry;
}

export function deleteProject(id, storage = globalThis.localStorage) {
  writeList(storage, readList(storage).filter((p) => p.id !== id));
}

// Local server: serves the site and runs the /api routes the same way Vercel does,
// with a real Postgres running in-process (PGlite), so no account or setup is needed.
//
//   npm run dev        → http://localhost:3000, data kept in .data/
//
// Tests import createApp() to run the API against a throwaway database.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setDb } from '../api/_lib/db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// Same file-based routing as Vercel: api/projects/[id].js answers /api/projects/123.
const ROUTES = [
  ['/api/auth/signup', 'api/auth/signup.js'],
  ['/api/auth/login', 'api/auth/login.js'],
  ['/api/auth/logout', 'api/auth/logout.js'],
  ['/api/auth/me', 'api/auth/me.js'],
  ['/api/projects', 'api/projects/index.js'],
  [/^\/api\/projects\/([^/]+)$/, 'api/projects/[id].js', 'id'],
];

function matchRoute(pathname) {
  for (const [pattern, file, param] of ROUTES) {
    if (typeof pattern === 'string' && pattern === pathname) return { file, params: {} };
    if (pattern instanceof RegExp) {
      const m = pattern.exec(pathname);
      if (m) return { file, params: { [param]: decodeURIComponent(m[1]) } };
    }
  }
  return null;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  if (String(req.headers['content-type'] || '').startsWith('application/json')) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

async function serveStatic(pathname, res) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, safe);
  if (!file.startsWith(ROOT) || /node_modules|\/\.|\/api\//.test(file)) return false;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/** An http.Server wired to the given database ({ query(text, params) → rows }). */
export function createApp(db) {
  setDb(db);
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const match = matchRoute(url.pathname);
    if (match) {
      req.query = { ...Object.fromEntries(url.searchParams), ...match.params };
      req.body = await readBody(req);
      const { default: handler } = await import(pathToFileURL(join(ROOT, match.file)).href);
      return handler(req, res);
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    if (!(await serveStatic(url.pathname, res))) {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

/** Wrap PGlite so it answers like the production driver (rows only). */
export async function pgliteDb(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  return { query: async (text, params = []) => (await pg.query(text, params)).rows, close: () => pg.close() };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const db = await pgliteDb(join(ROOT, '.data'));
  createApp(db).listen(port, () => console.log(`PaintWise running at http://localhost:${port}`));
}

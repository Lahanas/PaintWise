// Small helpers shared by every API route.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Wrap a route: only the listed methods are allowed, changes must be sent as JSON
 * (which browsers won't do across sites without permission, so it blocks CSRF),
 * and any error becomes a clean JSON answer instead of a crash.
 */
export function route(handlers) {
  return async function handler(req, res) {
    const fn = handlers[req.method];
    if (!fn) {
      res.setHeader('Allow', Object.keys(handlers).join(', '));
      return send(res, 405, { error: 'Method not allowed' });
    }
    try {
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const type = String(req.headers['content-type'] || '');
        if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON');
      }
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: status >= 500 && !err.status ? 'Something went wrong' : err.message });
    }
  };
}

/** The parsed JSON body (Vercel parses it; plain Node gives a string or nothing). */
export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'Invalid JSON'); }
  }
  return {};
}

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

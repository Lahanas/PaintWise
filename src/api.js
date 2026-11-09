// Talks to the PaintWise backend (/api). Every call returns the parsed answer or throws
// an Error with a message that can be shown to the user.

async function call(method, path, payload) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: payload !== undefined ? { 'content-type': 'application/json' } : {},
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: no backend here */ }
  if (!res.ok) {
    throw Object.assign(new Error((data && data.error) || `Server error (${res.status})`), { status: res.status });
  }
  return data;
}

/**
 * Who is logged in. Returns { available: false } when the site runs without a backend
 * (for example on GitHub Pages), so the app can hide the account features.
 */
export async function getSession() {
  try {
    const data = await call('GET', '/api/auth/me');
    if (!data || !('user' in data)) return { available: false, user: null, features: {} };
    return { available: true, user: data.user, features: data.features || {} };
  } catch {
    return { available: false, user: null, features: {} };
  }
}

export const signup = (email, password) => call('POST', '/api/auth/signup', { email, password }).then((d) => d.user);
export const login = (email, password) => call('POST', '/api/auth/login', { email, password }).then((d) => d.user);
export const logout = () => call('POST', '/api/auth/logout', {});
export const changePassword = (currentPassword, newPassword) => call('POST', '/api/auth/password', { currentPassword, newPassword }).then((d) => d.user);
export const forgotPassword = (email) => call('POST', '/api/auth/forgot', { email }).then((d) => d.message);
export const resetPassword = (token, password) => call('POST', '/api/auth/reset', { token, password }).then((d) => d.user);

export const listProjects = () => call('GET', '/api/projects').then((d) => d.projects);
export const getProject = (id) => call('GET', `/api/projects/${encodeURIComponent(id)}`).then((d) => d.project);
export const createProject = (name, data) => call('POST', '/api/projects', { name, data }).then((d) => d.project);
export const updateProject = (id, name, data) => call('PUT', `/api/projects/${encodeURIComponent(id)}`, { name, data }).then((d) => d.project);
export const deleteProject = (id) => call('DELETE', `/api/projects/${encodeURIComponent(id)}`);

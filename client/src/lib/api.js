export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : ''); // production builds call the server they are served from

let session = null; // { token, user } - MeetSphere JWT, kept in memory only
let refresher = null;

export const setSession = (s) => { session = s; };
export const getToken = () => session?.token;
export const setRefresher = (fn) => { refresher = fn; };

/** fetch wrapper: adds the JWT, retries once after re-exchanging the Firebase token on 401. */
export async function api(path, { method = 'GET', body } = {}, retry = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session && { Authorization: `Bearer ${session.token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry && refresher && session) {
    await refresher();
    return api(path, { method, body }, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const exchangeFirebaseToken = (idToken) => api('/api/auth/session', { method: 'POST', body: { idToken } }, false);

/** POST a binary body (e.g. a short audio clip) with the JWT; retries once after a token refresh. */
export async function apiBinary(path, blob, retry = true) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream', ...(session && { Authorization: `Bearer ${session.token}` }) },
    body: blob,
  });
  if (res.status === 401 && retry && refresher && session) {
    await refresher();
    return apiBinary(path, blob, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

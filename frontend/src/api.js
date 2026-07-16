/** Thin fetch wrapper for the VSK Ops API — attaches the JWT and normalizes errors. */
const TOKEN_KEY = "vsk-ops-token";
const PROFILE_KEY = "vsk-ops-profile";

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get profile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;
    } catch {
      return null;
    }
  },
  save(token, profile) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && auth.token) {
    auth.clear();
    window.location.reload(); // token expired — back to login
    return null;
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      if (text) message = text.length > 300 ? message : text;
    } catch {
      /* keep the status message */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  del: (path) => request(path, { method: "DELETE" }),
};

/** Best-effort GET — returns fallback instead of throwing on 403, for panels a role can't see. */
export const tryGet = (path, fallback = null) =>
  api.get(path).catch((e) => {
    if (e instanceof ApiError && e.status === 403) return fallback;
    throw e;
  });

/**
 * The single HTTP client for the ACME API.
 *
 * Every request goes through `request()`, which attaches the JWT, parses the
 * JSON body and converts failures into `ApiError`. A 401 response means the
 * session expired, so the registered handler logs the user out.
 */

// In production the site and API share one CloudFront domain, with the API under /api/acme-api.
// Citi's deploy script sets VITE_API_URL to the bare CloudFront URL (no API prefix), so it is
// deliberately ignored in production builds. VITE_API_URL only applies to local development.
const API_ROOT = `${
  import.meta.env.PROD ? "/api/acme-api" : import.meta.env.VITE_API_URL || "http://localhost:8000"
}/api/v1`;
const TOKEN_KEY = "acme_token";

let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/**
 * When a JWT expires, in epoch milliseconds, read from its (unverified) payload.
 * Only used to schedule a refresh; the server still validates every token.
 * Returns null for anything that isn't a readable JWT with an `exp` claim.
 */
export function tokenExpiresAt(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Register a callback that runs when the API rejects the current token. */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

/** Turn FastAPI's `detail` (string or validation array) into readable text. */
function describeError(body, fallback) {
  const detail = body && body.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => `${(item.loc || []).slice(1).join(".")}: ${item.msg}`)
      .join("; ");
  }
  return fallback;
}

/**
 * Perform an API request and return the parsed JSON (or null for 204).
 * @param {string} path - Path below /api/v1, e.g. "/projects".
 * @param {{method?: string, body?: object, params?: object, auth?: boolean}} options
 */
export async function request(
  path,
  { method = "GET", body, params, auth = true } = {},
) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      query.append(key, value);
  });
  const queryString = query.toString();
  const url = `${API_ROOT}${path}${queryString ? `?${queryString}` : ""}`;

  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      "Unable to reach the server. Check your connection and try again.",
    );
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && auth && unauthorizedHandler)
      unauthorizedHandler();
    throw new ApiError(
      response.status,
      describeError(data, `Request failed (${response.status})`),
    );
  }
  return data;
}

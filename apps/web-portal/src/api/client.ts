const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:3000';

const TOKEN_STORAGE_KEY = 'pumpos.accessToken';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiErrorBody {
  message?: string | string[];
}

// Narrows `response.json()`'s implicit `any` — the body is untrusted
// input from the network, not something we can assume has a `.message`
// field just because most NestJS error responses do.
export async function parseErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'message' in body) {
      const msg = (body as ApiErrorBody).message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  return fallback;
}

// Every dashboard/bills/meter-readings/credit-alerts/customers route on the
// backend requires a JWT (global JwtAuthGuard) except /auth/login and
// /auth/pin-login, so this always attaches the bearer token when one is
// stored. A 401 here almost always means the token expired or was never
// set — the caller (AuthContext) treats it as "log the user out".
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const message = await parseErrorMessage(
      response,
      `Request to ${path} failed (${response.status})`,
    );
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

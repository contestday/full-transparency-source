// Browser-side fetch helper for admin API routes.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.details?.[0];
    throw new ApiError(res.status, detail ? `${body.error}: ${detail.path ? `${detail.path} — ` : ""}${detail.message}` : body.error ?? `HTTP ${res.status}`, body.details);
  }
  return body as T;
}

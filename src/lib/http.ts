import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ConfigError } from "@/lib/env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  return schema.parse(body);
}

/** Wrap a route handler with consistent error handling. */
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return json(
      {
        error: "Validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 422 },
    );
  }
  if (err instanceof ConfigError) {
    console.error(err);
    return json({ error: "Service not configured" }, { status: 503 });
  }
  console.error(err);
  return json({ error: "Internal server error" }, { status: 500 });
}

/** Best-effort client IP (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Constant-time comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** Validate an `Authorization: Bearer <secret>` header against an env secret. */
export function requireBearer(request: Request, secret: string | undefined) {
  if (!secret) throw new ConfigError("Shared secret not configured");
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, secret)) throw new HttpError(401, "Unauthorised");
}

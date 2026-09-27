import { NextResponse } from "next/server";

/**
 * The widget runs on a customer's own origin, so widget-facing routes are open by design. What
 * guards them is the embed key in the body, not the origin.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
};

/** Adds the cross-origin headers to a response and returns it. */
export function withCors<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

/** The `OPTIONS` handler every widget-facing route re-exports. */
export function preflight(): Response {
  return withCors(new NextResponse(null, { status: 204 }));
}

/** JSON response with the cross-origin headers already set. */
export function corsJson(body: unknown, init?: ResponseInit): Response {
  return withCors(NextResponse.json(body, init));
}

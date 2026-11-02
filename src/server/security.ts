/**
 * Access control for the local REST API.
 *
 * Binding to 127.0.0.1 keeps other machines out, but not other websites: any page
 * open in the user's browser can send requests to localhost, and a DNS-rebinding
 * page can even read the responses. So every API request must pass three checks:
 *
 * - Host is this server's own loopback address (defeats DNS rebinding).
 * - Origin, when the browser sends one, is this server's own UI (defeats CSRF).
 * - A session token is presented, either as the HttpOnly, SameSite=Strict cookie
 *   the server sets when it serves the UI, or as `Authorization: Bearer <token>`
 *   for other local tools.
 *
 * The token comes from RECALL_API_TOKEN, or is generated randomly at startup (then
 * only the bundled UI can use the API).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE = "recall_session";

export interface ServerSecurity {
  token: string;
  tokenFromEnv: boolean;
  allowedHosts: Set<string>;
  allowedOrigins: Set<string>;
}

export interface Denial {
  status: 401 | 403;
  message: string;
}

export function createServerSecurity(
  port: number,
  env: NodeJS.ProcessEnv = process.env
): ServerSecurity {
  const fromEnv = env.RECALL_API_TOKEN?.trim();
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const extraOrigins = (env.RECALL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return {
    token: fromEnv || randomBytes(32).toString("base64url"),
    tokenFromEnv: Boolean(fromEnv),
    allowedHosts: new Set(hosts),
    allowedOrigins: new Set([...hosts.map((host) => `http://${host}`), ...extraOrigins]),
  };
}

/** Set-Cookie value that lets the bundled UI call the API. */
export function sessionCookie(security: ServerSecurity): string {
  return `${SESSION_COOKIE}=${security.token}; HttpOnly; SameSite=Strict; Path=/`;
}

function sameToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(header: string | undefined): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

/** Null when the request may proceed, otherwise why it is refused. */
export function checkApiRequest(req: IncomingMessage, security: ServerSecurity): Denial | null {
  const host = req.headers.host?.toLowerCase();
  if (!host || !security.allowedHosts.has(host)) {
    return { status: 403, message: "Host not allowed" };
  }
  const origin = req.headers.origin;
  if (origin && !security.allowedOrigins.has(origin.toLowerCase())) {
    return { status: 403, message: "Origin not allowed" };
  }
  const auth = req.headers.authorization;
  const presented = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : cookieToken(req.headers.cookie);
  if (!presented || !sameToken(presented, security.token)) {
    return { status: 401, message: "Missing or invalid API token" };
  }
  return null;
}

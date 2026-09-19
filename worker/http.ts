export type ApiErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "CONFLICT" | "INTERNAL_ERROR" | "SERVICE_UNAVAILABLE" | "UNAUTHORIZED" | "FORBIDDEN" | "OAUTH_ERROR";

export class ApiError extends Error {
	constructor(readonly status: number, readonly code: ApiErrorCode, message: string) { super(message); }
}

export const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
export const success = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify({ data }), { status, headers: { ...JSON_HEADERS, ...headers } });
export const failure = (error: ApiError, requestId: string) => new Response(JSON.stringify({ error: { code: error.code, message: error.message, requestId } }), { status: error.status, headers: JSON_HEADERS });
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function withSecurityHeaders(response: Response): Response {
	const secured = new Response(response.body, response);
	secured.headers.set("Cache-Control", "no-store");
	secured.headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' https://avatars.githubusercontent.com https://icons.duckduckgo.com data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com");
	secured.headers.set("Referrer-Policy", "no-referrer");
	secured.headers.set("X-Content-Type-Options", "nosniff");
	secured.headers.set("X-Frame-Options", "DENY");
	secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	return secured;
}

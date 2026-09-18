import type { CheckResult, CheckTarget, EndpointRecord, HealthStatus, HttpMethod } from "../src/types/monitoring";
import { ENDPOINT_LIMITS, isHttpMethod, validateUrl } from "../src/services/targetValidation";

export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_REDIRECTS = 5;

type ApiErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "CONFLICT" | "INTERNAL_ERROR";
interface EndpointRow { id: string; workspace_id: string; name: string; url: string; method: HttpMethod; expected_status: number; timeout_ms: number; latency_threshold_ms: number; check_interval_minutes: number; enabled: number; created_at: string; updated_at: string }
interface ResultRow { id: string; endpoint_id: string; checked_at: string; status_code: number | null; latency_ms: number; outcome: HealthStatus; error_type: string | null; error_message: string | null }

class ApiError extends Error {
	constructor(readonly status: number, readonly code: ApiErrorCode, message: string) { super(message); }
}

function success(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ data }), { status, headers: JSON_HEADERS });
}
function failure(error: ApiError, requestId: string): Response {
	return new Response(JSON.stringify({ error: { code: error.code, message: error.message, requestId } }), { status: error.status, headers: JSON_HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
	let raw: unknown;
	try { raw = await request.json(); } catch { throw new ApiError(400, "VALIDATION_ERROR", "Request body must be valid JSON."); }
	if (!isRecord(raw)) throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object.");
	return raw;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") throw new ApiError(400, "VALIDATION_ERROR", `Field '${field}' is required.`);
	return value.trim();
}
function boundedInt(value: unknown, field: string, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(400, "VALIDATION_ERROR", `Field '${field}' must be an integer from ${min} to ${max}.`);
	return value;
}

export interface EndpointInput { name: string; url: string; method: HttpMethod; expectedStatus: number; timeoutMs: number; latencyThresholdMs: number; checkIntervalMinutes: number; enabled: boolean }
export function validateEndpointInput(raw: Record<string, unknown>, partial = false): Partial<EndpointInput> {
	const out: Partial<EndpointInput> = {};
	const requireField = (key: string) => !partial || Object.hasOwn(raw, key);
	if (requireField("name")) {
		const name = requiredString(raw.name, "name");
		if (name.length < 2 || name.length > ENDPOINT_LIMITS.nameMax || !/[\p{L}\p{N}]/u.test(name)) throw new ApiError(400, "VALIDATION_ERROR", `Name must be 2-${ENDPOINT_LIMITS.nameMax} characters and contain a letter or number.`);
		out.name = name;
	}
	if (requireField("url")) {
		const url = requiredString(raw.url, "url");
		const problem = validateUrl(url);
		if (problem) throw new ApiError(400, "VALIDATION_ERROR", problem);
		assertPublicUrl(url);
		out.url = new URL(url).toString();
	}
	if (requireField("method")) {
		const method = typeof raw.method === "string" ? raw.method.toUpperCase() : raw.method;
		if (!isHttpMethod(method)) throw new ApiError(400, "VALIDATION_ERROR", "Field 'method' is not a supported HTTP method.");
		out.method = method;
	}
	if (requireField("expectedStatus")) out.expectedStatus = boundedInt(raw.expectedStatus, "expectedStatus", 100, 599);
	if (requireField("timeoutMs")) out.timeoutMs = boundedInt(raw.timeoutMs, "timeoutMs", ENDPOINT_LIMITS.timeoutMin, ENDPOINT_LIMITS.timeoutMax);
	if (requireField("latencyThresholdMs")) out.latencyThresholdMs = boundedInt(raw.latencyThresholdMs, "latencyThresholdMs", ENDPOINT_LIMITS.thresholdMin, ENDPOINT_LIMITS.thresholdMax);
	if (requireField("checkIntervalMinutes")) out.checkIntervalMinutes = boundedInt(raw.checkIntervalMinutes, "checkIntervalMinutes", ENDPOINT_LIMITS.intervalMin, ENDPOINT_LIMITS.intervalMax);
	if (requireField("enabled")) {
		if (typeof raw.enabled !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", "Field 'enabled' must be a boolean.");
		out.enabled = raw.enabled;
	}
	if (partial && Object.keys(out).length === 0) throw new ApiError(400, "VALIDATION_ERROR", "Provide at least one editable field.");
	return out;
}

function isPrivateIpv4(host: string): boolean {
	const parts = host.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	const [a = 0, b = 0] = parts;
	return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
export function assertPublicUrl(raw: string): void {
	const url = new URL(raw);
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	const privateIpv6 = host.includes(":") && (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb") || host.startsWith("::ffff:"));
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0" || isPrivateIpv4(host) || privateIpv6) {
		throw new ApiError(400, "VALIDATION_ERROR", "Private, local, loopback, link-local, multicast, and unspecified targets are not allowed.");
	}
}

function resultFromRow(row: ResultRow, target: CheckTarget): CheckResult {
	return { id: row.id, target, status: row.outcome, reason: row.error_message ?? reasonFor(row.outcome, row.status_code, row.latency_ms, target), latencyMs: row.latency_ms, actualStatusCode: row.status_code, checkedAt: row.checked_at };
}
function reasonFor(outcome: HealthStatus, code: number | null, latency: number, target: CheckTarget): string {
	if (code === null) return `No HTTP response was received from ${target.url}.`;
	if (outcome === "CRITICAL") return `Expected HTTP ${target.expectedStatus} but received HTTP ${code}.`;
	if (outcome === "DEGRADED") return `Responded HTTP ${code} in ${latency} ms, exceeding the ${target.latencyThresholdMs} ms threshold.`;
	return `Responded HTTP ${code} in ${latency} ms, within the ${target.latencyThresholdMs} ms threshold.`;
}
function targetFromRow(row: EndpointRow): CheckTarget { return { url: row.url, method: row.method, expectedStatus: row.expected_status, timeoutMs: row.timeout_ms, latencyThresholdMs: row.latency_threshold_ms }; }
async function endpointFromRow(db: D1Database, row: EndpointRow): Promise<EndpointRecord> {
	const latest = await db.prepare("SELECT * FROM check_results WHERE endpoint_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1").bind(row.id).first<ResultRow>();
	const target = targetFromRow(row);
	return { id: row.id, workspaceId: row.workspace_id, name: row.name, ...target, checkIntervalMinutes: row.check_interval_minutes, enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at, latestResult: latest ? resultFromRow(latest, target) : null };
}
async function findEndpoint(db: D1Database, id: string): Promise<EndpointRow> {
	const row = await db.prepare("SELECT * FROM endpoints WHERE id = ? AND workspace_id = ?").bind(id, DEFAULT_WORKSPACE_ID).first<EndpointRow>();
	if (!row) throw new ApiError(404, "NOT_FOUND", "Endpoint not found.");
	return row;
}

async function listEndpoints(db: D1Database): Promise<Response> {
	const { results } = await db.prepare("SELECT * FROM endpoints WHERE workspace_id = ? ORDER BY created_at ASC").bind(DEFAULT_WORKSPACE_ID).all<EndpointRow>();
	return success(await Promise.all(results.map((row) => endpointFromRow(db, row))));
}
async function createEndpoint(request: Request, db: D1Database): Promise<Response> {
	const input = validateEndpointInput(await readJson(request)) as EndpointInput;
	const id = crypto.randomUUID(); const now = new Date().toISOString();
	await db.prepare("INSERT INTO endpoints (id, workspace_id, name, url, method, expected_status, timeout_ms, latency_threshold_ms, check_interval_minutes, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		.bind(id, DEFAULT_WORKSPACE_ID, input.name, input.url, input.method, input.expectedStatus, input.timeoutMs, input.latencyThresholdMs, input.checkIntervalMinutes, input.enabled ? 1 : 0, now, now).run();
	return success(await endpointFromRow(db, await findEndpoint(db, id)), 201);
}
async function updateEndpoint(request: Request, db: D1Database, id: string): Promise<Response> {
	const current = await findEndpoint(db, id);
	const patch = validateEndpointInput(await readJson(request), true);
	const merged: EndpointInput = { name: patch.name ?? current.name, url: patch.url ?? current.url, method: patch.method ?? current.method, expectedStatus: patch.expectedStatus ?? current.expected_status, timeoutMs: patch.timeoutMs ?? current.timeout_ms, latencyThresholdMs: patch.latencyThresholdMs ?? current.latency_threshold_ms, checkIntervalMinutes: patch.checkIntervalMinutes ?? current.check_interval_minutes, enabled: patch.enabled ?? current.enabled === 1 };
	await db.prepare("UPDATE endpoints SET name = ?, url = ?, method = ?, expected_status = ?, timeout_ms = ?, latency_threshold_ms = ?, check_interval_minutes = ?, enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
		.bind(merged.name, merged.url, merged.method, merged.expectedStatus, merged.timeoutMs, merged.latencyThresholdMs, merged.checkIntervalMinutes, merged.enabled ? 1 : 0, new Date().toISOString(), id, DEFAULT_WORKSPACE_ID).run();
	return success(await endpointFromRow(db, await findEndpoint(db, id)));
}

async function fetchWithSafeRedirects(target: CheckTarget, signal: AbortSignal): Promise<Response> {
	let url = target.url;
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		assertPublicUrl(url);
		const response = await fetch(url, { method: target.method, signal, redirect: "manual" });
		if (![301, 302, 303, 307, 308].includes(response.status)) return response;
		const location = response.headers.get("location");
		void response.body?.cancel();
		if (!location) return response;
		if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects.");
		url = new URL(location, url).toString();
	}
	throw new Error("Too many redirects.");
}
async function executeCheck(target: CheckTarget): Promise<{ result: CheckResult; errorType: string | null }> {
	const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), target.timeoutMs); const started = performance.now();
	let response: Response | null = null; let errorType: string | null = null; let errorMessage: string | null = null;
	try { response = await fetchWithSafeRedirects(target, controller.signal); void response.body?.cancel().catch(() => { /* Body disposal does not change the observation. */ }); }
	catch (error) { errorType = error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR"; errorMessage = errorType === "TIMEOUT" ? `Request exceeded the ${target.timeoutMs} ms timeout.` : "The target could not be reached."; }
	finally { clearTimeout(timer); }
	const latencyMs = Math.round(performance.now() - started); const statusCode = response?.status ?? null;
	const outcome: HealthStatus = statusCode === null || statusCode !== target.expectedStatus ? "CRITICAL" : latencyMs > target.latencyThresholdMs ? "DEGRADED" : "HEALTHY";
	const result: CheckResult = { id: crypto.randomUUID(), target, status: outcome, reason: errorMessage ?? reasonFor(outcome, statusCode, latencyMs, target), latencyMs, actualStatusCode: statusCode, checkedAt: new Date().toISOString() };
	return { result, errorType };
}
async function checkEndpoint(db: D1Database, id: string): Promise<Response> {
	const row = await findEndpoint(db, id);
	if (row.enabled !== 1) throw new ApiError(409, "CONFLICT", "Disabled endpoints cannot be checked.");
	const { result, errorType } = await executeCheck(targetFromRow(row));
	await db.prepare("INSERT INTO check_results (id, endpoint_id, checked_at, status_code, latency_ms, outcome, error_type, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
		.bind(result.id, row.id, result.checkedAt, result.actualStatusCode, result.latencyMs, result.status, errorType, errorType ? result.reason : null).run();
	return success(result);
}

async function handleDemo(pathname: string): Promise<Response> {
	if (pathname.endsWith("/slow")) await new Promise((resolve) => setTimeout(resolve, 1200));
	const status = pathname.endsWith("/failing") ? 500 : 200;
	return new Response(JSON.stringify({ status: status === 200 ? "ok" : "error", endpoint: pathname }), { status, headers: JSON_HEADERS });
}

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url); const path = url.pathname;
	if (["/api/demo/healthy", "/api/demo/slow", "/api/demo/failing"].includes(path)) {
		if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", `Method ${request.method} not allowed.`);
		return handleDemo(path);
	}
	if (path === "/api/endpoints") {
		if (request.method === "GET") return listEndpoints(env.DB);
		if (request.method === "POST") return createEndpoint(request, env.DB);
		throw new ApiError(405, "METHOD_NOT_ALLOWED", `Method ${request.method} not allowed.`);
	}
	const match = /^\/api\/endpoints\/([^/]+)(?:\/(check|results))?$/.exec(path);
	if (!match?.[1]) throw new ApiError(404, "NOT_FOUND", "Route not found.");
	const id = decodeURIComponent(match[1]); const action = match[2];
	if (action === "check") {
		if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", `Method ${request.method} not allowed.`);
		return checkEndpoint(env.DB, id);
	}
	if (action === "results") {
		if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", `Method ${request.method} not allowed.`);
		const row = await findEndpoint(env.DB, id); const limitRaw = url.searchParams.get("limit") ?? "50"; const limit = Number(limitRaw);
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "VALIDATION_ERROR", "Query parameter 'limit' must be an integer from 1 to 100.");
		const { results } = await env.DB.prepare("SELECT * FROM check_results WHERE endpoint_id = ? ORDER BY checked_at DESC, id DESC LIMIT ?").bind(id, limit).all<ResultRow>();
		return success(results.map((result) => resultFromRow(result, targetFromRow(row))));
	}
	if (request.method === "GET") return success(await endpointFromRow(env.DB, await findEndpoint(env.DB, id)));
	if (request.method === "PATCH") return updateEndpoint(request, env.DB, id);
	if (request.method === "DELETE") { await findEndpoint(env.DB, id); await env.DB.prepare("DELETE FROM endpoints WHERE id = ? AND workspace_id = ?").bind(id, DEFAULT_WORKSPACE_ID).run(); return new Response(null, { status: 204 }); }
	throw new ApiError(405, "METHOD_NOT_ALLOWED", `Method ${request.method} not allowed.`);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
		try { return await route(request, env); }
		catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "An unexpected server error occurred.");
			const log = apiError.status >= 500 ? console.error : console.warn;
			log("API request failed", {
				requestId,
				method: request.method,
				path: new URL(request.url).pathname,
				status: apiError.status,
				code: apiError.code,
				error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
			});
			return failure(apiError, requestId);
		}
	},
} satisfies ExportedHandler<Env>;

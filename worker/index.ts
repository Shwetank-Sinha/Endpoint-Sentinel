import type { CheckResult, CheckTarget, HttpMethod } from "../src/types/monitoring";
import { HTTP_METHODS } from "../src/types/monitoring";

import { isDemoPath, validateUrl } from "../src/services/targetValidation";

export interface Env {}

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_LATENCY_THRESHOLD_MS = 800;
const DEFAULT_EXPECTED_STATUS = 200;
const DEMO_SLOW_DELAY_MS = 1200;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------------------
 * Demo endpoints
 * ------------------------------------------------------------------------- */

async function handleDemoHealthy(): Promise<Response> {
	return json({ status: "ok", endpoint: "/api/demo/healthy" });
}

async function handleDemoSlow(): Promise<Response> {
	await sleep(DEMO_SLOW_DELAY_MS);
	return json({ status: "ok", endpoint: "/api/demo/slow", note: "intentional ~1200ms delay" });
}

async function handleDemoFailing(): Promise<Response> {
	return json({ status: "error", endpoint: "/api/demo/failing" }, 500);
}

const demoHandlers: Readonly<Record<string, () => Promise<Response>>> = {
	"/api/demo/healthy": handleDemoHealthy,
	"/api/demo/slow": handleDemoSlow,
	"/api/demo/failing": handleDemoFailing,
};

/**
 * Resolves a check target URL to an internal /api/demo/* handler so these
 * are executed in-process (no self-HTTP round-trip). Returns null for any
 * external URL, which is then fetched normally.
 */
function demoHandlerForUrl(rawUrl: string): (() => Promise<Response>) | null {
	return isDemoPath(rawUrl) ? demoHandlers[rawUrl] ?? null : null;
}

/* ---------------------------------------------------------------------------
 * Check orchestrator /api/check
 * ------------------------------------------------------------------------- */

class InvalidTargetError extends Error {}

async function parseCheckTarget(request: Request): Promise<CheckTarget> {
	let bodyText: string;
	try {
		bodyText = await request.text();
	} catch {
		throw new InvalidTargetError("Request body could not be read.");
	}

	if (bodyText.trim().length === 0) {
		throw new InvalidTargetError("Missing JSON request body.");
	}

	let raw: unknown;
	try {
		raw = JSON.parse(bodyText);
	} catch {
		throw new InvalidTargetError("Request body must be valid JSON.");
	}

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new InvalidTargetError("Request body must be a JSON object.");
	}

	const input = raw as Record<string, unknown>;

	const urlValue = input.url;
	if (typeof urlValue !== "string" || urlValue.trim().length === 0) {
		throw new InvalidTargetError("Field 'url' (string) is required.");
	}

	const url = urlValue.trim();
	const urlError = validateUrl(url);
	if (urlError) throw new InvalidTargetError(urlError);
	const method = validMethod(input.method);
	const expectedStatus = validPositiveInt(
		input.expectedStatus,
		"expectedStatus",
		DEFAULT_EXPECTED_STATUS,
	);
	const timeoutMs = validPositiveInt(input.timeoutMs, "timeoutMs", DEFAULT_TIMEOUT_MS);
	const latencyThresholdMs = validPositiveInt(
		input.latencyThresholdMs,
		"latencyThresholdMs",
		DEFAULT_LATENCY_THRESHOLD_MS,
	);

	if (expectedStatus < 100 || expectedStatus > 599) throw new InvalidTargetError("Expected status must be an integer from 100 to 599.");
	if (timeoutMs > 2147483647) throw new InvalidTargetError("Timeout must not exceed 2147483647 ms.");
	return { url, method, expectedStatus, timeoutMs, latencyThresholdMs };
}

function validMethod(value: unknown): HttpMethod {
	if (value === undefined) return "GET";
	if (typeof value !== "string") {
		throw new InvalidTargetError("Field 'method' must be a string.");
	}
	const normalized = value.toUpperCase();
	if (!(HTTP_METHODS as readonly string[]).includes(normalized)) {
		throw new InvalidTargetError(
			`Field 'method' must be one of: ${HTTP_METHODS.join(", ")}.`,
		);
	}
	return normalized as HttpMethod;
}

function validPositiveInt(
	value: unknown,
	field: string,
	fallback: number,
): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new InvalidTargetError(`Field '${field}' must be a positive integer.`);
	}
	return value;
}

/**
 * Runs the task and aborts it (cancelling any in-flight fetch whose signal is
 * passed through) as soon as timeoutMs elapses.
 */
async function runWithTimeout<T>(
	task: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number,
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await Promise.race([
			task(controller.signal),
			new Promise<never>((_, reject) => {
				controller.signal.addEventListener(
					"abort",
					() =>
						reject(
							new DOMException("The operation was aborted.", "AbortError"),
						),
					{ once: true },
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

interface CheckOutcome {
	response: Response | null;
	timedOut: boolean;
	failureReason: string;
	latencyMs: number;
}

async function runCheck(target: CheckTarget): Promise<CheckResult> {
	const startedAt = performance.now();
	const demoHandler = demoHandlerForUrl(target.url);

	let response: Response | null = null;
	let timedOut = false;
	let failureReason = "";

	try {
		if (demoHandler !== null) {
			response = await runWithTimeout(() => target.method === "GET" ? demoHandler() : Promise.resolve(json({ error: `Method ${target.method} not allowed.` }, 405)), target.timeoutMs);
		} else {
			response = await runWithTimeout(
				(signal) =>
					fetch(target.url, {
						method: target.method,
						signal,
						// Follow redirects and classify the final HTTP response.
						redirect: "follow",
					}),
				target.timeoutMs,
			);
		}

		// The target's response body is never surfaced to the caller.
		void response.body?.cancel().catch(() => { /* Body disposal does not change the observed response. */ });
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			timedOut = true;
		} else {
			failureReason = error instanceof Error ? error.message : "Unknown error";
		}
	}

	const latencyMs = Math.round(performance.now() - startedAt);
	const outcome: CheckOutcome = { response, timedOut, failureReason, latencyMs };

	return classifyCheck(target, outcome);
}

function classifyCheck(target: CheckTarget, outcome: CheckOutcome): CheckResult {
	const base: CheckResult = {
		id: crypto.randomUUID(),
		target,
		status: "HEALTHY",
		reason: "",
		latencyMs: outcome.latencyMs,
		actualStatusCode: outcome.response?.status ?? null,
		checkedAt: new Date().toISOString(),
	};

	if (outcome.timedOut) {
		return {
			...base,
			status: "CRITICAL",
			reason: `Request to ${target.url} aborted after ${target.timeoutMs} ms, exceeding the timeout.`,
		};
	}

	if (outcome.response === null) {
		return {
			...base,
			status: "CRITICAL",
			reason: `Request to ${target.url} failed before a response was received${
				outcome.failureReason ? `: ${outcome.failureReason}` : "."
			}`,
		};
	}

	const actualStatus = outcome.response.status;
	if (actualStatus !== target.expectedStatus) {
		return {
			...base,
			status: "CRITICAL",
			reason: `Expected HTTP ${target.expectedStatus} from ${target.url} but received HTTP ${actualStatus}.`,
		};
	}

	if (outcome.latencyMs > target.latencyThresholdMs) {
		return {
			...base,
			status: "DEGRADED",
			reason: `Responded HTTP ${actualStatus} in ${outcome.latencyMs} ms, exceeding the ${target.latencyThresholdMs} ms latency threshold.`,
		};
	}

	return {
		...base,
		status: "HEALTHY",
		reason: `Responded HTTP ${actualStatus} in ${outcome.latencyMs} ms, within the ${target.latencyThresholdMs} ms latency threshold.`,
	};
}

/* ---------------------------------------------------------------------------
 * Router
 * ------------------------------------------------------------------------- */

async function handleCheck(request: Request): Promise<Response> {
	let target: CheckTarget;
	try {
		target = await parseCheckTarget(request);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid request body.";
		return json({ error: message }, 400);
	}

	const result = await runCheck(target);
	return json(result);
}

async function route(request: Request): Promise<Response> {
	const { pathname } = new URL(request.url);

	switch (pathname) {
		case "/api/demo/healthy":
			if (request.method !== "GET") {
				return json({ error: `Method ${request.method} not allowed.` }, 405);
			}
			return handleDemoHealthy();
		case "/api/demo/slow":
			if (request.method !== "GET") {
				return json({ error: `Method ${request.method} not allowed.` }, 405);
			}
			return handleDemoSlow();
		case "/api/demo/failing":
			if (request.method !== "GET") {
				return json({ error: `Method ${request.method} not allowed.` }, 405);
			}
			return handleDemoFailing();
		case "/api/check":
			if (request.method !== "POST") {
				return json({ error: `Method ${request.method} not allowed.` }, 405);
			}
			return handleCheck(request);
		default:
			return json({ error: "Not found." }, 404);
	}
}

export default {
	async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
		try {
			return await route(request);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Internal server error.";
			console.error("Unhandled request error:", error);
			return json({ error: message }, 500);
		}
	},
} satisfies ExportedHandler<Env>;
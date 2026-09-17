/**
 * Frontend API client for the Endpoint Sentinel worker.
 * Phase 1: just the single realtime check call; richer APIs arrive later.
 */

import type { CheckResult, CheckTarget } from "../types/monitoring";

const CHECK_ENDPOINT = "/api/check";

/**
 * Runs a single realtime check against the worker and returns the
 * classified result.
 *
 * @throws {Error} if the worker responds with a non-2xx status or the
 *   response shape cannot be parsed.
 */
export async function runRealtimeCheck(target: CheckTarget): Promise<CheckResult> {
	let response: Response;
	try {
		response = await fetch(CHECK_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(target),
		});
	} catch {
		throw new Error("Could not reach the Endpoint Sentinel API.");
	}

	if (!response.ok) {
		throw new Error(`Check request failed with HTTP ${response.status}.`);
	}

	const payload: unknown = await response.json();
	return parseCheckResult(payload);
}

/**
 * Returns a sensible default target used to pre-fill the check form.
 */
export function createDefaultTarget(): CheckTarget {
	return {
		url: "/api/demo/healthy",
		method: "GET",
		expectedStatus: 200,
		timeoutMs: 5000,
		latencyThresholdMs: 800,
	};
}

function parseCheckResult(payload: unknown): CheckResult {
	if (typeof payload !== "object" || payload === null) {
		throw new Error("Malformed check result from API.");
	}

	const result = payload as Record<string, unknown>;

	if (
		typeof result.id !== "string" ||
		typeof result.status !== "string" ||
		typeof result.reason !== "string" ||
		typeof result.latencyMs !== "number" ||
		typeof result.checkedAt !== "string" ||
		typeof result.target !== "object" ||
		result.target === null
	) {
		throw new Error("Malformed check result from API.");
	}

	return result as unknown as CheckResult;
}
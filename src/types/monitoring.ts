/**
 * Shared domain types for Endpoint Sentinel.
 * Consumed by both the Cloudflare Worker (worker/index.ts) and the
 * React frontend (src/services/monitoringApi.ts). Keep this file free of
 * runtime dependencies so it can be imported from anywhere.
 */

/**
 * HTTP methods the checker is allowed to issue.
 */
export const HTTP_METHODS = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"HEAD",
	"OPTIONS",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Health classification produced for a single check run.
 * - HEALTHY:   status matches and latency is within threshold
 * - DEGRADED:  status matches but latency exceeds the threshold
 * - CRITICAL:  status mismatch, timeout, or unreachable
 */
export const HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "CRITICAL"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/**
 * A single endpoint target to check.
 */
export interface CheckTarget {
	/** Absolute URL (or /api/demo/* path) to probe. */
	url: string;
	/** HTTP method to use for the probe. */
	method: HttpMethod;
	/** HTTP status code that counts as a successful response. */
	expectedStatus: number;
	/** Hard abort deadline in milliseconds. */
	timeoutMs: number;
	/** Latency ceiling that triggers DEGRADED, in milliseconds. */
	latencyThresholdMs: number;
}

/**
 * Result of a single check run. Serialized as-is by /api/check.
 */
export interface CheckResult {
	/** Unique identifier for this run. */
	id: string;
	/** Snapshot of the target that was checked. */
	target: CheckTarget;
	/** Health classification derived from the run. */
	status: HealthStatus;
	/** Plain-English explanation of why the status was chosen. */
	reason: string;
	/** Measured round-trip latency in milliseconds. */
	latencyMs: number;
	/**
	 * HTTP status code actually observed, or null when the request
	 * timed out or failed before a response arrived.
	 */
	actualStatusCode: number | null;
	/** ISO 8601 timestamp of when the check finished. */
	checkedAt: string;
}
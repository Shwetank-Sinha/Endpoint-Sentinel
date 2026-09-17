/**
 * localStorage persistence for Endpoint Sentinel.
 *
 * Stores two things:
 *  - endpoint registrations (id, name, target)
 *  - the latest monitoring results per endpoint (capped at
 *    MAX_HISTORY_PER_ENDPOINT per endpoint)
 *
 * All reads are defensive: corrupt or missing payloads are treated as "no
 * data" so the app always boots into a usable state. Persistence failures
 * (quota, private mode) are ignored and the app keeps working in memory.
 */

import type {
	DashboardEndpoint,
	EndpointHistoryMap,
	HistoryEntry,
} from "../types/dashboard";
import { HTTP_METHODS } from "../types/monitoring";
import type { CheckResult, CheckTarget } from "../types/monitoring";

export const MAX_HISTORY_PER_ENDPOINT = 20;

/** Upper bound on endpoints restored from storage to keep a corrupt/hostile
 * payload from freezing the app on boot. */
export const MAX_RESTORED_ENDPOINTS = 200;

const ENDPOINTS_KEY = "endpoint-sentinel:endpoints";
const HISTORY_KEY = "endpoint-sentinel:history";

type HealthStatusLiteral = CheckResult["status"];

/** True for JSON objects (never arrays) with a plain prototype. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/** True for whole numbers that are coercible to a sane "positive integer". */
function isPositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readJSON(key: string): unknown {
	try {
		const raw = window.localStorage.getItem(key);
		return raw === null ? null : JSON.parse(raw);
	} catch {
		return null;
	}
}

function writeJSON(key: string, value: unknown): void {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Ignore persistence failures; the app keeps working in memory.
	}
}

function normalizeTarget(raw: unknown): CheckTarget | null {
	if (!isRecord(raw)) return null;
	const target = raw;
	if (
		typeof target.url !== "string" ||
		target.url.length === 0 ||
		typeof target.method !== "string" ||
		!(HTTP_METHODS as readonly string[]).includes(target.method) ||
		!isPositiveInt(target.expectedStatus) ||
		!isPositiveInt(target.timeoutMs) ||
		!isPositiveInt(target.latencyThresholdMs)
	) {
		return null;
	}
	return {
		url: target.url,
		method: target.method as CheckTarget["method"],
		expectedStatus: target.expectedStatus,
		timeoutMs: target.timeoutMs,
		latencyThresholdMs: target.latencyThresholdMs,
	};
}

function isValidHealthStatus(value: string): value is HealthStatusLiteral {
	return value === "HEALTHY" || value === "DEGRADED" || value === "CRITICAL";
}

function normalizeResult(raw: unknown): CheckResult | null {
	if (!isRecord(raw)) return null;
	const result = raw;
	if (
		typeof result.id !== "string" ||
		result.id.length === 0 ||
		typeof result.status !== "string" ||
		!isValidHealthStatus(result.status) ||
		typeof result.reason !== "string" ||
		typeof result.latencyMs !== "number" ||
		!Number.isFinite(result.latencyMs) ||
		result.latencyMs < 0 ||
		typeof result.checkedAt !== "string"
	) {
		return null;
	}
	const code = result.actualStatusCode;
	if (code !== null && (typeof code !== "number" || !Number.isInteger(code))) {
		return null;
	}
	const target = normalizeTarget(result.target);
	if (target === null) return null;
	return {
		id: result.id,
		target,
		status: result.status,
		reason: result.reason,
		latencyMs: result.latencyMs,
		actualStatusCode: code === null ? null : (code as number),
		checkedAt: result.checkedAt,
	};
}

function normalizeHistoryEntry(raw: unknown): HistoryEntry | null {
	if (!isRecord(raw)) return null;
	const entry = raw;
	if (typeof entry.checkedAt !== "string") return null;
	const status = entry.status;
	if (
		status !== "HEALTHY" &&
		status !== "DEGRADED" &&
		status !== "CRITICAL" &&
		status !== "ERROR"
	) {
		return null;
	}
	const result =
		entry.result === null || entry.result === undefined
			? null
			: normalizeResult(entry.result);
	return {
		status,
		result,
		error: typeof entry.error === "string" ? entry.error : null,
		checkedAt: entry.checkedAt,
	};
}

/**
 * Reads persisted endpoint registrations, or null when nothing usable is
 * stored. Live status/result state is not persisted; restored endpoints
 * boot as NOT_CHECKED.
 */
export function loadSavedEndpoints(): DashboardEndpoint[] | null {
	const parsed = readJSON(ENDPOINTS_KEY);
	if (!Array.isArray(parsed)) return null;

	const result: DashboardEndpoint[] = [];
	for (const item of parsed) {
		if (result.length >= MAX_RESTORED_ENDPOINTS) break;
		if (!isRecord(item)) continue;
		const entry = item;
		if (typeof entry.id !== "string" || entry.id.length === 0) continue;
		if (typeof entry.name !== "string" || entry.name.length === 0) continue;
		const target = normalizeTarget(entry.target);
		if (target === null) continue;
		result.push({
			id: entry.id,
			name: entry.name,
			target,
			status: "NOT_CHECKED",
			result: null,
			error: null,
		});
	}
	return result.length > 0 ? result : null;
}

/** Reads the persisted per-endpoint history map. */
export function loadSavedHistory(): EndpointHistoryMap {
	const parsed = readJSON(HISTORY_KEY);
	if (!isRecord(parsed)) return {};
	const map: EndpointHistoryMap = {};
	for (const [id, rawEntries] of Object.entries(parsed)) {
		if (!Array.isArray(rawEntries)) continue;
		const entries: HistoryEntry[] = [];
		for (const rawEntry of rawEntries) {
			const entry = normalizeHistoryEntry(rawEntry);
			if (entry !== null) entries.push(entry);
		}
		if (entries.length > 0) {
			map[id] = entries.slice(0, MAX_HISTORY_PER_ENDPOINT);
		}
	}
	return map;
}

/** Persists endpoint registrations (live status/result excluded). */
export function saveEndpoints(endpoints: readonly DashboardEndpoint[]): void {
	writeJSON(
		ENDPOINTS_KEY,
		endpoints.map(({ id, name, target }) => ({ id, name, target })),
	);
}

/** Persists the per-endpoint history map. */
export function saveHistory(history: EndpointHistoryMap): void {
	writeJSON(HISTORY_KEY, history);
}

/**
 * Returns a new history map with `entry` prepended for `endpointId`, capped
 * at MAX_HISTORY_PER_ENDPOINT entries (most recent first).
 */
export function appendHistoryEntry(
	history: EndpointHistoryMap,
	endpointId: string,
	entry: HistoryEntry,
): EndpointHistoryMap {
	const previous = history[endpointId] ?? [];
	return {
		...history,
		[endpointId]: [entry, ...previous].slice(0, MAX_HISTORY_PER_ENDPOINT),
	};
}
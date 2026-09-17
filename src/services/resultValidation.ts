import { HTTP_METHODS } from "../types/monitoring";
import type { CheckResult, CheckTarget } from "../types/monitoring";
import { validateUrl } from "./targetValidation";
type HealthStatusLiteral = CheckResult["status"];
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function normalizeTarget(raw: unknown): CheckTarget | null {
	if (!isRecord(raw)) return null;
	const target = raw;
	if (
		typeof target.url !== "string" ||
		validateUrl(target.url) !== null ||
		typeof target.method !== "string" ||
		!(HTTP_METHODS as readonly string[]).includes(target.method) ||
		!isPositiveInt(target.expectedStatus) || target.expectedStatus < 100 || target.expectedStatus > 599 ||
		!isPositiveInt(target.timeoutMs) || target.timeoutMs > 2147483647 ||
		!isPositiveInt(target.latencyThresholdMs)
	) {
		return null;
	}
	return {
		url: target.url.trim(),
		method: target.method as CheckTarget["method"],
		expectedStatus: target.expectedStatus,
		timeoutMs: target.timeoutMs,
		latencyThresholdMs: target.latencyThresholdMs,
	};
}

function isValidHealthStatus(value: string): value is HealthStatusLiteral {
	return value === "HEALTHY" || value === "DEGRADED" || value === "CRITICAL";
}

export function normalizeResult(raw: unknown): CheckResult | null {
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
		typeof result.checkedAt !== "string" || !Number.isFinite(Date.parse(result.checkedAt))
	) {
		return null;
	}
	const code = result.actualStatusCode;
	if (code !== null && (typeof code !== "number" || !Number.isInteger(code) || code < 100 || code > 599)) {
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


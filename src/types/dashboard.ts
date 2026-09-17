import type { CheckResult, CheckTarget, HealthStatus } from "./monitoring";

export type EndpointStatus = "NOT_CHECKED" | "CHECKING" | HealthStatus | "ERROR";

export interface DashboardEndpoint {
	id: string;
	name: string;
	target: CheckTarget;
	status: EndpointStatus;
	result: CheckResult | null;
	error: string | null;
}

/** Health classifications that are actually recorded in monitoring history. */
export type HistoryEntryStatus = Extract<
	EndpointStatus,
	"HEALTHY" | "DEGRADED" | "CRITICAL" | "ERROR"
>;

/**
 * A single recorded monitoring result. Carries either a completed
 * CheckResult or an error that prevented one from being produced.
 */
export interface HistoryEntry {
	status: HistoryEntryStatus;
	result: CheckResult | null;
	error: string | null;
	checkedAt: string | null;
}

/** Monitoring history keyed by endpoint id (newest entry first). */
export type EndpointHistoryMap = Record<string, HistoryEntry[]>;

export interface DashboardSummary {
	total: number;
	healthy: number;
	degraded: number;
	critical: number;
	averageLatencyMs: number | null;
}
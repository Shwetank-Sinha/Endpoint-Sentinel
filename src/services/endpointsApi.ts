import type { AlertDelivery, CheckResult, EndpointRecord, HttpMethod, IncidentDetail, IncidentEvent, IncidentPage, IncidentSeverity, IncidentStatus, MonitoringJob } from "../types/monitoring";

export interface EndpointPayload {
	name: string; url: string; method: HttpMethod; expectedStatus: number;
	timeoutMs: number; latencyThresholdMs: number; checkIntervalMinutes: number; enabled: boolean;
}

interface ErrorEnvelope { error?: { code?: string; message?: string; requestId?: string } }
let activeWorkspaceId: string | null = null;
export class ApiClientError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
export function setActiveWorkspace(id: string | null): void { activeWorkspaceId = id; }
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	const headers = new Headers(init?.headers); if (activeWorkspaceId && !path.startsWith("/api/auth/")) headers.set("X-Workspace-ID", activeWorkspaceId);
	try { response = await fetch(path, { ...init, headers, credentials: "same-origin" }); } catch { throw new Error("Could not reach the Endpoint Sentinel API."); }
	if (!response.ok) {
		let envelope: ErrorEnvelope = {};
		try { envelope = await response.json() as ErrorEnvelope; } catch { /* use status fallback */ }
		const suffix = envelope.error?.requestId ? ` (request ${envelope.error.requestId})` : "";
		const error = new ApiClientError(`${envelope.error?.message ?? `Request failed with HTTP ${response.status}.`}${suffix}`, response.status, envelope.error?.code);
		if (response.status === 401 && path !== "/api/auth/session") window.dispatchEvent(new Event("endpoint-sentinel:unauthorized"));
		throw error;
	}
	if (response.status === 204) return undefined as T;
	const envelope = await response.json() as { data?: T };
	if (!("data" in envelope)) throw new Error("Malformed API response.");
	return envelope.data as T;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const endpointsApi = {
	list: () => request<EndpointRecord[]>("/api/endpoints"),
	create: (payload: EndpointPayload) => request<EndpointRecord>("/api/endpoints", jsonInit("POST", payload)),
	update: (id: string, payload: Partial<EndpointPayload>) => request<EndpointRecord>(`/api/endpoints/${encodeURIComponent(id)}`, jsonInit("PATCH", payload)),
	remove: (id: string) => request<void>(`/api/endpoints/${encodeURIComponent(id)}`, { method: "DELETE" }),
	check: (id: string) => request<{ jobId: string; status: "QUEUED" }>(`/api/endpoints/${encodeURIComponent(id)}/check`, { method: "POST" }),
	job: (id: string) => request<MonitoringJob>(`/api/jobs/${encodeURIComponent(id)}`),
	results: (id: string, limit = 50) => request<CheckResult[]>(`/api/endpoints/${encodeURIComponent(id)}/results?limit=${limit}`),
};

export interface AuthUser { id: string; githubId: number; githubLogin: string; displayName: string | null; avatarUrl: string | null }
export interface WorkspaceAccess { id: string; name: string; slug: string; role: "OWNER" | "MEMBER" }
export interface AuthSession { user: AuthUser; workspaces: WorkspaceAccess[] }
export const authApi = {
	session: () => request<AuthSession>("/api/auth/session"),
	logout: () => request<void>("/api/auth/logout", { method: "POST" }),
	createWorkspace: (name: string) => request<WorkspaceAccess>("/api/workspaces", jsonInit("POST", { name })),
};

export interface IncidentFilters { status?: IncidentStatus | ""; severity?: IncidentSeverity | ""; endpointId?: string; limit?: number; cursor?: string }
const incidentQuery = (filters: IncidentFilters) => { const query = new URLSearchParams(); if (filters.status) query.set("status", filters.status); if (filters.severity) query.set("severity", filters.severity); if (filters.endpointId) query.set("endpointId", filters.endpointId); if (filters.limit) query.set("limit", String(filters.limit)); if (filters.cursor) query.set("cursor", filters.cursor); return query.toString(); };

export const incidentsApi = {
	list: (filters: IncidentFilters = {}) => request<IncidentPage>(`/api/incidents?${incidentQuery(filters)}`),
	get: (id: string) => request<IncidentDetail>(`/api/incidents/${encodeURIComponent(id)}`),
	events: (id: string) => request<IncidentEvent[]>(`/api/incidents/${encodeURIComponent(id)}/events`),
	alerts: (id: string) => request<AlertDelivery[]>(`/api/incidents/${encodeURIComponent(id)}/alerts`),
	acknowledge: (id: string) => request<IncidentDetail>(`/api/incidents/${encodeURIComponent(id)}/acknowledge`, { method: "POST" }),
	resolve: (id: string) => request<IncidentDetail>(`/api/incidents/${encodeURIComponent(id)}/resolve`, { method: "POST" }),
};

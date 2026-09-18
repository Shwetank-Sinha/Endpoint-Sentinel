import type { CheckResult, EndpointRecord, HttpMethod } from "../types/monitoring";

export interface EndpointPayload {
	name: string; url: string; method: HttpMethod; expectedStatus: number;
	timeoutMs: number; latencyThresholdMs: number; checkIntervalMinutes: number; enabled: boolean;
}

interface ErrorEnvelope { error?: { code?: string; message?: string; requestId?: string } }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try { response = await fetch(path, init); } catch { throw new Error("Could not reach the Endpoint Sentinel API."); }
	if (!response.ok) {
		let envelope: ErrorEnvelope = {};
		try { envelope = await response.json() as ErrorEnvelope; } catch { /* use status fallback */ }
		const suffix = envelope.error?.requestId ? ` (request ${envelope.error.requestId})` : "";
		throw new Error(`${envelope.error?.message ?? `Request failed with HTTP ${response.status}.`}${suffix}`);
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
	check: (id: string) => request<CheckResult>(`/api/endpoints/${encodeURIComponent(id)}/check`, { method: "POST" }),
	results: (id: string, limit = 50) => request<CheckResult[]>(`/api/endpoints/${encodeURIComponent(id)}/results?limit=${limit}`),
};

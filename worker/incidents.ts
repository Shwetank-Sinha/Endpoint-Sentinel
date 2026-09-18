import type { AlertDelivery, IncidentDetail, IncidentEvent, IncidentPage, IncidentSeverity, IncidentStatus } from "../src/types/monitoring";

const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_RECOVERY_THRESHOLD = 1;
const MAX_THRESHOLD = 100;
const ALERT_TIMEOUT_MS = 10_000;
const MAX_ALERT_ATTEMPTS = 4;
const STALE_ALERT_MS = 2 * 60_000;
const RECOVERY_LIMIT = 100;
type IncidentEnv = Env & { ALERT_WEBHOOK_URL?: string };

interface ResultRow { id: string; endpoint_id: string; checked_at: string; status_code: number | null; latency_ms: number; outcome: "HEALTHY" | IncidentSeverity; error_message: string | null; incident_evaluated_at: string | null }
interface EndpointRow { id: string; workspace_id: string; name: string; expected_status: number }
interface IncidentRow { id: string; workspace_id: string; endpoint_id: string; status: IncidentStatus; severity: IncidentSeverity; title: string; summary: string; first_result_id: string | null; latest_result_id: string | null; consecutive_failure_count: number; started_at: string; acknowledged_at: string | null; resolved_at: string | null; created_at: string; updated_at: string; endpoint_name?: string }
interface EventRow { id: string; incident_id: string; event_type: IncidentEvent["eventType"]; from_severity: IncidentSeverity | null; to_severity: IncidentSeverity | null; result_id: string | null; message: string; created_at: string }
interface AlertRow { id: string; incident_id: string; incident_event_id: string; channel: string; deduplication_key: string; status: AlertDelivery["status"]; attempt_count: number; response_status: number | null; last_error: string | null; created_at: string; delivered_at: string | null; updated_at: string }

export interface AlertQueueMessage { version: 1; deliveryId: string; incidentId: string; incidentEventId: string }

function configuredInt(value: string | undefined, fallback: number): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_THRESHOLD ? parsed : fallback; }
function cleanError(error: unknown): string { return (error instanceof Error ? error.message : "Alert infrastructure failure.").replace(/https?:\/\/\S+/gi, "[webhook]").slice(0, 500); }
function reason(result: ResultRow, endpoint: EndpointRow): string {
	if (result.error_message) return result.error_message;
	if (result.status_code === null) return "No HTTP response was received.";
	if (result.outcome === "CRITICAL") return `Expected HTTP ${endpoint.expected_status} but received HTTP ${result.status_code}.`;
	if (result.outcome === "DEGRADED") return `HTTP ${result.status_code} exceeded the configured latency threshold.`;
	return `HTTP ${result.status_code} recovered.`;
}
function incidentFromRow(row: IncidentRow): IncidentDetail { return { id: row.id, endpointId: row.endpoint_id, endpointName: row.endpoint_name ?? "Unknown endpoint", status: row.status, severity: row.severity, title: row.title, summary: row.summary, consecutiveFailureCount: row.consecutive_failure_count, startedAt: row.started_at, acknowledgedAt: row.acknowledged_at, resolvedAt: row.resolved_at, createdAt: row.created_at, updatedAt: row.updated_at, firstResultId: row.first_result_id, latestResultId: row.latest_result_id }; }
function eventFromRow(row: EventRow): IncidentEvent { return { id: row.id, incidentId: row.incident_id, eventType: row.event_type, fromSeverity: row.from_severity, toSeverity: row.to_severity, resultId: row.result_id, message: row.message, createdAt: row.created_at }; }
function alertFromRow(row: AlertRow): AlertDelivery { return { id: row.id, incidentId: row.incident_id, incidentEventId: row.incident_event_id, channel: row.channel, status: row.status, attemptCount: row.attempt_count, responseStatus: row.response_status, lastError: row.last_error, createdAt: row.created_at, deliveredAt: row.delivered_at, updatedAt: row.updated_at }; }
function alertMessage(deliveryId: string, incidentId: string, incidentEventId: string): AlertQueueMessage { return { version: 1, deliveryId, incidentId, incidentEventId }; }

export function parseAlertMessage(raw: unknown): AlertQueueMessage | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	if (value.version !== 1 || typeof value.deliveryId !== "string" || !value.deliveryId || typeof value.incidentId !== "string" || !value.incidentId || typeof value.incidentEventId !== "string" || !value.incidentEventId) return null;
	return { version: 1, deliveryId: value.deliveryId, incidentId: value.incidentId, incidentEventId: value.incidentEventId };
}

async function publishAlert(env: IncidentEnv, message: AlertQueueMessage): Promise<void> {
	try { await env.ALERT_QUEUE.send(message, { contentType: "json" }); }
	catch (error) { console.error("Alert publication deferred", { deliveryId: message.deliveryId, incidentId: message.incidentId, outcome: "queued_for_recovery", error: cleanError(error) }); }
}

export async function evaluateIncident(env: IncidentEnv, resultId: string, evaluatedAt = new Date()): Promise<void> {
	const result = await env.DB.prepare("SELECT id, endpoint_id, checked_at, status_code, latency_ms, outcome, error_message, incident_evaluated_at FROM check_results WHERE id = ?").bind(resultId).first<ResultRow>();
	if (!result || result.incident_evaluated_at) return;
	const endpoint = await env.DB.prepare("SELECT id, workspace_id, name, expected_status FROM endpoints WHERE id = ?").bind(result.endpoint_id).first<EndpointRow>();
	if (!endpoint) return;
	const active = await env.DB.prepare("SELECT * FROM incidents WHERE endpoint_id = ? AND workspace_id = ? AND status IN ('OPEN','ACKNOWLEDGED') LIMIT 1").bind(endpoint.id, endpoint.workspace_id).first<IncidentRow>();
	const lastResolved = await env.DB.prepare("SELECT resolved_at FROM incidents WHERE endpoint_id = ? AND workspace_id = ? AND status = 'RESOLVED' ORDER BY resolved_at DESC LIMIT 1").bind(endpoint.id, endpoint.workspace_id).first<{ resolved_at: string }>();
	const history = (await env.DB.prepare("SELECT id, endpoint_id, checked_at, status_code, latency_ms, outcome, error_message, incident_evaluated_at FROM check_results WHERE endpoint_id = ? AND checked_at <= ? AND (? IS NULL OR checked_at > ?) ORDER BY checked_at DESC, id DESC LIMIT ?").bind(endpoint.id, result.checked_at, lastResolved?.resolved_at ?? null, lastResolved?.resolved_at ?? null, MAX_THRESHOLD).all<ResultRow>()).results;
	const failureCount = history.findIndex((item) => item.outcome === "HEALTHY");
	const consecutiveFailures = failureCount === -1 ? history.length : failureCount;
	const recoveryCount = history.findIndex((item) => item.outcome !== "HEALTHY");
	const consecutiveRecoveries = recoveryCount === -1 ? history.length : recoveryCount;
	const failureThreshold = configuredInt(env.INCIDENT_FAILURE_THRESHOLD, DEFAULT_FAILURE_THRESHOLD);
	const recoveryThreshold = configuredInt(env.INCIDENT_RECOVERY_THRESHOLD, DEFAULT_RECOVERY_THRESHOLD);
	const now = evaluatedAt.toISOString();
	const mark = env.DB.prepare("UPDATE check_results SET incident_evaluated_at = ? WHERE id = ? AND incident_evaluated_at IS NULL").bind(now, result.id);

	if (result.outcome === "HEALTHY") {
		if (!active || consecutiveRecoveries < recoveryThreshold) { await mark.run(); return; }
		const eventId = `${active.id}:resolved`, deliveryId = `${active.id}:resolved-alert`;
		await env.DB.batch([
			env.DB.prepare("UPDATE incidents SET status='RESOLVED', latest_result_id=?, consecutive_failure_count=0, resolved_at=?, updated_at=? WHERE id=? AND status IN ('OPEN','ACKNOWLEDGED')").bind(result.id, now, now, active.id),
			env.DB.prepare("INSERT OR IGNORE INTO incident_events (id,incident_id,event_type,from_severity,to_severity,result_id,message,created_at) VALUES (?,?,'RESOLVED',?,?,?,'Endpoint recovered after healthy monitoring results.',?)").bind(eventId, active.id, active.severity, active.severity, result.id, now),
			env.DB.prepare("INSERT OR IGNORE INTO alert_deliveries (id,incident_id,incident_event_id,channel,deduplication_key,status,created_at,updated_at) VALUES (?,?,?,'WEBHOOK',?,'QUEUED',?,?)").bind(deliveryId, active.id, eventId, `incident:${active.id}:resolved`, now, now), mark,
		]);
		await publishAlert(env, alertMessage(deliveryId, active.id, eventId)); return;
	}

	if (!active && consecutiveFailures < failureThreshold) { await mark.run(); return; }
	const detail = reason(result, endpoint);
	if (!active) {
		const incidentId = crypto.randomUUID(), eventId = crypto.randomUUID(), deliveryId = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare("INSERT INTO incidents (id,workspace_id,endpoint_id,status,severity,title,summary,first_result_id,latest_result_id,consecutive_failure_count,started_at,created_at,updated_at) VALUES (?,?,?,'OPEN',?,?,?,?,?,?,?, ?,?)").bind(incidentId, endpoint.workspace_id, endpoint.id, result.outcome, `${endpoint.name} is ${result.outcome.toLowerCase()}`, detail, result.id, result.id, consecutiveFailures, history[Math.min(consecutiveFailures, history.length) - 1]?.checked_at ?? result.checked_at, now, now),
			env.DB.prepare("INSERT INTO incident_events (id,incident_id,event_type,from_severity,to_severity,result_id,message,created_at) VALUES (?,?,'OPENED',NULL,?,?,?,?)").bind(eventId, incidentId, result.outcome, result.id, `Incident opened after ${consecutiveFailures} consecutive unhealthy results.`, now),
			env.DB.prepare("INSERT INTO alert_deliveries (id,incident_id,incident_event_id,channel,deduplication_key,status,created_at,updated_at) VALUES (?,?,?,'WEBHOOK',?,'QUEUED',?,?)").bind(deliveryId, incidentId, eventId, `incident:${incidentId}:opened`, now, now), mark,
		]);
		await publishAlert(env, alertMessage(deliveryId, incidentId, eventId)); return;
	}

	if (active.severity === "DEGRADED" && result.outcome === "CRITICAL") {
		const eventId = crypto.randomUUID(), deliveryId = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare("UPDATE incidents SET severity='CRITICAL',title=?,summary=?,latest_result_id=?,consecutive_failure_count=?,updated_at=? WHERE id=? AND status IN ('OPEN','ACKNOWLEDGED')").bind(`${endpoint.name} is critical`, detail, result.id, consecutiveFailures, now, active.id),
			env.DB.prepare("INSERT OR IGNORE INTO incident_events (id,incident_id,event_type,from_severity,to_severity,result_id,message,created_at) VALUES (?,?,'SEVERITY_CHANGED','DEGRADED','CRITICAL',?,'Incident severity increased to CRITICAL.',?)").bind(eventId, active.id, result.id, now),
			env.DB.prepare("INSERT OR IGNORE INTO alert_deliveries (id,incident_id,incident_event_id,channel,deduplication_key,status,created_at,updated_at) VALUES (?,?,?,'WEBHOOK',?,'QUEUED',?,?)").bind(deliveryId, active.id, eventId, `incident:${active.id}:critical:${result.id}`, now, now), mark,
		]);
		await publishAlert(env, alertMessage(deliveryId, active.id, eventId)); return;
	}
	await env.DB.batch([env.DB.prepare("UPDATE incidents SET summary=?,latest_result_id=?,consecutive_failure_count=?,updated_at=? WHERE id=? AND status IN ('OPEN','ACKNOWLEDGED')").bind(detail, result.id, consecutiveFailures, now, active.id), mark]);
}

export async function recoverIncidentEvaluations(env: IncidentEnv): Promise<number> {
	const rows = (await env.DB.prepare("SELECT id FROM check_results WHERE incident_evaluated_at IS NULL ORDER BY checked_at ASC LIMIT ?").bind(RECOVERY_LIMIT).all<{ id: string }>()).results;
	for (const row of rows) { try { await evaluateIncident(env, row.id); } catch (error) { console.error("Incident evaluation deferred", { resultId: row.id, outcome: "retry", error: cleanError(error) }); } }
	return rows.length;
}

export async function recoverStaleAlerts(env: IncidentEnv, at = new Date()): Promise<number> {
	const stale = new Date(at.getTime() - STALE_ALERT_MS).toISOString();
	const rows = (await env.DB.prepare("SELECT id,incident_id,incident_event_id FROM alert_deliveries WHERE status='QUEUED' AND updated_at<=? ORDER BY updated_at LIMIT ?").bind(stale, RECOVERY_LIMIT).all<{ id: string; incident_id: string; incident_event_id: string }>()).results;
	for (let offset = 0; offset < rows.length; offset += 100) await env.ALERT_QUEUE.sendBatch(rows.slice(offset, offset + 100).map((row) => ({ body: alertMessage(row.id, row.incident_id, row.incident_event_id), contentType: "json" as const })));
	return rows.length;
}

function webhookBody(format: string, incident: IncidentRow, event: EventRow, endpoint: EndpointRow, result: ResultRow | null): unknown {
	const durationSeconds = incident.resolved_at ? Math.max(0, Math.round((Date.parse(incident.resolved_at) - Date.parse(incident.started_at)) / 1000)) : null;
	const data = { event: event.event_type, incidentId: incident.id, endpoint: endpoint.name, severity: incident.severity, status: incident.status, httpStatus: result?.status_code ?? null, latencyMs: result?.latency_ms ?? null, startedAt: incident.started_at, reason: incident.summary, recoveryDurationSeconds: durationSeconds };
	if (format === "discord") return { content: `Endpoint Sentinel: ${endpoint.name} — ${event.event_type === "RESOLVED" ? "recovered" : incident.severity}`, embeds: [{ title: incident.title, description: incident.summary, color: event.event_type === "RESOLVED" ? 0x1e8e4e : incident.severity === "CRITICAL" ? 0xc1392b : 0x9c6a12, fields: [{ name: "Incident", value: incident.id }, { name: "Started", value: incident.started_at }, { name: "HTTP status", value: String(result?.status_code ?? "No response"), inline: true }, { name: "Latency", value: result ? `${result.latency_ms} ms` : "Unavailable", inline: true }, ...(durationSeconds === null ? [] : [{ name: "Recovery duration", value: `${durationSeconds} seconds` }])] }] };
	return data;
}

export async function processAlertMessage(env: IncidentEnv, raw: unknown, attempts: number): Promise<"ack" | "retry"> {
	const message = parseAlertMessage(raw); if (!message) { console.warn("Rejected invalid alert queue message", { outcome: "invalid_message" }); return "ack"; }
	const delivery = await env.DB.prepare("SELECT * FROM alert_deliveries WHERE id=? AND incident_id=? AND incident_event_id=?").bind(message.deliveryId, message.incidentId, message.incidentEventId).first<AlertRow>();
	if (!delivery || delivery.status === "DELIVERED" || delivery.status === "FAILED" || delivery.status === "SKIPPED") return "ack";
	const now = new Date().toISOString();
	const claim = await env.DB.prepare("UPDATE alert_deliveries SET attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status='QUEUED' AND attempt_count=?").bind(now, delivery.id, delivery.attempt_count).run();
	if (!claim.meta.changes) { const current = await env.DB.prepare("SELECT status FROM alert_deliveries WHERE id=?").bind(delivery.id).first<{ status: AlertDelivery["status"] }>(); return current?.status === "QUEUED" ? "retry" : "ack"; }
	if (!env.ALERT_WEBHOOK_URL) { await env.DB.prepare("UPDATE alert_deliveries SET status='SKIPPED',last_error='Webhook is not configured.',updated_at=? WHERE id=? AND status='QUEUED'").bind(now, delivery.id).run(); return "ack"; }
	const incident = await env.DB.prepare("SELECT * FROM incidents WHERE id=?").bind(delivery.incident_id).first<IncidentRow>(), event = await env.DB.prepare("SELECT * FROM incident_events WHERE id=? AND incident_id=?").bind(delivery.incident_event_id, delivery.incident_id).first<EventRow>();
	if (!incident || !event) return "ack";
	const endpoint = await env.DB.prepare("SELECT id,workspace_id,name,expected_status FROM endpoints WHERE id=? AND workspace_id=?").bind(incident.endpoint_id, incident.workspace_id).first<EndpointRow>();
	if (!endpoint) { await env.DB.prepare("UPDATE alert_deliveries SET status='SKIPPED',last_error='Endpoint no longer exists.',updated_at=? WHERE id=?").bind(now, delivery.id).run(); return "ack"; }
	const alertResultId = event.result_id ?? incident.latest_result_id;
	const result = alertResultId ? await env.DB.prepare("SELECT id,endpoint_id,checked_at,status_code,latency_ms,outcome,error_message,incident_evaluated_at FROM check_results WHERE id=?").bind(alertResultId).first<ResultRow>() : null;
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS); let response: Response | null = null;
	try { response = await fetch(env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(webhookBody(env.ALERT_WEBHOOK_FORMAT, incident, event, endpoint, result)), signal: controller.signal, redirect: "error" }); void response.body?.cancel().catch(() => undefined); }
	catch (error) { clearTimeout(timer); const detail = error instanceof Error && error.name === "AbortError" ? "Webhook request timed out." : cleanError(error); if (attempts >= MAX_ALERT_ATTEMPTS) { await env.DB.prepare("UPDATE alert_deliveries SET status='FAILED',last_error=?,updated_at=? WHERE id=?").bind(detail, now, delivery.id).run(); return "ack"; } await env.DB.prepare("UPDATE alert_deliveries SET last_error=?,updated_at=? WHERE id=? AND status='QUEUED'").bind(detail, now, delivery.id).run(); return "retry"; }
	finally { clearTimeout(timer); }
	const status = response.status;
	if (status >= 200 && status < 300) { await env.DB.prepare("UPDATE alert_deliveries SET status='DELIVERED',response_status=?,last_error=NULL,delivered_at=?,updated_at=? WHERE id=? AND status='QUEUED'").bind(status, now, now, delivery.id).run(); return "ack"; }
	const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
	if (retryable && attempts < MAX_ALERT_ATTEMPTS) { await env.DB.prepare("UPDATE alert_deliveries SET response_status=?,last_error='Webhook returned a retryable HTTP status.',updated_at=? WHERE id=? AND status='QUEUED'").bind(status, now, delivery.id).run(); return "retry"; }
	await env.DB.prepare("UPDATE alert_deliveries SET status='FAILED',response_status=?,last_error=?,updated_at=? WHERE id=? AND status='QUEUED'").bind(status, retryable ? "Webhook retries were exhausted." : "Webhook rejected the alert.", now, delivery.id).run(); return "ack";
}

function encodeCursor(updatedAt: string, id: string): string { return btoa(`${updatedAt}|${id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decodeCursor(value: string): [string, string] | null { try { const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/")); const split = decoded.lastIndexOf("|"); if (split < 1) return null; const date = decoded.slice(0, split), id = decoded.slice(split + 1); return Number.isFinite(Date.parse(date)) && id ? [date, id] : null; } catch { return null; } }

export async function listIncidents(db: D1Database, workspaceId: string, query: URLSearchParams): Promise<IncidentPage> {
	const status = query.get("status"), severity = query.get("severity"), endpointId = query.get("endpointId"), limit = Number(query.get("limit") ?? "25"), cursorRaw = query.get("cursor"), cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
	if (status && !["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(status)) throw new Error("VALIDATION:status must be OPEN, ACKNOWLEDGED, or RESOLVED.");
	if (severity && !["DEGRADED", "CRITICAL"].includes(severity)) throw new Error("VALIDATION:severity must be DEGRADED or CRITICAL.");
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("VALIDATION:limit must be an integer from 1 to 100.");
	if (cursorRaw && !cursor) throw new Error("VALIDATION:cursor is invalid.");
	const clauses = ["i.workspace_id = ?"], values: unknown[] = [workspaceId];
	if (status) { clauses.push("i.status = ?"); values.push(status); } if (severity) { clauses.push("i.severity = ?"); values.push(severity); } if (endpointId) { clauses.push("i.endpoint_id = ?"); values.push(endpointId); } if (cursor) { clauses.push("(i.updated_at < ? OR (i.updated_at = ? AND i.id < ?))"); values.push(cursor[0], cursor[0], cursor[1]); }
	values.push(limit + 1); const rows = (await db.prepare(`SELECT i.*, e.name AS endpoint_name FROM incidents i JOIN endpoints e ON e.id=i.endpoint_id WHERE ${clauses.join(" AND ")} ORDER BY i.updated_at DESC, i.id DESC LIMIT ?`).bind(...values).all<IncidentRow>()).results; const hasMore = rows.length > limit, page = rows.slice(0, limit), last = page.at(-1);
	const counts = await db.prepare("SELECT SUM(CASE WHEN status IN ('OPEN','ACKNOWLEDGED') THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN status IN ('OPEN','ACKNOWLEDGED') AND severity='CRITICAL' THEN 1 ELSE 0 END) AS critical, SUM(CASE WHEN status='RESOLVED' THEN 1 ELSE 0 END) AS resolved FROM incidents WHERE workspace_id=?").bind(workspaceId).first<{ open: number | null; critical: number | null; resolved: number | null }>();
	return { items: page.map(incidentFromRow), nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : null, counts: { open: counts?.open ?? 0, critical: counts?.critical ?? 0, resolved: counts?.resolved ?? 0 } };
}
export async function getIncident(db: D1Database, workspaceId: string, id: string): Promise<IncidentDetail | null> { const row = await db.prepare("SELECT i.*,e.name AS endpoint_name FROM incidents i JOIN endpoints e ON e.id=i.endpoint_id WHERE i.id=? AND i.workspace_id=?").bind(id, workspaceId).first<IncidentRow>(); return row ? incidentFromRow(row) : null; }
export async function getIncidentEvents(db: D1Database, workspaceId: string, id: string): Promise<IncidentEvent[] | null> { if (!await getIncident(db, workspaceId, id)) return null; return (await db.prepare("SELECT * FROM incident_events WHERE incident_id=? ORDER BY created_at ASC,id ASC").bind(id).all<EventRow>()).results.map(eventFromRow); }
export async function getIncidentAlerts(db: D1Database, workspaceId: string, id: string): Promise<AlertDelivery[] | null> { if (!await getIncident(db, workspaceId, id)) return null; return (await db.prepare("SELECT * FROM alert_deliveries WHERE incident_id=? ORDER BY created_at DESC,id DESC").bind(id).all<AlertRow>()).results.map(alertFromRow); }

export async function acknowledgeIncident(db: D1Database, workspaceId: string, id: string, at = new Date()): Promise<IncidentDetail | null | "CONFLICT"> {
	const incident = await getIncident(db, workspaceId, id); if (!incident) return null; if (incident.status !== "OPEN") return "CONFLICT"; const now = at.toISOString(), eventId = `${id}:acknowledged`; await db.batch([db.prepare("INSERT OR IGNORE INTO incident_events (id,incident_id,event_type,from_severity,to_severity,result_id,message,created_at) VALUES (?,?,'ACKNOWLEDGED',?,?,NULL,'Incident acknowledged manually.',?)").bind(eventId, id, incident.severity, incident.severity, now), db.prepare("UPDATE incidents SET status='ACKNOWLEDGED',acknowledged_at=COALESCE(acknowledged_at,?),updated_at=? WHERE id=? AND workspace_id=? AND status='OPEN'").bind(now, now, id, workspaceId)]); return getIncident(db, workspaceId, id); }
export async function resolveIncident(env: IncidentEnv, workspaceId: string, id: string, at = new Date()): Promise<IncidentDetail | null | "CONFLICT"> {
	const incident = await getIncident(env.DB, workspaceId, id); if (!incident) return null; if (incident.status === "RESOLVED") return "CONFLICT"; const now = at.toISOString(), eventId = `${id}:resolved`, deliveryId = `${id}:resolved-alert`; await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO incident_events (id,incident_id,event_type,from_severity,to_severity,result_id,message,created_at) VALUES (?,?,'RESOLVED',?,?,NULL,'Incident resolved manually.',?)").bind(eventId, id, incident.severity, incident.severity, now), env.DB.prepare("INSERT OR IGNORE INTO alert_deliveries (id,incident_id,incident_event_id,channel,deduplication_key,status,created_at,updated_at) VALUES (?,?,?,'WEBHOOK',?,'QUEUED',?,?)").bind(deliveryId, id, eventId, `incident:${id}:resolved`, now, now), env.DB.prepare("UPDATE incidents SET status='RESOLVED',resolved_at=COALESCE(resolved_at,?),updated_at=? WHERE id=? AND workspace_id=? AND status IN ('OPEN','ACKNOWLEDGED')").bind(now, now, id, workspaceId)]); await publishAlert(env, alertMessage(deliveryId, id, eventId)); return getIncident(env.DB, workspaceId, id);
}

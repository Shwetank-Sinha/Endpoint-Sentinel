import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, SELF } from "cloudflare:test";
import { DEFAULT_WORKSPACE_ID } from "../worker/app";
import { acknowledgeIncident, evaluateIncident, processAlertMessage, recoverStaleAlerts, resolveIncident, type AlertQueueMessage } from "../worker/incidents";

const sent: AlertQueueMessage[] = [];
const alertQueue = {
	async send(body: AlertQueueMessage) { sent.push(body); },
	async sendBatch(messages: Iterable<MessageSendRequest<AlertQueueMessage>>) { for (const message of messages) sent.push(message.body); },
} as Queue<AlertQueueMessage>;
const testEnv = (webhook?: string) => ({ DB: env.DB, MONITORING_QUEUE: env.MONITORING_QUEUE, ALERT_QUEUE: alertQueue, MAX_JOBS_PER_SCHEDULE: "100", INCIDENT_FAILURE_THRESHOLD: "2", INCIDENT_RECOVERY_THRESHOLD: "1", ALERT_WEBHOOK_FORMAT: "generic", ...(webhook ? { ALERT_WEBHOOK_URL: webhook } : {}) }) as Env & { ALERT_WEBHOOK_URL?: string };

async function endpoint(id: string, workspace = DEFAULT_WORKSPACE_ID) {
	await env.DB.prepare("INSERT INTO endpoints (id,workspace_id,name,url,method,expected_status,timeout_ms,latency_threshold_ms,check_interval_minutes,enabled,created_at,updated_at) VALUES (?,?,?,'https://status.example.test','GET',200,1000,500,5,1,'2026-09-19T10:00:00.000Z','2026-09-19T10:00:00.000Z')").bind(id, workspace, `Endpoint ${id}`).run();
}
async function result(endpointId: string, id: string, outcome: "HEALTHY" | "DEGRADED" | "CRITICAL", checkedAt: string) {
	const code = outcome === "CRITICAL" ? 500 : 200, latency = outcome === "DEGRADED" ? 900 : 50;
	await env.DB.prepare("INSERT INTO check_results (id,endpoint_id,checked_at,status_code,latency_ms,outcome,error_type,error_message) VALUES (?,?,?,?,?,?,NULL,NULL)").bind(id, endpointId, checkedAt, code, latency, outcome).run();
	await evaluateIncident(testEnv(), id, new Date(checkedAt));
}
async function openIncident(id: string) {
	await endpoint(id);
	await result(id, `${id}-r1`, "DEGRADED", "2026-09-19T10:01:00.000Z");
	await result(id, `${id}-r2`, "DEGRADED", "2026-09-19T10:02:00.000Z");
	return (await env.DB.prepare("SELECT id FROM incidents WHERE endpoint_id=?").bind(id).first<{ id: string }>())!.id;
}

beforeEach(async () => {
	sent.length = 0;
	await env.DB.prepare("DELETE FROM alert_deliveries").run();
	await env.DB.prepare("DELETE FROM incident_events").run();
	await env.DB.prepare("DELETE FROM incidents").run();
	await env.DB.prepare("DELETE FROM check_results").run();
	await env.DB.prepare("DELETE FROM monitoring_jobs").run();
	await env.DB.prepare("DELETE FROM endpoints").run();
	await env.DB.prepare("DELETE FROM workspaces WHERE id <> ?").bind(DEFAULT_WORKSPACE_ID).run();
});

describe("incident evaluation", () => {
	it("ignores one transient failure and opens once at the threshold", async () => {
		await endpoint("threshold");
		await result("threshold", "r1", "DEGRADED", "2026-09-19T10:01:00.000Z");
		expect(await env.DB.prepare("SELECT id FROM incidents").first()).toBeNull();
		await result("threshold", "r2", "DEGRADED", "2026-09-19T10:02:00.000Z");
		expect((await env.DB.prepare("SELECT COUNT(*) count FROM incidents").first<{ count: number }>())?.count).toBe(1);
		expect((await env.DB.prepare("SELECT COUNT(*) count FROM alert_deliveries").first<{ count: number }>())?.count).toBe(1);
	});

	it("does not duplicate an incident, event, or alert for repeated evaluation", async () => {
		const incidentId = await openIncident("duplicate");
		await evaluateIncident(testEnv(), "duplicate-r2");
		await result("duplicate", "duplicate-r3", "DEGRADED", "2026-09-19T10:03:00.000Z");
		expect((await env.DB.prepare("SELECT COUNT(*) count FROM incidents").first<{ count: number }>())?.count).toBe(1);
		expect((await env.DB.prepare("SELECT COUNT(*) count FROM incident_events WHERE incident_id=?").bind(incidentId).first<{ count: number }>())?.count).toBe(1);
		expect((await env.DB.prepare("SELECT COUNT(*) count FROM alert_deliveries WHERE incident_id=?").bind(incidentId).first<{ count: number }>())?.count).toBe(1);
	});

	it("escalates DEGRADED to CRITICAL and resolves after recovery", async () => {
		const incidentId = await openIncident("lifecycle");
		await result("lifecycle", "lifecycle-r3", "CRITICAL", "2026-09-19T10:03:00.000Z");
		expect(await env.DB.prepare("SELECT severity,status FROM incidents WHERE id=?").bind(incidentId).first()).toMatchObject({ severity: "CRITICAL", status: "OPEN" });
		await result("lifecycle", "lifecycle-r4", "HEALTHY", "2026-09-19T10:04:00.000Z");
		expect(await env.DB.prepare("SELECT status FROM incidents WHERE id=?").bind(incidentId).first()).toMatchObject({ status: "RESOLVED" });
		expect((await env.DB.prepare("SELECT event_type FROM incident_events WHERE incident_id=? ORDER BY created_at").bind(incidentId).all<{ event_type: string }>()).results.map((row) => row.event_type)).toEqual(["OPENED", "SEVERITY_CHANGED", "RESOLVED"]);
		expect((await env.DB.prepare("SELECT COUNT(*) count FROM alert_deliveries WHERE incident_id=?").bind(incidentId).first<{ count: number }>())?.count).toBe(3);
	});

	it("supports acknowledgement, manual resolution, and a new later incident", async () => {
		const incidentId = await openIncident("manual");
		expect(await acknowledgeIncident(env.DB, DEFAULT_WORKSPACE_ID, incidentId, new Date("2026-09-19T10:03:00.000Z"))).toMatchObject({ status: "ACKNOWLEDGED" });
		expect(await resolveIncident(testEnv(), DEFAULT_WORKSPACE_ID, incidentId, new Date("2026-09-19T10:04:00.000Z"))).toMatchObject({ status: "RESOLVED" });
		await result("manual", "manual-r3", "CRITICAL", "2026-09-19T10:05:00.000Z");
		await result("manual", "manual-r4", "CRITICAL", "2026-09-19T10:06:00.000Z");
		expect((await env.DB.prepare("SELECT COUNT(*) count FROM incidents WHERE endpoint_id='manual'").first<{ count: number }>())?.count).toBe(2);
		expect((await env.DB.prepare("SELECT event_type FROM incident_events WHERE incident_id=? ORDER BY created_at").bind(incidentId).all<{ event_type: string }>()).results.map((row) => row.event_type)).toEqual(["OPENED", "ACKNOWLEDGED", "RESOLVED"]);
	});
});

describe("webhook alert delivery", () => {
	async function firstDelivery(endpointId: string) { const incidentId = await openIncident(endpointId); const delivery = await env.DB.prepare("SELECT id,incident_event_id FROM alert_deliveries WHERE incident_id=?").bind(incidentId).first<{ id: string; incident_event_id: string }>(); return { incidentId, delivery: delivery!, message: { version: 1, deliveryId: delivery!.id, incidentId, incidentEventId: delivery!.incident_event_id } satisfies AlertQueueMessage }; }

	it("skips honestly when no webhook is configured", async () => {
		const item = await firstDelivery("missing-hook");
		expect(await processAlertMessage(testEnv(), item.message, 1)).toBe("ack");
		expect(await env.DB.prepare("SELECT status,last_error FROM alert_deliveries WHERE id=?").bind(item.delivery.id).first()).toMatchObject({ status: "SKIPPED", last_error: "Webhook is not configured." });
	});

	it("delivers successfully and ignores duplicate delivery", async () => {
		const webhook = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 204 }));
		const item = await firstDelivery("success-hook"), configured = testEnv("https://webhook-success.example.test/token-secret");
		expect(await processAlertMessage(configured, item.message, 1)).toBe("ack");
		expect(webhook).toHaveBeenCalledWith("https://webhook-success.example.test/token-secret", expect.objectContaining({ redirect: "manual" }));
		expect(await processAlertMessage(configured, item.message, 2)).toBe("ack");
		expect(await env.DB.prepare("SELECT status,attempt_count,response_status FROM alert_deliveries WHERE id=?").bind(item.delivery.id).first()).toMatchObject({ status: "DELIVERED", attempt_count: 1, response_status: 204 });
		webhook.mockRestore();
	});

	it("uses accurate Discord wording for automatic recovery and manual resolution", async () => {
		const webhook = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
		const incidentId = await openIncident("recovery-copy");
		await result("recovery-copy", "recovery-copy-critical", "CRITICAL", "2026-09-19T10:03:00.000Z");
		await result("recovery-copy", "recovery-copy-healthy", "HEALTHY", "2026-09-19T10:04:00.000Z");
		const recovery = await env.DB.prepare("SELECT a.id,a.incident_event_id FROM alert_deliveries a JOIN incident_events e ON e.id=a.incident_event_id WHERE a.incident_id=? AND e.event_type='RESOLVED'").bind(incidentId).first<{ id: string; incident_event_id: string }>();
		await processAlertMessage({ ...testEnv("https://webhook-success.example.test"), ALERT_WEBHOOK_FORMAT: "discord" }, { version: 1, deliveryId: recovery!.id, incidentId, incidentEventId: recovery!.incident_event_id }, 1);
		const recoveryBody = JSON.parse(String(webhook.mock.calls.at(-1)?.[1]?.body)) as { content: string; embeds: Array<{ title: string; description: string; fields: Array<{ name: string; value: string }> }> };
		expect(recoveryBody.content).toContain("recovered");
		expect(recoveryBody.embeds[0]).toMatchObject({ title: "Endpoint recovery-copy recovered", description: "Endpoint recovered after healthy monitoring results." });
		expect(recoveryBody.embeds[0]?.title.toLowerCase()).not.toContain("critical");
		expect(recoveryBody.embeds[0]?.fields).toContainEqual({ name: "Recovery duration", value: "180 seconds" });

		const manualId = await openIncident("manual-copy");
		await resolveIncident(testEnv(), DEFAULT_WORKSPACE_ID, manualId, new Date("2026-09-19T10:05:00.000Z"));
		const manual = await env.DB.prepare("SELECT a.id,a.incident_event_id FROM alert_deliveries a JOIN incident_events e ON e.id=a.incident_event_id WHERE a.incident_id=? AND e.event_type='RESOLVED'").bind(manualId).first<{ id: string; incident_event_id: string }>();
		await processAlertMessage({ ...testEnv("https://webhook-success.example.test"), ALERT_WEBHOOK_FORMAT: "discord" }, { version: 1, deliveryId: manual!.id, incidentId: manualId, incidentEventId: manual!.incident_event_id }, 1);
		const manualBody = JSON.parse(String(webhook.mock.calls.at(-1)?.[1]?.body)) as { content: string; embeds: Array<{ title: string; description: string }> };
		expect(manualBody.content).toContain("incident resolved");
		expect(manualBody.embeds[0]).toMatchObject({ title: "Endpoint manual-copy incident resolved", description: "Incident resolved manually." });
		webhook.mockRestore();
	});

	it("claims concurrent duplicate alert deliveries only once", async () => {
		const webhook = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
		const item = await firstDelivery("concurrent-hook"), configured = testEnv("https://webhook-success.example.test");
		await Promise.all([processAlertMessage(configured, item.message, 1), processAlertMessage(configured, item.message, 1)]);
		expect(webhook).toHaveBeenCalledTimes(1);
		expect(await env.DB.prepare("SELECT status,attempt_count FROM alert_deliveries WHERE id=?").bind(item.delivery.id).first()).toMatchObject({ status: "DELIVERED", attempt_count: 1 });
		webhook.mockRestore();
	});

	it("retries retryable responses and fails permanent responses", async () => {
		const webhook = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 429 })).mockResolvedValueOnce(new Response(null, { status: 400 }));
		const retry = await firstDelivery("retry-hook");
		expect(await processAlertMessage(testEnv("https://webhook-retry.example.test"), retry.message, 1)).toBe("retry");
		expect(await env.DB.prepare("SELECT status,response_status FROM alert_deliveries WHERE id=?").bind(retry.delivery.id).first()).toMatchObject({ status: "QUEUED", response_status: 429 });
		const failed = await firstDelivery("failed-hook");
		expect(await processAlertMessage(testEnv("https://webhook-failed.example.test"), failed.message, 1)).toBe("ack");
		expect(await env.DB.prepare("SELECT status,response_status FROM alert_deliveries WHERE id=?").bind(failed.delivery.id).first()).toMatchObject({ status: "FAILED", response_status: 400 });
		webhook.mockRestore();
	});

	it("recovers stale queued alert deliveries", async () => {
		await firstDelivery("stale-hook"); sent.length = 0;
		await env.DB.prepare("UPDATE alert_deliveries SET updated_at='2026-09-19T10:00:00.000Z'").run();
		expect(await recoverStaleAlerts(testEnv(), new Date("2026-09-19T10:10:00.000Z"))).toBe(1);
		expect(sent).toHaveLength(1);
	});
});

describe("incident API", () => {
	it("isolates workspaces and validates filters and pagination", async () => {
		await env.DB.prepare("INSERT INTO workspaces (id,name) VALUES ('other-incidents','Other')").run(); await endpoint("foreign-incident", "other-incidents");
		await env.DB.prepare("INSERT INTO incidents (id,workspace_id,endpoint_id,status,severity,title,summary,consecutive_failure_count,started_at,created_at,updated_at) VALUES ('foreign-i','other-incidents','foreign-incident','OPEN','CRITICAL','Foreign','Hidden',2,'2026-09-19T10:00:00.000Z','2026-09-19T10:00:00.000Z','2026-09-19T10:00:00.000Z')").run();
		expect(((await (await SELF.fetch("https://app.test/api/incidents")).json()) as { data: { items: unknown[] } }).data.items).toEqual([]);
		for (const query of ["status=BAD", "severity=BAD", "limit=0", "cursor=bad"]) expect((await SELF.fetch(`https://app.test/api/incidents?${query}`)).status).toBe(400);
		await openIncident("api-one"); await openIncident("api-two");
		const page = await SELF.fetch("https://app.test/api/incidents?status=OPEN&severity=DEGRADED&limit=1"); expect(page.status).toBe(200); const data = (await page.json() as { data: { items: unknown[]; nextCursor: string } }).data; expect(data.items).toHaveLength(1); expect(data.nextCursor).toEqual(expect.any(String));
	});
});

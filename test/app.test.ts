import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, SELF } from "cloudflare:test";
import { DEFAULT_WORKSPACE_ID, executeCheck, parseQueueMessage, processQueueMessage, scheduleChecks, scheduledBucket, type MonitoringQueueMessage } from "../worker/app";

const payload = { name: "Payments API", url: "https://status.example.test/health", method: "GET", expectedStatus: 200, timeoutMs: 5000, latencyThresholdMs: 800, checkIntervalMinutes: 5, enabled: true };
async function json(response: Response) { return response.json() as Promise<Record<string, unknown>>; }

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM alert_deliveries").run();
	await env.DB.prepare("DELETE FROM incident_events").run();
	await env.DB.prepare("DELETE FROM incidents").run();
	await env.DB.prepare("DELETE FROM check_results").run();
	await env.DB.prepare("DELETE FROM monitoring_jobs").run();
	await env.DB.prepare("DELETE FROM endpoints").run();
	await env.DB.prepare("DELETE FROM workspaces WHERE id <> ?").bind("00000000-0000-4000-8000-000000000001").run();
});

describe("endpoint validation", () => {
	it("rejects credentials and private targets with a consistent envelope", async () => {
		for (const url of ["https://user:pass@example.com", "http://127.0.0.1/admin", "ftp://example.com"]) {
			const response = await SELF.fetch("https://app.test/api/endpoints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, url }) });
			expect(response.status).toBe(400);
			expect(await json(response)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
		}
	});
});

describe("D1 endpoint API", () => {
	it("creates, reads, updates, and deletes an endpoint", async () => {
		const createdResponse = await SELF.fetch("https://app.test/api/endpoints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
		expect(createdResponse.status).toBe(201);
		const created = (await json(createdResponse)).data as { id: string; name: string };
		expect(created.name).toBe(payload.name);
		const listed = (await json(await SELF.fetch("https://app.test/api/endpoints"))).data as unknown[];
		expect(listed).toHaveLength(1);
		const updated = await SELF.fetch(`https://app.test/api/endpoints/${created.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Billing API" }) });
		expect((await json(updated)).data).toMatchObject({ name: "Billing API" });
		expect((await SELF.fetch(`https://app.test/api/endpoints/${created.id}`, { method: "DELETE" })).status).toBe(204);
		expect((await json(await SELF.fetch("https://app.test/api/endpoints"))).data).toEqual([]);
	});

	it("does not expose another workspace's endpoint", async () => {
		await env.DB.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").bind("other", "Other").run();
		await env.DB.prepare("INSERT INTO endpoints (id, workspace_id, name, url, method, expected_status, timeout_ms, latency_threshold_ms, check_interval_minutes, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("foreign", "other", "Secret", "https://other.example.test", "GET", 200, 5000, 800, 5, 1).run();
		expect((await json(await SELF.fetch("https://app.test/api/endpoints"))).data).toEqual([]);
		expect((await SELF.fetch("https://app.test/api/endpoints/foreign")).status).toBe(404);
	});

	it("creates an asynchronous manual job, polls it, and persists one result", async () => {
		const createResponse = await SELF.fetch("https://app.test/api/endpoints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
		const id = ((await json(createResponse)).data as { id: string }).id;
		const checkResponse = await SELF.fetch(`https://app.test/api/endpoints/${id}/check`, { method: "POST" });
		expect(checkResponse.status).toBe(202);
		const queued = (await json(checkResponse)).data as { jobId: string; status: string };
		expect(queued.status).toBe("QUEUED");
		const row = await env.DB.prepare("SELECT * FROM monitoring_jobs WHERE id = ?").bind(queued.jobId).first<{ endpoint_id: string; scheduled_for: string }>();
		expect(row).not.toBeNull();
		const message: MonitoringQueueMessage = { version: 1, jobId: queued.jobId, workspaceId: DEFAULT_WORKSPACE_ID, endpointId: id, scheduledFor: row!.scheduled_for, source: "MANUAL" };
		expect(await processQueueMessage(env, message, 1)).toBe("ack");
		const polled = (await json(await SELF.fetch(`https://app.test/api/jobs/${queued.jobId}`))).data as { status: string; result: unknown };
		expect(polled).toMatchObject({ status: "COMPLETED", result: { status: "HEALTHY", actualStatusCode: 200 } });
		expect(await processQueueMessage(env, message, 2)).toBe("ack");
		const history = (await json(await SELF.fetch(`https://app.test/api/endpoints/${id}/results?limit=50`))).data as unknown[];
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({ id: expect.any(String), status: "HEALTHY", actualStatusCode: 200, checkedAt: expect.any(String), latencyMs: expect.any(Number) });
		const refreshed = (await json(await SELF.fetch("https://app.test/api/endpoints"))).data as Array<{ id: string; latestResult: unknown; activeJobStatus: unknown }>;
		expect(refreshed.find((endpoint) => endpoint.id === id)).toMatchObject({ latestResult: { status: "HEALTHY" }, activeJobStatus: null });
	});

	it("keeps job polling scoped to the default workspace", async () => {
		await env.DB.prepare("INSERT INTO workspaces (id, name) VALUES ('other-jobs', 'Other jobs')").run();
		await env.DB.prepare("INSERT INTO endpoints (id, workspace_id, name, url, method, expected_status, timeout_ms, latency_threshold_ms, check_interval_minutes, enabled) VALUES ('foreign-endpoint', 'other-jobs', 'Foreign', 'https://example.test', 'GET', 200, 5000, 800, 5, 1)").run();
		const now = new Date().toISOString();
		await env.DB.prepare("INSERT INTO monitoring_jobs (id, workspace_id, endpoint_id, deduplication_key, source, status, scheduled_for, created_at, updated_at) VALUES ('foreign-job', 'other-jobs', 'foreign-endpoint', 'foreign-key', 'MANUAL', 'QUEUED', ?, ?, ?)").bind(now, now, now).run();
		expect((await SELF.fetch("https://app.test/api/jobs/foreign-job")).status).toBe(404);
	});
});

describe("queue-driven scheduler", () => {
	async function insertEndpoint(id: string, enabled: boolean, createdAt: string, url = "https://status.example.test/health") {
		await env.DB.prepare("INSERT INTO endpoints (id, workspace_id, name, url, method, expected_status, timeout_ms, latency_threshold_ms, check_interval_minutes, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'GET', 200, 100, 800, 5, ?, ?, ?)").bind(id, DEFAULT_WORKSPACE_ID, id, url, enabled ? 1 : 0, createdAt, createdAt).run();
	}

	it("calculates stable buckets and schedules only due enabled endpoints once", async () => {
		const now = new Date("2026-09-19T12:10:30.000Z");
		expect(scheduledBucket("due", 5, now)).toEqual({ scheduledFor: "2026-09-19T12:10:00.000Z", deduplicationKey: `scheduled:due:${Date.parse("2026-09-19T12:10:00.000Z")}` });
		await insertEndpoint("due", true, "2026-09-19T12:00:00.000Z");
		await insertEndpoint("not-due", true, "2026-09-19T12:09:00.000Z");
		await insertEndpoint("paused", false, "2026-09-19T12:00:00.000Z");
		expect((await scheduleChecks(env, now)).due).toBe(1);
		await scheduleChecks(env, now);
		const jobs = await env.DB.prepare("SELECT endpoint_id FROM monitoring_jobs ORDER BY endpoint_id").all<{ endpoint_id: string }>();
		expect(jobs.results).toEqual([{ endpoint_id: "due" }]);
	});

	it("recovers stale queued jobs", async () => {
		await insertEndpoint("stale", true, "2026-09-19T12:09:00.000Z");
		await env.DB.prepare("INSERT INTO monitoring_jobs (id, workspace_id, endpoint_id, deduplication_key, source, status, scheduled_for, created_at, updated_at) VALUES ('stale-job', ?, 'stale', 'stale-key', 'MANUAL', 'QUEUED', '2026-09-19T12:00:00.000Z', '2026-09-19T12:00:00.000Z', '2026-09-19T12:00:00.000Z')").bind(DEFAULT_WORKSPACE_ID).run();
		expect((await scheduleChecks(env, new Date("2026-09-19T12:10:00.000Z"))).recovered).toBe(1);
	});
});

describe("queue consumer reliability", () => {
	async function queuedJob(id: string, url: string, enabled = true) {
		const now = "2026-09-19T12:00:00.000Z";
		await env.DB.prepare("INSERT INTO endpoints (id, workspace_id, name, url, method, expected_status, timeout_ms, latency_threshold_ms, check_interval_minutes, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'GET', 200, 100, 800, 5, ?, ?, ?)").bind(id, DEFAULT_WORKSPACE_ID, id, url, enabled ? 1 : 0, now, now).run();
		await env.DB.prepare("INSERT INTO monitoring_jobs (id, workspace_id, endpoint_id, deduplication_key, source, status, scheduled_for, created_at, updated_at) VALUES (?, ?, ?, ?, 'MANUAL', 'QUEUED', ?, ?, ?)").bind(`${id}-job`, DEFAULT_WORKSPACE_ID, id, `${id}-key`, now, now, now).run();
		return { version: 1, jobId: `${id}-job`, workspaceId: DEFAULT_WORKSPACE_ID, endpointId: id, scheduledFor: now, source: "MANUAL" } satisfies MonitoringQueueMessage;
	}

	it("treats HTTP 500 and timeout failures as monitoring results", async () => {
		for (const [id, url, errorType] of [["http500", "https://failing.example.test", null], ["timeout", "https://timeout.example.test", "TIMEOUT"]] as const) {
			const message = await queuedJob(id, url);
			expect(await processQueueMessage(env, message, 1)).toBe("ack");
			const result = await env.DB.prepare("SELECT outcome, status_code, error_type FROM check_results WHERE job_id = ?").bind(message.jobId).first<{ outcome: string; status_code: number | null; error_type: string | null }>();
			expect(result).toMatchObject({ outcome: "CRITICAL", error_type: errorType });
			if (id === "http500") expect(result?.status_code).toBe(500);
		}
	});

	it("classifies a network exception as a monitoring result", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("DNS unavailable"));
		const checked = await executeCheck({ url: "https://network.example.test", method: "GET", expectedStatus: 200, timeoutMs: 100, latencyThresholdMs: 800 });
		expect(checked).toMatchObject({ errorType: "NETWORK_ERROR", result: { status: "CRITICAL", actualStatusCode: null } });
		fetchMock.mockRestore();
	});

	it("retries infrastructure failure without persisting a result", async () => {
		const message = await queuedJob("infra", "https://status.example.test");
		const brokenDb = new Proxy(env.DB, { get(target, property) { if (property === "batch") return async () => { throw new Error("D1 unavailable"); }; const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });
		const brokenEnv = { DB: brokenDb, MONITORING_QUEUE: env.MONITORING_QUEUE, MAX_JOBS_PER_SCHEDULE: "100" } as Env;
		expect(await processQueueMessage(brokenEnv, message, 1)).toBe("retry");
		expect(await env.DB.prepare("SELECT status FROM monitoring_jobs WHERE id = ?").bind(message.jobId).first()).toMatchObject({ status: "QUEUED" });
		expect(await env.DB.prepare("SELECT id FROM check_results WHERE job_id = ?").bind(message.jobId).first()).toBeNull();
	});

	it("finalizes paused jobs and safely acknowledges jobs removed by endpoint deletion", async () => {
		const paused = await queuedJob("paused-consumer", "https://status.example.test", false);
		expect(await processQueueMessage(env, paused, 1)).toBe("ack");
		expect(await env.DB.prepare("SELECT status FROM monitoring_jobs WHERE id = ?").bind(paused.jobId).first()).toMatchObject({ status: "FAILED" });
		const deleted = await queuedJob("deleted-consumer", "https://status.example.test");
		await env.DB.prepare("DELETE FROM endpoints WHERE id = ?").bind(deleted.endpointId).run();
		expect(await processQueueMessage(env, deleted, 1)).toBe("ack");
	});

	it("rejects malformed queue payloads", async () => {
		expect(parseQueueMessage({ version: 2 })).toBeNull();
		expect(await processQueueMessage(env, { version: 1, jobId: "x" }, 1)).toBe("ack");
	});
});

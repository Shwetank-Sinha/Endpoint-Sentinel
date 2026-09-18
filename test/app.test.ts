import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";

const payload = { name: "Payments API", url: "https://status.example.test/health", method: "GET", expectedStatus: 200, timeoutMs: 5000, latencyThresholdMs: 800, checkIntervalMinutes: 5, enabled: true };
async function json(response: Response) { return response.json() as Promise<Record<string, unknown>>; }

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM check_results").run();
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

	it("persists a completed check and returns it as history", async () => {
		const createResponse = await SELF.fetch("https://app.test/api/endpoints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
		const id = ((await json(createResponse)).data as { id: string }).id;
		const checkResponse = await SELF.fetch(`https://app.test/api/endpoints/${id}/check`, { method: "POST" });
		expect(checkResponse.status).toBe(200);
		const history = (await json(await SELF.fetch(`https://app.test/api/endpoints/${id}/results?limit=50`))).data as unknown[];
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({ id: expect.any(String), status: "HEALTHY", actualStatusCode: 200, checkedAt: expect.any(String), latencyMs: expect.any(Number) });
	});
});

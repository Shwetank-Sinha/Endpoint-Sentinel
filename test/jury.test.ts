import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker, { processQueueMessage, type MonitoringQueueMessage } from "../worker/app";
import { DEFAULT_WORKSPACE_ID } from "../worker/auth";

const origin = "https://app.test";
const juryEnv = () => ({ ...env, PUBLIC_JURY_DEMO: "true" }) as Env;
const normalEnv = () => ({ ...env, PUBLIC_JURY_DEMO: "false" }) as Env;
async function request(path: string, init: RequestInit = {}, workspaceId = DEFAULT_WORKSPACE_ID, jury = true): Promise<Response> {
	const headers = new Headers(init.headers);
	if (workspaceId) headers.set("x-workspace-id", workspaceId);
	if (["POST", "PATCH", "PUT", "DELETE"].includes(init.method ?? "GET")) headers.set("origin", origin);
	return worker.fetch(new Request(`${origin}${path}`, { ...init, headers }), jury ? juryEnv() : normalEnv());
}
const json = async (response: Response) => response.json() as Promise<{ data?: any; error?: { code: string } }>;
const payload = (name: string, url: string) => ({ name, url, method: "GET", expectedStatus: 200, timeoutMs: 1000, latencyThresholdMs: 800, checkIntervalMinutes: 5, enabled: true });

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM alert_deliveries"), env.DB.prepare("DELETE FROM incident_events"), env.DB.prepare("DELETE FROM incidents"),
		env.DB.prepare("DELETE FROM check_results"), env.DB.prepare("DELETE FROM monitoring_jobs"), env.DB.prepare("DELETE FROM endpoints"),
		env.DB.prepare("DELETE FROM workspace_audit_events"), env.DB.prepare("DELETE FROM workspace_invitations"),
		env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM oauth_states"), env.DB.prepare("DELETE FROM workspace_memberships"),
		env.DB.prepare("DELETE FROM users"), env.DB.prepare("DELETE FROM workspaces WHERE id<>?").bind(DEFAULT_WORKSPACE_ID),
	]);
});

describe("temporary public jury mode", () => {
	it("opens the application and returns the default workspace without a session", async () => {
		const root = await request("/"); expect(root.status).toBe(200); expect(root.headers.get("content-type")).toContain("text/html");
		const session = await json(await request("/api/auth/session"));
		expect(session.data).toEqual({ juryMode: true, user: null, workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: "Default Workspace", slug: "default-workspace", role: "MEMBER" }] });
	});

	it("allows only the designated default workspace", async () => {
		await env.DB.prepare("INSERT INTO workspaces(id,name,slug) VALUES('other-jury','Other Jury','other-jury')").run();
		expect((await request("/api/endpoints", {}, "other-jury")).status).toBe(403);
		expect((await request("/api/workspaces")).status).toBe(200);
		expect((await request("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Forbidden" }) })).status).toBe(403);
		expect((await request(`/api/workspaces/${DEFAULT_WORKSPACE_ID}/members`)).status).toBe(403);
	});

	it("runs endpoint, job, history, and incident routes without a GitHub session", async () => {
		const created = await json(await request("/api/endpoints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload("Jury route test", "https://failing.example.test/health")) }));
		const endpointId = created.data.id as string;
		for (let index = 0; index < 2; index++) {
			const queued = await json(await request(`/api/endpoints/${endpointId}/check`, { method: "POST" }));
			const row = await env.DB.prepare("SELECT scheduled_for FROM monitoring_jobs WHERE id=?").bind(queued.data.jobId).first<{ scheduled_for: string }>();
			const message: MonitoringQueueMessage = { version: 1, jobId: queued.data.jobId, workspaceId: DEFAULT_WORKSPACE_ID, endpointId, scheduledFor: row!.scheduled_for, source: "MANUAL" };
			expect(await processQueueMessage(juryEnv(), message, 1)).toBe("ack");
			expect((await json(await request(`/api/jobs/${queued.data.jobId}`))).data.status).toBe("COMPLETED");
		}
		expect((await json(await request(`/api/endpoints/${endpointId}/results`))).data).toHaveLength(2);
		const incidents = await json(await request("/api/incidents")); expect(incidents.data.items).toHaveLength(1);
		const incidentId = incidents.data.items[0].id as string;
		expect((await request(`/api/incidents/${incidentId}`)).status).toBe(200);
		expect((await request(`/api/incidents/${incidentId}/events`)).status).toBe(200);
		expect((await request(`/api/incidents/${incidentId}/alerts`)).status).toBe(200);
		expect((await request(`/api/incidents/${incidentId}/acknowledge`, { method: "POST" })).status).toBe(200);
		expect((await request(`/api/incidents/${incidentId}/resolve`, { method: "POST" })).status).toBe(200);
		expect((await request(`/api/endpoints/${endpointId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) })).status).toBe(200);
		expect((await request(`/api/endpoints/${endpointId}`, { method: "DELETE" })).status).toBe(204);
	});

	it("keeps normal authentication and GitHub OAuth intact when disabled", async () => {
		expect((await request("/api/endpoints", {}, DEFAULT_WORKSPACE_ID, false)).status).toBe(401);
		const oauth = await request("/api/auth/github?returnTo=%2F", { redirect: "manual" }, DEFAULT_WORKSPACE_ID, false);
		expect(oauth.status).toBe(302); expect(oauth.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
	});
});

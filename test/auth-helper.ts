import { env, SELF } from "cloudflare:test";
import { DEFAULT_WORKSPACE_ID, hashToken, SESSION_COOKIE } from "../worker/auth";

export const TEST_TOKEN = "test-session-token-with-at-least-thirty-two-bytes";
export const TEST_USER_ID = "github:1001";

export async function installTestSession(role: "OWNER" | "MEMBER" = "OWNER", workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
	const now = new Date(), created = now.toISOString(), expires = new Date(now.getTime() + 3_600_000).toISOString();
	await env.DB.prepare("INSERT OR REPLACE INTO users(id,github_id,github_login,display_name,avatar_url,created_at,updated_at) VALUES(?,1001,'test-owner','Test Owner',NULL,?,?)").bind(TEST_USER_ID, created, created).run();
	await env.DB.prepare("INSERT OR REPLACE INTO workspace_memberships(workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?)").bind(workspaceId, TEST_USER_ID, role, created, created).run();
	await env.DB.prepare("INSERT OR REPLACE INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)").bind(await hashToken(TEST_TOKEN), TEST_USER_ID, expires, created, created).run();
}

export function apiFetch(input: string, init: RequestInit = {}, workspaceId = DEFAULT_WORKSPACE_ID): Promise<Response> {
	const headers = new Headers(init.headers); headers.set("cookie", `${SESSION_COOKIE}=${TEST_TOKEN}`); headers.set("x-workspace-id", workspaceId);
	if (["POST", "PATCH", "PUT", "DELETE"].includes(init.method ?? "GET")) headers.set("origin", "https://app.test");
	return SELF.fetch(input, { ...init, headers });
}

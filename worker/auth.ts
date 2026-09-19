import { ApiError, isRecord, success } from "./http";

export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const SESSION_COOKIE = "__Host-endpoint_sentinel_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

type AuthEnv = Env & { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; BOOTSTRAP_OWNER_GITHUB_LOGIN?: string; APP_BASE_URL?: string };
export type WorkspaceRole = "OWNER" | "MEMBER";
export interface SessionUser { id: string; githubId: number; githubLogin: string; displayName: string | null; avatarUrl: string | null }
export interface WorkspaceAccess { id: string; name: string; slug: string; role: WorkspaceRole }
export interface AuthContext { user: SessionUser; workspaces: WorkspaceAccess[] }

interface SessionRow { token_hash: string; expires_at: string; user_id: string; github_id: number; github_login: string; display_name: string | null; avatar_url: string | null }
interface GithubUser { id: number; login: string; name?: string | null; avatar_url?: string | null }

const bytes = (length: number) => { const value = new Uint8Array(length); crypto.getRandomValues(value); return value; };
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export async function hashToken(token: string): Promise<string> { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))); }
const randomToken = () => base64url(bytes(32));
const cookie = (token: string, maxAge: number) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
function cookieValue(request: Request): string | null { const raw = request.headers.get("cookie") ?? ""; for (const item of raw.split(";")) { const [name, ...rest] = item.trim().split("="); if (name === SESSION_COOKIE) return rest.join("=") || null; } return null; }
export function safeReturnPath(value: string | null): string { if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return "/"; try { const url = new URL(value, "https://sentinel.invalid"); return url.origin === "https://sentinel.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/"; } catch { return "/"; } }
function appBaseUrl(request: Request, env: AuthEnv): string { if (env.APP_BASE_URL) { const configured = new URL(env.APP_BASE_URL); if (configured.protocol !== "https:" && configured.hostname !== "localhost") throw new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured correctly."); return configured.origin; } return new URL(request.url).origin; }
function requireOAuthConfig(env: AuthEnv): asserts env is AuthEnv & { GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string } { if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new ApiError(503, "SERVICE_UNAVAILABLE", "GitHub authentication is not configured."); }
export async function cleanupAuth(db: D1Database, at = new Date()): Promise<void> { const now = at.toISOString(); await db.batch([db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now), db.prepare("DELETE FROM oauth_states WHERE expires_at<=?").bind(now)]); }

async function workspacesFor(db: D1Database, userId: string): Promise<WorkspaceAccess[]> { return (await db.prepare("SELECT w.id,w.name,w.slug,m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY m.created_at,w.id").bind(userId).all<{ id: string; name: string; slug: string; role: WorkspaceRole }>()).results; }
export async function authenticate(request: Request, db: D1Database, at = new Date()): Promise<AuthContext> {
	const token = cookieValue(request); if (!token || token.length < 32 || token.length > 128) throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
	const hash = await hashToken(token), now = at.toISOString();
	const row = await db.prepare("SELECT s.token_hash,s.expires_at,s.user_id,u.github_id,u.github_login,u.display_name,u.avatar_url FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?").bind(hash).first<SessionRow>();
	if (!row || row.expires_at <= now) { if (row) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(hash).run(); throw new ApiError(401, "UNAUTHORIZED", "Your session is invalid or has expired."); }
	await db.prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=? AND last_seen_at<?").bind(now, hash, new Date(at.getTime() - 60 * 60 * 1000).toISOString()).run();
	return { user: { id: row.user_id, githubId: row.github_id, githubLogin: row.github_login, displayName: row.display_name, avatarUrl: row.avatar_url }, workspaces: await workspacesFor(db, row.user_id) };
}
export function workspaceFor(request: Request, auth: AuthContext): WorkspaceAccess {
	const requested = request.headers.get("x-workspace-id");
	if (requested) { const found = auth.workspaces.find((workspace) => workspace.id === requested); if (!found) throw new ApiError(403, "FORBIDDEN", "You do not have access to that workspace."); return found; }
	if (auth.workspaces.length === 1) return auth.workspaces[0]!;
	if (auth.workspaces.length === 0) throw new ApiError(403, "FORBIDDEN", "Create or join a workspace to continue.");
	throw new ApiError(400, "VALIDATION_ERROR", "Select a workspace to continue.");
}
export function workspaceById(auth: AuthContext, id: string): WorkspaceAccess { const found = auth.workspaces.find((workspace) => workspace.id === id); if (!found) throw new ApiError(403, "FORBIDDEN", "You do not have access to that workspace."); return found; }
export function validateOrigin(request: Request, env: AuthEnv): void { if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return; const origin = request.headers.get("origin"); if (!origin || origin !== appBaseUrl(request, env)) throw new ApiError(403, "FORBIDDEN", "The request origin could not be verified."); }

export async function beginGithub(request: Request, env: AuthEnv): Promise<Response> {
	requireOAuthConfig(env); const state = randomToken(), now = new Date(), returnTo = safeReturnPath(new URL(request.url).searchParams.get("returnTo"));
	await cleanupAuth(env.DB, now); await env.DB.prepare("INSERT INTO oauth_states(state_hash,return_to,expires_at,created_at) VALUES(?,?,?,?)").bind(await hashToken(state), returnTo, new Date(now.getTime() + STATE_TTL_MS).toISOString(), now.toISOString()).run();
	const target = new URL("https://github.com/login/oauth/authorize"); target.searchParams.set("client_id", env.GITHUB_CLIENT_ID); target.searchParams.set("redirect_uri", `${appBaseUrl(request, env)}/api/auth/github/callback`); target.searchParams.set("state", state); target.searchParams.set("scope", "read:user");
	return Response.redirect(target.toString(), 302);
}
async function githubIdentity(code: string, request: Request, env: AuthEnv): Promise<GithubUser> {
	requireOAuthConfig(env); const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${appBaseUrl(request, env)}/api/auth/github/callback` }), redirect: "manual" });
	if (!tokenResponse.ok) throw new ApiError(502, "OAUTH_ERROR", "GitHub authentication could not be completed."); const tokenPayload: unknown = await tokenResponse.json(); if (!isRecord(tokenPayload) || typeof tokenPayload.access_token !== "string") throw new ApiError(400, "OAUTH_ERROR", "GitHub authentication was denied or could not be completed.");
	const identityResponse = await fetch("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${tokenPayload.access_token}`, "User-Agent": "Endpoint-Sentinel" }, redirect: "manual" });
	if (!identityResponse.ok) throw new ApiError(502, "OAUTH_ERROR", "The GitHub identity could not be retrieved."); const identity: unknown = await identityResponse.json(); if (!isRecord(identity) || typeof identity.id !== "number" || typeof identity.login !== "string" || !identity.login) throw new ApiError(502, "OAUTH_ERROR", "GitHub returned an invalid identity.");
	return { id: identity.id, login: identity.login, name: typeof identity.name === "string" ? identity.name : null, avatar_url: typeof identity.avatar_url === "string" ? identity.avatar_url : null };
}
export async function githubCallback(request: Request, env: AuthEnv): Promise<Response> {
	const url = new URL(request.url), state = url.searchParams.get("state");
	if (url.searchParams.has("error")) { let returnTo = "/"; if (state) { const stateHash = await hashToken(state), stored = await env.DB.prepare("SELECT return_to FROM oauth_states WHERE state_hash=?").bind(stateHash).first<{ return_to: string }>(); if (stored) { returnTo = safeReturnPath(stored.return_to); await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=?").bind(stateHash).run(); } } const target = new URL(returnTo, appBaseUrl(request, env)); target.searchParams.set("authError", "oauth_denied"); return new Response(null, { status: 302, headers: { Location: `${target.pathname}${target.search}${target.hash}` } }); }
	const code = url.searchParams.get("code"); if (!state || !code) throw new ApiError(400, "OAUTH_ERROR", "The OAuth callback is incomplete.");
	const stateHash = await hashToken(state), now = new Date(), stored = await env.DB.prepare("SELECT return_to,expires_at FROM oauth_states WHERE state_hash=?").bind(stateHash).first<{ return_to: string; expires_at: string }>();
	if (!stored || stored.expires_at <= now.toISOString()) { if (stored) await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=?").bind(stateHash).run(); throw new ApiError(400, "OAUTH_ERROR", "The OAuth request is invalid or has expired."); }
	await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=?").bind(stateHash).run(); const identity = await githubIdentity(code, request, env); const userId = `github:${identity.id}`, timestamp = now.toISOString();
	await env.DB.prepare("INSERT INTO users(id,github_id,github_login,display_name,avatar_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET github_login=excluded.github_login,display_name=excluded.display_name,avatar_url=excluded.avatar_url,updated_at=excluded.updated_at").bind(userId, identity.id, identity.login, identity.name ?? null, identity.avatar_url ?? null, timestamp, timestamp).run();
	if (env.BOOTSTRAP_OWNER_GITHUB_LOGIN && identity.login.toLowerCase() === env.BOOTSTRAP_OWNER_GITHUB_LOGIN.trim().toLowerCase()) await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO workspace_memberships(workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,'OWNER',?,?)").bind(DEFAULT_WORKSPACE_ID, userId, timestamp, timestamp), env.DB.prepare("UPDATE workspaces SET created_by=COALESCE(created_by,?) WHERE id=?").bind(userId, DEFAULT_WORKSPACE_ID)]);
	const oldToken = cookieValue(request); if (oldToken) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hashToken(oldToken)).run(); const token = randomToken(); await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)").bind(await hashToken(token), userId, new Date(now.getTime() + SESSION_TTL_MS).toISOString(), timestamp, timestamp).run();
	return new Response(null, { status: 302, headers: { Location: safeReturnPath(stored.return_to), "Set-Cookie": cookie(token, Math.floor(SESSION_TTL_MS / 1000)) } });
}
export async function sessionResponse(request: Request, env: AuthEnv): Promise<Response> { const auth = await authenticate(request, env.DB); return success(auth); }
export async function logout(request: Request, env: AuthEnv): Promise<Response> { validateOrigin(request, env); const token = cookieValue(request); if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hashToken(token)).run(); return new Response(null, { status: 204, headers: { "Set-Cookie": clearCookie() } }); }

export async function listWorkspaces(auth: AuthContext): Promise<Response> { return success(auth.workspaces); }
function slugify(name: string): string { return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace"; }
export async function createWorkspace(request: Request, env: AuthEnv, auth: AuthContext): Promise<Response> { validateOrigin(request, env); let body: unknown; try { body = await request.json(); } catch { throw new ApiError(400, "VALIDATION_ERROR", "Request body must be valid JSON."); } if (!isRecord(body) || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80) throw new ApiError(400, "VALIDATION_ERROR", "Workspace name must be 2-80 characters."); const id = crypto.randomUUID(), now = new Date().toISOString(), name = body.name.trim(), slug = `${slugify(name)}-${id.slice(0, 8)}`; await env.DB.batch([env.DB.prepare("INSERT INTO workspaces(id,name,slug,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id, name, slug, auth.user.id, now, now), env.DB.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,'OWNER',?,?)").bind(id, auth.user.id, now, now)]); return success({ id, name, slug, role: "OWNER" }, 201); }
export async function listMembers(db: D1Database, workspace: WorkspaceAccess): Promise<Response> { if (workspace.role !== "OWNER") throw new ApiError(403, "FORBIDDEN", "Only workspace owners can view members."); const rows = (await db.prepare("SELECT u.id,u.github_login,u.display_name,u.avatar_url,m.role,m.created_at FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at,u.github_login").bind(workspace.id).all()).results; return success(rows.map((row) => ({ id: row.id, githubLogin: row.github_login, displayName: row.display_name, avatarUrl: row.avatar_url, role: row.role, createdAt: row.created_at }))); }
export async function setMember(request: Request, env: AuthEnv, workspace: WorkspaceAccess): Promise<Response> {
	if (workspace.role !== "OWNER") throw new ApiError(403, "FORBIDDEN", "Only workspace owners can administer members.");
	let body: unknown; try { body = await request.json(); } catch { throw new ApiError(400, "VALIDATION_ERROR", "Request body must be valid JSON."); }
	if (!isRecord(body) || typeof body.githubLogin !== "string" || !body.githubLogin.trim() || (body.role !== "OWNER" && body.role !== "MEMBER")) throw new ApiError(400, "VALIDATION_ERROR", "Provide a GitHub login and an OWNER or MEMBER role.");
	const user = await env.DB.prepare("SELECT id FROM users WHERE github_login=? COLLATE NOCASE").bind(body.githubLogin.trim()).first<{ id: string }>();
	if (!user) throw new ApiError(404, "NOT_FOUND", "That user must sign in before they can be added.");
	const now = new Date().toISOString(); await env.DB.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at").bind(workspace.id, user.id, body.role, now, now).run(); return success({ userId: user.id, role: body.role }, 201);
}

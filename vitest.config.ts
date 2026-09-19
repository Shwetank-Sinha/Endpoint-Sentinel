import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [cloudflareTest(async () => ({
		wrangler: { configPath: "./wrangler.toml" },
		miniflare: {
			compatibilityDate: "2026-08-22",
			d1Databases: ["DB"],
			serviceBindings: { ASSETS: async () => new Response('<!doctype html><html><body><div id="root"></div></body></html>', { headers: { "content-type": "text/html; charset=utf-8" } }) },
			outboundService: async (request) => {
				const url = new URL(request.url);
				if (url.hostname === "github.com" && url.pathname === "/login/oauth/access_token") { const body = await request.text(); const code = new URLSearchParams(body).get("code") ?? ""; return Response.json({ access_token: `token-${code}`, token_type: "bearer" }); }
				if (url.hostname === "api.github.com" && url.pathname === "/user") { const normal = request.headers.get("authorization") === "Bearer token-normal"; return Response.json(normal ? { id: 2002, login: "normal-user", name: "Normal User", avatar_url: "https://avatars.githubusercontent.com/u/2002" } : { id: 1001, login: "test-owner", name: "Test Owner", avatar_url: "https://avatars.githubusercontent.com/u/1001" }); }
				if (url.hostname === "failing.example.test") return new Response("error", { status: 500 });
				if (url.hostname === "timeout.example.test") {
					await new Promise((resolve) => setTimeout(resolve, 250));
					return new Response("late", { status: 200 });
				}
				if (url.hostname === "network.example.test") throw new Error("simulated DNS failure");
				if (url.hostname === "webhook-success.example.test") return new Response(null, { status: 204 });
				if (url.hostname === "webhook-retry.example.test") return new Response(null, { status: 429 });
				if (url.hostname === "webhook-failed.example.test") return new Response(null, { status: 400 });
				return new Response("ok", { status: 200 });
			},
			bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations"), GITHUB_CLIENT_ID: "test-client-id", GITHUB_CLIENT_SECRET: "test-client-secret", BOOTSTRAP_OWNER_GITHUB_LOGIN: "test-owner", APP_BASE_URL: "https://app.test" },
		},
	}))],
	test: {
		setupFiles: ["./test/setup.ts"],
	},
});

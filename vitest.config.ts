import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [cloudflareTest(async () => ({
		wrangler: { configPath: "./wrangler.toml" },
		miniflare: {
			compatibilityDate: "2026-08-22",
			d1Databases: ["DB"],
			outboundService: async (request) => {
				const url = new URL(request.url);
				if (url.hostname === "failing.example.test") return new Response("error", { status: 500 });
				if (url.hostname === "timeout.example.test") {
					await new Promise((resolve) => setTimeout(resolve, 250));
					return new Response("late", { status: 200 });
				}
				if (url.hostname === "network.example.test") throw new Error("simulated DNS failure");
				return new Response("ok", { status: 200 });
			},
			bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
		},
	}))],
	test: {
		setupFiles: ["./test/setup.ts"],
	},
});

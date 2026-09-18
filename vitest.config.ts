import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [cloudflareTest(async () => ({
		wrangler: { configPath: "./wrangler.toml" },
		miniflare: {
			compatibilityDate: "2026-08-22",
			d1Databases: ["DB"],
			outboundService: () => new Response("ok", { status: 200 }),
			bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
		},
	}))],
	test: {
		setupFiles: ["./test/setup.ts"],
	},
});

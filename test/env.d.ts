declare module "cloudflare:test" {
	interface ProvidedEnv extends Env {
		DB: D1Database;
		TEST_MIGRATIONS: D1Migration[];
		ALERT_QUEUE: Queue;
		GITHUB_CLIENT_ID: string;
		GITHUB_CLIENT_SECRET: string;
		BOOTSTRAP_OWNER_GITHUB_LOGIN: string;
		APP_BASE_URL: string;
	}
}
export {};

import { describe, expect, it } from "vitest";
import { endpointInitial, endpointPresentation } from "../src/services/endpointPresentation";

describe("endpoint presentation", () => {
	it("preserves and visibly classifies complete HTTP and HTTPS URLs", () => {
		const secure = endpointPresentation("https://github.com/openai/example?token=private#status");
		expect(secure).toMatchObject({ protocol: "HTTPS", displayUrl: "https://github.com/openai/example?token=private#status", hostname: "github.com" });
		expect(secure.faviconUrl).toBe("https://icons.duckduckgo.com/ip3/github.com.ico");
		expect(secure.faviconUrl).not.toContain("token");
		const insecure = endpointPresentation("http://example.com/health");
		expect(insecure).toMatchObject({ protocol: "HTTP", displayUrl: "http://example.com/health" });
	});

	it("derives favicon requests from normalized hostnames for representative sites", () => {
		for (const [url, hostname] of [
			["https://www.youtube.com/watch?v=abc", "www.youtube.com"],
			["https://github.com/", "github.com"],
			["https://discord.com/channels/example", "discord.com"],
			["https://jsonplaceholder.typicode.com/todos/1", "jsonplaceholder.typicode.com"],
		] as const) {
			const presentation = endpointPresentation(url);
			expect(presentation.hostname).toBe(hostname);
			expect(presentation.faviconUrl).toBe(`https://icons.duckduckgo.com/ip3/${hostname}.ico`);
			expect(presentation.faviconUrl).not.toContain("private");
			expect(presentation.faviconUrl).not.toContain("secret");
		}
		const unknown = endpointPresentation("https://unknown-domain-for-sentinel.invalid/private?q=secret");
		expect(unknown).toMatchObject({ hostname: "unknown-domain-for-sentinel.invalid", faviconUrl: null });
	});

	it("handles malformed URLs and produces deterministic accessible fallback initials", () => {
		expect(endpointPresentation("not a URL")).toEqual({ href: null, displayUrl: "not a URL", protocol: null, hostname: null, faviconUrl: null });
		expect(endpointInitial("YouTube", "youtube.com")).toBe("Y");
		expect(endpointInitial("", "github.com")).toBe("G");
		expect(endpointInitial("", null)).toBe("?");
	});
});

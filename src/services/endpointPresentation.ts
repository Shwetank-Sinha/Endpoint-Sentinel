export interface EndpointPresentation {
	href: string | null;
	displayUrl: string;
	protocol: "HTTP" | "HTTPS" | null;
	hostname: string | null;
	faviconUrl: string | null;
}

export function endpointPresentation(rawUrl: string): EndpointPresentation {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported protocol");
		const hostname = parsed.hostname.toLowerCase();
		const reserved = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".invalid") || hostname.endsWith(".test") || hostname.endsWith(".example");
		return {
			href: parsed.toString(),
			displayUrl: parsed.toString(),
			protocol: parsed.protocol === "https:" ? "HTTPS" : "HTTP",
			hostname,
			faviconUrl: reserved ? null : `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`,
		};
	} catch {
		return { href: null, displayUrl: rawUrl, protocol: null, hostname: null, faviconUrl: null };
	}
}

export function endpointInitial(name: string, hostname: string | null): string {
	const source = name.trim() || hostname?.trim() || "?";
	return Array.from(source)[0]?.toLocaleUpperCase() ?? "?";
}

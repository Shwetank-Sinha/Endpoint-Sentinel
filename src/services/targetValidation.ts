import { HTTP_METHODS, type HttpMethod } from "../types/monitoring";

export const DEMO_PATHS = ["/api/demo/healthy", "/api/demo/slow", "/api/demo/failing"] as const;
export function isDemoPath(url: string): boolean { return (DEMO_PATHS as readonly string[]).includes(url); }

export const ENDPOINT_LIMITS = {
	nameMax: 120, timeoutMin: 100, timeoutMax: 120_000,
	thresholdMin: 1, thresholdMax: 120_000, intervalMin: 1, intervalMax: 10_080,
} as const;

export function validateUrl(value: string): string | null {
	const url = value.trim();
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Only HTTP and HTTPS URLs are supported.";
		if (!parsed.hostname) return "A hostname is required.";
		if (parsed.username || parsed.password) return "URLs must not contain embedded credentials.";
	} catch {
		return "Enter a valid absolute HTTP or HTTPS URL.";
	}
	return null;
}

export function validEndpointName(name: string): boolean {
	const trimmed = name.trim();
	return trimmed.length >= 2 && trimmed.length <= ENDPOINT_LIMITS.nameMax && /[\p{L}\p{N}]/u.test(trimmed);
}

export function isHttpMethod(value: unknown): value is HttpMethod {
	return typeof value === "string" && (HTTP_METHODS as readonly string[]).includes(value);
}

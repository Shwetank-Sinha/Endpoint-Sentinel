export const DEMO_PATHS = ["/api/demo/healthy", "/api/demo/slow", "/api/demo/failing"] as const;

export function isDemoPath(url: string): boolean {
	return (DEMO_PATHS as readonly string[]).includes(url);
}

export function validateUrl(value: string): string | null {
	const url = value.trim();
	if (isDemoPath(url)) return null;
	if (!/^https?:\/\//i.test(url)) {
		return "Use an absolute http:// or https:// URL, or /api/demo/healthy, /api/demo/slow or /api/demo/failing.";
	}
	try {
		const parsed = new URL(url);
		if (!parsed.hostname || parsed.username || parsed.password) return "Provide a hostname without embedded credentials.";
	} catch {
		return "Enter a valid HTTP or HTTPS URL.";
	}
	return null;
}

export function validEndpointName(name: string): boolean {
	return name.trim().length >= 2 && /[\p{L}\p{N}]/u.test(name);
}

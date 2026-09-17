import type { EndpointStatus } from "../types/dashboard";

const LABELS: Record<EndpointStatus, string> = {
	NOT_CHECKED: "Not Checked",
	CHECKING: "Checking",
	HEALTHY: "Healthy",
	DEGRADED: "Degraded",
	CRITICAL: "Critical",
	ERROR: "Check Failed",
};

interface StatusBadgeProps {
	status: EndpointStatus;
	label?: string;
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
	const isChecking = status === "CHECKING";
	const tone = status.toLowerCase().replace("_", "-");
	return (
		<span className={`es-badge es-badge--${tone}`}>
			{isChecking ? (
				<span className="es-spinner" aria-hidden="true" />
			) : (
				<span className="es-dot" aria-hidden="true" />
			)}
			{label ?? LABELS[status]}
		</span>
	);
}
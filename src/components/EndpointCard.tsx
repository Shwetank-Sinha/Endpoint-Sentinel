import type { DashboardEndpoint, EndpointStatus } from "../types/dashboard";
import StatusBadge from "./StatusBadge";

interface EndpointCardProps {
	endpoint: DashboardEndpoint;
	onCheck: (id: string) => void;
	onShowHistory: (id: string) => void;
}

/**
 * Explainable message per status, used whenever a live result/error is not
 * (yet) available so every card always says why it looks the way it does.
 */
const STATUS_EXPLANATIONS: Record<EndpointStatus, string> = {
	NOT_CHECKED: "No health check has run yet. Select “Check Now” for a reading.",
	CHECKING: "Health check in progress — measuring status code and latency.",
	HEALTHY: "",
	DEGRADED: "",
	CRITICAL: "",
	ERROR: "",
};

export default function EndpointCard({ endpoint, onCheck, onShowHistory }: EndpointCardProps) {
	const { id, name, target, status, result, error } = endpoint;
	const isChecking = status === "CHECKING";
	const detail = error ?? result?.reason ?? STATUS_EXPLANATIONS[status];

	return (
		<article className="es-card" aria-busy={isChecking}>
			<header className="es-card__header">
				<div className="es-card__heading">
					<h3 className="es-card__name">{name}</h3>
					<p className="es-card__url">
						<span className="es-card__method">{target.method}</span>
						<code className="es-card__code">{target.url}</code>
					</p>
				</div>
				<StatusBadge status={status} />
			</header>

			<dl className="es-card__meta">
				<div className="es-card__stat">
					<dt>Latency</dt>
					<dd>{result ? `${result.latencyMs} ms` : "—"}</dd>
				</div>
				<div className="es-card__stat">
					<dt>HTTP</dt>
					<dd>{result ? String(result.actualStatusCode ?? "none") : "—"}</dd>
				</div>
				<div className="es-card__stat">
					<dt>Expected</dt>
					<dd>{target.expectedStatus}</dd>
				</div>
			</dl>

			{detail ? (
				<p className="es-card__reason" aria-live="polite">
					{detail}
				</p>
			) : null}

			<footer className="es-card__footer">
				<div className="es-card__actions">
					<button
						type="button"
						className="es-btn"
						onClick={() => onShowHistory(id)}
					>
						History
					</button>
					<button
						type="button"
						className="es-btn"
						onClick={() => onCheck(id)}
						disabled={isChecking}
					>
						{isChecking ? "Checking…" : "Check Now"}
					</button>
				</div>
			</footer>
		</article>
	);
}
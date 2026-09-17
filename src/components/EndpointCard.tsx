import type { DashboardEndpoint, EndpointStatus } from "../types/dashboard";
import { isDemoPath } from "../services/targetValidation";
import StatusBadge from "./StatusBadge";

interface EndpointCardProps {
	endpoint: DashboardEndpoint;
	onCheck: (id: string) => void;
	onDelete: (id: string) => void;
	canDelete: boolean;
	lastCheckedAt: string | null;
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

export default function EndpointCard({ endpoint, onCheck, onShowHistory, onDelete, canDelete, lastCheckedAt }: EndpointCardProps) {
	const { id, name, target, status, result, error } = endpoint;
	const isChecking = status === "CHECKING";
	const detail = error ?? result?.reason ?? STATUS_EXPLANATIONS[status];

	return (
		<article className="es-card" aria-busy={isChecking}>
			<header className="es-card__header">
				<div className="es-card__heading">
					<h3 className="es-card__name">{name}</h3>
					<p className="es-form__hint">{isDemoPath(target.url) ? "Controlled Demo" : "External Endpoint"}</p>
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

			<p className="es-form__hint">{lastCheckedAt ? <>Last checked: <time dateTime={lastCheckedAt}>{new Date(lastCheckedAt).toLocaleString()}</time></> : "Not checked yet"}</p>

			{detail ? (
				<p className="es-card__reason" aria-live="polite">
					{detail}
				</p>
			) : null}

			<footer className="es-card__footer">
				<div className="es-card__actions">
					{canDelete ? <button type="button" className="es-btn" onClick={() => onDelete(id)}>Delete</button> : null}
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
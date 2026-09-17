import Modal from "./Modal";
import StatusBadge from "./StatusBadge";
import type { DashboardEndpoint, HistoryEntry } from "../types/dashboard";

interface HistoryModalProps {
	endpoint: DashboardEndpoint;
	history: HistoryEntry[];
	onClose: () => void;
}

function formatTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export default function HistoryModal({ endpoint, history, onClose }: HistoryModalProps) {
	return (
		<Modal title={`History — ${endpoint.name}`} onClose={onClose}>
			<div className="es-history-endpoint">
				<p className="es-history-endpoint__url">
					<span className="es-card__method">{endpoint.target.method}</span>
					<code className="es-card__code">{endpoint.target.url}</code>
				</p>
			</div>

			{history.length === 0 ? (
				<p className="es-history__empty">No results recorded yet for this endpoint.</p>
			) : (
				<ul className="es-history">
					{history.map((entry) => {
						const detail = entry.error ?? entry.result?.reason;
						return (
							<li
								key={entry.result?.id ?? `error-${entry.checkedAt}`}
								className="es-history__item"
							>
								<header className="es-history__header">
									<StatusBadge status={entry.status} />
									<time className="es-history__time" dateTime={entry.checkedAt}>
										{formatTime(entry.checkedAt)}
									</time>
								</header>

								<dl className="es-history__meta">
									<div className="es-card__stat">
										<dt>Latency</dt>
										<dd>
											{entry.result ? `${entry.result.latencyMs} ms` : "—"}
										</dd>
									</div>
									<div className="es-card__stat">
										<dt>HTTP</dt>
										<dd>
											{entry.result
												? String(entry.result.actualStatusCode ?? "none")
												: "—"}
										</dd>
									</div>
								</dl>

								{detail ? <p className="es-history__reason">{detail}</p> : null}
							</li>
						);
					})}
				</ul>
			)}
		</Modal>
	);
}
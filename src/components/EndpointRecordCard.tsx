import type { EndpointRecord } from "../types/monitoring";
import StatusBadge from "./StatusBadge";

interface Props { endpoint: EndpointRecord; checking: boolean; queued: boolean; onCheck: () => void; onToggle: () => void; onDetails: () => void; onDelete: () => void }
const formatTime = (value: Date | string) => new Date(value).toLocaleString();

export default function EndpointRecordCard({ endpoint, checking, queued, onCheck, onToggle, onDetails, onDelete }: Props) {
	const result = endpoint.latestResult;
	const activity = checking ? "PROCESSING" : queued ? "QUEUED" : endpoint.activeJobStatus;
	const nextCheck = endpoint.enabled ? new Date((result ? Date.parse(result.checkedAt) : Date.parse(endpoint.createdAt)) + endpoint.checkIntervalMinutes * 60_000) : null;
	return <article className="es-card" aria-busy={activity !== null}>
		<header className="es-card__header"><div className="es-card__heading"><h3 className="es-card__name">{endpoint.name}</h3><p className="es-card__url"><span className="es-card__method">{endpoint.method}</span><code className="es-card__code">{endpoint.url}</code></p></div>{!endpoint.enabled ? <StatusBadge status="NOT_CHECKED" label="Paused" /> : activity ? <StatusBadge status="CHECKING" label={activity === "QUEUED" ? "Queued" : "Checking"} /> : <StatusBadge status={result?.status ?? "NOT_CHECKED"} />}</header>
		<dl className="es-card__meta"><div className="es-card__stat"><dt>Latency</dt><dd>{result ? `${result.latencyMs} ms` : "—"}</dd></div><div className="es-card__stat"><dt>HTTP</dt><dd>{result?.actualStatusCode ?? "—"}</dd></div><div className="es-card__stat"><dt>Interval</dt><dd>{endpoint.checkIntervalMinutes} min</dd></div></dl>
		<p className="es-form__hint">Last checked: {result ? <time dateTime={result.checkedAt}>{formatTime(result.checkedAt)}</time> : "Not yet"}<br />Next check: {nextCheck ? <time dateTime={nextCheck.toISOString()}>{formatTime(nextCheck)}</time> : "Paused"}</p>
		{result ? <p className="es-card__reason">{result.reason}</p> : null}
		{endpoint.activeIncident ? <button className={`es-incident-link es-incident-link--${endpoint.activeIncident.severity.toLowerCase()}`} type="button" onClick={onDetails}>Active {endpoint.activeIncident.severity.toLowerCase()} incident · {endpoint.activeIncident.status.toLowerCase()}</button> : null}
		<footer className="es-card__footer"><div className="es-card__actions"><button className="es-btn" type="button" onClick={onDelete}>Delete</button><button className="es-btn" type="button" onClick={onDetails}>Details</button><button className="es-btn" type="button" onClick={onToggle}>{endpoint.enabled ? "Pause" : "Enable"}</button><button className="es-btn" type="button" onClick={onCheck} disabled={activity !== null || !endpoint.enabled}>{activity === "QUEUED" ? "Queued" : activity ? "Checking…" : "Check Now"}</button></div></footer>
	</article>;
}

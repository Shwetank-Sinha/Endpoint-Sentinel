import type { EndpointRecord } from "../types/monitoring";
import EndpointIdentity from "./EndpointIdentity";
import StatusBadge from "./StatusBadge";

interface Props { endpoint: EndpointRecord; checking: boolean; queued: boolean; onCheck: () => void; onToggle: () => void; onEdit: () => void; onDetails: () => void; onIncident: () => void; onDelete: () => void }
const formatTime = (value: Date | string) => new Date(value).toLocaleString();

export default function EndpointRecordCard({ endpoint, checking, queued, onCheck, onToggle, onEdit, onDetails, onIncident, onDelete }: Props) {
	const result = endpoint.latestResult;
	const activity = checking ? "PROCESSING" : queued ? "QUEUED" : endpoint.activeJobStatus;
	const nextCheck = endpoint.enabled ? new Date((result ? Date.parse(result.checkedAt) : Date.parse(endpoint.createdAt)) + endpoint.checkIntervalMinutes * 60_000) : null;
	return <article className="es-card" aria-busy={activity !== null}>
		<header className="es-card__header"><EndpointIdentity name={endpoint.name} url={endpoint.url} method={endpoint.method} />{!endpoint.enabled ? <StatusBadge status="NOT_CHECKED" label="Paused" /> : activity ? <StatusBadge status="CHECKING" label={activity === "QUEUED" ? "Queued" : "Checking"} /> : <StatusBadge status={result?.status ?? "NOT_CHECKED"} />}</header>
		<dl className="es-card__meta"><div className="es-card__stat"><dt>Latency</dt><dd>{result ? `${result.latencyMs} ms` : "—"}</dd></div><div className="es-card__stat"><dt>HTTP status</dt><dd>{result?.actualStatusCode ?? "—"}</dd></div><div className="es-card__stat"><dt>Threshold</dt><dd>{endpoint.latencyThresholdMs} ms</dd></div><div className="es-card__stat"><dt>Interval</dt><dd>{endpoint.checkIntervalMinutes} min</dd></div></dl>
		<p className="es-form__hint">Last checked: {result ? <time dateTime={result.checkedAt}>{formatTime(result.checkedAt)}</time> : "Not yet"}<br />Next check: {nextCheck ? <time dateTime={nextCheck.toISOString()}>{formatTime(nextCheck)}</time> : "Paused"}</p>
		{result ? <p className="es-card__reason">{result.reason}</p> : null}
		{endpoint.activeIncident ? <button className={`es-incident-link es-incident-link--${endpoint.activeIncident.severity.toLowerCase()}`} type="button" onClick={onIncident} aria-label={`View active ${endpoint.activeIncident.severity.toLowerCase()} incident for ${endpoint.name}`}>Active {endpoint.activeIncident.severity.toLowerCase()} incident · {endpoint.activeIncident.status.toLowerCase()}</button> : null}
		<footer className="es-card__footer"><div className="es-card__actions"><button className="es-btn es-btn--quiet es-btn--danger-text" type="button" onClick={onDelete}>Delete</button><button className="es-btn es-btn--quiet" type="button" onClick={onEdit}>Edit</button><button className="es-btn es-btn--quiet" type="button" onClick={onDetails}>History</button><button className="es-btn es-btn--quiet" type="button" onClick={onToggle}>{endpoint.enabled ? "Pause" : "Resume"}</button><button className="es-btn es-btn--primary" type="button" onClick={onCheck} disabled={activity !== null || !endpoint.enabled}>{activity === "QUEUED" ? "Queued" : activity ? "Checking…" : "Check now"}</button></div></footer>
	</article>;
}

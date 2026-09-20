import type { EndpointRecord } from '../types/monitoring';
import EndpointIdentity from './EndpointIdentity';
import EndpointMenu from './EndpointMenu';
import StatusBadge from './StatusBadge';
interface Props { endpoint: EndpointRecord; checking: boolean; queued: boolean; updating?: boolean; onCheck: () => void; onToggle: () => void; onEdit: () => void; onDetails: () => void; onIncident: () => void; onDelete: () => void }
const clock = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
export default function EndpointRecordCard({ endpoint, checking, queued, updating = false, onCheck, onToggle, onEdit, onDetails, onIncident, onDelete }: Props) {
  const result = endpoint.latestResult;
  const activity = checking ? 'PROCESSING' : queued ? 'QUEUED' : endpoint.activeJobStatus;
  const next = endpoint.enabled ? new Date(Date.parse(result?.checkedAt ?? endpoint.createdAt) + endpoint.checkIntervalMinutes * 60000) : null;
  return <article className="es-endpoint-row" aria-label={endpoint.name} aria-busy={activity !== null || updating}>
    <div className="es-endpoint-main">
      <EndpointIdentity name={endpoint.name} url={endpoint.url} method={endpoint.method} />
      <div className="es-endpoint-health">{!endpoint.enabled ? <StatusBadge status="NOT_CHECKED" label="Paused" /> : activity ? <StatusBadge status="CHECKING" label={activity === 'QUEUED' ? 'Queued' : 'Checking'} /> : <StatusBadge status={result?.status ?? 'NOT_CHECKED'} />}</div>
      <div className="es-endpoint-measure"><strong>{result ? result.latencyMs.toLocaleString() + ' ms' : '—'}</strong><small>limit {endpoint.latencyThresholdMs} ms</small></div>
      <div className="es-endpoint-measure"><strong>{result ? result.actualStatusCode ?? 'No response' : 'Not checked'}</strong><small>expect {endpoint.expectedStatus} / {endpoint.checkIntervalMinutes} min</small></div>
      <div className="es-row-actions"><button className="es-btn es-btn--quiet" onClick={onDetails}>History</button><button className="es-btn" onClick={onCheck} disabled={activity !== null || !endpoint.enabled || updating}>{activity === 'QUEUED' ? 'Queued' : activity ? 'Checking…' : 'Check now'}</button><EndpointMenu name={endpoint.name} enabled={endpoint.enabled} busy={updating} onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} /></div>
    </div>
    <div className="es-endpoint-secondary"><p className="es-card__reason">{result?.reason ?? 'Awaiting the first check.'}</p><div className="es-endpoint-schedule"><span>Last {result ? <time dateTime={result.checkedAt} title={new Date(result.checkedAt).toLocaleString()}>{clock(result.checkedAt)}</time> : '—'}</span><span>Next {next ? <time dateTime={next.toISOString()} title={'Estimated: ' + next.toLocaleString()}>{next.getTime() < Date.now() ? 'Due' : clock(next.toISOString())}</time> : 'Paused'}</span></div>{endpoint.activeIncident ? <button className={'es-incident-link es-incident-link--' + endpoint.activeIncident.severity.toLowerCase()} onClick={onIncident} aria-label={'View active ' + endpoint.activeIncident.severity.toLowerCase() + ' incident for ' + endpoint.name}>↗ {endpoint.activeIncident.status === 'ACKNOWLEDGED' ? 'Acknowledged incident' : 'Active incident'}</button> : null}</div>
  </article>;
}

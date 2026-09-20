import { useCallback, useEffect, useRef, useState } from 'react';
import { incidentsApi } from '../services/endpointsApi';
import type { AlertDelivery, IncidentDetail, IncidentEvent, IncidentPage, IncidentSeverity, IncidentStatus, IncidentSummary } from '../types/monitoring';
import Modal from './Modal';
import Icon from './Icon';
interface Props { refreshToken: number; focusedIncidentId: string | null; onFocusHandled: () => void; onChanged: () => void }
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not load incidents.';
const duration = (incident: IncidentSummary) => { const minutes = Math.max(0, Math.round(((incident.resolvedAt ? Date.parse(incident.resolvedAt) : Date.now()) - Date.parse(incident.startedAt)) / 60000)); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };
function eventLabel(event: IncidentEvent) { return event.eventType === 'RESOLVED' ? event.resultId ? 'Recovered automatically' : 'Resolved manually' : event.eventType.replaceAll('_', ' ').toLowerCase(); }
function Severity({ incident }: { incident: IncidentSummary }) { return <div className="es-incident-row__labels"><span className={'es-incident-severity es-incident-severity--' + incident.severity.toLowerCase()}>{incident.severity}</span><span>{incident.status}</span></div>; }
function Delivery({ alert }: { alert: AlertDelivery }) { return <span className={'es-delivery es-delivery--' + alert.status.toLowerCase()}>{alert.status === 'QUEUED' ? 'Pending delivery' : alert.status === 'DELIVERED' ? 'Delivered' : alert.status === 'FAILED' ? 'Delivery failed' : 'Delivery skipped'}</span>; }
export default function IncidentsSection({ refreshToken, focusedIncidentId, onFocusHandled, onChanged }: Props) {
  const [status, setStatus] = useState<IncidentStatus | ''>(''), [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [page, setPage] = useState<IncidentPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null), [selected, setSelected] = useState<IncidentDetail | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]), [alerts, setAlerts] = useState<AlertDelivery[]>([]);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [rowAlerts, setRowAlerts] = useState<Record<string, AlertDelivery[] | null>>({});
  const loadSequence = useRef(0), detailSequence = useRef(0), actionLock = useRef(false);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current; setLoading(true); setError(null);
    try {
      const next = await incidentsApi.list({ status, severity, limit: 50 }); if (sequence !== loadSequence.current) return; setPage(next); setRowAlerts({});
      const rows = await Promise.all(next.items.filter(i => i.status !== 'RESOLVED').map(async i => { try { return [i.id, await incidentsApi.alerts(i.id)] as const; } catch { return [i.id, null] as const; } }));
      if (sequence === loadSequence.current) setRowAlerts(Object.fromEntries(rows));
    } catch (cause) { if (sequence === loadSequence.current) setError(message(cause)); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [severity, status]);
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load, refreshToken]);
  const open = useCallback(async (id: string) => {
    const sequence = ++detailSequence.current; setDetailId(id); setSelected(null); setDetailLoading(true); setDetailError(null); setEvents([]); setAlerts([]);
    try {
      const [detail, timeline, deliveries] = await Promise.all([incidentsApi.get(id), incidentsApi.events(id), incidentsApi.alerts(id)]);
      if (sequence !== detailSequence.current) return;
      setSelected(detail); setEvents(timeline); setAlerts(deliveries);
    } catch (cause) { if (sequence === detailSequence.current) setDetailError(message(cause)); }
    finally { if (sequence === detailSequence.current) setDetailLoading(false); }
  }, []);
  useEffect(() => { if (focusedIncidentId) { void open(focusedIncidentId); onFocusHandled(); } }, [focusedIncidentId, open, onFocusHandled]);
  function close() { if (actionLock.current) return; detailSequence.current++; setDetailId(null); setSelected(null); }
  async function action(kind: 'acknowledge' | 'resolve') {
    if (!selected || actionLock.current) return; actionLock.current = true; setBusy(kind); setDetailError(null);
    try { const updated = await incidentsApi[kind](selected.id); setSelected(updated); const [timeline, deliveries] = await Promise.all([incidentsApi.events(updated.id), incidentsApi.alerts(updated.id)]); setEvents(timeline); setAlerts(deliveries); await load(); onChanged(); }
    catch (cause) { setDetailError(message(cause)); } finally { actionLock.current = false; setBusy(null); }
  }
  return <section className="es-incidents" id="incidents" aria-labelledby="incidents-title">
    <header className="es-section-heading"><div><p className="es-eyebrow">Investigate / Respond</p><h2 id="incidents-title">Incidents</h2><p>Failures, acknowledgement, recovery, and alert delivery.</p></div><span className="es-section-count">{loading ? 'Loading' : page ? `${page.counts.open} active` : 'Unavailable'}</span></header>
    <div className="es-incident-summary" aria-label="Incident summary"><div><span>Active incidents</span><strong>{page?.counts.open ?? '—'}</strong></div><div><span>Critical incidents</span><strong>{page?.counts.critical ?? '—'}</strong></div><div><span>Resolved incidents</span><strong>{page?.counts.resolved ?? '—'}</strong></div></div>
    <div className="es-filters"><label>Status<select value={status} onChange={e => setStatus(e.target.value as IncidentStatus | '')}><option value="">All statuses</option><option value="OPEN">Open</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option></select></label><label>Severity<select value={severity} onChange={e => setSeverity(e.target.value as IncidentSeverity | '')}><option value="">All severities</option><option value="DEGRADED">Degraded</option><option value="CRITICAL">Critical</option></select></label></div>
    {loading ? <p className="es-loading" role="status">Loading incidents…</p> : error ? <div className="es-error-state" role="alert"><p>{error}</p><button className="es-btn" onClick={() => void load()}>Retry incidents</button></div> : !page?.items.length ? <div className="es-empty"><Icon name="check" /><h3>{!status && !severity ? 'No active incidents' : 'No matching incidents'}</h3><p>{!status && !severity ? 'No incidents have been recorded for this workspace.' : 'Try another status or severity filter.'}</p></div> : <div className="es-incident-list">{page.items.map(incident => <article className="es-incident-row" key={incident.id} aria-label={'Incident for ' + incident.endpointName}><div><Severity incident={incident} /><h3>{incident.endpointName}</h3><p>{incident.summary}</p>{incident.status !== 'RESOLVED' ? <div className="es-incident-deliveries">{rowAlerts[incident.id] === null ? 'Delivery status unavailable — open details to retry' : rowAlerts[incident.id]?.length ? rowAlerts[incident.id]!.map(alert => <Delivery key={alert.id} alert={alert} />) : rowAlerts[incident.id] ? 'No alert required' : 'Loading deliveries…'}</div> : null}</div><dl><div><dt>Started</dt><dd><time dateTime={incident.startedAt}>{new Date(incident.startedAt).toLocaleString()}</time></dd></div><div><dt>Duration</dt><dd>{duration(incident)}</dd></div></dl><button className="es-btn" onClick={() => void open(incident.id)}>View incident <Icon name="arrow" /></button></article>)}</div>}
    {detailId ? <Modal title={selected ? `Incident — ${selected.endpointName}` : 'Incident details'} onClose={close} closeDisabled={busy !== null} size="wide">{detailLoading ? <p role="status">Loading incident details…</p> : <>{detailError ? <div className="es-form__error" role="alert">{detailError}{!selected ? <button className="es-btn" onClick={() => void open(detailId)}>Retry details</button> : null}</div> : null}{selected ? <div className="es-incident-detail"><div className="es-details__heading"><Severity incident={selected} /><span className="es-form__hint">{selected.id}</span></div><p className="es-diagnostic">{selected.summary}</p><dl className="es-incident-metadata"><div><dt>Started</dt><dd>{new Date(selected.startedAt).toLocaleString()}</dd></div><div><dt>Duration</dt><dd>{duration(selected)}</dd></div><div><dt>Consecutive failures</dt><dd>{selected.consecutiveFailureCount}</dd></div></dl><div className="es-card__actions">{selected.status === 'OPEN' ? <button className="es-btn" disabled={busy !== null} onClick={() => void action('acknowledge')}>{busy === 'acknowledge' ? 'Acknowledging…' : 'Acknowledge'}</button> : null}{selected.status !== 'RESOLVED' ? <button className="es-btn es-btn--danger" disabled={busy !== null} onClick={() => void action('resolve')}>{busy === 'resolve' ? 'Resolving…' : 'Resolve incident'}</button> : null}{selected.status === 'RESOLVED' ? <p className="es-resolution">{events.some(e => e.eventType === 'RESOLVED' && e.resultId) ? 'Automatically recovered after healthy monitoring results.' : 'Manually resolved. Future failures can open a new incident.'}</p> : <span className="es-form__hint">Acknowledging keeps monitoring and automatic recovery active.</span>}</div><div className="es-incident-columns"><section><h3>Event timeline</h3>{events.length ? <ol className="es-timeline">{events.map(event => <li key={event.id}><strong>{eventLabel(event)}</strong><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time><p>{event.message}</p></li>)}</ol> : <p>No events recorded.</p>}</section><section><h3>Alert deliveries</h3>{alerts.length ? <ul className="es-alert-list">{alerts.map(alert => <li key={alert.id}><Delivery alert={alert} /><span>{alert.channel} · {alert.attemptCount} attempt{alert.attemptCount === 1 ? '' : 's'}</span>{alert.responseStatus ? <span>HTTP {alert.responseStatus}</span> : null}{alert.deliveredAt ? <time dateTime={alert.deliveredAt}>{new Date(alert.deliveredAt).toLocaleString()}</time> : null}{alert.lastError ? <small>{alert.lastError}</small> : null}</li>)}</ul> : <p className="es-form__hint">No alert was required for this incident.</p>}</section></div></div> : null}</>}</Modal> : null}
  </section>;
}

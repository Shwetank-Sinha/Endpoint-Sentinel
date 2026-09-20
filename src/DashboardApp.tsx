import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "./components/Icon";
import ConfirmDialog from "./components/ConfirmDialog";
import EndpointDetailsModal from "./components/EndpointDetailsModal";
import EndpointFormModal from "./components/EndpointFormModal";
import EndpointRecordCard from "./components/EndpointRecordCard";
import IncidentsSection from "./components/IncidentsSection";
import SummaryCards from "./components/SummaryCards";
import { endpointsApi, type EndpointPayload } from "./services/endpointsApi";
import type { DashboardSummary } from "./types/dashboard";
import type { CheckResult, EndpointRecord } from "./types/monitoring";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "An unexpected error occurred.";
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
type Activity = "QUEUED" | "PROCESSING";

export default function DashboardApp({ juryMode = false }: { juryMode?: boolean }) {
	const locks = useRef(new Set<string>());
	const [updatedAt, setUpdatedAt] = useState<string | null>(null);
	const [updating, setUpdating] = useState<string | null>(null);
	const [endpoints, setEndpoints] = useState<EndpointRecord[]>([]), [loading, setLoading] = useState(true);
	const [pageError, setPageError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
	const [form, setForm] = useState<"new" | EndpointRecord | null>(null), [formBusy, setFormBusy] = useState(false), [formError, setFormError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<EndpointRecord | null>(null), [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState<string | null>(null);
	const [activity, setActivity] = useState<Map<string, Activity>>(new Map()), [details, setDetails] = useState<EndpointRecord | null>(null);
	const [incidentRefresh, setIncidentRefresh] = useState(0);
	const [focusedIncidentId, setFocusedIncidentId] = useState<string | null>(null);
	const clearFocusedIncident = useCallback(() => setFocusedIncidentId(null), []);
	const [results, setResults] = useState<CheckResult[]>([]), [resultsLoading, setResultsLoading] = useState(false), [resultsError, setResultsError] = useState<string | null>(null);
	const load = useCallback(async (initial = false) => { if (initial) setLoading(true); setPageError(null); try { setEndpoints(await endpointsApi.list()); setUpdatedAt(new Date().toISOString()); } catch (error) { setPageError(errorMessage(error)); } finally { if (initial) setLoading(false); } }, []);
	useEffect(() => { void load(true); }, [load]);
	async function save(payload: EndpointPayload) { if (locks.current.has("save")) return; locks.current.add("save"); setFormBusy(true); setFormError(null); try { const isNew = form === "new", saved = isNew ? await endpointsApi.create(payload) : await endpointsApi.update(form!.id, payload); setEndpoints((items) => isNew ? [...items, saved] : items.map((item) => item.id === saved.id ? saved : item)); setForm(null); setNotice(isNew ? "Endpoint added." : "Endpoint updated."); } catch (error) { setFormError(errorMessage(error)); } finally { setFormBusy(false); locks.current.delete("save"); } }
	async function remove() { if (!deleting || locks.current.has("delete")) return; locks.current.add("delete"); setDeleteBusy(true); setDeleteError(null); try { await endpointsApi.remove(deleting.id); setEndpoints((items) => items.filter((item) => item.id !== deleting.id)); setActivity((items) => { const next = new Map(items); next.delete(deleting.id); return next; }); if (details?.id === deleting.id) setDetails(null); setDeleting(null); setNotice("Endpoint deleted."); } catch (error) { setDeleteError(errorMessage(error)); } finally { setDeleteBusy(false); locks.current.delete("delete"); } }
	const setEndpointActivity = (id: string, value: Activity | null) => setActivity((items) => { const next = new Map(items); value ? next.set(id, value) : next.delete(id); return next; });
	const check = useCallback(async (endpoint: EndpointRecord) => {
		if (locks.current.has(endpoint.id)) return; locks.current.add(endpoint.id); setEndpointActivity(endpoint.id, "QUEUED"); setPageError(null);
		try {
			const queued = await endpointsApi.check(endpoint.id);
			for (let attempt = 0; attempt < 20; attempt++) { const job = await endpointsApi.job(queued.jobId); if (job.status === "PROCESSING") setEndpointActivity(endpoint.id, "PROCESSING"); if (job.status === "COMPLETED") { await load(); setIncidentRefresh((value) => value + 1); if (details?.id === endpoint.id) { setResults(await endpointsApi.results(endpoint.id)); const refreshed = await endpointsApi.list(); setDetails(refreshed.find((item) => item.id === endpoint.id) ?? null); } setNotice(`${endpoint.name} check completed.`); return; } if (job.status === "FAILED") throw new Error(job.lastError ?? "The check could not be completed."); await delay(1500); }
			throw new Error("The check is still queued. Refresh shortly to see its result, or try again later.");
		} catch (error) { setPageError(errorMessage(error)); } finally { setEndpointActivity(endpoint.id, null); locks.current.delete(endpoint.id); }
	}, [activity, details, load]);
	async function checkAll() { await Promise.allSettled(endpoints.filter((endpoint) => endpoint.enabled && !activity.has(endpoint.id) && !endpoint.activeJobStatus).map(check)); }
	async function toggle(endpoint: EndpointRecord) { if (locks.current.has("toggle")) return; locks.current.add("toggle"); setUpdating(endpoint.id); try { const saved = await endpointsApi.update(endpoint.id, { enabled: !endpoint.enabled }); setEndpoints((items) => items.map((item) => item.id === saved.id ? saved : item)); setNotice(saved.enabled ? `${saved.name} monitoring enabled.` : `${saved.name} monitoring paused.`); } catch (error) { setPageError(errorMessage(error)); } finally { setUpdating(null); locks.current.delete("toggle"); } }
	async function openDetails(endpoint: EndpointRecord) { setDetails(endpoint); setResults([]); setResultsError(null); setResultsLoading(true); try { setResults(await endpointsApi.results(endpoint.id)); } catch (error) { setResultsError(errorMessage(error)); } finally { setResultsLoading(false); } }
	const summary = useMemo<DashboardSummary>(() => { const current = endpoints.map((endpoint) => endpoint.latestResult).filter((result): result is CheckResult => result !== null); return { total: endpoints.length, healthy: current.filter((r) => r.status === "HEALTHY").length, degraded: current.filter((r) => r.status === "DEGRADED").length, critical: current.filter((r) => r.status === "CRITICAL").length, averageLatencyMs: current.length ? Math.round(current.reduce((sum, r) => sum + r.latencyMs, 0) / current.length) : null }; }, [endpoints]);
	const activeIncidents = endpoints.filter(endpoint => endpoint.activeIncident);
	return <main className="es-app" id="overview" tabIndex={-1}><header className="es-hero"><div><p className="es-eyebrow">Monitoring / Overview</p><h1 className="es-title">Operations overview</h1><p className="es-subtitle">Endpoint health, incidents, and recovery. One operational view.</p>{juryMode ? <p className="es-jury-notice" role="status"><strong>Public jury evaluation mode</strong><span>Authentication is temporarily disabled for hackathon evaluation.</span></p> : null}</div><div className="es-hero__actions"><button className="es-btn" type="button" onClick={() => void checkAll()} disabled={!endpoints.some(e => e.enabled && !e.activeJobStatus) || activity.size > 0}><Icon name="refresh" />{activity.size > 0 ? "Checking…" : "Check all"}</button><button className="es-btn es-btn--primary" type="button" onClick={() => { setFormError(null); setForm("new"); }}><Icon name="plus" />Add endpoint</button></div></header><p className="es-refresh">{activity.size > 0 ? `Checking ${activity.size} endpoint(s)…` : updatedAt ? <>Data refreshed <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleTimeString()}</time> · Latest recorded checks</> : "Loading workspace data…"}</p>
		{notice ? <p className="es-notice" role="status">{notice}</p> : null}{pageError ? <div className="es-error-state" role="alert"><p>{pageError}</p><button className="es-btn" type="button" onClick={() => void load()}>Retry</button></div> : null}<SummaryCards summary={summary} />
		{!loading && activeIncidents.length > 0 ? <a className="es-attention" href="#incidents"><Icon name="incident" /><strong>{activeIncidents.length} active incident{activeIncidents.length === 1 ? "" : "s"}</strong><span>{activeIncidents.map(e => e.name).join(" · ")}</span><span className="es-attention-action">Investigate <Icon name="arrow" /></span></a> : null}
		<section id="endpoints" className="es-endpoints" aria-labelledby="endpoints-title"><header className="es-section-heading es-section-heading--compact"><div><p className="es-eyebrow">Monitors</p><h2 id="endpoints-title">Endpoints</h2></div><span className="es-section-count">{endpoints.length} configured</span></header>{loading ? <p className="es-loading" role="status">Loading endpoints…</p> : endpoints.length === 0 && !pageError ? <section className="es-empty"><span className="es-empty__icon" aria-hidden="true">+</span><h2>No endpoints yet</h2><p>Add your first endpoint to begin recording real reliability checks.</p><button className="es-btn es-btn--primary" type="button" onClick={() => setForm("new")}>Add endpoint</button></section> : <div className="es-inventory" role="region" aria-label="Monitored endpoints"><div className="es-inventory-head" aria-hidden="true"><span>Endpoint / URL</span><span>Health</span><span>Latency</span><span>HTTP / Schedule</span><span>Actions</span></div>{endpoints.map((endpoint) => <EndpointRecordCard key={endpoint.id} endpoint={endpoint} updating={updating === endpoint.id} checking={activity.get(endpoint.id) === "PROCESSING"} queued={activity.get(endpoint.id) === "QUEUED"} onCheck={() => void check(endpoint)} onToggle={() => void toggle(endpoint)} onEdit={() => { setFormError(null); setForm(endpoint); }} onDetails={() => void openDetails(endpoint)} onIncident={() => setFocusedIncidentId(endpoint.activeIncident?.id ?? null)} onDelete={() => { setDeleteError(null); setDeleting(endpoint); }} />)}</div>}</section>
		<IncidentsSection refreshToken={incidentRefresh} focusedIncidentId={focusedIncidentId} onFocusHandled={clearFocusedIncident} onChanged={() => { void load(); setIncidentRefresh((value) => value + 1); }} />
		{form ? <EndpointFormModal {...(form === "new" ? {} : { endpoint: form })} busy={formBusy} error={formError} onClose={() => setForm(null)} onSubmit={(payload) => void save(payload)} /> : null}
		{deleting ? <ConfirmDialog name={deleting.name} busy={deleteBusy} error={deleteError} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} /> : null}
		{details ? <EndpointDetailsModal endpoint={details} results={results} loading={resultsLoading} error={resultsError} onClose={() => setDetails(null)} onEdit={() => { setFormError(null); setForm(details); setDetails(null); }} /> : null}
	</main>;
}

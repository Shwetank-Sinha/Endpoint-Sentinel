import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmDialog from "./components/ConfirmDialog";
import EndpointDetailsModal from "./components/EndpointDetailsModal";
import EndpointFormModal from "./components/EndpointFormModal";
import EndpointRecordCard from "./components/EndpointRecordCard";
import SummaryCards from "./components/SummaryCards";
import { endpointsApi, type EndpointPayload } from "./services/endpointsApi";
import type { DashboardSummary } from "./types/dashboard";
import type { CheckResult, EndpointRecord } from "./types/monitoring";

const message = (error: unknown) => error instanceof Error ? error.message : "An unexpected error occurred.";
export default function DashboardApp() {
	const [endpoints, setEndpoints] = useState<EndpointRecord[]>([]);
	const [loading, setLoading] = useState(true); const [pageError, setPageError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
	const [form, setForm] = useState<"new" | EndpointRecord | null>(null); const [formBusy, setFormBusy] = useState(false); const [formError, setFormError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<EndpointRecord | null>(null); const [deleteBusy, setDeleteBusy] = useState(false); const [deleteError, setDeleteError] = useState<string | null>(null);
	const [checking, setChecking] = useState<Set<string>>(new Set()); const [details, setDetails] = useState<EndpointRecord | null>(null);
	const [results, setResults] = useState<CheckResult[]>([]); const [resultsLoading, setResultsLoading] = useState(false); const [resultsError, setResultsError] = useState<string | null>(null);
	const load = useCallback(async () => { setLoading(true); setPageError(null); try { setEndpoints(await endpointsApi.list()); } catch (error) { setPageError(message(error)); } finally { setLoading(false); } }, []);
	useEffect(() => { void load(); }, [load]);
	async function save(payload: EndpointPayload) { setFormBusy(true); setFormError(null); try { const isNew = form === "new"; const saved = isNew ? await endpointsApi.create(payload) : await endpointsApi.update(form!.id, payload); setEndpoints((items) => isNew ? [...items, saved] : items.map((item) => item.id === saved.id ? saved : item)); setForm(null); setNotice(isNew ? "Endpoint added." : "Endpoint updated."); } catch (error) { setFormError(message(error)); } finally { setFormBusy(false); } }
	async function remove() { if (!deleting) return; setDeleteBusy(true); setDeleteError(null); try { await endpointsApi.remove(deleting.id); setEndpoints((items) => items.filter((item) => item.id !== deleting.id)); if (details?.id === deleting.id) setDetails(null); setDeleting(null); setNotice("Endpoint deleted."); } catch (error) { setDeleteError(message(error)); } finally { setDeleteBusy(false); } }
	const check = useCallback(async (endpoint: EndpointRecord) => { setChecking((ids) => new Set(ids).add(endpoint.id)); setPageError(null); try { const result = await endpointsApi.check(endpoint.id); setEndpoints((items) => items.map((item) => item.id === endpoint.id ? { ...item, latestResult: result } : item)); setDetails((item) => item?.id === endpoint.id ? { ...item, latestResult: result } : item); setNotice(`${endpoint.name} check completed.`); } catch (error) { setPageError(message(error)); } finally { setChecking((ids) => { const next = new Set(ids); next.delete(endpoint.id); return next; }); } }, []);
	async function checkAll() { await Promise.allSettled(endpoints.filter((endpoint) => endpoint.enabled && !checking.has(endpoint.id)).map(check)); }
	async function openDetails(endpoint: EndpointRecord) { setDetails(endpoint); setResults([]); setResultsError(null); setResultsLoading(true); try { setResults(await endpointsApi.results(endpoint.id)); } catch (error) { setResultsError(message(error)); } finally { setResultsLoading(false); } }
	const summary = useMemo<DashboardSummary>(() => { const current = endpoints.map((endpoint) => endpoint.latestResult).filter((result): result is CheckResult => result !== null); return { total: endpoints.length, healthy: current.filter((r) => r.status === "HEALTHY").length, degraded: current.filter((r) => r.status === "DEGRADED").length, critical: current.filter((r) => r.status === "CRITICAL").length, averageLatencyMs: current.length ? Math.round(current.reduce((sum, r) => sum + r.latencyMs, 0) / current.length) : null }; }, [endpoints]);
	return <main className="es-app"><header className="es-hero"><div><h1 className="es-title">Endpoint Sentinel</h1><p className="es-subtitle">Persistent API reliability monitoring for your team.</p></div><div className="es-hero__actions"><button className="es-btn" type="button" onClick={() => { setFormError(null); setForm("new"); }}>Add Endpoint</button><button className="es-btn es-btn--primary" type="button" onClick={() => void checkAll()} disabled={endpoints.length === 0 || checking.size > 0}>Check All</button></div></header>
		{notice ? <p className="es-notice" role="status">{notice}</p> : null}{pageError ? <div className="es-error-state" role="alert"><p>{pageError}</p><button className="es-btn" type="button" onClick={() => void load()}>Retry</button></div> : null}<SummaryCards summary={summary} />
		{loading ? <p className="es-loading" role="status">Loading endpoints…</p> : endpoints.length === 0 && !pageError ? <section className="es-empty"><h2>No endpoints yet</h2><p>Add your first endpoint to begin recording real reliability checks.</p><button className="es-btn es-btn--primary" type="button" onClick={() => setForm("new")}>Add Endpoint</button></section> : <section className="es-grid" aria-label="Monitored endpoints">{endpoints.map((endpoint) => <EndpointRecordCard key={endpoint.id} endpoint={endpoint} checking={checking.has(endpoint.id)} onCheck={() => void check(endpoint)} onDetails={() => void openDetails(endpoint)} onDelete={() => { setDeleteError(null); setDeleting(endpoint); }} />)}</section>}
		{form ? <EndpointFormModal {...(form === "new" ? {} : { endpoint: form })} busy={formBusy} error={formError} onClose={() => setForm(null)} onSubmit={(payload) => void save(payload)} /> : null}
		{deleting ? <ConfirmDialog name={deleting.name} busy={deleteBusy} error={deleteError} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} /> : null}
		{details ? <EndpointDetailsModal endpoint={details} results={results} loading={resultsLoading} error={resultsError} onClose={() => setDetails(null)} onEdit={() => { setFormError(null); setForm(details); setDetails(null); }} /> : null}
	</main>;
}

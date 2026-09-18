import { useState, type FormEvent } from "react";
import type { EndpointRecord, HttpMethod } from "../types/monitoring";
import { HTTP_METHODS } from "../types/monitoring";
import type { EndpointPayload } from "../services/endpointsApi";
import { ENDPOINT_LIMITS, validEndpointName, validateUrl } from "../services/targetValidation";
import Modal from "./Modal";

interface Props { endpoint?: EndpointRecord; busy: boolean; error: string | null; onClose: () => void; onSubmit: (payload: EndpointPayload) => void }
interface Draft { name: string; url: string; method: HttpMethod; expectedStatus: string; timeoutMs: string; latencyThresholdMs: string; checkIntervalMinutes: string; enabled: boolean }

export default function EndpointFormModal({ endpoint, busy, error, onClose, onSubmit }: Props) {
	const [draft, setDraft] = useState<Draft>(() => ({ name: endpoint?.name ?? "", url: endpoint?.url ?? "", method: endpoint?.method ?? "GET", expectedStatus: String(endpoint?.expectedStatus ?? 200), timeoutMs: String(endpoint?.timeoutMs ?? 5000), latencyThresholdMs: String(endpoint?.latencyThresholdMs ?? 800), checkIntervalMinutes: String(endpoint?.checkIntervalMinutes ?? 5), enabled: endpoint?.enabled ?? true }));
	const [validation, setValidation] = useState<string | null>(null);
	const update = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }));
	function submit(event: FormEvent) {
		event.preventDefault();
		const numeric = { expectedStatus: Number(draft.expectedStatus), timeoutMs: Number(draft.timeoutMs), latencyThresholdMs: Number(draft.latencyThresholdMs), checkIntervalMinutes: Number(draft.checkIntervalMinutes) };
		const problem = !validEndpointName(draft.name) ? `Name must be 2-${ENDPOINT_LIMITS.nameMax} characters and contain a letter or number.` : validateUrl(draft.url)
			?? (!Number.isInteger(numeric.expectedStatus) || numeric.expectedStatus < 100 || numeric.expectedStatus > 599 ? "Expected status must be 100-599." : null)
			?? (!Number.isInteger(numeric.timeoutMs) || numeric.timeoutMs < ENDPOINT_LIMITS.timeoutMin || numeric.timeoutMs > ENDPOINT_LIMITS.timeoutMax ? `Timeout must be ${ENDPOINT_LIMITS.timeoutMin}-${ENDPOINT_LIMITS.timeoutMax} ms.` : null)
			?? (!Number.isInteger(numeric.latencyThresholdMs) || numeric.latencyThresholdMs < ENDPOINT_LIMITS.thresholdMin || numeric.latencyThresholdMs > ENDPOINT_LIMITS.thresholdMax ? `Latency threshold must be ${ENDPOINT_LIMITS.thresholdMin}-${ENDPOINT_LIMITS.thresholdMax} ms.` : null)
			?? (!Number.isInteger(numeric.checkIntervalMinutes) || numeric.checkIntervalMinutes < ENDPOINT_LIMITS.intervalMin || numeric.checkIntervalMinutes > ENDPOINT_LIMITS.intervalMax ? `Check interval must be ${ENDPOINT_LIMITS.intervalMin}-${ENDPOINT_LIMITS.intervalMax} minutes.` : null);
		setValidation(problem); if (problem) return;
		onSubmit({ name: draft.name.trim(), url: draft.url.trim(), method: draft.method, ...numeric, enabled: draft.enabled });
	}
	return <Modal title={endpoint ? "Edit Endpoint" : "Add Endpoint"} onClose={onClose}>
		<form className="es-form" onSubmit={submit} noValidate>
			<label className="es-form__field"><span className="es-form__label">Name</span><input data-autofocus className="es-form__input" value={draft.name} onChange={(e) => update({ name: e.target.value })} /></label>
			<label className="es-form__field"><span className="es-form__label">URL</span><input className="es-form__input" type="url" placeholder="https://api.example.com/health" value={draft.url} onChange={(e) => update({ url: e.target.value })} /></label>
			<div className="es-form__row"><label className="es-form__field"><span className="es-form__label">Method</span><select className="es-form__select" value={draft.method} onChange={(e) => update({ method: e.target.value as HttpMethod })}>{HTTP_METHODS.map((method) => <option key={method}>{method}</option>)}</select></label><label className="es-form__field"><span className="es-form__label">Expected status</span><input className="es-form__input" type="number" value={draft.expectedStatus} onChange={(e) => update({ expectedStatus: e.target.value })} /></label></div>
			<div className="es-form__row"><label className="es-form__field"><span className="es-form__label">Timeout (ms)</span><input className="es-form__input" type="number" value={draft.timeoutMs} onChange={(e) => update({ timeoutMs: e.target.value })} /></label><label className="es-form__field"><span className="es-form__label">Latency threshold (ms)</span><input className="es-form__input" type="number" value={draft.latencyThresholdMs} onChange={(e) => update({ latencyThresholdMs: e.target.value })} /></label></div>
			<label className="es-form__field"><span className="es-form__label">Check interval (minutes)</span><input className="es-form__input" type="number" value={draft.checkIntervalMinutes} onChange={(e) => update({ checkIntervalMinutes: e.target.value })} /></label>
			<label className="es-form__checkbox"><input type="checkbox" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Enabled</label>
			{validation || error ? <p className="es-form__error" role="alert">{validation ?? error}</p> : null}
			<div className="es-form__actions"><button className="es-btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="es-btn es-btn--primary" disabled={busy}>{busy ? "Saving…" : endpoint ? "Save Changes" : "Add Endpoint"}</button></div>
		</form>
	</Modal>;
}

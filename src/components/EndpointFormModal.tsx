import { useId, useRef, useState, type FormEvent } from 'react';
import type { EndpointRecord, HttpMethod } from '../types/monitoring';
import { HTTP_METHODS } from '../types/monitoring';
import type { EndpointPayload } from '../services/endpointsApi';
import { ENDPOINT_LIMITS, validEndpointName, validateUrl } from '../services/targetValidation';
import Modal from './Modal';
interface Props { endpoint?: EndpointRecord; busy: boolean; error: string | null; onClose: () => void; onSubmit: (payload: EndpointPayload) => void }
interface Draft { name: string; url: string; method: HttpMethod; expectedStatus: string; timeoutMs: string; latencyThresholdMs: string; checkIntervalMinutes: string; enabled: boolean }
export default function EndpointFormModal({ endpoint, busy, error, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState<Draft>(() => ({ name: endpoint?.name ?? '', url: endpoint?.url ?? '', method: endpoint?.method ?? 'GET', expectedStatus: String(endpoint?.expectedStatus ?? 200), timeoutMs: String(endpoint?.timeoutMs ?? 5000), latencyThresholdMs: String(endpoint?.latencyThresholdMs ?? 800), checkIntervalMinutes: String(endpoint?.checkIntervalMinutes ?? 5), enabled: endpoint?.enabled ?? true }));
  const [validation, setValidation] = useState<Partial<Record<keyof Draft, string>>>({});
  const prefix = useId(), formRef = useRef<HTMLFormElement>(null);
  const update = (patch: Partial<Draft>) => setDraft(value => ({ ...value, ...patch }));
  function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const numeric = { expectedStatus: Number(draft.expectedStatus), timeoutMs: Number(draft.timeoutMs), latencyThresholdMs: Number(draft.latencyThresholdMs), checkIntervalMinutes: Number(draft.checkIntervalMinutes) };
    const problems: Partial<Record<keyof Draft, string>> = {};
    if (!validEndpointName(draft.name)) problems.name = `Use 2–${ENDPOINT_LIMITS.nameMax} characters, including a letter or number.`;
    const urlProblem = validateUrl(draft.url); if (urlProblem) problems.url = urlProblem;
    for (const [key, min, max] of [['expectedStatus', 100, 599], ['timeoutMs', ENDPOINT_LIMITS.timeoutMin, ENDPOINT_LIMITS.timeoutMax], ['latencyThresholdMs', ENDPOINT_LIMITS.thresholdMin, ENDPOINT_LIMITS.thresholdMax], ['checkIntervalMinutes', ENDPOINT_LIMITS.intervalMin, ENDPOINT_LIMITS.intervalMax]] as const) {
      if (!draft[key].trim() || !Number.isInteger(numeric[key]) || numeric[key] < min || numeric[key] > max) problems[key] = `Enter a whole number from ${min} to ${max}.`;
    }
    setValidation(problems);
    const first = Object.keys(problems)[0];
    if (first) { formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); return; }
    onSubmit({ name: draft.name.trim(), url: draft.url.trim(), method: draft.method, ...numeric, enabled: draft.enabled });
  }
  function field(key: Exclude<keyof Draft, 'enabled' | 'method'>, label: string, type = 'text', hint?: string) {
    const invalid = validation[key], id = `${prefix}-${key}`;
    return <label className="es-form__field" htmlFor={id}><span className="es-form__label" id={`${id}-label`}>{label} <span className="es-form__required" aria-hidden="true">*</span></span><input id={id} aria-labelledby={`${id}-label`} name={key} data-autofocus={key === 'name' ? true : undefined} className="es-form__input" type={type} required value={draft[key]} aria-invalid={!!invalid} aria-describedby={invalid ? `${id}-error` : hint ? `${id}-hint` : undefined} onChange={e => update({ [key]: e.target.value })} />{hint ? <small className="es-form__hint" id={`${id}-hint`}>{hint}</small> : null}{invalid ? <small className="es-field-error" id={`${id}-error`}>{invalid}</small> : null}</label>;
  }
  return <Modal title={endpoint ? 'Edit Endpoint' : 'Add Endpoint'} onClose={onClose} closeDisabled={busy}><form ref={formRef} className="es-form" onSubmit={submit} noValidate><p className="es-form__hint">{endpoint ? 'Update the target and its monitoring rules.' : 'Define a target and the response you expect.'} Fields marked * are required.</p><fieldset disabled={busy} className="es-form-fields">{field('name', 'Name')}{field('url', 'URL', 'url', 'An absolute HTTP or HTTPS URL. Never include credentials.')}<div className="es-form__row"><label className="es-form__field"><span className="es-form__label">Method</span><select className="es-form__select" value={draft.method} onChange={e => update({ method: e.target.value as HttpMethod })}>{HTTP_METHODS.map(method => <option key={method}>{method}</option>)}</select></label>{field('expectedStatus', 'Expected status', 'number')}</div><div className="es-form__row">{field('timeoutMs', 'Timeout (ms)', 'number')}{field('latencyThresholdMs', 'Latency threshold (ms)', 'number')}</div>{field('checkIntervalMinutes', 'Check interval (minutes)', 'number')}<label className="es-form__checkbox"><input type="checkbox" checked={draft.enabled} onChange={e => update({ enabled: e.target.checked })} />Enable scheduled monitoring</label></fieldset>{Object.keys(validation).length ? <p className="es-form__error" role="alert">Check the highlighted fields before saving.</p> : null}{error ? <p className="es-form__error" role="alert">{error}</p> : null}<div className="es-form__actions"><button className="es-btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="es-btn es-btn--primary" disabled={busy}>{busy ? 'Saving…' : endpoint ? 'Save Changes' : 'Add Endpoint'}</button></div></form></Modal>;
}

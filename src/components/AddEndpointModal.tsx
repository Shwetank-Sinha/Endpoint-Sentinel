import { useState, type FormEvent } from "react";
import { validateUrl, validEndpointName } from "../services/targetValidation";
import Modal from "./Modal";
import { createDefaultTarget } from "../services/monitoringApi";
import { HTTP_METHODS } from "../types/monitoring";
import type { CheckTarget, HttpMethod } from "../types/monitoring";

interface AddEndpointModalProps {
	onAdd: (name: string, target: CheckTarget) => void;
	onClose: () => void;
}

interface FieldErrors {
	name?: string;
	url?: string;
	expectedStatus?: string;
	timeoutMs?: string;
	latencyThresholdMs?: string;
}

interface Draft {
	name: string;
	url: string;
	method: HttpMethod;
	expectedStatus: string;
	timeoutMs: string;
	latencyThresholdMs: string;
}

function validatePositiveInt(value: string, label: string): string | null {
	if (value.trim().length === 0) return `${label} is required.`;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		return `${label} must be a positive whole number.`;
	}
	return null;
}

function inputClass(hasError: boolean): string {
	return hasError ? "es-form__input es-form__input--invalid" : "es-form__input";
}

export default function AddEndpointModal({ onAdd, onClose }: AddEndpointModalProps) {
	const [errors, setErrors] = useState<FieldErrors>({});
	const [draft, setDraft] = useState<Draft>(() => {
		const defaults = createDefaultTarget();
		return {
			name: "",
			url: defaults.url,
			method: defaults.method,
			expectedStatus: String(defaults.expectedStatus),
			timeoutMs: String(defaults.timeoutMs),
			latencyThresholdMs: String(defaults.latencyThresholdMs),
		};
	});

	const update = (patch: Partial<Draft>) =>
		setDraft((prev) => ({ ...prev, ...patch }));

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		const name = draft.name.trim();
		const nextErrors: FieldErrors = {};

		const nameError = validEndpointName(name) ? null : "Enter a descriptive name of at least two characters, including a letter or number.";
		if (nameError !== null) nextErrors.name = nameError;

		const urlError = validateUrl(draft.url);
		if (urlError !== null) nextErrors.url = urlError;

		const expectedStatusError = validatePositiveInt(draft.expectedStatus, "Expected status");
		if (expectedStatusError !== null) nextErrors.expectedStatus = expectedStatusError;
		else if (Number(draft.expectedStatus) < 100 || Number(draft.expectedStatus) > 599) nextErrors.expectedStatus = "Expected status must be an integer from 100 to 599.";

		const timeoutError = validatePositiveInt(draft.timeoutMs, "Timeout") ?? (Number(draft.timeoutMs) > 2147483647 ? "Timeout must not exceed 2147483647 ms." : null);
		if (timeoutError !== null) nextErrors.timeoutMs = timeoutError;

		const latencyError = validatePositiveInt(
			draft.latencyThresholdMs,
			"Latency threshold",
		);
		if (latencyError !== null) nextErrors.latencyThresholdMs = latencyError;

		setErrors(nextErrors);
		if (Object.keys(nextErrors).length > 0) return;

		onAdd(name, {
			url: draft.url.trim(),
			method: draft.method,
			expectedStatus: Number(draft.expectedStatus),
			timeoutMs: Number(draft.timeoutMs),
			latencyThresholdMs: Number(draft.latencyThresholdMs),
		});
	}

	return (
		<Modal title="Add Endpoint" onClose={onClose}>
			<form className="es-form" onSubmit={handleSubmit} noValidate>
				<div className="es-form__field">
					<label className="es-form__label" htmlFor="es-add-name">
						Name <span className="es-form__required">*</span>
					</label>
					<input
						id="es-add-name"
						className={inputClass(errors.name !== undefined)}
						type="text"
						value={draft.name}
						onChange={(event) => update({ name: event.target.value })}
						placeholder="e.g. Payments API"
						data-autofocus
						aria-invalid={errors.name !== undefined}
						aria-describedby={errors.name ? "es-add-name-error" : undefined}
					/>
					{errors.name ? (
						<p className="es-form__error" id="es-add-name-error">
							{errors.name}
						</p>
					) : null}
				</div>

				<div className="es-form__field">
					<label className="es-form__label" htmlFor="es-add-url">
						URL <span className="es-form__required">*</span>
					</label>
					<input
						id="es-add-url"
						className={inputClass(errors.url !== undefined)}
						type="text"
						value={draft.url}
						onChange={(event) => update({ url: event.target.value })}
						placeholder="https://example.com/health or /api/demo/healthy"
						aria-invalid={errors.url !== undefined}
						aria-describedby={errors.url ? "es-add-url-error" : undefined}
					/>
					<p className="es-form__hint">
						Absolute http(s) URL or a relative /api/demo route.
					</p>
					{errors.url ? (
						<p className="es-form__error" id="es-add-url-error">
							{errors.url}
						</p>
					) : null}
				</div>

				<div className="es-form__row">
					<div className="es-form__field">
						<label className="es-form__label" htmlFor="es-add-method">
							Method
						</label>
						<select
							id="es-add-method"
							className="es-form__select"
							value={draft.method}
							onChange={(event) =>
								update({ method: event.target.value as HttpMethod })
							}
						>
							{HTTP_METHODS.map((method) => (
								<option key={method} value={method}>
									{method}
								</option>
							))}
						</select>
					</div>

					<div className="es-form__field">
						<label className="es-form__label" htmlFor="es-add-expected">
							Expected Status
						</label>
						<input
							id="es-add-expected"
							className={inputClass(errors.expectedStatus !== undefined)}
							type="number"
							inputMode="numeric"
							min={100}
							max={599}
							step={1}
							value={draft.expectedStatus}
							onChange={(event) => update({ expectedStatus: event.target.value })}
							aria-invalid={errors.expectedStatus !== undefined}
							aria-describedby={
								errors.expectedStatus ? "es-add-expected-error" : undefined
							}
						/>
						{errors.expectedStatus ? (
							<p className="es-form__error" id="es-add-expected-error">
								{errors.expectedStatus}
							</p>
						) : null}
					</div>
				</div>

				<div className="es-form__row">
					<div className="es-form__field">
						<label className="es-form__label" htmlFor="es-add-timeout">
							Timeout (ms)
						</label>
						<input
							id="es-add-timeout"
							className={inputClass(errors.timeoutMs !== undefined)}
							type="number"
							inputMode="numeric"
							min={1}
							step={1}
							value={draft.timeoutMs}
							onChange={(event) => update({ timeoutMs: event.target.value })}
							aria-invalid={errors.timeoutMs !== undefined}
							aria-describedby={errors.timeoutMs ? "es-add-timeout-error" : undefined}
						/>
						{errors.timeoutMs ? (
							<p className="es-form__error" id="es-add-timeout-error">
								{errors.timeoutMs}
							</p>
						) : null}
					</div>

					<div className="es-form__field">
						<label className="es-form__label" htmlFor="es-add-latency">
							Latency Threshold (ms)
						</label>
						<input
							id="es-add-latency"
							className={inputClass(errors.latencyThresholdMs !== undefined)}
							type="number"
							inputMode="numeric"
							min={1}
							step={1}
							value={draft.latencyThresholdMs}
							onChange={(event) =>
								update({ latencyThresholdMs: event.target.value })
							}
							aria-invalid={errors.latencyThresholdMs !== undefined}
							aria-describedby={
								errors.latencyThresholdMs ? "es-add-latency-error" : undefined
							}
						/>
						{errors.latencyThresholdMs ? (
							<p className="es-form__error" id="es-add-latency-error">
								{errors.latencyThresholdMs}
							</p>
						) : null}
					</div>
				</div>

				<div className="es-form__actions">
					<button type="button" className="es-btn" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" className="es-btn es-btn--primary">
						Add Endpoint
					</button>
				</div>
			</form>
		</Modal>
	);
}
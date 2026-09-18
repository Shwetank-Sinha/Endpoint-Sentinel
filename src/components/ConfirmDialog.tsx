import Modal from "./Modal";
interface Props { name: string; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }
export default function ConfirmDialog({ name, busy, error, onCancel, onConfirm }: Props) {
	return <Modal title="Delete endpoint?" onClose={onCancel}><p>Delete <strong>{name}</strong> and all of its check history? This cannot be undone.</p>{error ? <p className="es-form__error" role="alert">{error}</p> : null}<div className="es-form__actions"><button className="es-btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button data-autofocus className="es-btn es-btn--danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Deleting…" : "Delete Endpoint"}</button></div></Modal>;
}

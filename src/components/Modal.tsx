import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
	title: string;
	children: ReactNode;
	onClose: () => void;
}

const FOCUSABLE_SELECTOR =
	'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal chrome (backdrop, escape-to-close, body scroll lock, focus
 * management) rendered into a portal. The AddEndpoint and History modals
 * build on it.
 */
export default function Modal({ title, children, onClose }: ModalProps) {
	const titleId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	const previouslyFocusedRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		previouslyFocusedRef.current = previouslyFocused;

		const dialog = dialogRef.current;
		if (dialog !== null) {
			const autoFocusTarget = dialog.querySelector<HTMLElement>("[data-autofocus]");
			if (autoFocusTarget !== null) {
				autoFocusTarget.focus();
			} else {
				dialog.focus();
			}
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}

			if (event.key !== "Tab" || dialog === null) return;

			const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const activeElement = document.activeElement;

			if (event.shiftKey && (activeElement === first || activeElement === dialog)) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
			previouslyFocusedRef.current?.focus();
		};
	}, [onClose]);

	function onBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
		if (event.target === event.currentTarget) onClose();
	}

	return createPortal(
		<div className="es-modal-backdrop" onMouseDown={onBackdropMouseDown}>
			<div
				ref={dialogRef}
				className="es-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				<header className="es-modal__header">
					<h2 className="es-modal__title" id={titleId}>
						{title}
					</h2>
					<button
						type="button"
						className="es-modal__close"
						onClick={onClose}
						aria-label="Close dialog"
					>
						&times;
					</button>
				</header>
				<div className="es-modal__body">{children}</div>
			</div>
		</div>,
		document.body,
	);
}
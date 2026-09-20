import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
interface ModalProps { title: string; children: ReactNode; onClose: () => void; closeDisabled?: boolean; size?: 'wide' | 'small' }
/** Native modal dialogs supply focus containment, background inertness and stacked Escape handling. */
export default function Modal({ title, children, onClose, closeDisabled = false, size }: ModalProps) {
  const titleId = useId(), dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose), disabledRef = useRef(closeDisabled);
  closeRef.current = onClose; disabledRef.current = closeDisabled;
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = 'hidden';
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();
    const cancel = (event: Event) => { event.preventDefault(); if (!disabledRef.current) closeRef.current(); };
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const targets = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(el => !el.closest('fieldset:disabled') && el.getClientRects().length > 0);
      const first = targets[0], last = targets.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('keydown', trap);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('keydown', trap); dialog.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return createPortal(<dialog ref={dialogRef} className={'es-modal es-modal-native' + (size ? ' es-modal--' + size : '')} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={event => {
    if (event.target !== event.currentTarget || closeDisabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><header className="es-modal__header"><h2 className="es-modal__title" id={titleId}>{title}</h2><button className="es-modal__close" type="button" disabled={closeDisabled} onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></header><div className="es-modal__body">{children}</div></dialog>, document.body);
}

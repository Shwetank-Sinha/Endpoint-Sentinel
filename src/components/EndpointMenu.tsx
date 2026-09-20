import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Icon from './Icon';
interface Props { name: string; enabled: boolean; busy: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void }
export default function EndpointMenu({ name, enabled, busy, onEdit, onToggle, onDelete }: Props) {
  const [open, setOpen] = useState(false), id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') setOpen(false);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }
  function action(callback: () => void) { close(); callback(); }
  return <div className="es-menu-root" ref={root} onKeyDown={key}><button className="es-btn es-menu-trigger" ref={trigger} type="button" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={e => { if (!open && e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}><Icon name="more" /></button>{open ? <div className="es-menu" role="menu" aria-label={`Actions for ${name}`} id={id}><button role="menuitem" onClick={() => action(onEdit)}>Edit endpoint</button><button role="menuitem" disabled={busy} onClick={() => action(onToggle)}>{enabled ? 'Pause monitoring' : 'Resume monitoring'}</button><button role="menuitem" className="es-menu-danger" onClick={() => action(onDelete)}>Delete endpoint</button></div> : null}</div>;
}

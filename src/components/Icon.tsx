type Name = 'pulse' | 'grid' | 'endpoint' | 'incident' | 'team' | 'sun' | 'moon' | 'arrow' | 'plus' | 'refresh' | 'close' | 'more' | 'check';
const paths: Record<Name, string> = {
  pulse: 'M2 12h4l3-8 6 16 3-8h4', grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  endpoint: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 12h8', incident: 'M12 3 2 21h20L12 3z M12 9v5 M12 17v1',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M16 3a4 4 0 0 1 0 8',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
  moon: 'M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10z', arrow: 'M5 12h14 M13 6l6 6-6 6',
  plus: 'M12 5v14 M5 12h14', refresh: 'M20 7v5h-5 M4 17v-5h5 M5 7a8 8 0 0 1 13-2l2 2 M4 17l2 2a8 8 0 0 0 13-2',
  close: 'm6 6 12 12 M6 18 18 6', more: 'M4 12h.01 M12 12h.01 M20 12h.01', check: 'm5 12 4 4L19 6',
};
export default function Icon({ name }: { name: Name }) { return <svg className="es-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }

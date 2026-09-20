import { useEffect, useState } from 'react';
import Icon from './Icon';
const KEY = 'endpoint-sentinel-theme';
export default function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  function apply(value: string) { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value; setTheme(value); }
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const systemChanged = () => { let saved = null; try { saved = localStorage.getItem(KEY); } catch { /* use system */ } if (saved !== 'light' && saved !== 'dark') apply(media.matches ? 'dark' : 'light'); };
    const storageChanged = (event: StorageEvent) => { if (event.key === KEY) event.newValue === 'light' || event.newValue === 'dark' ? apply(event.newValue) : systemChanged(); };
    media.addEventListener('change', systemChanged); window.addEventListener('storage', storageChanged);
    return () => { media.removeEventListener('change', systemChanged); window.removeEventListener('storage', storageChanged); };
  }, []);
  function toggle() { const next = theme === 'dark' ? 'light' : 'dark'; apply(next); try { localStorage.setItem(KEY, next); } catch { /* In-memory theme still works. */ } }
  return <button className="es-btn es-theme" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'AMOLED dark'} mode`} onClick={toggle}><Icon name={theme === 'dark' ? 'moon' : 'sun'} /><span>{theme === 'dark' ? 'AMOLED dark' : 'Light mode'}</span></button>;
}

// Runs before the app paints. Only a non-sensitive theme preference is stored.
(() => {
  let theme;
  try { theme = localStorage.getItem('endpoint-sentinel-theme'); } catch { /* Storage may be disabled. */ }
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();

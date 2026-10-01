// Light / dark look. The choice is remembered on this device; documents always print on white.
import { useState } from 'react';
const KEY = 'aali-theme';
const read = () => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
export function applyTheme(t = read()) { document.documentElement.dataset.theme = t; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#15120b' : '#b87400'); }
export function ThemeToggle({ label }) {
  const [t, setT] = useState(read), dark = t === 'dark';
  const flip = () => { const n = dark ? 'light' : 'dark'; try { localStorage.setItem(KEY, n); } catch {} applyTheme(n); setT(n); };
  return <button type="button" className={label ? 'btn sm' : 'eye theme'} aria-pressed={dark} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={flip}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />}</svg>
    {label && (dark ? 'Light mode' : 'Dark mode')}</button>;
}

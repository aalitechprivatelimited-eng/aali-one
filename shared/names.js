// A display name is the short name shown on screen ("Nikhil" for "Nikhilesh Venkata Sai Tanniru").
// It must be made of the person's own name: every word of it has to be the start of one of their names, at least 3 letters long.
// So "Nikhil", "Venkat", "Sai" and "Venkata Sai" pass; "Demigod" does not. An empty display name means: show the full name.
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export function displayOk(display, full) {
  const d = words(display), f = words(full), used = new Set();
  return d.every((w) => { if (w.length < 3) return false; const i = f.findIndex((x, j) => !used.has(j) && x.startsWith(w)); if (i < 0) return false; used.add(i); return true; });
}
// Ready-made choices to tap: each name, and the first two together.
export function displayChoices(full) {
  const f = String(full || '').trim().split(/\s+/).filter((w) => w.replace(/[^a-z0-9]/gi, '').length >= 3);
  return [...new Set([...f, f.length > 2 ? `${f[0]} ${f[1]}` : ''].filter(Boolean))].slice(0, 6);
}

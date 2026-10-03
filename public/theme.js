// Sets the look (light or dark) before anything is drawn, so the opening screen never flashes the wrong colour.
try { document.documentElement.dataset.theme = localStorage.getItem('aali-theme') === 'dark' ? 'dark' : 'light'; } catch (e) {}

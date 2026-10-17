import { createRoot } from 'react-dom/client';
import { watchCardTables } from './cardtables.js';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
// The fonts are served by Aali One itself (no Google Fonts): no flash of other letters while they load, and nothing from outside.
import '@fontsource/archivo/400.css'; import '@fontsource/archivo/500.css'; import '@fontsource/archivo/600.css'; import '@fontsource/archivo/700.css';
import '@fontsource/source-serif-4/600.css'; import '@fontsource/source-serif-4/700.css'; import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { applyTheme } from './theme.jsx';

applyTheme();

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
watchCardTables(); // wide tables become cards on a phone

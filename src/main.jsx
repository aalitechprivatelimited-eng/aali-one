import { createRoot } from 'react-dom/client';
import { watchCardTables } from './cardtables.js';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';
import { applyTheme } from './theme.jsx';

applyTheme();

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
watchCardTables(); // wide tables become cards on a phone

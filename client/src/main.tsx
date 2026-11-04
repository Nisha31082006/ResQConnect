import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { HASH_MODE } from './services/api';
import 'leaflet/dist/leaflet.css';
import './i18n';
import './index.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { OfflineProvider } from './context/OfflineContext';
import { ToastProvider } from './context/ToastContext';

const Router = HASH_MODE ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <ToastProvider>
        <AuthProvider>
          <OfflineProvider>
            <App />
          </OfflineProvider>
        </AuthProvider>
      </ToastProvider>
    </Router>
  </React.StrictMode>,
);

// Service worker only caches the app shell (never /api). Production builds only, so dev hot reload is unaffected.
if ('serviceWorker' in navigator && import.meta.env.PROD && !HASH_MODE) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

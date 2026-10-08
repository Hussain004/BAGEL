import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './landing.css';
import App from './App';
import { consumeLaunchFiles, registerServiceWorker } from './utils/pwa';

registerServiceWorker();
consumeLaunchFiles();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

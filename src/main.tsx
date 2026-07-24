import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/fraunces/latin-600.css';
import './index.css';
import App from './app/App';
import { installService } from './pwa/install';
import { updateManager } from './pwa/updateManager';

updateManager.register();
installService.init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
